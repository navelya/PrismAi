import { ClientExecutor } from '../../core/types';
import { CompositorConfig, ImageObject } from '../../types';
import { toLegacyRenderableOutput } from '@/lib/workflow/result-format';

const loadImage = (src: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = reject;
        // Add cache-busting param so the browser doesn't reuse a previously
        // CORS-tainted cached response (which would block toDataURL below).
        const safeUrl = src.startsWith('data:')
            ? src
            : src + (src.includes('?') ? '&' : '?') + 'notaint=1';
        img.src = safeUrl;
    });

/**
 * Browser-only Compositor executor used by useNodeAutoCompute.
 *
 * Mirrors the canvas branch of [executor.ts](executor.ts) but lives in a
 * separate module so the browser bundle never pulls in the server-only
 * Sharp + Supabase service-role client.
 *
 * Output shape matches the envelope the rest of the v2 engine expects so
 * downstream nodes (Blur, AI Generator, etc.) can read this compositor's
 * result through the same `nodeOutputs[id]` path they use for every other
 * node.
 */
export const compositorClientExecutor: ClientExecutor<CompositorConfig> = async (
    config,
    inputs
) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return null;

    const {
        canvasWidth = 1080,
        canvasHeight = 1080,
        layers = [],
        outputFormat = 'png',
        outputQuality = 1.0,
    } = config;

    if (!layers || layers.length === 0) return null;

    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    let drewSomething = false;

    for (const layer of layers) {
        if (!layer.visible) continue;

        const rawUpstream = inputs[layer.sourceHandleId];
        if (rawUpstream === undefined || rawUpstream === null) continue;

        // Upstream may arrive as an envelope ({type, data}), a raw
        // ImageObject, or an array of ImageObjects — toLegacyRenderableOutput
        // collapses all three to a consistent shape.
        const normalized = toLegacyRenderableOutput(rawUpstream);
        const sourceArray: ImageObject[] = Array.isArray(normalized)
            ? normalized
            : [normalized];
        const imageData = sourceArray[layer.selectedIndex ?? 0] || sourceArray[0];
        if (!imageData?.url) continue;

        try {
            const img = await loadImage(imageData.url);
            const { x, y, width, height, rotation, opacity, flipX, flipY, crop } = layer.transform;

            ctx.save();
            ctx.globalAlpha = opacity ?? 1;
            ctx.translate(x + width / 2, y + height / 2);
            if (rotation) ctx.rotate((rotation * Math.PI) / 180);
            if (flipX || flipY) ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);

            ctx.drawImage(
                img,
                crop?.x || 0,
                crop?.y || 0,
                crop?.width || img.width,
                crop?.height || img.height,
                -width / 2,
                -height / 2,
                width,
                height
            );
            ctx.restore();
            drewSomething = true;
        } catch (err) {
            console.error(`[compositorClientExecutor] Layer ${layer.name} failed:`, err);
        }
    }

    if (!drewSomething) return null;

    const mimeType = `image/${outputFormat}`;
    let dataUrl: string;
    try {
        dataUrl = canvas.toDataURL(mimeType, outputQuality);
    } catch (err) {
        // Cross-origin taint or other canvas read error.
        console.error('[compositorClientExecutor] toDataURL failed:', err);
        return null;
    }

    return {
        type: 'image',
        data: [{
            url: dataUrl,
            resolution: { width: canvasWidth, height: canvasHeight },
            metadata: {
                format: outputFormat,
                source: 'Compositor',
                processedBy: 'BrowserCanvas',
            },
        }] as ImageObject[],
    };
};
