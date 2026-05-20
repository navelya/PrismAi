import { ImageObject } from '../../types';
import { ClientExecutor } from '../../core/types';
import { toLegacyRenderableOutput, detectMediaTypeFromUrl } from '@/lib/workflow/result-format';
import { BlurConfig } from './definition';
import { radiusToSigma, blurFilterString } from './shared';
import { GraphDescription } from '../compositor/shared';
import { CompositorLayer } from '../compositor/definition';

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
 * Synthesize a 1-layer compositor GraphDescription wrapping a raw video URL.
 * Used when blur's upstream is a static-URL video (e.g., MediaInput → Blur
 * directly, with no compositor between). Means blur's output is uniformly a
 * `kind: 'filter'` wrapping a `kind: 'compositor'` regardless of upstream shape.
 */
function wrapUrlAsCompositorGraph(
    url: string,
    resolution?: { width: number; height: number },
): GraphDescription {
    const w = resolution?.width ?? 1920;
    const h = resolution?.height ?? 1080;
    const layer: CompositorLayer = {
        id: '__blur_wrap__',
        name: 'wrap',
        sourceHandleId: '__blur_wrap__',
        selectedIndex: 0,
        transform: {
            x: 0, y: 0, width: w, height: h,
            rotation: 0, opacity: 1,
            flipX: false, flipY: false,
            isAutoCentered: true,
            crop: null,
        },
        visible: true,
        locked: false,
        startTime: 0,
        duration: null,
        trimIn: 0,
        trimOut: null,
        speed: 1,
        muted: false,
        transition: { type: 'none', duration: 0 },
    };
    return {
        kind: 'compositor',
        layers: [{ layer, source: { kind: 'media', url, mediaKind: 'video' } }],
        canvasWidth: w,
        canvasHeight: h,
        duration: 0,
        fps: 30,
        intrinsicDurations: {},
    };
}

export const blurClientExecutor: ClientExecutor<BlurConfig> = async (config, inputs) => {
    const upstream = inputs.image;
    if (upstream === undefined || upstream === null) return null;

    const normalized = toLegacyRenderableOutput(upstream);
    const first = Array.isArray(normalized) ? normalized[0] : normalized;
    let url: string | null = null;
    let upstreamGraph: GraphDescription | undefined;
    let resolution: { width: number; height: number } | undefined;

    if (typeof first === 'string') url = first;
    else if (first && typeof first === 'object') {
        if (typeof (first as any).url === 'string') url = (first as any).url;
        if ((first as any).graph) upstreamGraph = (first as any).graph as GraphDescription;
        if ((first as any).resolution) resolution = (first as any).resolution;
    }

    // Pull-model live signal: upstream publishes a `graph` description from
    // a Compositor (or another filter wrapping one). No URL yet, and the
    // signal isn't a single seekable resource — it's a description that
    // downstream consumers render at their own time.
    const hasGraphSource = !!upstreamGraph;
    if (!url && !hasGraphSource) return null;

    const kind: 'image' | 'video' = hasGraphSource
        ? 'video'
        : (detectMediaTypeFromUrl(url!) === 'video' ? 'video' : 'image');

    if (kind === 'video') {
        const ownFilter = blurFilterString(config?.radius ?? 5);

        // Always operate on a GraphDescription. If upstream already supplied
        // one, wrap it; otherwise synthesize a 1-layer compositor graph
        // around the raw URL first. Downstream consumers see exactly one
        // shape (a `kind: 'filter'` graph) no matter what fed us.
        const baseGraph: GraphDescription = upstreamGraph
            ?? wrapUrlAsCompositorGraph(url!, resolution);

        const filterGraph: GraphDescription = {
            kind: 'filter',
            upstream: baseGraph,
            cssFilter: ownFilter,
        };

        return {
            type: 'video',
            data: [{
                url: '',
                graph: filterGraph,
                resolution,
            }],
        };
    }

    const dataUrl = await clientBlurExecutor(config, url!);
    if (!dataUrl) return null;

    return { type: 'image', data: [{ url: dataUrl }] as ImageObject[] };
};
