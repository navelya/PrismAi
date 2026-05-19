import sharp from 'sharp';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { ExecutionContext, NodeExecutionResult, ImageObject } from '../../types';
import { CompositorConfig, CompositorLayer } from './definition';
import { createServiceClient } from '@/lib/supabase/service';
import {
    detectSourceKindFromUrl,
    LayerSourceKind,
    computeTimelineDuration,
    hasTemporalContent,
} from './shared';

/**
 * Compositor server executor (Stage 1 temporal-aware).
 *
 * Two code paths under one entrypoint:
 *
 *   1. **Still composite** — when no layer has a video source and no layer has
 *      a non-default time range. Identical to the legacy behavior: Sharp
 *      resize/rotate/flip/composite per layer, upload one image. Returns an
 *      `image` envelope. This path is byte-identical for workflows that
 *      pre-date the temporal fields.
 *
 *   2. **Temporal render** — when any layer is sourced from video, has a
 *      non-zero `startTime`, or sets a finite `duration`. Uses ffmpeg-wasm
 *      to:
 *        - Probe each video's intrinsic duration
 *        - Build a `-filter_complex` graph that scales each layer to its
 *          transform's W×H, time-gates it via `enable='between(t,...)'`, and
 *          overlays it onto a black canvas in array order (array[0] = bottom,
 *          matching the still-composite z-order).
 *        - Encodes the result as H.264 mp4 and uploads to `workflow-ephemeral-tmp`.
 *      Returns a `video` envelope.
 *
 *   The compositor exposes a single polymorphic output handle (`image_out`)
 *   whose static dataType is the union ['image','video']. The connection
 *   validator narrows it to 'video' at runtime whenever any wired layer is a
 *   video — so downstream image-only consumers reject the wire while video
 *   consumers accept it. This executor's emitted envelope (`image` vs
 *   `video`) matches that narrowing.
 *
 *   Known Stage 1 limitations on the temporal path:
 *     - Layer rotation, opacity, flip, blendMode, and crop are ignored on
 *       video output (these are still respected on still-composite output).
 *     - Audio is omitted from Stage 1 video output. amix scaffolding is
 *       planned for Stage 2 alongside per-layer muted/transition handling.
 *     - Server may exceed Vercel's 60s function budget for long timelines.
 */
export const compositorExecutor = async (
    config: CompositorConfig,
    inputs: Record<string, any>,
    context: ExecutionContext,
): Promise<NodeExecutionResult> => {
    try {
        const layers = (config?.layers || []) as CompositorLayer[];

        const sourceKindByLayerId: Record<string, LayerSourceKind> = {};
        for (const layer of layers) {
            const url = inputs[layer.sourceHandleId];
            sourceKindByLayerId[layer.id] =
                typeof url === 'string' ? detectSourceKindFromUrl(url) : 'unknown';
        }

        if (hasTemporalContent(layers, sourceKindByLayerId)) {
            return await runTemporalRender(config, inputs, context, sourceKindByLayerId);
        }
        return await runStillComposite(config, inputs, context);
    } catch (err) {
        return { success: false, data: null, error: err instanceof Error ? err.message : 'Compositor failed' };
    }
};

// ───────────────────────────────────────────────────────────────────────────
// Still-composite path (Sharp). Preserves the pre-temporal behavior exactly.
// ───────────────────────────────────────────────────────────────────────────

async function runStillComposite(
    config: CompositorConfig,
    inputs: Record<string, any>,
    context: ExecutionContext,
): Promise<NodeExecutionResult> {
    const width = Math.round(config?.canvasWidth || 1080);
    const height = Math.round(config?.canvasHeight || 1080);
    const layers = (config?.layers || []) as CompositorLayer[];
    const outputFormat = (config?.outputFormat || 'png') as string;
    const outputQuality = config?.outputQuality ?? 1.0;

    console.log(
        `[CompositorExecutor:still] Canvas ${width}x${height}, ${layers.length} layers`,
    );

    let baseCanvas = sharp({
        create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    });

    const layerResults = await Promise.all(
        layers.map(async (layer) => {
            if (!layer.visible) return null;
            const imageUrl = inputs[layer.sourceHandleId];
            if (!imageUrl || typeof imageUrl !== 'string') return null;

            try {
                const response = await fetch(imageUrl);
                if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
                const inputBuffer = Buffer.from(await response.arrayBuffer());
                const tf = layer.transform || ({} as any);
                const targetW = Math.max(1, Math.round(tf.width || width));
                const targetH = Math.max(1, Math.round(tf.height || height));
                const rotation = tf.rotation || 0;

                let imgSharp = sharp(inputBuffer).resize(targetW, targetH, { fit: 'fill' });
                if (tf.flipX) imgSharp = imgSharp.flop();
                if (tf.flipY) imgSharp = imgSharp.flip();
                if (rotation !== 0) {
                    imgSharp = imgSharp.rotate(rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
                }
                const processedBuffer = await imgSharp.toBuffer();
                return {
                    input: processedBuffer,
                    left: Math.round(tf.x || 0),
                    top: Math.round(tf.y || 0),
                };
            } catch (err) {
                console.error(`[CompositorExecutor:still] Layer ${layer.name} failed:`, err);
                return null;
            }
        }),
    );

    const overlays = layerResults.filter(
        (o): o is { input: Buffer; left: number; top: number } => o !== null,
    );
    if (overlays.length > 0) baseCanvas = baseCanvas.composite(overlays);

    let finalBuffer: Buffer;
    let contentType: string;
    if (outputFormat === 'jpg' || outputFormat === 'jpeg') {
        finalBuffer = await baseCanvas.jpeg({ quality: Math.round(outputQuality * 100) }).toBuffer();
        contentType = 'image/jpeg';
    } else if (outputFormat === 'webp') {
        finalBuffer = await baseCanvas.webp({ quality: Math.round(outputQuality * 100) }).toBuffer();
        contentType = 'image/webp';
    } else {
        finalBuffer = await baseCanvas.png().toBuffer();
        contentType = 'image/png';
    }

    const supabase = createServiceClient();
    const ext = outputFormat === 'jpg' ? 'jpg' : outputFormat === 'jpeg' ? 'jpeg' : outputFormat === 'webp' ? 'webp' : 'png';
    const filename = `${context.executionId}/${context.nodeId}/compositor_${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
        .from('workflow-ephemeral-tmp')
        .upload(filename, finalBuffer, { contentType, cacheControl: '3600' });
    if (uploadError) {
        return { success: false, data: null, error: `Storage upload failed: ${uploadError.message}` };
    }

    const { data: urlData } = supabase.storage.from('workflow-ephemeral-tmp').getPublicUrl(filename);

    const result: ImageObject = {
        url: urlData.publicUrl,
        resolution: { width, height },
        metadata: { format: outputFormat, source: 'Compositor', processedBy: 'ServerSharp' },
    };

    return { success: true, data: [result] };
}

// ───────────────────────────────────────────────────────────────────────────
// Temporal-render path (fluent-ffmpeg + @ffmpeg-installer/ffmpeg).
//
// Replaced the previous ffmpeg-wasm implementation because @ffmpeg/ffmpeg@0.12+
// is browser-only and throws "ffmpeg.wasm does not support nodejs" inside a
// Vercel function. The fluent-ffmpeg path uses a static Linux ffmpeg binary
// shipped by @ffmpeg-installer and a static ffprobe shipped by
// @ffprobe-installer, both bundled at deploy time so the function runs
// self-contained.
//
// Lazy import: image-only / still-composite workflows never load these
// modules (they're large on cold start), so the still path stays cheap.
// ───────────────────────────────────────────────────────────────────────────

interface ProcessedLayer {
    layer: CompositorLayer;
    inputPath: string;
    sourceKind: LayerSourceKind;
    intrinsicDuration: number; // seconds; 0 if unknown
    effectiveDuration: number; // seconds; what we actually render
    startTime: number;         // seconds
}

async function runTemporalRender(
    config: CompositorConfig,
    inputs: Record<string, any>,
    context: ExecutionContext,
    sourceKindByLayerId: Record<string, LayerSourceKind>,
): Promise<NodeExecutionResult> {
    const width = Math.round(config?.canvasWidth || 1080);
    const height = Math.round(config?.canvasHeight || 1080);
    const fps = Math.max(1, Math.min(60, Math.round(config?.fps || 30)));
    const allLayers = (config?.layers || []) as CompositorLayer[];

    const ffmpegLib = await import('fluent-ffmpeg');
    const ffmpegInstaller = await import('@ffmpeg-installer/ffmpeg');
    const ffprobeInstaller = await import('@ffprobe-installer/ffprobe');
    const ffmpeg = ffmpegLib.default;
    ffmpeg.setFfmpegPath(ffmpegInstaller.default.path);
    ffmpeg.setFfprobePath(ffprobeInstaller.default.path);

    // Stage everything in /tmp — the only writable area on Vercel/Lambda.
    // Cleanup at every exit path so a failing run doesn't leak between
    // invocations sharing the same warm function instance.
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'compositor-'));
    const cleanup = async () => {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    };

    try {
        // Stage videos and images that have a usable source URL and are
        // visible. Layers are processed in array order so the resulting
        // overlay chain produces array[0] = bottom of stack (matches the
        // still-composite z-order).
        const visibleLayers = allLayers.filter((l) => l.visible);
        const processed: ProcessedLayer[] = [];

        for (let i = 0; i < visibleLayers.length; i++) {
            const layer = visibleLayers[i];
            const url = inputs[layer.sourceHandleId];
            if (!url || typeof url !== 'string') continue;
            const kind = sourceKindByLayerId[layer.id] ?? detectSourceKindFromUrl(url);
            if (kind !== 'video' && kind !== 'image') {
                // Stage 1: text-only layers are skipped on the temporal path.
                // Sharp renders text via fonts; bridging that to ffmpeg is
                // Stage 2 work.
                continue;
            }

            const ext = kind === 'video' ? 'mp4' : 'png';
            const inputPath = path.join(tmpDir, `in_${i}.${ext}`);
            try {
                const resp = await fetch(url);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const buf = Buffer.from(await resp.arrayBuffer());
                await fs.writeFile(inputPath, buf);
            } catch (err) {
                console.error(
                    `[CompositorExecutor:temporal] Skipping layer ${layer.name}: fetch failed`,
                    err,
                );
                continue;
            }

            let intrinsicDuration = 0;
            if (kind === 'video') {
                intrinsicDuration = await probeVideoDuration(ffmpeg, inputPath).catch(() => 0);
            }

            processed.push({
                layer,
                inputPath,
                sourceKind: kind,
                intrinsicDuration,
                effectiveDuration: 0, // filled below once we know the timeline total
                startTime: Math.max(0, layer.startTime || 0),
            });
        }

        if (processed.length === 0) {
            await cleanup();
            return { success: false, data: null, error: 'No renderable layers on temporal compositor.' };
        }

        // Resolve total timeline duration. computeTimelineDuration honors
        // config.timelineDuration; otherwise max(startTime + effective duration).
        const intrinsicMap: Record<string, number | null> = {};
        for (const p of processed) intrinsicMap[p.layer.id] = p.intrinsicDuration || null;
        const total = computeTimelineDuration(
            processed.map((p) => p.layer),
            config?.timelineDuration ?? null,
            intrinsicMap,
        );

        // Effective duration per layer (after `total` — image/text layers
        // without configured duration fall back to the total).
        for (const p of processed) {
            if (typeof p.layer.duration === 'number' && p.layer.duration > 0) {
                p.effectiveDuration = p.layer.duration;
            } else if (p.sourceKind === 'video' && p.intrinsicDuration > 0) {
                p.effectiveDuration = p.intrinsicDuration;
            } else {
                p.effectiveDuration = Math.max(0.1, total - p.startTime);
            }
        }

        // ── Build the filter graph ──
        // [bg]                           color=black, size=WxH, duration=total
        // For each input i:
        //   - image: [i:v]loop=-1:1:0,trim=duration=eff,setpts=PTS-STARTPTS,scale=w:h,format=rgba[L_i]
        //   - video: [i:v]trim=duration=eff,setpts=PTS-STARTPTS,scale=w:h,format=rgba[L_i]
        // Overlay each [L_i] onto the running canvas with time gating + x/y.
        const filters: string[] = [];
        filters.push(`color=c=black:s=${width}x${height}:r=${fps}:d=${total}[bg]`);

        let currentChain = 'bg';
        processed.forEach((p, idx) => {
            const tf = p.layer.transform || ({} as any);
            const w = Math.max(2, Math.round(tf.width || width));
            const h = Math.max(2, Math.round(tf.height || height));
            const x = Math.round(tf.x || 0);
            const y = Math.round(tf.y || 0);
            const eff = p.effectiveDuration;
            const startT = p.startTime;
            const endT = startT + eff;

            const layerLabel = `L${idx}`;
            if (p.sourceKind === 'image') {
                filters.push(
                    `[${idx}:v]loop=loop=-1:size=1:start=0,trim=duration=${eff.toFixed(3)},setpts=PTS-STARTPTS,scale=${w}:${h}:flags=bilinear,format=rgba[${layerLabel}]`,
                );
            } else {
                filters.push(
                    `[${idx}:v]trim=duration=${eff.toFixed(3)},setpts=PTS-STARTPTS,scale=${w}:${h}:flags=bilinear,format=rgba[${layerLabel}]`,
                );
            }

            const nextChain = idx === processed.length - 1 ? 'out' : `s${idx}`;
            filters.push(
                `[${currentChain}][${layerLabel}]overlay=x=${x}:y=${y}:enable='between(t,${startT.toFixed(3)},${endT.toFixed(3)})':format=auto[${nextChain}]`,
            );
            currentChain = nextChain;
        });

        const filterComplex = filters.join(';');
        const outputPath = path.join(tmpDir, 'out.mp4');

        console.log(`[CompositorExecutor:temporal] filter_complex: ${filterComplex}`);

        try {
            await new Promise<void>((resolve, reject) => {
                const cmd = ffmpeg();
                // Add inputs in array order so [N:v] in the filter graph
                // matches the layer index.
                for (const p of processed) {
                    if (p.sourceKind === 'image') {
                        cmd.input(p.inputPath).inputOptions(['-loop', '1']);
                    } else {
                        cmd.input(p.inputPath);
                    }
                }
                cmd.complexFilter(filterComplex, ['out'])
                    .outputOptions([
                        '-t', total.toFixed(3),
                        '-r', String(fps),
                        '-c:v', 'libx264',
                        '-preset', 'veryfast',
                        '-pix_fmt', 'yuv420p',
                        '-movflags', '+faststart',
                        '-an', // Stage 1: no audio (mirrors the wasm version)
                    ])
                    .on('end', () => resolve())
                    .on('error', (err) => reject(err))
                    .save(outputPath);
            });
        } catch (err) {
            await cleanup();
            return {
                success: false,
                data: null,
                error: `ffmpeg render failed: ${err instanceof Error ? err.message : 'unknown error'}`,
            };
        }

        let outputBuffer: Buffer;
        try {
            outputBuffer = await fs.readFile(outputPath);
        } catch (err) {
            await cleanup();
            return {
                success: false,
                data: null,
                error: `ffmpeg produced no output: ${err instanceof Error ? err.message : 'unknown error'}`,
            };
        }

        await cleanup();

        const supabase = createServiceClient();
        const filename = `${context.executionId}/${context.nodeId}/compositor_${Date.now()}.mp4`;
        const { error: uploadError } = await supabase.storage
            .from('workflow-ephemeral-tmp')
            .upload(filename, outputBuffer, { contentType: 'video/mp4', cacheControl: '3600' });
        if (uploadError) {
            return { success: false, data: null, error: `Storage upload failed: ${uploadError.message}` };
        }

        const { data: urlData } = supabase.storage.from('workflow-ephemeral-tmp').getPublicUrl(filename);

        return {
            success: true,
            data: [
                {
                    url: urlData.publicUrl,
                    resolution: { width, height },
                    metadata: {
                        format: 'mp4',
                        source: 'Compositor',
                        processedBy: 'ServerFluentFfmpeg',
                    },
                },
            ],
        };
    } catch (err) {
        await cleanup();
        throw err;
    }
}

/**
 * Probe a video's duration via ffprobe (bundled by @ffprobe-installer).
 * fluent-ffmpeg's .ffprobe() returns a promise-friendly callback API.
 */
function probeVideoDuration(ffmpeg: any, filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err: Error | null, data: any) => {
            if (err) {
                reject(err);
                return;
            }
            const duration = data?.format?.duration;
            resolve(typeof duration === 'number' ? duration : 0);
        });
    });
}
