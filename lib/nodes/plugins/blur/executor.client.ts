import { ImageObject } from '../../types';
import { ClientExecutor } from '../../core/types';
import { toLegacyRenderableOutput, detectMediaTypeFromUrl } from '@/lib/workflow/result-format';
import { BlurConfig } from './definition';
import { radiusToSigma, blurFilterString } from './shared';

/**
 * Browser-only Blur Executor (image branch)
 * Uses Canvas API + CSS filters to bake the blur into a static data URL.
 * For images this is a one-shot transform — downstream consumers render
 * the data URL via <img src=...> with no further work.
 */
export const clientBlurExecutor = async (
    config: BlurConfig,
    imageUrl: string,
): Promise<string | null> => {
    if (typeof window === 'undefined') return null;

    const sigma = radiusToSigma(config?.radius ?? 5);

    return new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        if (!ctx) {
            resolve(null);
            return;
        }

        const img = new Image();
        img.crossOrigin = 'anonymous';

        img.onload = () => {
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.filter = `blur(${sigma}px)`;
            ctx.drawImage(img, 0, 0);
            try {
                const dataUrl = canvas.toDataURL('image/png');
                resolve(dataUrl);
            } catch (e) {
                console.error('[clientBlurExecutor] Failed to get data URL (likely CORS taint):', e);
                resolve(null);
            }
        };

        img.onerror = () => {
            console.error('[clientBlurExecutor] Failed to load image');
            resolve(null);
        };

        const safeUrl = imageUrl.startsWith('data:')
            ? imageUrl
            : imageUrl + (imageUrl.includes('?') ? '&' : '?') + 'notaint=1';

        img.src = safeUrl;
    });
};

/**
 * Generic-shape adapter for the auto-compute pipeline.
 *
 * IMAGE → bake the blur into a data URL (one-shot canvas transform).
 * VIDEO (static URL) → pass the upstream URL through with a `cssFilter`
 *   descriptor. Downstream consumers attach their own <video src={url}> and
 *   apply the filter at render time. Preserves duration, seek, and play/pause
 *   semantics — the video is a real seekable resource.
 * VIDEO (live source) → upstream is a Compositor (or another pass-through
 *   filter) whose envelope carries a MediaStream / live HTMLCanvasElement
 *   instead of a finished URL. We propagate the same reference forward,
 *   concatenating our `cssFilter` onto the chain. Downstream consumers
 *   attach via `<video srcObject={stream}>` and the accumulated cssFilter
 *   composes as CSS layered filters at render time — same chaining contract
 *   as the static-URL case, just with a live signal as the source.
 *
 * In all video cases the upstream's pixel data is NEVER re-encoded by this
 * executor — filters are descriptors, not bakes. That's what makes the
 * pipeline truly live (vs. record-then-display).
 */
export const blurClientExecutor: ClientExecutor<BlurConfig> = async (config, inputs) => {
    const upstream = inputs.image;
    if (upstream === undefined || upstream === null) return null;

    const normalized = toLegacyRenderableOutput(upstream);
    const first = Array.isArray(normalized) ? normalized[0] : normalized;
    let url: string | null = null;
    let upstreamCssFilter: string | null = null;
    let stream: MediaStream | undefined;
    let liveCanvas: HTMLCanvasElement | undefined;
    let resolution: { width: number; height: number } | undefined;

    if (typeof first === 'string') url = first;
    else if (first && typeof first === 'object') {
        if (typeof (first as any).url === 'string') url = (first as any).url;
        if (typeof (first as any).cssFilter === 'string') upstreamCssFilter = (first as any).cssFilter;
        if ((first as any).stream) stream = (first as any).stream;
        if ((first as any).canvas) liveCanvas = (first as any).canvas;
        if ((first as any).resolution) resolution = (first as any).resolution;
    }

    // Detect live signal: a video coming from Compositor (or another upstream
    // pass-through filter) carries stream/canvas with an empty URL. Treat it
    // as a video for filter-chaining purposes — don't try to fetch the empty
    // URL or run the image canvas branch.
    const hasLiveSource = !!(stream || liveCanvas);
    if (!url && !hasLiveSource) return null;

    const kind: 'image' | 'video' = hasLiveSource
        ? 'video'
        : (detectMediaTypeFromUrl(url!) === 'video' ? 'video' : 'image');

    if (kind === 'video') {
        const ownFilter = blurFilterString(config?.radius ?? 5);
        const cssFilter = upstreamCssFilter
            ? `${upstreamCssFilter} ${ownFilter}`
            : ownFilter;
        return {
            type: 'video',
            data: [{
                url: url ?? '',
                stream,
                canvas: liveCanvas,
                cssFilter,
                resolution,
            }],
        } as any;
    }

    const dataUrl = await clientBlurExecutor(config, url!);
    if (!dataUrl) return null;

    return { type: 'image', data: [{ url: dataUrl }] as ImageObject[] };
};
