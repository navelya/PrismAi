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
    hasAudio: boolean;         // video has at least one audio stream
}

export interface RenderCompositorVideoOptions {
    /** Mix per-layer audio into the output. Workflow executor leaves this off; download route turns it on. */
    includeAudio: boolean;
    /** libx264 CRF. Lower = higher quality + bigger file. Default 23 keeps parity with the workflow executor. */
    crf?: number;
}

/**
 * Render the compositor's temporal timeline to an mp4 Buffer.
 *
 * Shared core between the workflow executor (which uploads the result and
 * returns a URL) and the download API route (which streams the buffer back
 * to the browser). Both callers pass the same (config, inputs) shape — the
 * `inputs` map is keyed by `layer.sourceHandleId` -> resolved URL.
 */
export async function renderCompositorVideo(
    config: CompositorConfig,
    inputs: Record<string, any>,
    options: RenderCompositorVideoOptions,
): Promise<Buffer> {
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

        // Per-layer diagnostic so a missing layer in the final mp4 can be
        // triaged from the server log: shows whether the URL classified to a
        // usable kind, what Content-Type came back from the fetch, and which
        // skip path (if any) fired.
        const layerDiagnostics: Array<{
            layerName: string;
            url: string | undefined;
            urlKind: LayerSourceKind;
            contentType?: string;
            finalKind?: 'video' | 'image';
            skipped?: string;
        }> = [];

        for (let i = 0; i < visibleLayers.length; i++) {
            const layer = visibleLayers[i];
            const url = inputs[layer.sourceHandleId];
            if (!url || typeof url !== 'string') {
                layerDiagnostics.push({ layerName: layer.name, url: undefined, urlKind: 'unknown', skipped: 'no-input-url' });
                continue;
            }
            let kind: 'video' | 'image' | 'text' | 'unknown' = detectSourceKindFromUrl(url);

            // Content-Type fallback: when the URL doesn't carry a recognizable
            // extension (e.g. signed Supabase URLs, AI model proxy paths), do
            // a HEAD to ask the server. Without this, a layer with a valid
            // image-but-no-extension URL was silently dropped here and never
            // overlaid into the final mp4.
            let contentType: string | undefined;
            if (kind !== 'video' && kind !== 'image') {
                try {
                    const head = await fetch(url, { method: 'HEAD' });
                    contentType = head.headers.get('content-type') || undefined;
                    if (contentType?.startsWith('video/')) kind = 'video';
                    else if (contentType?.startsWith('image/')) kind = 'image';
                } catch {
                    // HEAD failed — fall through; the GET below will still try.
                }
            }

            if (kind !== 'video' && kind !== 'image') {
                layerDiagnostics.push({
                    layerName: layer.name,
                    url,
                    urlKind: detectSourceKindFromUrl(url),
                    contentType,
                    skipped: `unsupported-kind:${kind}`,
                });
                continue;
            }

            const ext = kind === 'video' ? 'mp4' : 'png';
            const inputPath = path.join(tmpDir, `in_${i}.${ext}`);
            try {
                const resp = await fetch(url);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                // Secondary classification refinement: if we still aren't
                // sure and the GET gives us a Content-Type, use it.
                if (!contentType) {
                    contentType = resp.headers.get('content-type') || undefined;
                }
                const buf = Buffer.from(await resp.arrayBuffer());
                await fs.writeFile(inputPath, buf);
            } catch (err) {
                console.error(
                    `[renderCompositorVideo] Skipping layer ${layer.name}: fetch failed`,
                    err,
                );
                layerDiagnostics.push({
                    layerName: layer.name,
                    url,
                    urlKind: detectSourceKindFromUrl(url),
                    contentType,
                    skipped: `fetch-failed:${err instanceof Error ? err.message : 'unknown'}`,
                });
                continue;
            }

            let intrinsicDuration = 0;
            let hasAudio = false;
            if (kind === 'video') {
                const probe = await probeVideoStreams(ffmpeg, inputPath).catch(() => ({ duration: 0, hasAudio: false }));
                intrinsicDuration = probe.duration;
                hasAudio = probe.hasAudio;
            }

            layerDiagnostics.push({
                layerName: layer.name,
                url,
                urlKind: detectSourceKindFromUrl(url),
                contentType,
                finalKind: kind,
            });

            processed.push({
                layer,
                inputPath,
                sourceKind: kind,
                intrinsicDuration,
                effectiveDuration: 0, // filled below once we know the timeline total
                startTime: Math.max(0, layer.startTime || 0),
                hasAudio,
            });
        }

        console.log(
            '[renderCompositorVideo] layer-resolution diagnostic',
            JSON.stringify(layerDiagnostics, null, 2),
        );

        if (processed.length === 0) {
            throw new Error('No renderable layers on temporal compositor.');
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

        // ── Build the video filter graph ──
        // [bg]                           color=black, size=WxH, duration=total
        // For each input i:
        //   - image: [i:v]loop=-1:1:0,trim=duration=eff,setpts=PTS-STARTPTS+startT/TB,scale=w:h,format=rgba[L_i]
        //   - video: [i:v]trim=duration=eff,setpts=PTS-STARTPTS+startT/TB,scale=w:h,format=rgba[L_i]
        // Overlay each [L_i] onto the running canvas with time gating + x/y.
        //
        // The `+startT/TB` PTS shift parks each layer's frames at the global
        // canvas timestamp where the layer is supposed to play. Without it,
        // `setpts=PTS-STARTPTS` rebases the trimmed stream to [0..eff], so for
        // layers that start at t>0 the overlay window [startT..endT] falls
        // *past EOF* of that stream — overlay's default `eof_action=repeat`
        // then holds the last decoded frame (in practice the first, since the
        // decoder has barely advanced when `enable` flips on), making the
        // layer look like a frozen still. Image layers happen to look fine
        // either way because every frame is identical.
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
            const setpts = `setpts=PTS-STARTPTS+${startT.toFixed(3)}/TB`;

            const layerLabel = `L${idx}`;
            filters.push(
                `[${idx}:v]trim=duration=${eff.toFixed(3)},${setpts},scale=${w}:${h}:flags=bilinear,format=rgba[${layerLabel}]`,
            );

            const nextChain = idx === processed.length - 1 ? 'vout' : `s${idx}`;
            filters.push(
                `[${currentChain}][${layerLabel}]overlay=x=${x}:y=${y}:enable='between(t,${startT.toFixed(3)},${endT.toFixed(3)})':format=auto[${nextChain}]`,
            );
            currentChain = nextChain;
        });

        // ── Build the audio mix (when requested + at least one audible video) ──
        // For each unmuted video layer with audio:
        //   [i:a]atrim=duration=eff,asetpts=PTS-STARTPTS,adelay=ms|ms|...|ms[A_i]
        // The pipe-delimited delay list repeats the per-channel offset 8 times so
        // mono / stereo / 5.1 / 7.1 all get the same shift. We avoided the newer
        // `:all=1` option because the static ffmpeg builds shipped by
        // @ffmpeg-installer don't all carry it ("Option not found").
        // Then amix together (or use the single chain directly when there's only one).
        const outputMaps: string[] = ['vout'];
        let useAudio = false;
        if (options.includeAudio) {
            const audible = processed
                .map((p, idx) => ({ p, idx }))
                .filter(({ p }) => p.sourceKind === 'video' && p.hasAudio && !p.layer.muted);

            if (audible.length > 0) {
                const audioLabels: string[] = [];
                audible.forEach(({ p, idx }) => {
                    const startMs = Math.max(0, Math.round(p.startTime * 1000));
                    const delays = new Array(8).fill(startMs).join('|');
                    const label = `A${idx}`;
                    filters.push(
                        `[${idx}:a]atrim=duration=${p.effectiveDuration.toFixed(3)},asetpts=PTS-STARTPTS,adelay=${delays}[${label}]`,
                    );
                    audioLabels.push(label);
                });

                if (audioLabels.length === 1) {
                    outputMaps.push(audioLabels[0]);
                } else {
                    const mixIn = audioLabels.map((l) => `[${l}]`).join('');
                    filters.push(
                        `${mixIn}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0[aout]`,
                    );
                    outputMaps.push('aout');
                }
                useAudio = true;
            }
        }

        const filterComplex = filters.join(';');
        const outputPath = path.join(tmpDir, 'out.mp4');

        console.log(`[renderCompositorVideo] filter_complex: ${filterComplex}`);

        await new Promise<void>((resolve, reject) => {
            const cmd = ffmpeg();
            // Add inputs in array order so [N:v] in the filter graph
            // matches the layer index.
            for (const p of processed) {
                cmd.input(p.inputPath);
            }
            const outputOptions: string[] = [
                '-t', total.toFixed(3),
                '-r', String(fps),
                '-c:v', 'libx264',
                '-preset', 'veryfast',
                '-pix_fmt', 'yuv420p',
                '-movflags', '+faststart',
            ];
            if (typeof options.crf === 'number') {
                outputOptions.push('-crf', String(options.crf));
            }
            if (useAudio) {
                outputOptions.push('-c:a', 'aac', '-b:a', '192k');
            } else {
                outputOptions.push('-an');
            }
            let stderrTail = '';
            cmd.complexFilter(filterComplex, outputMaps)
                .outputOptions(outputOptions)
                .on('stderr', (line: string) => {
                    stderrTail = (stderrTail + '\n' + line).slice(-2000);
                })
                .on('end', () => resolve())
                .on('error', (err: Error) => {
                    console.error('[renderCompositorVideo] ffmpeg failed.\nfilter_complex:\n', filterComplex, '\nstderr tail:\n', stderrTail);
                    reject(new Error(`${err.message}${stderrTail ? `\nffmpeg stderr:\n${stderrTail}` : ''}`));
                })
                .save(outputPath);
        });

        return await fs.readFile(outputPath);
    } finally {
        await cleanup();
    }
}

async function runTemporalRender(
    config: CompositorConfig,
    inputs: Record<string, any>,
    context: ExecutionContext,
    _sourceKindByLayerId: Record<string, LayerSourceKind>,
): Promise<NodeExecutionResult> {
    const width = Math.round(config?.canvasWidth || 1080);
    const height = Math.round(config?.canvasHeight || 1080);

    let outputBuffer: Buffer;
    try {
        outputBuffer = await renderCompositorVideo(config, inputs, { includeAudio: false });
    } catch (err) {
        return {
            success: false,
            data: null,
            error: `ffmpeg render failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        };
    }

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
}

/**
 * Probe a video for duration + audio-stream presence via ffprobe (bundled by
 * @ffprobe-installer). fluent-ffmpeg's .ffprobe() returns a promise-friendly
 * callback API.
 */
function probeVideoStreams(ffmpeg: any, filePath: string): Promise<{ duration: number; hasAudio: boolean }> {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err: Error | null, data: any) => {
            if (err) {
                reject(err);
                return;
            }
            const duration = data?.format?.duration;
            const hasAudio = Array.isArray(data?.streams) && data.streams.some((s: any) => s.codec_type === 'audio');
            resolve({
                duration: typeof duration === 'number' ? duration : 0,
                hasAudio,
            });
        });
    });
}
