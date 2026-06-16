import { ImageObject } from '../../types';
import { ClientExecutor } from '../../core/types';
import { toLegacyRenderableOutput, detectMediaTypeFromUrl } from '@/lib/workflow/result-format';
import { LevelsConfig } from './definition';
import { applyLutInPlace, buildLevelsLut, levelsFilterToken } from './shared';
import { GraphDescription } from '../compositor/shared';
import { CompositorLayer } from '../compositor/definition';

/**
 * Browser-only Levels Executor.
 *
 * Loads the upstream image, applies the same 256-entry LUT used server-side
 * to the canvas's ImageData (RGB only, alpha untouched), returns a data URL.
 */
const computeLevelsDataUrl = async (
    config: LevelsConfig,
    imageUrl: string,
): Promise<string | null> => {
    if (typeof window === 'undefined') return null;

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
            ctx.drawImage(img, 0, 0);

            try {
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const lut = buildLevelsLut(
                    config.black_point ?? 0,
                    config.white_point ?? 255,
                    config.gamma ?? 1.0,
                );
                applyLutInPlace(imageData.data, lut);
                ctx.putImageData(imageData, 0, 0);
                // WebP q0.9: ~10-15x smaller than PNG q1.0, alpha preserved.
                // Live preview only — final server export still goes through sharp.
                resolve(canvas.toDataURL('image/webp', 0.9));
            } catch (e) {
                console.error('[clientLevelsExecutor] Failed to process image (likely CORS taint):', e);
                resolve(null);
            }
        };

        img.onerror = () => {
            console.error('[clientLevelsExecutor] Failed to load image');
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
 * Used when levels' upstream is a static-URL video (e.g. MediaInput → Levels
 * directly, with no compositor between). Means levels' output is uniformly a
 * `kind: 'filter'` wrapping a `kind: 'compositor'` regardless of upstream shape.
 * Mirrors blur's wrapUrlAsCompositorGraph.
 */
function wrapUrlAsCompositorGraph(
    url: string,
    resolution?: { width: number; height: number },
): GraphDescription {
    const w = resolution?.width ?? 1920;
    const h = resolution?.height ?? 1080;
    const layer: CompositorLayer = {
        id: '__levels_wrap__',
        name: 'wrap',
        sourceHandleId: '__levels_wrap__',
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

/**
 * Generic-shape adapter for the auto-compute pipeline.
 * Mirrors the blur plugin's pattern.
 *
 * Image upstream → bake the LUT into a static data URL (one-shot transform).
 * Video upstream → wrap the upstream graph (or synthesize one around a raw
 * URL) in a `kind: 'filter'` graph carrying levels as a `levels(b,w,g)` token.
 * The renderer applies it as a per-frame LUT and the server maps it to an
 * exact ffmpeg lutrgb pass, so the chain stays live without baking pixels.
 */
export const levelsClientExecutor: ClientExecutor<LevelsConfig> = async (config, inputs) => {
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

    // Pull-model live signal: upstream publishes a `graph` from a Compositor
    // (or another filter wrapping one). No URL yet, but it's still real data.
    const hasGraphSource = !!upstreamGraph;
    if (!url && !hasGraphSource) return null;

    const kind: 'image' | 'video' = hasGraphSource
        ? 'video'
        : (detectMediaTypeFromUrl(url!) === 'video' ? 'video' : 'image');

    if (kind === 'video') {
        const ownFilter = levelsFilterToken(
            config.black_point ?? 0,
            config.white_point ?? 255,
            config.gamma ?? 1.0,
        );

        // Always operate on a GraphDescription. If upstream already supplied
        // one, wrap it; otherwise synthesize a 1-layer compositor graph around
        // the raw URL first. Downstream consumers see exactly one shape (a
        // `kind: 'filter'` graph) no matter what fed us.
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

    const dataUrl = await computeLevelsDataUrl(config, url!);
    if (!dataUrl) return null;

    return { type: 'image', data: [{ url: dataUrl }] as ImageObject[] };
};
