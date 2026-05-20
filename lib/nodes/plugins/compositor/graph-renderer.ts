'use client';

/**
 * Pull-model graph renderer.
 *
 * A pure-imperative Canvas 2D function that paints a `GraphDescription` at an
 * arbitrary time `t` into a target context. Used by `LayerSubgraph` so each
 * downstream consumer (a chained compositor, a blur card, etc.) can render
 * an upstream graph at its OWN playhead into its OWN offscreen canvas —
 * decoupling playback from the source compositor's UI.
 *
 * Not React-aware: the caller drives repaints (typically via rAF). The cache
 * batches image loads and pooled video element references so steady-state
 * rendering is just `ctx.drawImage` calls.
 *
 * Trade-off vs. the top-level Konva renderer: text layers use vanilla
 * `ctx.fillText`, which is more primitive than Konva.Text — multi-line wrap
 * and `letterSpacing` aren't replicated here. For the v1 pull-model rollout
 * the priority is video compositing; text fidelity in nested subgraphs is a
 * known limitation.
 */

import { CompositorLayer } from './definition';
import {
    GraphDescription,
    GraphLayer,
    GraphLayerSource,
    isLayerActiveAt,
    LayerSourceKind,
} from './shared';
import { acquireVideo, releaseVideo, setMuted, setPlayState } from './video-pool';

/** Convert a graph layer's source to the kind enum used by activity gating. */
function sourceKind(source: GraphLayerSource): LayerSourceKind {
    if (source.kind === 'media') return source.mediaKind;
    if (source.kind === 'text') return 'text';
    return 'video'; // nested graphs are always treated as video for gating
}

interface VideoHandle {
    el: HTMLVideoElement;
    id: number;
}

/**
 * Per-consumer cache. Holds image loads, scratch canvases, and pooled video
 * handles for the lifetime of one renderer (one `LayerSubgraph` instance).
 *
 * Important: video handles are pool-keyed by the consumer's `poolKey` so each
 * consumer gets its own decoder per URL with its own `currentTime`. That's
 * the core of the pull-model — independent playheads across nodes.
 */
export class GraphRenderCache {
    readonly poolKey: string;
    private images = new Map<string, HTMLImageElement>();
    private imageLoadingPromises = new Map<string, Promise<HTMLImageElement>>();
    private videos = new Map<string, VideoHandle>();
    private scratch: HTMLCanvasElement[] = [];
    private scratchInUse = 0;

    constructor(poolKey: string) {
        this.poolKey = poolKey;
    }

    /**
     * Get a loaded image element, or null if it hasn't finished loading yet.
     * Kicks off a load on first request. The renderer paints whatever frames
     * it can; layers whose image isn't ready yet are skipped this frame and
     * reattempted next frame.
     */
    getImage(url: string): HTMLImageElement | null {
        const cached = this.images.get(url);
        if (cached) return cached;

        if (!this.imageLoadingPromises.has(url)) {
            const promise = new Promise<HTMLImageElement>((resolve, reject) => {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => {
                    this.images.set(url, img);
                    resolve(img);
                };
                img.onerror = reject;
                const safe = url.startsWith('data:')
                    ? url
                    : url + (url.includes('?') ? '&' : '?') + 'notaint=1';
                img.src = safe;
            });
            this.imageLoadingPromises.set(url, promise);
        }
        return null;
    }

    /**
     * Get or acquire a pooled <video> element for this consumer. Returns null
     * if the video isn't ready yet; the renderer skips the layer and tries
     * next frame.
     */
    getVideo(url: string): HTMLVideoElement | null {
        let handle = this.videos.get(url);
        if (!handle) {
            handle = acquireVideo(url, this.poolKey);
            this.videos.set(url, handle);
        }
        return handle.el.readyState >= 2 ? handle.el : null;
    }

    /**
     * Vote on the play state for a particular video. The pool reconciles per
     * element across all voters in the same poolKey.
     */
    setVideoPlayState(url: string, wantsPlay: boolean): void {
        const handle = this.videos.get(url);
        if (!handle) return;
        setPlayState(url, handle.id, wantsPlay, this.poolKey);
    }

    /**
     * Vote on the mute state for a particular video. OR-ed across consumers
     * in the pool — without this method, pull-model surfaces had no way to
     * vote unmuted, so chained compositors never emitted audio even when the
     * transport's mute toggle was off.
     */
    setVideoMuted(url: string, muted: boolean): void {
        const handle = this.videos.get(url);
        if (!handle) return;
        setMuted(url, handle.id, muted, this.poolKey);
    }

    /**
     * Seek a pooled video to `time` (clamped). No-op if the video isn't ready.
     * Uses fastSeek when available for snappier scrubs.
     */
    seekVideo(url: string, time: number): void {
        const handle = this.videos.get(url);
        if (!handle) return;
        const el = handle.el;
        if (el.readyState < 1) return;
        const clamped = Math.max(0, Math.min(time, Math.max(0, el.duration || 0)));
        if (Math.abs(el.currentTime - clamped) > 0.05) {
            const fastSeek = (el as any).fastSeek;
            if (typeof fastSeek === 'function') {
                try { fastSeek.call(el, clamped); return; } catch { /* fall through */ }
            }
            try { el.currentTime = clamped; } catch { /* not ready */ }
        }
    }

    /**
     * Borrow a scratch canvas of at least `width × height`. Renderer must
     * call `releaseAllScratch()` between frames so they can be reused next
     * paint. Filter graphs use these to render the upstream into a temp
     * surface before applying the CSS filter on the final draw.
     */
    borrowScratch(width: number, height: number): HTMLCanvasElement {
        if (this.scratchInUse < this.scratch.length) {
            const c = this.scratch[this.scratchInUse++];
            if (c.width !== width) c.width = width;
            if (c.height !== height) c.height = height;
            return c;
        }
        const c = document.createElement('canvas');
        c.width = width;
        c.height = height;
        this.scratch.push(c);
        this.scratchInUse++;
        return c;
    }

    releaseAllScratch(): void {
        this.scratchInUse = 0;
    }

    /**
     * Drop all resources. Called when the renderer unmounts. Releases pooled
     * video voters so the pool can pause/recycle the elements.
     */
    dispose(): void {
        this.videos.forEach((handle, url) => {
            releaseVideo(url, handle.id, this.poolKey);
        });
        this.videos.clear();
        this.images.clear();
        this.imageLoadingPromises.clear();
        this.scratch = [];
        this.scratchInUse = 0;
    }
}

/**
 * Apply a Konva-style layer transform to the current ctx (translate to
 * center, rotate, scale for flip, then draw with -w/2,-h/2 offset).
 */
function applyTransform(
    ctx: CanvasRenderingContext2D,
    layer: CompositorLayer,
    draw: (drawW: number, drawH: number) => void,
): void {
    const t = layer.transform;
    const w = Math.max(1, t.width);
    const h = Math.max(1, t.height);
    ctx.save();
    ctx.globalAlpha = t.opacity ?? 1;
    if (t.blendMode) ctx.globalCompositeOperation = t.blendMode as GlobalCompositeOperation;
    ctx.translate(t.x + w / 2, t.y + h / 2);
    if (t.rotation) ctx.rotate((t.rotation * Math.PI) / 180);
    if (t.flipX || t.flipY) ctx.scale(t.flipX ? -1 : 1, t.flipY ? -1 : 1);
    ctx.translate(-w / 2, -h / 2);
    draw(w, h);
    ctx.restore();
}

function drawMediaLayer(
    ctx: CanvasRenderingContext2D,
    gl: GraphLayer,
    time: number,
    isPlaying: boolean,
    cache: GraphRenderCache,
    muted: boolean,
): void {
    const { layer, source } = gl;
    if (source.kind !== 'media') return;
    const url = source.url;

    if (source.mediaKind === 'video') {
        // Vote play + mute state and seek if paused; pool reconciles across voters.
        cache.setVideoPlayState(url, isPlaying);
        cache.setVideoMuted(url, muted);
        if (!isPlaying) {
            const localTime = Math.max(0, time - (layer.startTime || 0));
            cache.seekVideo(url, localTime);
        }
        const el = cache.getVideo(url);
        if (!el || el.videoWidth === 0) return;
        const t = layer.transform;
        applyTransform(ctx, layer, (w, h) => {
            try {
                ctx.drawImage(
                    el,
                    t.crop?.x ?? 0,
                    t.crop?.y ?? 0,
                    t.crop?.width ?? el.videoWidth,
                    t.crop?.height ?? el.videoHeight,
                    0,
                    0,
                    w,
                    h,
                );
            } catch {
                // CORS-tainted draw can throw; skip this frame.
            }
        });
        return;
    }

    // image
    const img = cache.getImage(url);
    if (!img) return;
    const t = layer.transform;
    applyTransform(ctx, layer, (w, h) => {
        try {
            ctx.drawImage(
                img,
                t.crop?.x ?? 0,
                t.crop?.y ?? 0,
                t.crop?.width ?? img.width,
                t.crop?.height ?? img.height,
                0,
                0,
                w,
                h,
            );
        } catch {
            // ignore
        }
    });
}

function drawTextLayer(ctx: CanvasRenderingContext2D, gl: GraphLayer): void {
    const { layer, source } = gl;
    if (source.kind !== 'text') return;
    const t = layer.transform;
    const fontSize = t.fontSize || 48;
    const fontWeight = t.fontWeight || 'bold';
    const fontStyle = t.fontStyle || 'normal';
    const fontFamily = t.fontFamily || 'Inter';

    applyTransform(ctx, layer, (w, h) => {
        ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
        ctx.fillStyle = t.fillColor || '#ffffff';
        ctx.textAlign = (t.textAlign as CanvasTextAlign) || 'center';
        ctx.textBaseline = 'middle';
        // Single-line vanilla draw. Multi-line wrapping is not replicated
        // here — see file header for the trade-off.
        const x = t.textAlign === 'left' ? 0 : t.textAlign === 'right' ? w : w / 2;
        ctx.fillText(source.text, x, h / 2);
    });
}

function drawGraphLayer(
    ctx: CanvasRenderingContext2D,
    gl: GraphLayer,
    time: number,
    isPlaying: boolean,
    cache: GraphRenderCache,
    muted: boolean,
): void {
    const { layer, source } = gl;
    if (source.kind !== 'graph') return;
    // Render the nested graph into a scratch canvas at its natural
    // resolution, then composite as a regular layer in our coord space.
    const sub = source.graph;
    const dims =
        sub.kind === 'filter'
            ? (() => {
                  let cur: GraphDescription = sub;
                  while (cur.kind === 'filter') cur = cur.upstream;
                  return { width: cur.canvasWidth, height: cur.canvasHeight };
              })()
            : { width: sub.canvasWidth, height: sub.canvasHeight };

    const scratch = cache.borrowScratch(dims.width, dims.height);
    const sctx = scratch.getContext('2d');
    if (!sctx) return;
    paintGraphFrame(sub, time, sctx, cache, isPlaying, muted);

    applyTransform(ctx, layer, (w, h) => {
        try {
            ctx.drawImage(scratch, 0, 0, dims.width, dims.height, 0, 0, w, h);
        } catch {
            // ignore
        }
    });
}

/**
 * Paint a graph at `time` into `ctx`. The renderer assumes `ctx` is sized to
 * the graph's natural dimensions (caller's responsibility).
 *
 * Driven by the caller's repaint loop — typically rAF in `LayerSubgraph`.
 * The cache holds video/image refs across frames; release with `cache.dispose()`
 * when the consumer unmounts.
 *
 * `muted` defaults to true so existing callers (blur preview, etc.) keep their
 * silent behavior without a code change; LayerSubgraph passes the consumer's
 * mute vote through so chained compositors can carry audio.
 */
export function paintGraphFrame(
    graph: GraphDescription,
    time: number,
    ctx: CanvasRenderingContext2D,
    cache: GraphRenderCache,
    isPlaying: boolean,
    muted: boolean = true,
): void {
    if (graph.kind === 'filter') {
        // Recurse into the base graph onto a scratch, then draw with filter.
        let base: GraphDescription = graph;
        let cssFilter = '';
        while (base.kind === 'filter') {
            cssFilter = cssFilter ? `${base.cssFilter} ${cssFilter}` : base.cssFilter;
            base = base.upstream;
        }
        // base is now a non-filter graph
        const baseGraph = base as Exclude<GraphDescription, { kind: 'filter' }>;
        const scratch = cache.borrowScratch(baseGraph.canvasWidth, baseGraph.canvasHeight);
        const sctx = scratch.getContext('2d');
        if (!sctx) return;
        paintGraphFrame(base, time, sctx, cache, isPlaying, muted);
        const targetW = ctx.canvas.width;
        const targetH = ctx.canvas.height;
        ctx.save();
        ctx.clearRect(0, 0, targetW, targetH);
        ctx.filter = cssFilter || 'none';
        try {
            ctx.drawImage(scratch, 0, 0, baseGraph.canvasWidth, baseGraph.canvasHeight, 0, 0, targetW, targetH);
        } catch {
            // ignore
        }
        ctx.restore();
        return;
    }

    // compositor graph
    const w = graph.canvasWidth;
    const h = graph.canvasHeight;
    ctx.clearRect(0, 0, w, h);

    // Iterate in reverse so array[0] is drawn last on top — matches the
    // top-level Konva renderer's convention.
    const layers = [...graph.layers].reverse();
    for (const gl of layers) {
        const { layer, source } = gl;
        if (!layer.visible) continue;

        const kind = sourceKind(source);
        const intrinsic = graph.intrinsicDurations[layer.id] ?? null;
        if (!isLayerActiveAt(layer, kind, intrinsic, time)) continue;

        if (source.kind === 'media') {
            drawMediaLayer(ctx, gl, time, isPlaying, cache, muted);
        } else if (source.kind === 'text') {
            drawTextLayer(ctx, gl);
        } else if (source.kind === 'graph') {
            drawGraphLayer(ctx, gl, time, isPlaying, cache, muted);
        }
    }
}
