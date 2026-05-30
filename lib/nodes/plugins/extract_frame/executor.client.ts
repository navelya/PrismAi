import { ImageObject } from '../../types';
import { ClientExecutor } from '../../core/types';
import { toLegacyRenderableOutput, detectMediaTypeFromUrl } from '@/lib/workflow/result-format';
import { ExtractFrameConfig } from './definition';
import { GraphDescription, graphDimensions } from '../compositor/shared';
import { GraphRenderCache, paintGraphFrame } from '../compositor/graph-renderer';

/**
 * Browser-only Extract Frame executor.
 *
 * Bakes the chosen frame into a static WebP q0.9 data URL — alpha-preserving
 * and ~10-15x smaller than PNG q1.0 — so downstream image consumers
 * (compositor layer, ai_generator, another filter) get a real image with no
 * server round-trip. Live-preview only; the final Run Workflow path uses
 * sharp on the server.
 *
 * Three upstream shapes (mirrors blur's input handling):
 *   - live graph (compositor / filter): paint the graph at the chosen time onto
 *     an offscreen canvas, then toDataURL.
 *   - static video URL: seek a <video> to the chosen time, drawImage, toDataURL.
 *   - image URL: frame extraction is the identity — pass the URL straight back.
 */

const SAFE_RESOLVE_MS = 5000;
// Long enough for a seeked frame in a live graph (pooled <video> decode) to
// land before we snapshot the canvas. The component's preview already shows the
// live scrub; this background bake only runs on a committed frameTime change.
const GRAPH_SETTLE_MS = 800;

function safeUrl(url: string): string {
    return url.startsWith('data:') ? url : url + (url.includes('?') ? '&' : '?') + 'notaint=1';
}

/**
 * Seek a throwaway <video> to `time`, draw the frame to a canvas, return a PNG
 * data URL. crossOrigin='anonymous' + the notaint cache-bust keep toDataURL
 * from throwing on Supabase-served assets.
 */
function extractVideoFrameToDataUrl(url: string, time: number): Promise<string | null> {
    return new Promise((resolve) => {
        const video = document.createElement('video');
        video.crossOrigin = 'anonymous';
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';

        let settled = false;
        const finish = (val: string | null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { video.removeAttribute('src'); video.load(); } catch { /* noop */ }
            resolve(val);
        };

        const timer = setTimeout(() => finish(null), SAFE_RESOLVE_MS);

        const grab = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = video.videoWidth || 1;
                canvas.height = video.videoHeight || 1;
                const ctx = canvas.getContext('2d');
                if (!ctx) return finish(null);
                ctx.drawImage(video, 0, 0);
                finish(canvas.toDataURL('image/webp', 0.9));
            } catch (e) {
                console.error('[extractFrameClientExecutor] Failed to snapshot video frame:', e);
                finish(null);
            }
        };

        video.onloadeddata = () => {
            const dur = Number.isFinite(video.duration) ? video.duration : 0;
            const t = dur > 0 ? Math.min(time, Math.max(0, dur - 0.05)) : time;
            if (Math.abs(video.currentTime - t) < 0.01) {
                grab();
            } else {
                video.onseeked = grab;
                try { video.currentTime = t; } catch { grab(); }
            }
        };
        video.onerror = () => finish(null);

        video.src = safeUrl(url);
    });
}

/**
 * Paint a live `GraphDescription` at a fixed `time` into an offscreen canvas,
 * repeating for a short settle window so pooled videos can decode the seeked
 * frame, then snapshot to a PNG data URL.
 */
function renderGraphFrameToDataUrl(graph: GraphDescription, time: number): Promise<string | null> {
    return new Promise((resolve) => {
        const dims = graphDimensions(graph);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, dims.width);
        canvas.height = Math.max(1, dims.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(null);

        const cache = new GraphRenderCache(`extract_frame_exec_${Math.random().toString(36).slice(2)}`);
        const start = performance.now();
        let raf = 0;

        const tick = (now: number) => {
            cache.releaseAllScratch();
            // isPlaying=false → the renderer seeks each layer to its local time
            // at `time` and holds (no playhead advance).
            paintGraphFrame(graph, time, ctx, cache, false);

            if (now - start < GRAPH_SETTLE_MS) {
                raf = requestAnimationFrame(tick);
                return;
            }

            let dataUrl: string | null = null;
            try {
                dataUrl = canvas.toDataURL('image/webp', 0.9);
            } catch (e) {
                console.error('[extractFrameClientExecutor] Failed to snapshot graph frame:', e);
                dataUrl = null;
            }
            if (raf) cancelAnimationFrame(raf);
            cache.dispose();
            resolve(dataUrl);
        };
        raf = requestAnimationFrame(tick);
    });
}

export const extractFrameClientExecutor: ClientExecutor<ExtractFrameConfig> = async (config, inputs) => {
    if (typeof window === 'undefined') return null;

    const upstream = inputs.image;
    if (upstream === undefined || upstream === null) return null;

    const normalized = toLegacyRenderableOutput(upstream);
    const first = Array.isArray(normalized) ? normalized[0] : normalized;

    let url: string | null = null;
    let upstreamGraph: GraphDescription | undefined;

    if (typeof first === 'string') {
        url = first;
    } else if (first && typeof first === 'object') {
        if (typeof (first as any).url === 'string') url = (first as any).url;
        if ((first as any).graph) upstreamGraph = (first as any).graph as GraphDescription;
    }

    const hasGraphSource = !!upstreamGraph;
    if (!url && !hasGraphSource) return null;

    const time = Math.max(0, config?.frameTime ?? 0);

    if (hasGraphSource) {
        const dataUrl = await renderGraphFrameToDataUrl(upstreamGraph!, time);
        if (!dataUrl) return null;
        return { type: 'image', data: [{ url: dataUrl }] as ImageObject[] };
    }

    const kind = detectMediaTypeFromUrl(url!) === 'video' || url!.startsWith('data:video/') ? 'video' : 'image';
    if (kind === 'video') {
        const dataUrl = await extractVideoFrameToDataUrl(url!, time);
        if (!dataUrl) return null;
        return { type: 'image', data: [{ url: dataUrl }] as ImageObject[] };
    }

    // Image upstream — extracting a "frame" is the identity. Pass it through.
    return { type: 'image', data: [{ url: url! }] as ImageObject[] };
};
