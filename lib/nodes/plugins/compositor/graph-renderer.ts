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
    getSourceSeekTime,
    isLayerActiveAt,
    LayerSourceKind,
} from './shared';
import { acquireVideo, releaseVideo, setMuted, setPlayState } from './video-pool';
import { buildLevelsLut, applyLutInPlace } from '../levels/shared';

/**
 * Split an accumulated cssFilter chain into the part `ctx.filter` can apply
 * natively (blur, contrast, …) and the Levels node's `levels(b,w,g)` tokens,
 * which have no native CSS-filter equivalent (gamma) and are applied as a
 * per-frame RGB LUT instead.
 *
 * Ordering caveat: native CSS filters apply during the drawImage, then each
 * levels LUT applies after, regardless of the original encounter order. A
 * single levels filter (the common case) is exact; a mixed blur+levels chain
 * is visually approximate in the live preview only — the server export and the
 * levels node's own card preview are unaffected.
 */
function splitLevelsFromCssFilter(cssFilter: string): {
    cssOnly: string;
    levelsLuts: Uint8ClampedArray[];
} {
    const levelsLuts: Uint8ClampedArray[] = [];
    const cssOnly = cssFilter
        .replace(/levels\(([^)]*)\)/gi, (_, args: string) => {
            const [b, w, g] = String(args).split(',').map((s) => parseFloat(s));
            if ([b, w, g].every((n) => isFinite(n))) {
                levelsLuts.push(buildLevelsLut(b, w, g));
            }
            return '';
        })
        .replace(/\s+/g, ' ')
        .trim();
    return { cssOnly, levelsLuts };
}

/** Convert a graph layer's source to the kind enum used by activity gating. */
function sourceKind(source: GraphLayerSource): LayerSourceKind {
    if (source.kind === 'media') return source.mediaKind;
    if (source.kind === 'text') return 'text';
    return 'video'; // nested graphs are always treated as video for gating
}

interface VideoHandle {
    el: HTMLVideoElement;
    id: number;
    /** Full pool key the element was acquired under (poolKey:slotKey). */
    acquiredPoolKey: string;
    url: string;
}

/**
 * Per-consumer cache. Holds image loads, scratch canvases, and pooled video
 * handles for the lifetime of one renderer (one `LayerSubgraph` instance).
 *
 * Important: video handles are pool-keyed by the consumer's `poolKey` PLUS
 * the layer's slot key (`poolKey:layerId`) so each consumer gets its own
 * decoder per CLIP with its own `currentTime`. Per-clip (not per-URL)
 * isolation matters for split clips: two halves of a blade cut share one URL
 * but are independent clips — keying by URL alone made them fight over a
 * single element's currentTime and stomp each other's play votes (the second
 * clip's "I'm inactive, pause" vote overrode the first clip's "play").
 * Mirrors the per-layer suffixing the top-level Konva LayerVideo already
 * does (Renderer.tsx poolKey={`${poolKey}:${layer.id}`}).
 */
export class GraphRenderCache {
    readonly poolKey: string;
    private images = new Map<string, HTMLImageElement>();
    private imageLoadingPromises = new Map<string, Promise<HTMLImageElement>>();
    private videos = new Map<string, VideoHandle>();
    private scratch: HTMLCanvasElement[] = [];
    private scratchInUse = 0;
    /**
     * Per-slot "was active in the previous frame" flag. Drives the
     * transition handling in `voteVideoPoolState`: activation seeks to
     * layer-local time, deactivation pre-positions the element back to the
     * clip's trim-in so the next activation can play instantly without a
     * seek delay.
     */
    private lastActiveBySlot = new Map<string, boolean>();
    /**
     * Per-slot "what local time were we at on the previous frame." Lets
     * `voteVideoPoolState` distinguish natural frame-to-frame advancement
     * (~16ms steady-state) from user-initiated scrubs (large jumps) and
     * seek only on the latter — keeping the element stable during pause.
     */
    private lastLocalTimeBySlot = new Map<string, number>();

    constructor(poolKey: string) {
        this.poolKey = poolKey;
    }

    private slotEntryKey(slotKey: string, url: string): string {
        return `${slotKey}|${url}`;
    }

    wasVideoActive(slotKey: string): boolean {
        return this.lastActiveBySlot.get(slotKey) ?? false;
    }

    markVideoActive(slotKey: string, isActive: boolean): void {
        this.lastActiveBySlot.set(slotKey, isActive);
    }

    getLastLocalTime(slotKey: string): number | null {
        return this.lastLocalTimeBySlot.has(slotKey) ? this.lastLocalTimeBySlot.get(slotKey)! : null;
    }

    setLastLocalTime(slotKey: string, localTime: number): void {
        this.lastLocalTimeBySlot.set(slotKey, localTime);
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
     * Get or acquire a pooled <video> element for this consumer + clip slot.
     * Returns null if the video isn't ready yet; the renderer skips the layer
     * and tries next frame.
     */
    getVideo(url: string, slotKey: string): HTMLVideoElement | null {
        const key = this.slotEntryKey(slotKey, url);
        let handle = this.videos.get(key);
        if (!handle) {
            const acquiredPoolKey = `${this.poolKey}:${slotKey}`;
            const { el, id } = acquireVideo(url, acquiredPoolKey);
            handle = { el, id, acquiredPoolKey, url };
            this.videos.set(key, handle);
        }
        return handle.el.readyState >= 2 ? handle.el : null;
    }

    /** Raw element access regardless of readiness (drift checks, metadata). */
    peekVideo(url: string, slotKey: string): HTMLVideoElement | null {
        return this.videos.get(this.slotEntryKey(slotKey, url))?.el ?? null;
    }

    /**
     * Intrinsic duration of a pooled video once its metadata has loaded;
     * null before that. Feeds `resolveGraphDuration` so graphs published
     * with duration 0 (blur's URL wrap) resolve their real length.
     */
    getVideoDuration(url: string, slotKey: string): number | null {
        const el = this.videos.get(this.slotEntryKey(slotKey, url))?.el;
        if (!el || el.readyState < 1) return null;
        return isFinite(el.duration) && el.duration > 0 ? el.duration : null;
    }

    /**
     * Vote on the play state for a particular clip's video. The pool
     * reconciles per element across all voters in the same poolKey.
     */
    setVideoPlayState(url: string, slotKey: string, wantsPlay: boolean): void {
        const handle = this.videos.get(this.slotEntryKey(slotKey, url));
        if (!handle) return;
        setPlayState(url, handle.id, wantsPlay, handle.acquiredPoolKey);
    }

    /**
     * Vote on the mute state for a particular clip's video. OR-ed across
     * consumers in the pool — without this method, pull-model surfaces had no
     * way to vote unmuted, so chained compositors never emitted audio even
     * when the transport's mute toggle was off.
     */
    setVideoMuted(url: string, slotKey: string, muted: boolean): void {
        const handle = this.videos.get(this.slotEntryKey(slotKey, url));
        if (!handle) return;
        setMuted(url, handle.id, muted, handle.acquiredPoolKey);
    }

    /**
     * Seek a pooled video to `time` (clamped). No-op if the video isn't ready.
     * Uses fastSeek when available for snappier scrubs (only when the element
     * is already decoded — `fastSeek` on a readyState 1 element can silently
     * no-op without firing a seek event in some browsers).
     */
    seekVideo(url: string, slotKey: string, time: number): void {
        const handle = this.videos.get(this.slotEntryKey(slotKey, url));
        if (!handle) return;
        const el = handle.el;
        if (el.readyState < 1) return;
        const clamped = Math.max(0, Math.min(time, Math.max(0, el.duration || 0)));
        if (Math.abs(el.currentTime - clamped) > 0.05) {
            const fastSeek = (el as any).fastSeek;
            // Only use fastSeek once the element is decoded; otherwise the
            // call can silently no-op (Chrome was observed doing this on
            // readyState 1 elements).
            if (el.readyState >= 2 && typeof fastSeek === 'function') {
                try { fastSeek.call(el, clamped); return; } catch { /* fall through */ }
            }
            try { el.currentTime = clamped; } catch { /* not ready */ }
        }
    }

    /**
     * Force a paused, metadata-loaded video element to decode its first frame.
     *
     * The setup we hit: pool acquires an element with preload="auto", browser
     * reaches readyState 1 (metadata), then stops because nothing is asking
     * for frames. drawImage stays empty — we never see the layer. Setting
     * `currentTime` to a no-op value doesn't fire a seek (so no decode). The
     * reliable wakeup is `play()` (which forces frame decoding) followed by
     * an immediate `pause()` so the element ends up paused on a decoded frame
     * rather than playing.
     *
     * Play votes are reconciled via `setPlayState` so the pool's consensus
     * isn't disturbed: this is a side-channel kick to the actual element,
     * not a play-state vote.
     */
    forceFirstFrameDecode(url: string, slotKey: string): void {
        const handle = this.videos.get(this.slotEntryKey(slotKey, url));
        if (!handle) return;
        const el = handle.el;
        if (el.readyState >= 2) return;
        // Element must be muted before play() in all major browsers'
        // autoplay-without-gesture policies. The pool already initializes
        // elements muted (see video-pool.ts el.muted = true), so this is
        // usually a no-op but kept defensive.
        const wasMuted = el.muted;
        try { el.muted = true; } catch { /* noop */ }
        el.play()
            .then(() => {
                try { el.pause(); } catch { /* noop */ }
                if (!wasMuted) {
                    try { el.muted = false; } catch { /* noop */ }
                }
            })
            .catch(() => {
                if (!wasMuted) {
                    try { el.muted = false; } catch { /* noop */ }
                }
            });
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
        this.videos.forEach((handle) => {
            releaseVideo(handle.url, handle.id, handle.acquiredPoolKey);
        });
        this.videos.clear();
        this.images.clear();
        this.imageLoadingPromises.clear();
        this.lastActiveBySlot.clear();
        this.lastLocalTimeBySlot.clear();
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

/**
 * Per-frame state update for one video layer's pool element.
 *
 * Three responsibilities:
 *   - Acquire the element (idempotent) so it warms up before its window.
 *   - Vote on the pool's play + mute state based on activity.
 *   - Issue seeks ONLY on real transitions: layer activation, deactivation,
 *     and user scrubs (large jumps in layer-local time between frames).
 *
 * `drawMediaLayer` is intentionally pure-draw — it does not seek. All
 * timing concerns live here so we never seek-on-pause-while-already-at-the-
 * right-position, which used to cause a visible blank frame on pause.
 */
const SCRUB_JUMP_THRESHOLD_SEC = 0.5;

function voteVideoPoolState(
    cache: GraphRenderCache,
    url: string,
    layer: CompositorLayer,
    time: number,
    isActive: boolean,
    isPlaying: boolean,
    muted: boolean,
): void {
    const slot = layer.id;
    cache.getVideo(url, slot);

    const wasActive = cache.wasVideoActive(slot);
    cache.markVideoActive(slot, isActive);

    // Source-relative time: timeline-local offset PLUS the clip's trim-in.
    // This is the canonical mapping (shared.ts getSourceSeekTime) — the
    // previous `time - startTime` here omitted trimIn, so every pull-model
    // consumer played trimmed/split clips from the wrong source position
    // ("the cut half replays the other half's content").
    const localTime = getSourceSeekTime(layer, time);
    const lastLocalTime = cache.getLastLocalTime(slot);
    cache.setLastLocalTime(slot, localTime);

    cache.setVideoMuted(url, slot, !isActive || muted);

    if (isActive && !wasActive) {
        // Activation edge — seek to layer-local time BEFORE voting play
        // so the browser doesn't start playback from a stale currentTime
        // and then teleport, which renders as a blank frame. Also kick
        // the decoder so a paused not-yet-decoded element doesn't stay
        // stuck at readyState 1 (see forceFirstFrameDecode docstring).
        cache.seekVideo(url, slot, localTime);
        cache.forceFirstFrameDecode(url, slot);
        cache.setVideoPlayState(url, slot, isPlaying);
        return;
    }

    if (!isActive && wasActive) {
        // Deactivation edge — pause, then pre-position to the clip's source
        // start (trim-in) so the next activation has the element already at
        // the right frame and can play instantly. The seek is invisible to
        // the user because the layer isn't being drawn anyway.
        cache.setVideoPlayState(url, slot, false);
        cache.seekVideo(url, slot, Math.max(0, layer.trimIn || 0));
        return;
    }

    if (isActive) {
        // Steady active state. Only TWO reasons to seek; otherwise leave the
        // element alone — both so a paused scene stays visually stable AND so
        // a PLAYING clip free-runs without per-frame seeks (see no-drift note).
        //
        // 1. User-scrub-like jumps in layer-local time. Natural frame-to-
        //    frame playback advances ~16ms which is well under the threshold;
        //    scrubbing (and the once-per-loop wrap back to 0) jumps further.
        //    This is edge-triggered (one seek per jump), not per-frame, so it
        //    does not stall a steadily-playing decoder.
        // 2. Element acquired but not yet decoded a frame (readyState 1, not
        //    yet 2). A paused HTMLVideoElement that loaded metadata won't
        //    decode its first frame on its own — drawImage stays empty until
        //    something seeks OR plays it. The card's Konva-based LayerVideo
        //    has its own seek effect for this; LayerSubgraph relies on us.
        //    `getVideo` returns null while readyState < 2, so we both seek
        //    AND play→pause to wake the decoder. The play+pause kick is the
        //    reliable fallback when fastSeek silently no-ops on a not-yet-
        //    decoded element.
        //
        // NO per-frame PLAYING-drift seek. A `currentTime =` correction on a
        // steadily-playing element knocks its decoder back to readyState 1
        // until the target frame re-decodes; a redraw landing in that window
        // paints the cleared layer with no frame (drawImage no-ops) and the
        // opaque base shows through as a black frame — the "blinking during
        // playback" regression. The pre-overhaul renderer free-ran here and
        // never blinked; loop=true re-aligns the source at its boundary and
        // the scrub-jump branch above re-seeks once on the loop wrap.
        const ready = cache.getVideo(url, slot) !== null;
        const scrubbed =
            lastLocalTime !== null &&
            Math.abs(localTime - lastLocalTime) > SCRUB_JUMP_THRESHOLD_SEC;
        if (!ready) {
            cache.seekVideo(url, slot, localTime);
            cache.forceFirstFrameDecode(url, slot);
        } else if (scrubbed) {
            cache.seekVideo(url, slot, localTime);
        }
        cache.setVideoPlayState(url, slot, isPlaying);
    }
    // !isActive && !wasActive: nothing to do; element stays paused at trim-in.
}

/**
 * Returns `true` if the layer's media was ready and drawn (or n/a), `false`
 * if the asset hasn't finished loading/decoding yet. Callers use the boolean
 * to keep a paused render loop alive until every active layer is ready — see
 * `LayerSubgraph`'s paint loop. Without it, a cold-load subgraph paints one
 * empty frame before its media decodes and then idles black.
 */
function drawMediaLayer(
    ctx: CanvasRenderingContext2D,
    gl: GraphLayer,
    cache: GraphRenderCache,
): boolean {
    const { layer, source } = gl;
    if (source.kind !== 'media') return true;
    const url = source.url;

    if (source.mediaKind === 'video') {
        const el = cache.getVideo(url, layer.id);
        if (!el || el.videoWidth === 0) return false;
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
        return true;
    }

    // image
    const img = cache.getImage(url);
    if (!img) return false;
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
    return true;
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
): boolean {
    const { layer, source } = gl;
    if (source.kind !== 'graph') return true;
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
    if (!sctx) return false;
    // Propagate the nested frame's readiness up: this layer is only "complete"
    // once the graph it wraps has all of ITS media decoded too.
    const complete = paintGraphFrame(sub, time, sctx, cache, isPlaying, muted);

    applyTransform(ctx, layer, (w, h) => {
        try {
            ctx.drawImage(scratch, 0, 0, dims.width, dims.height, 0, 0, w, h);
        } catch {
            // ignore
        }
    });
    return complete;
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
 *
 * Returns `true` when every active layer's media was ready and drawn this
 * frame, `false` when at least one asset is still loading/decoding. A paused
 * caller keeps repainting until this returns `true` (then settles + idles) so
 * a cold-load subgraph doesn't freeze on an empty first frame.
 */
export function paintGraphFrame(
    graph: GraphDescription,
    time: number,
    ctx: CanvasRenderingContext2D,
    cache: GraphRenderCache,
    isPlaying: boolean,
    muted: boolean = true,
): boolean {
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
        if (!sctx) return false;
        const complete = paintGraphFrame(base, time, sctx, cache, isPlaying, muted);
        const targetW = ctx.canvas.width;
        const targetH = ctx.canvas.height;
        // Native CSS filters (blur, …) go through ctx.filter; Levels tokens have
        // no CSS equivalent (gamma) and are applied as an RGB LUT after the draw.
        const { cssOnly, levelsLuts } = splitLevelsFromCssFilter(cssFilter);
        ctx.save();
        ctx.clearRect(0, 0, targetW, targetH);
        ctx.filter = cssOnly || 'none';
        try {
            ctx.drawImage(scratch, 0, 0, baseGraph.canvasWidth, baseGraph.canvasHeight, 0, 0, targetW, targetH);
        } catch {
            // ignore
        }
        ctx.restore();
        if (levelsLuts.length > 0 && targetW > 0 && targetH > 0) {
            try {
                const imageData = ctx.getImageData(0, 0, targetW, targetH);
                for (const lut of levelsLuts) applyLutInPlace(imageData.data, lut);
                ctx.putImageData(imageData, 0, 0);
            } catch {
                // CORS-tainted target can't be read back — skip the LUT this
                // frame rather than crash the render loop.
            }
        }
        return complete;
    }

    // compositor graph
    const w = graph.canvasWidth;
    const h = graph.canvasHeight;
    ctx.clearRect(0, 0, w, h);

    // First pass: vote pool state for every video layer regardless of
    // activity. Inactive layers MUST be voted paused+muted; otherwise an
    // earlier active window leaves them playing in the pool and we end up
    // with all clips' audio stacking simultaneously. Iteration order here
    // doesn't matter because votes are per-URL.
    for (const gl of graph.layers) {
        const { layer, source } = gl;
        if (source.kind !== 'media' || source.mediaKind !== 'video') continue;
        const kind = sourceKind(source);
        const intrinsic = graph.intrinsicDurations[layer.id] ?? null;
        const active = layer.visible && isLayerActiveAt(layer, kind, intrinsic, time);
        voteVideoPoolState(cache, source.url, layer, time, active, isPlaying, muted);
    }

    // Second pass: draw active layers. Reverse order so array[0] is on top —
    // matches the top-level Konva renderer's convention. Track whether every
    // active media/graph layer was ready this frame; text is synchronous and
    // never blocks completeness.
    let complete = true;
    const layers = [...graph.layers].reverse();
    for (const gl of layers) {
        const { layer, source } = gl;
        if (!layer.visible) continue;

        const kind = sourceKind(source);
        const intrinsic = graph.intrinsicDurations[layer.id] ?? null;
        if (!isLayerActiveAt(layer, kind, intrinsic, time)) continue;

        if (source.kind === 'media') {
            complete = drawMediaLayer(ctx, gl, cache) && complete;
        } else if (source.kind === 'text') {
            drawTextLayer(ctx, gl);
        } else if (source.kind === 'graph') {
            complete = drawGraphLayer(ctx, gl, time, isPlaying, cache, muted) && complete;
        }
    }
    return complete;
}
