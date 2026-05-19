import sharp from 'sharp';
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
// Temporal-render path
//
// @ffmpeg/ffmpeg@0.12+ is browser-only by design — its constructor throws
// "ffmpeg.wasm does not support nodejs" the moment it's instantiated in a
// Node runtime (Vercel serverless function). The previous lazy-import
// implementation that lived here (recoverable from git history at commit
// fd3d7734) was never reachable in production for that reason.
//
// To re-enable server-side temporal render, the project needs to pick ONE:
//   (a) fluent-ffmpeg + ffmpeg-static (Node-native, ~70MB binary)
//   (b) route to the Python sidecar service
//   (c) use a cloud video model on Replicate
//   (d) skip server video entirely and rely on the client pull-model graph
//       render (compositor card) to produce / download user-visible video
//
// Until that decision lands, fail fast with a useful message instead of the
// bare "ffmpeg.wasm does not support nodejs" surface error.
// ───────────────────────────────────────────────────────────────────────────

async function runTemporalRender(
    _config: CompositorConfig,
    _inputs: Record<string, any>,
    _context: ExecutionContext,
    _sourceKindByLayerId: Record<string, LayerSourceKind>,
): Promise<NodeExecutionResult> {
    return {
        success: false,
        data: null,
        error:
            'Server-side video composition is not available in this deployment. ' +
            '@ffmpeg/ffmpeg@0.12 is browser-only and cannot run in Node.js. ' +
            'Use the in-card client preview (pull-model graph render) for live ' +
            'playback, or switch the server path to fluent-ffmpeg + ffmpeg-static, ' +
            'the Python sidecar service, or a Replicate video model.',
    };
}
