import { ClientExecutor } from '../../core/types';
import { CompositorConfig } from './definition';
import { ImageObject } from '../../types';
import { toLegacyRenderableOutput } from '@/lib/workflow/result-format';
import { detectSourceKindFromUrl } from './shared';
import { useAppStore } from '@/lib/store/app-store';

const safeUrl = (src: string): string => {
    if (src.startsWith('data:')) return src;
    return src + (src.includes('?') ? '&' : '?') + 'notaint=1';
};

const loadImage = (src: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = safeUrl(src);
    });

/**
 * Load a video, seek to its first frame, and resolve with the loaded element
 * once the frame is painted (so drawImage will sample real pixels, not a
 * black placeholder).
 *
 * Used by the client-side composite so downstream image consumers see a still
 * preview that includes video content. For a full timeline render, the server
 * executor produces an mp4 — this path always returns a single composited
 * image envelope at timeline t=0.
 */
const loadVideoFirstFrame = (src: string): Promise<HTMLVideoElement> =>
    new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.crossOrigin = 'anonymous';
        video.muted = true;
        video.playsInline = true;
        let resolved = false;
        const onSeeked = () => {
            if (resolved) return;
            resolved = true;
            video.removeEventListener('seeked', onSeeked);
            resolve(video);
        };
        const onLoadedMetadata = () => {
            try {
                video.currentTime = 0;
            } catch {
                onSeeked();
            }
        };
        video.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
        video.addEventListener('seeked', onSeeked);
        video.addEventListener('error', () => reject(new Error('Video failed to load')));
        // Defensive timeout — bad URLs shouldn't hang the live preview forever.
        setTimeout(() => {
            if (!resolved) reject(new Error('Video first-frame load timed out'));
        }, 8000);
        video.src = safeUrl(src);
        video.load();
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

    // Perf gate 1 — skip while the user is mid-gesture on the canvas. Each
    // executor run for a heavy composite is hundreds of ms of image decoding +
    // Canvas 2D drawing. Running it on every transform commit makes layer
    // drags feel sluggish. The store flips `isDragging` on/off via the editor
    // modal's handleInteractStart/End and the canvas card's interaction
    // handlers. The executor will re-fire on the next config change after
    // drag completes (useNodeAutoCompute debounces to 150ms).
    if (useAppStore.getState().isDragging) return null;

    // Perf gate 2 — when the compositor has video content, this executor
    // can't produce something useful anyway: the actual mp4 only exists after
    // the server runs. Producing a still-frame composite per config change
    // means N parallel video downloads + seeks per drag commit. Skip and let
    // the server-side render populate nodeOutputs when the workflow executes.
    const hasVideoLayer = layers.some((layer) => {
        const upstream = inputs[layer.sourceHandleId];
        if (!upstream) return false;
        const normalized = toLegacyRenderableOutput(upstream);
        const arr: ImageObject[] = Array.isArray(normalized) ? normalized : [normalized];
        const item = arr[layer.selectedIndex ?? 0] || arr[0];
        return !!(item?.url && detectSourceKindFromUrl(item.url) === 'video');
    });
    if (hasVideoLayer) return null;

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

        const kind = detectSourceKindFromUrl(imageData.url);

        // Client preview is a still composite at timeline t=0. Skip videos
        // whose startTime > 0 — they aren't on screen yet at t=0. Images and
        // text are always-on (their default duration = null = full timeline).
        if (kind === 'video' && (layer.startTime || 0) > 0) continue;

        try {
            let drawable: CanvasImageSource;
            let intrinsicW: number;
            let intrinsicH: number;

            if (kind === 'video') {
                const video = await loadVideoFirstFrame(imageData.url);
                drawable = video;
                intrinsicW = video.videoWidth || 0;
                intrinsicH = video.videoHeight || 0;
            } else {
                const img = await loadImage(imageData.url);
                drawable = img;
                intrinsicW = img.width;
                intrinsicH = img.height;
            }

            const { x, y, width, height, rotation, opacity, flipX, flipY, crop } = layer.transform;

            ctx.save();
            ctx.globalAlpha = opacity ?? 1;
            ctx.translate(x + width / 2, y + height / 2);
            if (rotation) ctx.rotate((rotation * Math.PI) / 180);
            if (flipX || flipY) ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);

            ctx.drawImage(
                drawable,
                crop?.x || 0,
                crop?.y || 0,
                crop?.width || intrinsicW,
                crop?.height || intrinsicH,
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
