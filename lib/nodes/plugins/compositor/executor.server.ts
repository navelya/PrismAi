import sharp from 'sharp';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { ExecutionContext, NodeExecutionResult, ImageObject } from '../../types';
import { CompositorConfig, CompositorLayer } from './definition';
import { uploadEphemeralResult } from '../utils/ephemeral';
import {
    detectSourceKindFromUrl,
    LayerSourceKind,
    computeTimelineDuration,
    hasTemporalContent,
} from './shared';

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 } as const;

/**
 * A layer's resolved input is either a media URL (image/video to fetch) or a
 * raw string from an upstream Prompt/Text node. Anything that begins with an
 * http(s)/data/blob scheme is treated as media; everything else is text.
 *
 * Prompt text never carries a URL scheme, so this cleanly separates the two
 * without needing a separate per-layer "type" field (the compositor model has
 * none — a layer is whatever its wire resolves to; see definition.ts).
 */
function isMediaUrl(value: string): boolean {
    return /^(https?:|data:|blob:)/i.test(value.trim());
}

function escapePangoText(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Pango's foreground wants #rrggbb — drop any 8-digit alpha suffix. */
function normalizeHex(color: string | undefined): string {
    const v = (color || '#ffffff').trim();
    const m = /^#([0-9a-fA-F]{8})$/.exec(v);
    return m ? `#${m[1].slice(0, 6)}` : v;
}

/**
 * Rasterize a text layer to a transparent `boxW×boxH` RGBA PNG buffer using
 * libvips/Pango (bundled with sharp — see `sharp.versions.pango`). The text is
 * wrapped to the layer's box width, horizontally aligned, and vertically
 * centered inside the box, so a text layer composites EXACTLY like an image
 * layer of the same transform size. This mirrors the editor's Konva text box
 * (Renderer.tsx `LayerText`: width/height box, align, verticalAlign:'middle',
 * default fontSize 48 / family Inter / style bold / fill #ffffff).
 *
 * Font-fidelity caveat: rendering uses whatever font fontconfig resolves for
 * the requested family on the server. If the family (e.g. "Inter") isn't
 * installed, Pango falls back to a default sans — the text still renders, the
 * face may differ from the editor. letterSpacing/lineHeight are approximated
 * via Pango's letter_spacing/spacing.
 */
async function renderTextLayerToBuffer(
    layer: CompositorLayer,
    text: string,
    canvasW: number,
    canvasH: number,
): Promise<Buffer | null> {
    const t = layer.transform || ({} as any);
    const boxW = Math.max(1, Math.round(t.width || canvasW));
    const boxH = Math.max(1, Math.round(t.height || canvasH));
    const fontSize = Math.max(1, Math.round(t.fontSize || 48));
    const family = (t.fontFamily || 'Inter').trim();

    // Konva stores weight/style in `fontStyle` ('bold' | 'italic' |
    // 'bold italic' | 'normal'), defaulting to 'bold'; LayerTransform also
    // carries `fontWeight`. Fold both into a Pango font description:
    // "<Family> [Italic] [Bold] <size>".
    const rawStyle = (t.fontStyle ?? 'bold').toString().toLowerCase();
    const rawWeight = (t.fontWeight ?? '').toString().toLowerCase();
    const italic = rawStyle.includes('italic') || rawWeight.includes('italic');
    const bold = rawStyle.includes('bold') || /(^|\s)(bold|600|700|800|900)(\s|$)/.test(rawWeight);
    const fontDesc = `${family}${italic ? ' Italic' : ''}${bold ? ' Bold' : ''} ${fontSize}`;

    const align: 'left' | 'centre' | 'right' =
        t.textAlign === 'left' ? 'left' : t.textAlign === 'right' ? 'right' : 'centre';

    const letterSpacingUnits = Math.round((t.letterSpacing || 0) * 1024); // Pango units = 1/1024 pt
    const lineSpacingPx = Math.max(0, Math.round(((t.lineHeight || 1.2) - 1) * fontSize));

    const spanAttrs = [`foreground="${normalizeHex(t.fillColor)}"`];
    if (letterSpacingUnits) spanAttrs.push(`letter_spacing="${letterSpacingUnits}"`);
    const markup = `<span ${spanAttrs.join(' ')}>${escapePangoText(text)}</span>`;

    let textBuf: Buffer;
    try {
        textBuf = await sharp({
            text: {
                text: markup,
                font: fontDesc,
                rgba: true,
                width: boxW,
                align,
                spacing: lineSpacingPx,
            },
        }).png().toBuffer();
    } catch (err) {
        console.error(`[CompositorExecutor] text rasterization failed for layer ${layer.name}:`, err);
        return null;
    }

    const tmeta = await sharp(textBuf).metadata();
    const tw = Math.min(boxW, tmeta.width || boxW);
    const th = Math.min(boxH, tmeta.height || fontSize);

    // Place inside the box: align horizontally, center vertically
    // (verticalAlign:'middle'). Clamp to >=0 since sharp.composite rejects
    // negative offsets — over-tall/over-wide text clips at the box edge,
    // matching Konva's box clipping.
    const left = align === 'right' ? boxW - tw : align === 'centre' ? Math.round((boxW - tw) / 2) : 0;
    const top = Math.round((boxH - th) / 2);

    return sharp({
        create: { width: boxW, height: boxH, channels: 4, background: TRANSPARENT },
    })
        .composite([{ input: textBuf, left: Math.max(0, left), top: Math.max(0, top) }])
        .png()
        .toBuffer();
}

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
 *   Audio: the audio tracks of video layers AND dedicated audio layers are
 *   mixed into the output (both the Run/workflow path and the Download route
 *   pass includeAudio). Per-layer `muted` is honored; audio layers carry no
 *   visual and are never overlaid.
 *
 *   Known Stage 1 limitations on the temporal path:
 *     - Layer rotation, opacity, flip, blendMode, and crop are ignored on
 *       video output (these are still respected on still-composite output).
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
    let width = Math.round(config?.canvasWidth || 1080);
    let height = Math.round(config?.canvasHeight || 1080);
    const layers = (config?.layers || []) as CompositorLayer[];
    const outputFormat = (config?.outputFormat || 'png') as string;
    const outputQuality = config?.outputQuality ?? 1.0;

    // Server-side auto-fit parity (see renderCompositorVideo). When the SINGLE
    // visible media layer was never client-fitted (the LLM guessed its transform
    // before the image existed), resize the canvas to the source and composite it
    // full-bleed — otherwise `fit:'fill'` stretches it into the guessed box and a
    // larger canvas adds bars. Gated on `isAutoCentered`, so editor-built
    // composites (which set it true) stay byte-identical. The probed buffer is
    // reused below to avoid a second fetch.
    let fitLayerId: string | null = null;
    const prefetched = new Map<string, Buffer>();
    {
        const visibleMedia = layers.filter(
            (l) => l.visible && typeof inputs[l.sourceHandleId] === 'string' && isMediaUrl(inputs[l.sourceHandleId]),
        );
        if (visibleMedia.length === 1 && visibleMedia[0].transform?.isAutoCentered !== true) {
            const only = visibleMedia[0];
            try {
                const resp = await fetch(inputs[only.sourceHandleId]);
                if (resp.ok) {
                    const buf = Buffer.from(await resp.arrayBuffer());
                    const meta = await sharp(buf).metadata();
                    if (meta.width && meta.height) {
                        width = meta.width;
                        height = meta.height;
                        fitLayerId = only.id;
                        prefetched.set(only.id, buf);
                        console.log(
                            `[CompositorExecutor:still] auto-fit: canvas → source ${width}x${height} for un-fitted single layer "${only.name}"`,
                        );
                    }
                }
            } catch (err) {
                console.error('[CompositorExecutor:still] auto-fit probe failed:', err);
            }
        }
    }

    console.log(
        `[CompositorExecutor:still] Canvas ${width}x${height}, ${layers.length} layers`,
    );

    let baseCanvas = sharp({
        create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    });

    const layerResults = await Promise.all(
        layers.map(async (layer) => {
            if (!layer.visible) return null;
            const source = inputs[layer.sourceHandleId];
            if (!source || typeof source !== 'string') return null;

            const tf = layer.transform || ({} as any);
            // The auto-fitted layer fills the (now source-sized) canvas; everyone
            // else keeps its configured transform.
            const isFit = layer.id === fitLayerId;
            const targetW = isFit ? width : Math.max(1, Math.round(tf.width || width));
            const targetH = isFit ? height : Math.max(1, Math.round(tf.height || height));
            const rotation = tf.rotation || 0;

            try {
                // A layer is either media (fetchable URL) or a Prompt/Text
                // string. Text is rasterized to a box-sized PNG so it goes
                // through the same flip/rotate/composite path as an image —
                // previously a text layer fell into fetch() below, threw, and
                // was silently dropped, so it never reached the AI node.
                let layerSharp: sharp.Sharp;
                if (isMediaUrl(source)) {
                    let inputBuffer = prefetched.get(layer.id);
                    if (!inputBuffer) {
                        const response = await fetch(source);
                        if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
                        inputBuffer = Buffer.from(await response.arrayBuffer());
                    }
                    layerSharp = sharp(inputBuffer).resize(targetW, targetH, { fit: 'fill' });
                } else {
                    const textBox = await renderTextLayerToBuffer(layer, source, width, height);
                    if (!textBox) return null;
                    layerSharp = sharp(textBox);
                }

                if (tf.flipX) layerSharp = layerSharp.flop();
                if (tf.flipY) layerSharp = layerSharp.flip();
                if (rotation !== 0) {
                    layerSharp = layerSharp.rotate(rotation, { background: TRANSPARENT });
                }
                const processedBuffer = await layerSharp.toBuffer();
                return {
                    input: processedBuffer,
                    left: isFit ? 0 : Math.round(tf.x || 0),
                    top: isFit ? 0 : Math.round(tf.y || 0),
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
    // Z-order: array[0] is the TOP layer (matches the Konva editor and the
    // graph renderer, which reverse before drawing — see graph-renderer.ts
    // "array[0] is on top", and the temporal path below which reverses too).
    // Sharp composites in array order with the LAST entry painted on top, so
    // reverse here. Without this, array[0] (the layer the user put on top, e.g.
    // a logo or text) was composited at the BOTTOM and buried under the
    // full-canvas base image — the exact "only the base image survived" bug.
    if (overlays.length > 0) baseCanvas = baseCanvas.composite([...overlays].reverse());

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

    const ext = outputFormat === 'jpg' ? 'jpg' : outputFormat === 'jpeg' ? 'jpeg' : outputFormat === 'webp' ? 'webp' : 'png';

    return uploadEphemeralResult(context, finalBuffer, {
        prefix: 'compositor',
        extension: ext,
        contentType,
        resolution: { width, height },
        metadata: { format: outputFormat, source: 'Compositor', processedBy: 'ServerSharp' }
    });
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
    intrinsicWidth: number;    // source pixel width; 0 if unknown
    intrinsicHeight: number;   // source pixel height; 0 if unknown
}

export interface RenderCompositorVideoOptions {
    /** Mix per-layer audio (video audio tracks + dedicated audio layers) into the output. Both the workflow Run path and the download route enable this. */
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
    // Canvas size is mutable: a single un-fitted layer (typical of a chat-built
    // compositor whose layer transform the LLM guessed before the media existed)
    // resizes the canvas to the source's true dimensions below — see the
    // server-side auto-fit after probing.
    let width = Math.round(config?.canvasWidth || 1080);
    let height = Math.round(config?.canvasHeight || 1080);
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
            finalKind?: 'video' | 'image' | 'audio';
            skipped?: string;
        }> = [];

        for (let i = 0; i < visibleLayers.length; i++) {
            const layer = visibleLayers[i];
            const url = inputs[layer.sourceHandleId];
            if (!url || typeof url !== 'string') {
                layerDiagnostics.push({ layerName: layer.name, url: undefined, urlKind: 'unknown', skipped: 'no-input-url' });
                continue;
            }

            // Text layer (Prompt/Text string, no URL scheme). Rasterize it to a
            // box-sized PNG and feed it into the overlay graph as an image —
            // otherwise it classified as 'unknown' below and was dropped as
            // `unsupported-kind:text`, so text never appeared in video output.
            if (!isMediaUrl(url)) {
                const textBox = await renderTextLayerToBuffer(layer, url, width, height);
                if (!textBox) {
                    layerDiagnostics.push({ layerName: layer.name, url: '(text)', urlKind: 'text', skipped: 'text-render-empty' });
                    continue;
                }
                const inputPath = path.join(tmpDir, `in_${i}.png`);
                await fs.writeFile(inputPath, textBox);
                layerDiagnostics.push({ layerName: layer.name, url: '(text)', urlKind: 'text', finalKind: 'image' });
                processed.push({
                    layer,
                    inputPath,
                    sourceKind: 'text',
                    intrinsicDuration: 0,
                    effectiveDuration: 0, // filled below once we know the timeline total
                    startTime: Math.max(0, layer.startTime || 0),
                    hasAudio: false,
                    intrinsicWidth: 0, // text has no intrinsic size — never drives canvas fit
                    intrinsicHeight: 0,
                });
                continue;
            }

            let kind: LayerSourceKind = detectSourceKindFromUrl(url);

            // Content-Type fallback: when the URL doesn't carry a recognizable
            // extension (e.g. signed Supabase URLs, AI model proxy paths), do
            // a HEAD to ask the server. Without this, a layer with a valid
            // image-but-no-extension URL was silently dropped here and never
            // overlaid into the final mp4.
            let contentType: string | undefined;
            if (kind !== 'video' && kind !== 'image' && kind !== 'audio') {
                try {
                    const head = await fetch(url, { method: 'HEAD' });
                    contentType = head.headers.get('content-type') || undefined;
                    if (contentType?.startsWith('video/')) kind = 'video';
                    else if (contentType?.startsWith('image/')) kind = 'image';
                    else if (contentType?.startsWith('audio/')) kind = 'audio';
                } catch {
                    // HEAD failed — fall through; the GET below will still try.
                }
            }

            // Audio layer: staged + probed like video, but it has no video
            // stream — it's mixed into the output's audio track only, never
            // overlaid into the visual graph.
            if (kind === 'audio') {
                const aext = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|weba)(\?|$)/i.exec(url)?.[1] || 'mp3';
                const inputPath = path.join(tmpDir, `in_${i}.${aext}`);
                try {
                    const resp = await fetch(url);
                    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                    const buf = Buffer.from(await resp.arrayBuffer());
                    await fs.writeFile(inputPath, buf);
                } catch (err) {
                    layerDiagnostics.push({
                        layerName: layer.name,
                        url,
                        urlKind: 'audio',
                        contentType,
                        skipped: `fetch-failed:${err instanceof Error ? err.message : 'unknown'}`,
                    });
                    continue;
                }
                const probe = await probeVideoStreams(ffmpeg, inputPath).catch(
                    () => ({ duration: 0, hasAudio: false, width: 0, height: 0 }),
                );
                layerDiagnostics.push({ layerName: layer.name, url, urlKind: 'audio', contentType, finalKind: 'audio' });
                processed.push({
                    layer,
                    inputPath,
                    sourceKind: 'audio',
                    intrinsicDuration: probe.duration,
                    effectiveDuration: 0, // filled below once we know the timeline total
                    startTime: Math.max(0, layer.startTime || 0),
                    hasAudio: probe.hasAudio,
                    intrinsicWidth: 0, // audio has no visual — never drives canvas fit
                    intrinsicHeight: 0,
                });
                continue;
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
            let intrinsicWidth = 0;
            let intrinsicHeight = 0;
            if (kind === 'video') {
                const probe = await probeVideoStreams(ffmpeg, inputPath).catch(() => ({ duration: 0, hasAudio: false, width: 0, height: 0 }));
                intrinsicDuration = probe.duration;
                hasAudio = probe.hasAudio;
                intrinsicWidth = probe.width;
                intrinsicHeight = probe.height;
            } else {
                // Image: read intrinsic pixel size so a single un-fitted image
                // layer can drive the canvas auto-fit below, same as video.
                const meta = await sharp(inputPath).metadata().catch(() => null);
                intrinsicWidth = meta?.width || 0;
                intrinsicHeight = meta?.height || 0;
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
                intrinsicWidth,
                intrinsicHeight,
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
            } else if ((p.sourceKind === 'video' || p.sourceKind === 'audio') && p.intrinsicDuration > 0) {
                p.effectiveDuration = p.intrinsicDuration;
            } else {
                p.effectiveDuration = Math.max(0.1, total - p.startTime);
            }
        }

        // Visual layers (everything except audio) drive the canvas + overlay
        // graph; audio layers are inputs for the audio mix only.
        const visual = processed.filter((p) => p.sourceKind !== 'audio');

        // ── Server-side auto-fit (parity with the client's
        // calculateFirstLayerFitToCanvas) ──
        // A chat-built compositor dispatches with the LLM's GUESSED canvas +
        // layer transform — it sized them before the generated media existed, so
        // the box aspect rarely matches the real source. The client corrects this
        // once the media's metadata loads (handleLayerIntrinsicLoad sets
        // transform.isAutoCentered=true), but a chat auto-run renders BEFORE that,
        // baking the guess in: a layer scaled to a mismatched box stretches, and a
        // canvas larger than the layer adds black bars. When the SINGLE visible
        // media layer was never client-fitted, resize the canvas to the source and
        // make the layer full-bleed — exactly what the editor (and the Download
        // button, which shares this function) would have produced.
        // `isAutoCentered === true` means the client/user already positioned it, so
        // the config is respected as-is and the Download path is unaffected.
        const fitTransform = new Map<string, { x: number; y: number; width: number; height: number }>();
        if (visual.length === 1) {
            const p = visual[0];
            const tf = p.layer.transform || ({} as any);
            if (
                (p.sourceKind === 'video' || p.sourceKind === 'image') &&
                tf.isAutoCentered !== true &&
                p.intrinsicWidth > 0 &&
                p.intrinsicHeight > 0
            ) {
                width = p.intrinsicWidth;
                height = p.intrinsicHeight;
                fitTransform.set(p.layer.id, { x: 0, y: 0, width, height });
                console.log(
                    `[renderCompositorVideo] auto-fit: canvas → source ${width}x${height} for un-fitted single layer "${p.layer.name}"`,
                );
            }
        }

        // Effective transform per layer: the auto-fit override when present,
        // otherwise the (rounded, defaulted) configured transform.
        const effTransform = (p: ProcessedLayer) => {
            const ov = fitTransform.get(p.layer.id);
            if (ov) return ov;
            const tf = p.layer.transform || ({} as any);
            return {
                x: Math.round(tf.x || 0),
                y: Math.round(tf.y || 0),
                width: Math.max(2, Math.round(tf.width || width)),
                height: Math.max(2, Math.round(tf.height || height)),
            };
        };

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

        // Only visual layers get a `[idx:v]` scale chain + overlay. The input
        // index stays the GLOBAL `processed.indexOf(p)` so `[idx:v]` / `[idx:a]`
        // line up with ffmpeg's input order (audio layers are still added as
        // inputs below).
        visual.forEach((p) => {
            const idx = processed.indexOf(p);
            const { width: w, height: h } = effTransform(p);
            const eff = p.effectiveDuration;
            const startT = p.startTime;
            const setpts = `setpts=PTS-STARTPTS+${startT.toFixed(3)}/TB`;

            const layerLabel = `L${idx}`;
            filters.push(
                `[${idx}:v]trim=duration=${eff.toFixed(3)},${setpts},scale=${w}:${h}:flags=bilinear,format=rgba[${layerLabel}]`,
            );
        });

        let currentChain = 'bg';
        const reversedOverlay = [...visual].reverse();
        reversedOverlay.forEach((p, reverseIdx) => {
            const idx = processed.indexOf(p);
            const { x, y } = effTransform(p);
            const eff = p.effectiveDuration;
            const startT = p.startTime;
            const endT = startT + eff;
            const layerLabel = `L${idx}`;

            let overlayArgs = `x=${x}:y=${y}:enable='between(t,${startT.toFixed(3)},${endT.toFixed(3)})':format=auto`;
            // Repeat the single frame generated from image inputs so it covers the entire enabled window
            if (p.sourceKind === 'image' || p.sourceKind === 'text') {
                overlayArgs += ':eof_action=repeat';
            }

            const nextChain = reverseIdx === reversedOverlay.length - 1 ? 'vout' : `s${reverseIdx}`;
            filters.push(
                `[${currentChain}][${layerLabel}]overlay=${overlayArgs}[${nextChain}]`,
            );
            currentChain = nextChain;
        });

        // Audio-only timeline (no visual layers): the black [bg] canvas IS the
        // video output, so map it directly.
        const videoOut = reversedOverlay.length > 0 ? 'vout' : 'bg';

        // ── Build the audio mix (when requested + at least one audible video) ──
        // For each unmuted video layer with audio:
        //   [i:a]atrim=duration=eff,asetpts=PTS-STARTPTS,adelay=ms|ms|...|ms[A_i]
        // The pipe-delimited delay list repeats the per-channel offset 8 times so
        // mono / stereo / 5.1 / 7.1 all get the same shift. We avoided the newer
        // `:all=1` option because the static ffmpeg builds shipped by
        // @ffmpeg-installer don't all carry it ("Option not found").
        // Then amix together (or use the single chain directly when there's only one).
        const outputMaps: string[] = [videoOut];
        let useAudio = false;
        if (options.includeAudio) {
            const audible = processed
                .map((p, idx) => ({ p, idx }))
                .filter(({ p }) => (p.sourceKind === 'video' || p.sourceKind === 'audio') && p.hasAudio && !p.layer.muted);

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
        // Run/Workflow output now carries audio too (audio layers + the audio
        // tracks of video layers), matching the Download path.
        outputBuffer = await renderCompositorVideo(config, inputs, { includeAudio: true });
    } catch (err) {
        return {
            success: false,
            data: null,
            error: `ffmpeg render failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        };
    }

    return uploadEphemeralResult(context, outputBuffer, {
        prefix: 'compositor',
        extension: 'mp4',
        contentType: 'video/mp4',
        resolution: { width, height },
        metadata: {
            format: 'mp4',
            source: 'Compositor',
            processedBy: 'ServerFluentFfmpeg',
        }
    });
}

/**
 * Probe a video for duration + audio-stream presence via ffprobe (bundled by
 * @ffprobe-installer). fluent-ffmpeg's .ffprobe() returns a promise-friendly
 * callback API.
 */
function probeVideoStreams(
    ffmpeg: any,
    filePath: string,
): Promise<{ duration: number; hasAudio: boolean; width: number; height: number }> {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err: Error | null, data: any) => {
            if (err) {
                reject(err);
                return;
            }
            const duration = data?.format?.duration;
            const streams = Array.isArray(data?.streams) ? data.streams : [];
            const hasAudio = streams.some((s: any) => s.codec_type === 'audio');
            const videoStream = streams.find((s: any) => s.codec_type === 'video');
            resolve({
                duration: typeof duration === 'number' ? duration : 0,
                hasAudio,
                width: Number(videoStream?.width) || 0,
                height: Number(videoStream?.height) || 0,
            });
        });
    });
}
