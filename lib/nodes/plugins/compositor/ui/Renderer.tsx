'use client';

/**
 * Shared Konva layer renderer for the Compositor.
 *
 * Used by both the in-canvas preview ([CompositorNode](../canvas/CompositorNode.tsx))
 * and the full-screen editor ([CompositorEditorModal](./CompositorEditorModal.tsx)).
 *
 * What's shared: the per-layer Konva node setup (image/text props, transforms,
 * blend modes, typography) — so pixel output is identical between preview and
 * editor and there's no drift in scaling math.
 *
 * What's not shared: the Stage itself, because preview and editor have
 * fundamentally different stage management (preview = fit-scaled Group inside a
 * resize-observed container; editor = user-controlled zoom/pan with Transformer
 * and dimmer overlay). Each caller wraps these layer nodes in its own Stage.
 */

import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Image as KonvaImage, Text as KonvaText, Group } from 'react-konva';
import useImage from 'use-image';
import Konva from 'konva';
import { CompositorLayer, LayerTransform } from '../definition';
import { detectSourceKindFromUrl, isLayerActiveAt, LayerSourceKind, GraphDescription, graphDimensions } from '../shared';
import { acquireVideo, onVideoMetadata, releaseVideo, setPlayState, setMuted } from '../video-pool';
import { GraphRenderCache, paintGraphFrame } from '../graph-renderer';

/**
 * What the shared renderer needs to draw one layer:
 *   - the layer record (transform, visibility, etc.)
 *   - its resolved upstream value: an image object `{ url, ... }`, a text
 *     string, an object carrying a live `canvas` reference (legacy push model),
 *     an object carrying a `graph` description (pull model), or null when the
 *     upstream hasn't produced anything yet
 */
export interface RenderableLayer {
    layer: CompositorLayer;
    resolved: { url?: string; canvas?: HTMLCanvasElement; graph?: GraphDescription; cssFilter?: string } | string | null;
}

interface CompositorLayerNodesProps {
    layers: RenderableLayer[];
    interactive?: boolean;
    selectedLayerId?: string | null;
    onSelectLayer?: (layerId: string) => void;
    onTransformLayer?: (layerId: string, updates: Partial<LayerTransform>) => void;
    onLayerImageLoad?: (layerId: string, img: HTMLImageElement) => void;
    /**
     * Reports a video layer's intrinsic metadata when it loads. Used by the
     * editor to populate the timeline's track lengths and by the renderer's
     * own activity gating.
     */
    onLayerVideoLoad?: (layerId: string, meta: { duration: number; width: number; height: number }) => void;
    /** Set isDragging on the global store while a layer is being transformed (autosave gate). */
    onInteractStart?: () => void;
    onInteractEnd?: () => void;
    /**
     * Timeline playhead in seconds. When undefined, no time gating is applied
     * — every visible layer renders (matches the legacy still-composite mode).
     * When provided, layers outside their `[startTime, startTime + effectiveDuration]`
     * window are skipped, and video layers seek/play in sync.
     */
    playhead?: number;
    /** Whether videos should be in playback mode (true) or paused on the playhead (false). */
    isPlaying?: boolean;
    /**
     * Whether the pooled video elements should be muted. The MiniTransport
     * (card) and Transport (modal) volume buttons flow through here; without
     * this thread the toggles were pure UI state and audio never played.
     * Defaults to true so the initial state matches the historical behavior.
     */
    muted?: boolean;
    /**
     * Intrinsic source duration per layer id (seconds). Drives time gating for
     * video layers when `layer.duration` is null. Populated by the editor from
     * `onLayerVideoLoad` callbacks.
     */
    intrinsicDurations?: Record<string, number | null>;
    /**
     * Pool key for HTMLVideoElement acquisition. Surfaces that should share
     * decoders (a compositor card + its editor modal viewing the same
     * compositor) pass the same key — typically the owning node id. Surfaces
     * that need independent playback (a downstream blur or chained compositor)
     * pass their own distinct key so their videos get fresh decoders with
     * independent currentTime.
     *
     * When omitted, callers fall back to the pool's `_global_` default which
     * shares across all unkeyed acquirers (legacy behavior — fine for the
     * pre-pull-model layout but not for chained live previews).
     */
    poolKey?: string;
}

function safeImageUrl(url: string): string {
    if (!url) return '';
    if (url.startsWith('data:')) return url;
    return url + (url.includes('?') ? '&' : '?') + 'notaint=1';
}

const LayerImage = memo(function LayerImage({
    layer,
    imageUrl,
    interactive,
    onSelect,
    onTransform,
    onLoad,
    onInteractStart,
    onInteractEnd,
}: {
    layer: CompositorLayer;
    imageUrl: string;
    interactive: boolean;
    onSelect?: () => void;
    onTransform?: (updates: Partial<LayerTransform>) => void;
    onLoad?: (img: HTMLImageElement) => void;
    onInteractStart?: () => void;
    onInteractEnd?: () => void;
}) {
    const safeUrl = useMemo(() => safeImageUrl(imageUrl), [imageUrl]);
    const [img] = useImage(safeUrl, 'anonymous');
    const shapeRef = useRef<any>(null);
    const t = layer.transform;

    useEffect(() => {
        if (img && onLoad) onLoad(img);
    }, [img, onLoad]);

    if (!img) return null;

    const commonProps: any = {
        image: img,
        ref: shapeRef,
        x: t.x,
        y: t.y,
        width: t.width,
        height: t.height,
        rotation: t.rotation,
        opacity: t.opacity,
        scaleX: t.flipX ? -1 : 1,
        scaleY: t.flipY ? -1 : 1,
        offsetX: t.flipX ? t.width : 0,
        offsetY: t.flipY ? t.height : 0,
        globalCompositeOperation: (t.blendMode as any) || 'source-over',
    };

    if (!interactive) {
        // Non-interactive (preview) still needs to know when the image loads
        // so callers can auto-fit the layer to the image's true dimensions.
        // The onLoad effect above runs in both modes; nothing else to wire.
        return <KonvaImage {...commonProps} listening={false} />;
    }

    return (
        <KonvaImage
            {...commonProps}
            // The Transformer in the editor finds the selected node by name.
            name={`img-${layer.id}`}
            draggable={!layer.locked}
            onClick={onSelect}
            onTap={onSelect}
            onDragStart={() => {
                onSelect?.();
                onInteractStart?.();
            }}
            onDragEnd={(e) => {
                onTransform?.({ x: e.target.x(), y: e.target.y() });
                onInteractEnd?.();
            }}
            onTransformStart={() => onInteractStart?.()}
            onTransformEnd={() => {
                const node = shapeRef.current;
                if (!node) {
                    onInteractEnd?.();
                    return;
                }
                const scaleX = node.scaleX();
                const scaleY = node.scaleY();
                node.scaleX(t.flipX ? -1 : 1);
                node.scaleY(t.flipY ? -1 : 1);
                onTransform?.({
                    x: node.x(),
                    y: node.y(),
                    rotation: node.rotation(),
                    width: Math.max(5, node.width() * Math.abs(scaleX)),
                    height: Math.max(5, node.height() * Math.abs(scaleY)),
                });
                onInteractEnd?.();
            }}
        />
    );
});

/**
 * Render a video layer as a Konva Image bound to an HTMLVideoElement.
 *
 * Konva supports HTMLVideoElement directly as the `image` prop — every redraw
 * pulls the current frame. We drive redraws via a rAF tick state when the
 * video is playing, or seek + draw-once when paused.
 *
 * Local time = `playhead - layer.startTime`. Negative means the layer hasn't
 * started yet (parent should have already skipped via activity gating, but we
 * defend against it here too).
 */
const LayerVideo = memo(function LayerVideo({
    layer,
    videoUrl,
    interactive,
    onSelect,
    onTransform,
    onLoad,
    onInteractStart,
    onInteractEnd,
    localTime,
    isPlaying,
    visible = true,
    poolKey,
    muted = true,
}: {
    layer: CompositorLayer;
    videoUrl: string;
    interactive: boolean;
    onSelect?: () => void;
    onTransform?: (updates: Partial<LayerTransform>) => void;
    onLoad?: (meta: { duration: number; width: number; height: number }) => void;
    onInteractStart?: () => void;
    onInteractEnd?: () => void;
    /** Layer-local time in seconds; clamped to [0, video.duration] by the component. */
    localTime: number | undefined;
    isPlaying: boolean;
    /**
     * Konva visibility flag — when false, the layer's frame isn't drawn but
     * the underlying HTMLVideoElement stays mounted and pre-seeked. This is
     * the crucial bit that prevents the "black flash on clip activation"
     * symptom: if we unmounted instead, releasing the pooled video element
     * would force a full re-decode the next time the playhead entered the
     * clip's window.
     */
    visible?: boolean;
    /** See CompositorLayerNodesProps.poolKey. */
    poolKey?: string;
    /**
     * Whether THIS consumer wants the pooled video element muted. Cast as a
     * vote into the pool; OR-ed across all consumers of the same element.
     * Defaults to true so a renderer that doesn't pass the prop matches the
     * historical silent behavior.
     */
    muted?: boolean;
}) {
    // Acquire a pooled element on mount; pool returns the shared element and
    // a unique consumer id so this instance can vote on play state without
    // stomping other surfaces' votes. See video-pool.ts for the consensus
    // logic. The poolKey scopes the acquisition so independent consumer trees
    // (different cards) get independent decoders for the same URL.
    const handle = useMemo(
        () => (typeof document !== 'undefined' ? acquireVideo(videoUrl, poolKey) : null),
        [videoUrl, poolKey],
    );
    const pooledEl = handle?.el ?? null;
    const consumerId = handle?.id ?? null;
    const shapeRef = useRef<any>(null);
    const [ready, setReady] = useState(() => !!pooledEl && (pooledEl as any).readyState >= 1);
    const t = layer.transform;

    const videoEl = pooledEl;

    // Keep onLoad in a ref so we don't refire the metadata subscription when
    // the parent (CompositorLayerNodes) hands us a fresh arrow callback per
    // render. Without this, every parent re-render unsubscribed + resubscribed
    // and (in earlier versions) tore down the <video> element entirely — the
    // root cause of the "canvas loader stays forever" bug.
    const onLoadRef = useRef(onLoad);
    onLoadRef.current = onLoad;

    useEffect(() => {
        if (!pooledEl || consumerId === null) return;
        const unsub = onVideoMetadata(videoUrl, (el) => {
            setReady(true);
            onLoadRef.current?.({
                duration: el.duration || 0,
                width: el.videoWidth || 0,
                height: el.videoHeight || 0,
            });
        }, poolKey);
        return () => {
            unsub();
            releaseVideo(videoUrl, consumerId, poolKey);
        };
    }, [videoUrl, pooledEl, consumerId, poolKey]);

    // Vote on play state. The pool plays if any consumer wants play, pauses
    // if none do. When this LayerVideo unmounts, releaseVideo removes the
    // vote and the pool re-reconciles — which fixes the case "modal was
    // playing → user closes modal → element should pause because the card
    // never voted to play."
    useEffect(() => {
        if (consumerId === null) return;
        setPlayState(videoUrl, consumerId, !!isPlaying, poolKey);
    }, [isPlaying, consumerId, videoUrl, poolKey]);

    // Vote on mute state. Toggling the volume button on the card or in the
    // editor flips this prop; setMuted reconciles the pool's element so audio
    // actually plays. Without this, the prior `muted=true` initialization in
    // the pool stuck forever and the volume buttons were decorative.
    useEffect(() => {
        if (consumerId === null) return;
        setMuted(videoUrl, consumerId, !!muted, poolKey);
    }, [muted, consumerId, videoUrl, poolKey]);

    // Seek when not playing (covers two cases: paused & user scrubs; inactive
    // clip that the parent is keeping mounted so the decoder stays warm).
    // While playing we let the pooled video advance naturally — manual seeks
    // would stutter. Prefer `fastSeek` when available — it jumps to the
    // nearest keyframe rather than the exact PTS, which paints a frame much
    // sooner during a scrub (Chrome/Firefox/Safari all support it).
    useEffect(() => {
        // Always seek on the underlying pooled HTMLVideoElement, even when
        // we're rendering the offscreen filter canvas — only the real video
        // element has meaningful duration/currentTime/fastSeek.
        if (!pooledEl || !ready || isPlaying) return;
        if (typeof localTime !== 'number') return;
        const clamped = Math.max(0, Math.min(localTime, Math.max(0, pooledEl.duration || 0)));
        if (Math.abs(pooledEl.currentTime - clamped) > 0.05) {
            const fastSeek = (pooledEl as any).fastSeek;
            if (typeof fastSeek === 'function') {
                try { fastSeek.call(pooledEl, clamped); return; } catch { /* fall through */ }
            }
            pooledEl.currentTime = clamped;
        }
    }, [localTime, ready, isPlaying, pooledEl]);

    if (!ready || !videoEl) return null;

    const commonProps: any = {
        image: videoEl,
        ref: shapeRef,
        visible,
        x: t.x,
        y: t.y,
        width: t.width,
        height: t.height,
        rotation: t.rotation,
        opacity: t.opacity,
        scaleX: t.flipX ? -1 : 1,
        scaleY: t.flipY ? -1 : 1,
        offsetX: t.flipX ? t.width : 0,
        offsetY: t.flipY ? t.height : 0,
        globalCompositeOperation: (t.blendMode as any) || 'source-over',
    };

    if (!interactive) {
        return <KonvaImage {...commonProps} listening={false} />;
    }

    return (
        <KonvaImage
            {...commonProps}
            name={`img-${layer.id}`}
            draggable={!layer.locked && visible}
            onClick={onSelect}
            onTap={onSelect}
            onDragStart={() => {
                onSelect?.();
                onInteractStart?.();
            }}
            onDragEnd={(e) => {
                onTransform?.({ x: e.target.x(), y: e.target.y() });
                onInteractEnd?.();
            }}
            onTransformStart={() => onInteractStart?.()}
            onTransformEnd={() => {
                const node = shapeRef.current;
                if (!node) {
                    onInteractEnd?.();
                    return;
                }
                const scaleX = node.scaleX();
                const scaleY = node.scaleY();
                node.scaleX(t.flipX ? -1 : 1);
                node.scaleY(t.flipY ? -1 : 1);
                onTransform?.({
                    x: node.x(),
                    y: node.y(),
                    rotation: node.rotation(),
                    width: Math.max(5, node.width() * Math.abs(scaleX)),
                    height: Math.max(5, node.height() * Math.abs(scaleY)),
                });
                onInteractEnd?.();
            }}
        />
    );
});

/**
 * Render a layer whose source is an HTMLCanvasElement (e.g. another
 * Compositor's live canvas, or a Blur node that wraps it). No video pool,
 * no decoder warm-up — Konva accepts HTMLCanvasElement as a `KonvaImage`
 * source directly, and the shared `CompositorAnimator` on this Layer
 * batches the redraw that re-reads the canvas pixels each frame. That's
 * what makes compositor-to-compositor chaining feel instant: zero encoding,
 * zero round-trip, just pointer-passing.
 *
 * Activity gating: a canvas source has no intrinsic duration. We treat it
 * image-style — always active whenever the parent says it's visible (its
 * own playhead is owned by the upstream compositor, which already gates
 * what frames the canvas shows).
 */
const LayerCanvas = memo(function LayerCanvas({
    layer,
    sourceCanvas,
    cssFilter,
    interactive,
    onSelect,
    onTransform,
    onLoad,
    onInteractStart,
    onInteractEnd,
    visible = true,
}: {
    layer: CompositorLayer;
    sourceCanvas: HTMLCanvasElement;
    /**
     * Same contract as LayerVideo's cssFilter. When present, frames are
     * copied through an offscreen canvas with `ctx.filter = cssFilter`
     * before Konva picks them up. Chained filters compose by concatenation.
     */
    cssFilter?: string | null;
    interactive: boolean;
    onSelect?: () => void;
    onTransform?: (updates: Partial<LayerTransform>) => void;
    onLoad?: (meta: { duration: number; width: number; height: number }) => void;
    onInteractStart?: () => void;
    onInteractEnd?: () => void;
    visible?: boolean;
}) {
    const shapeRef = useRef<any>(null);
    const t = layer.transform;

    // Always route through a managed wrapper canvas — never hand the
    // upstream canvas to Konva directly. Two reasons:
    //   (1) The upstream canvas can briefly be 0×0 during layout/mount
    //       transitions; Konva's internal `drawImage` throws an
    //       InvalidStateError on a 0-dim source. Our wrapper retains its
    //       last-good dimensions across transitions so Konva never sees 0.
    //   (2) The cssFilter path needs an offscreen canvas anyway. Using the
    //       same wrapper for both filter-on and filter-off cases keeps the
    //       code one path; the per-frame copy at typical canvas sizes is
    //       ~1ms and the simplicity is worth it.
    const wrapperRef = useRef<HTMLCanvasElement | null>(null);
    if (!wrapperRef.current && typeof document !== 'undefined') {
        const c = document.createElement('canvas');
        // HTML5 default is 300×150, but force a non-zero start for safety —
        // Konva's drawImage will refuse a 0-dim image even on first paint.
        if (!c.width) c.width = 1;
        if (!c.height) c.height = 1;
        wrapperRef.current = c;
    }

    // Copy frames from the upstream canvas through the wrapper. When
    // cssFilter is set, apply it during the copy. Konva's CompositorAnimator
    // drives the redraw rate; this loop's job is only to keep the wrapper's
    // pixels current with the upstream so each Konva redraw reads a fresh
    // frame.
    useEffect(() => {
        const dst = wrapperRef.current;
        if (!dst || !sourceCanvas) return;
        const ctx = dst.getContext('2d');
        if (!ctx) return;
        let stopped = false;
        let raf = 0;
        const draw = () => {
            if (stopped) return;
            const sw = sourceCanvas.width;
            const sh = sourceCanvas.height;
            // Only resize + copy when the upstream has real dimensions.
            // If it transiently drops to 0 (mount/unmount), the wrapper
            // retains its last-good content so Konva keeps rendering.
            if (sw > 0 && sh > 0) {
                if (dst.width !== sw) dst.width = sw;
                if (dst.height !== sh) dst.height = sh;
                ctx.filter = cssFilter || 'none';
                try {
                    ctx.drawImage(sourceCanvas, 0, 0, sw, sh);
                } catch {
                    // Defensive: cross-origin taint shouldn't happen for our
                    // own in-app canvases, but keep the loop alive.
                }
            }
            raf = requestAnimationFrame(draw);
        };
        raf = requestAnimationFrame(draw);
        return () => {
            stopped = true;
            if (raf) cancelAnimationFrame(raf);
        };
    }, [cssFilter, sourceCanvas]);

    // Report intrinsic dimensions to the parent's auto-fit logic. Poll once
    // per rAF until the upstream canvas has non-zero dims, then fire and
    // stop. Duration is 0 — a live canvas has no intrinsic timeline of its
    // own; the upstream owns the playhead.
    const onLoadRef = useRef(onLoad);
    onLoadRef.current = onLoad;
    useEffect(() => {
        if (!sourceCanvas) return;
        let raf = 0;
        let fired = false;
        const tick = () => {
            if (fired) return;
            const w = sourceCanvas.width;
            const h = sourceCanvas.height;
            if (w > 0 && h > 0) {
                fired = true;
                onLoadRef.current?.({ duration: 0, width: w, height: h });
                return;
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => { if (raf) cancelAnimationFrame(raf); };
    }, [sourceCanvas]);

    const imageEl = wrapperRef.current;
    if (!imageEl) return null;

    const commonProps: any = {
        image: imageEl,
        ref: shapeRef,
        visible,
        x: t.x,
        y: t.y,
        width: t.width,
        height: t.height,
        rotation: t.rotation,
        opacity: t.opacity,
        scaleX: t.flipX ? -1 : 1,
        scaleY: t.flipY ? -1 : 1,
        offsetX: t.flipX ? t.width : 0,
        offsetY: t.flipY ? t.height : 0,
        globalCompositeOperation: (t.blendMode as any) || 'source-over',
    };

    if (!interactive) {
        return <KonvaImage {...commonProps} listening={false} />;
    }

    return (
        <KonvaImage
            {...commonProps}
            name={`img-${layer.id}`}
            draggable={!layer.locked && visible}
            onClick={onSelect}
            onTap={onSelect}
            onDragStart={() => {
                onSelect?.();
                onInteractStart?.();
            }}
            onDragEnd={(e) => {
                onTransform?.({ x: e.target.x(), y: e.target.y() });
                onInteractEnd?.();
            }}
            onTransformStart={() => onInteractStart?.()}
            onTransformEnd={() => {
                const node = shapeRef.current;
                if (!node) {
                    onInteractEnd?.();
                    return;
                }
                const scaleX = node.scaleX();
                const scaleY = node.scaleY();
                node.scaleX(t.flipX ? -1 : 1);
                node.scaleY(t.flipY ? -1 : 1);
                onTransform?.({
                    x: node.x(),
                    y: node.y(),
                    rotation: node.rotation(),
                    width: Math.max(5, node.width() * Math.abs(scaleX)),
                    height: Math.max(5, node.height() * Math.abs(scaleY)),
                });
                onInteractEnd?.();
            }}
        />
    );
});

/**
 * Render a layer whose source is a pull-model `GraphDescription`.
 *
 * Each instance owns an offscreen canvas at the subgraph's natural
 * dimensions. A rAF loop paints the subgraph into it at THIS consumer's
 * playhead via the imperative `paintGraphFrame` renderer (see
 * graph-renderer.ts). The painted canvas is then exposed to the enclosing
 * Konva tree as a KonvaImage source — same trick as `LayerCanvas`, but the
 * canvas's contents are computed locally instead of being a reference to
 * an upstream node's surface.
 *
 * This is the core of the pull-model: instead of every downstream node
 * pointing at the same source canvas (which has one shared playhead), each
 * downstream consumer renders the upstream graph itself, at its own time,
 * into its own canvas.
 */
const LayerSubgraph = memo(function LayerSubgraph({
    layer,
    graph,
    playhead,
    isPlaying,
    poolKey,
    interactive,
    onSelect,
    onTransform,
    onLoad,
    onInteractStart,
    onInteractEnd,
    visible = true,
}: {
    layer: CompositorLayer;
    graph: GraphDescription;
    playhead: number;
    isPlaying: boolean;
    poolKey: string;
    interactive: boolean;
    onSelect?: () => void;
    onTransform?: (updates: Partial<LayerTransform>) => void;
    onLoad?: (meta: { duration: number; width: number; height: number }) => void;
    onInteractStart?: () => void;
    onInteractEnd?: () => void;
    visible?: boolean;
}) {
    const shapeRef = useRef<any>(null);
    const t = layer.transform;
    const dims = graphDimensions(graph);

    // Offscreen canvas + render cache live for the component's lifetime. The
    // cache owns pooled video voters and image loads; releasing it on unmount
    // is what removes this consumer's votes from the shared pool.
    const offscreenRef = useRef<HTMLCanvasElement | null>(null);
    const cacheRef = useRef<GraphRenderCache | null>(null);
    if (!offscreenRef.current && typeof document !== 'undefined') {
        const c = document.createElement('canvas');
        c.width = Math.max(1, dims.width);
        c.height = Math.max(1, dims.height);
        offscreenRef.current = c;
    }
    if (!cacheRef.current) {
        cacheRef.current = new GraphRenderCache(poolKey);
    }

    // Keep the cache's poolKey in sync if the parent changes it (rare — would
    // only happen if the owning node id changed, which it doesn't).
    useEffect(() => {
        return () => {
            cacheRef.current?.dispose();
            cacheRef.current = null;
        };
    }, []);

    // Resize the offscreen canvas if the graph's dimensions change.
    useEffect(() => {
        const c = offscreenRef.current;
        if (!c) return;
        if (c.width !== dims.width) c.width = Math.max(1, dims.width);
        if (c.height !== dims.height) c.height = Math.max(1, dims.height);
    }, [dims.width, dims.height]);

    // Fire onLoad once we know the subgraph's dimensions. Duration is taken
    // from the graph; intrinsic subgraph durations don't drive activity
    // gating at the parent level (the subgraph manages its own timeline).
    const onLoadRef = useRef(onLoad);
    onLoadRef.current = onLoad;
    useEffect(() => {
        if (dims.width > 0 && dims.height > 0) {
            onLoadRef.current?.({ duration: 0, width: dims.width, height: dims.height });
        }
    }, [dims.width, dims.height]);

    // rAF loop driving the subgraph repaint. We don't gate on isPlaying here
    // — even when the consumer is paused, the subgraph might still need to
    // repaint (e.g. user editing layers upstream → live reflection downstream).
    // The cost is one drawImage chain per frame; cheap.
    const playheadRef = useRef(playhead);
    playheadRef.current = playhead;
    const isPlayingRef = useRef(isPlaying);
    isPlayingRef.current = isPlaying;
    useEffect(() => {
        const c = offscreenRef.current;
        const cache = cacheRef.current;
        if (!c || !cache) return;
        let stopped = false;
        let raf = 0;
        const draw = () => {
            if (stopped) return;
            const ctx = c.getContext('2d');
            if (ctx) {
                cache.releaseAllScratch();
                paintGraphFrame(graph, playheadRef.current, ctx, cache, isPlayingRef.current);
            }
            raf = requestAnimationFrame(draw);
        };
        raf = requestAnimationFrame(draw);
        return () => {
            stopped = true;
            if (raf) cancelAnimationFrame(raf);
        };
    }, [graph]);

    const imageEl = offscreenRef.current;
    if (!imageEl) return null;

    const commonProps: any = {
        image: imageEl,
        ref: shapeRef,
        visible,
        x: t.x,
        y: t.y,
        width: t.width,
        height: t.height,
        rotation: t.rotation,
        opacity: t.opacity,
        scaleX: t.flipX ? -1 : 1,
        scaleY: t.flipY ? -1 : 1,
        offsetX: t.flipX ? t.width : 0,
        offsetY: t.flipY ? t.height : 0,
        globalCompositeOperation: (t.blendMode as any) || 'source-over',
    };

    if (!interactive) {
        return <KonvaImage {...commonProps} listening={false} />;
    }

    return (
        <KonvaImage
            {...commonProps}
            name={`img-${layer.id}`}
            draggable={!layer.locked && visible}
            onClick={onSelect}
            onTap={onSelect}
            onDragStart={() => {
                onSelect?.();
                onInteractStart?.();
            }}
            onDragEnd={(e) => {
                onTransform?.({ x: e.target.x(), y: e.target.y() });
                onInteractEnd?.();
            }}
            onTransformStart={() => onInteractStart?.()}
            onTransformEnd={() => {
                const node = shapeRef.current;
                if (!node) {
                    onInteractEnd?.();
                    return;
                }
                const scaleX = node.scaleX();
                const scaleY = node.scaleY();
                node.scaleX(t.flipX ? -1 : 1);
                node.scaleY(t.flipY ? -1 : 1);
                onTransform?.({
                    x: node.x(),
                    y: node.y(),
                    rotation: node.rotation(),
                    width: Math.max(5, node.width() * Math.abs(scaleX)),
                    height: Math.max(5, node.height() * Math.abs(scaleY)),
                });
                onInteractEnd?.();
            }}
        />
    );
});

const LayerText = memo(function LayerText({
    layer,
    text,
    interactive,
    onSelect,
    onTransform,
    onInteractStart,
    onInteractEnd,
}: {
    layer: CompositorLayer;
    text: string;
    interactive: boolean;
    onSelect?: () => void;
    onTransform?: (updates: Partial<LayerTransform>) => void;
    onInteractStart?: () => void;
    onInteractEnd?: () => void;
}) {
    const shapeRef = useRef<any>(null);
    const t = layer.transform;

    const commonProps: any = {
        text,
        ref: shapeRef,
        x: t.x,
        y: t.y,
        width: t.width,
        height: t.height,
        rotation: t.rotation,
        opacity: t.opacity,
        scaleX: t.flipX ? -1 : 1,
        scaleY: t.flipY ? -1 : 1,
        offsetX: t.flipX ? t.width : 0,
        offsetY: t.flipY ? t.height : 0,
        globalCompositeOperation: (t.blendMode as any) || 'source-over',
        fontSize: t.fontSize || 48,
        fontFamily: t.fontFamily || 'Inter',
        fontStyle: t.fontStyle || 'bold',
        fill: t.fillColor || '#ffffff',
        align: t.textAlign || 'center',
        verticalAlign: 'middle',
        lineHeight: t.lineHeight || 1.2,
        letterSpacing: t.letterSpacing || 0,
    };

    if (!interactive) {
        return <KonvaText {...commonProps} listening={false} />;
    }

    return (
        <KonvaText
            {...commonProps}
            name={`img-${layer.id}`}
            draggable={!layer.locked}
            onClick={onSelect}
            onTap={onSelect}
            onDragStart={() => {
                onSelect?.();
                onInteractStart?.();
            }}
            onDragEnd={(e) => {
                onTransform?.({ x: e.target.x(), y: e.target.y() });
                onInteractEnd?.();
            }}
            onTransformStart={() => onInteractStart?.()}
            onTransform={(e) => {
                // Bake scale into width/height each frame and reset scale to 1.
                // Konva applies scaleX/scaleY visually, which would stretch the
                // text glyphs. Translating into width/height instead re-flows
                // the text inside a resized box without distortion.
                const node = e.target;
                const scaleX = node.scaleX();
                const scaleY = node.scaleY();
                const newWidth = Math.max(20, node.width() * Math.abs(scaleX));
                const newHeight = Math.max(20, node.height() * Math.abs(scaleY));
                node.setAttrs({
                    width: newWidth,
                    height: newHeight,
                    scaleX: t.flipX ? -1 : 1,
                    scaleY: t.flipY ? -1 : 1,
                });
            }}
            onTransformEnd={() => {
                const node = shapeRef.current;
                if (!node) {
                    onInteractEnd?.();
                    return;
                }
                const scaleX = node.scaleX();
                const scaleY = node.scaleY();
                node.scaleX(t.flipX ? -1 : 1);
                node.scaleY(t.flipY ? -1 : 1);
                onTransform?.({
                    x: node.x(),
                    y: node.y(),
                    rotation: node.rotation(),
                    width: Math.max(20, node.width() * Math.abs(scaleX)),
                    height: Math.max(20, node.height() * Math.abs(scaleY)),
                });
                onInteractEnd?.();
            }}
        />
    );
});

/**
 * Single per-Stage Konva.Animation that owns the redraw loop.
 *
 * Previously each `<LayerVideo>` ran its own `requestVideoFrameCallback` (or
 * `rAF`) loop calling `batchDraw()` — three videos meant three independent
 * redraw triggers per frame, all hitting the same Konva Layer. This
 * component replaces that with one `Konva.Animation` per Layer; Konva itself
 * coalesces redraws into a single per-frame paint.
 *
 * Mount this inside the same Konva `<Layer>` whose nodes you want animated.
 * Pass `enabled={true}` when any layer's source is video; pass `false` for
 * image-only compositors so we don't waste a frame loop on a static scene.
 */
export const CompositorAnimator = memo(function CompositorAnimator({
    enabled,
}: { enabled: boolean }) {
    // The Group is a no-op visually — its sole purpose is to hold a ref so
    // we can reach the parent Konva.Layer at runtime. We don't render
    // anything inside it.
    const anchorRef = useRef<any>(null);

    useEffect(() => {
        if (!enabled) return;
        const node = anchorRef.current;
        const konvaLayer = node?.getLayer?.();
        if (!konvaLayer) return;
        // Empty callback: Konva.Animation marks the layer dirty every frame.
        // Each redraw re-reads every <KonvaImage>'s `image` prop, which for
        // pooled HTMLVideoElement sources means the current decoded frame
        // gets painted naturally.
        const anim = new Konva.Animation(() => {}, konvaLayer);
        anim.start();
        return () => { anim.stop(); };
    }, [enabled]);

    return <Group ref={anchorRef} listening={false} />;
});

/**
 * Render the compositor's layers as Konva nodes. Mount inside any Konva `<Layer>`.
 * Pass `interactive` to enable drag/transform/select; omit for static preview.
 */
export const CompositorLayerNodes = memo(function CompositorLayerNodes({
    layers,
    interactive = false,
    onSelectLayer,
    onTransformLayer,
    onLayerImageLoad,
    onLayerVideoLoad,
    onInteractStart,
    onInteractEnd,
    playhead,
    isPlaying = false,
    intrinsicDurations,
    poolKey,
    muted = true,
}: CompositorLayerNodesProps) {
    // Detect if any visible layer needs the continuous redraw loop. That's
    // true when the layer is a video URL (frames decode over time), an
    // upstream canvas reference (legacy push model), or a graph description
    // (pull model — the subgraph might be animating). Image-only compositors
    // don't need the rAF loop.
    const hasVideo = useMemo(
        () =>
            layers.some(({ layer, resolved }) => {
                if (!layer.visible) return false;
                if (resolved && typeof resolved === 'object') {
                    if ((resolved as any).graph) return true;
                    if ((resolved as any).canvas instanceof HTMLCanvasElement) return true;
                }
                const url =
                    resolved && typeof resolved === 'object' && typeof (resolved as any).url === 'string'
                        ? ((resolved as any).url as string)
                        : null;
                return !!(url && detectSourceKindFromUrl(url) === 'video');
            }),
        [layers],
    );

    return (
        <>
            <CompositorAnimator enabled={hasVideo} />
            {[...layers].reverse().map(({ layer, resolved }) => {
                if (!layer.visible) return null;
                if (resolved === null || resolved === undefined) return null;

                const url =
                    resolved && typeof resolved === 'object' && typeof (resolved as any).url === 'string'
                        ? ((resolved as any).url as string)
                        : null;
                // Pull-model graph description from upstream. When present,
                // takes precedence over every other source — the layer is a
                // sub-render the consumer drives at its own playhead. The
                // graph itself may be a `filter` wrapper composing a CSS
                // filter chain onto an inner compositor graph; the
                // LayerSubgraph renderer descends through both transparently.
                const sourceGraph: GraphDescription | null =
                    resolved && typeof resolved === 'object' && (resolved as any).graph
                        ? ((resolved as any).graph as GraphDescription)
                        : null;
                // Live canvas reference from an upstream renderer (legacy
                // push model — kept for non-graph sources that still publish
                // a direct canvas ref). The pull-model graph branch above
                // takes precedence whenever both are present.
                const sourceCanvas =
                    !sourceGraph &&
                    resolved && typeof resolved === 'object' && (resolved as any).canvas instanceof HTMLCanvasElement
                        ? ((resolved as any).canvas as HTMLCanvasElement)
                        : null;
                // Filter descriptor carried from an upstream effect node
                // (e.g. Blur). When present, the LayerVideo routes frames
                // through an offscreen canvas with `ctx.filter = cssFilter`
                // before Konva renders them.
                const cssFilter =
                    resolved && typeof resolved === 'object' && typeof (resolved as any).cssFilter === 'string'
                        ? ((resolved as any).cssFilter as string)
                        : null;
                const asText = typeof resolved === 'string' ? resolved : null;

                let kind: LayerSourceKind = 'unknown';
                if (asText !== null) kind = 'text';
                else if (sourceGraph) kind = 'video'; // graphs behave like video for gating/redraw
                else if (sourceCanvas) kind = 'video'; // canvas behaves like video for gating/redraw
                else if (url) kind = detectSourceKindFromUrl(url);

                // Activity gating. Video layers stay mounted even when
                // inactive — we just toggle Konva visibility — so the pooled
                // HTMLVideoElement remains decoded and pre-seeked, killing
                // the "black flash on clip activation" symptom. Image / text
                // layers can safely unmount when inactive (no decoder to
                // warm up).
                let isActive = true;
                if (typeof playhead === 'number') {
                    const intrinsic = intrinsicDurations?.[layer.id] ?? null;
                    isActive = isLayerActiveAt(layer, kind, intrinsic, playhead);
                }

                if (sourceGraph) {
                    // Pull-model: render the subgraph at THIS consumer's
                    // playhead into our own offscreen canvas, then composite
                    // it as a layer in our scene. Independent of any other
                    // consumer of the same upstream — each downstream node
                    // is its own renderer with its own time cursor.
                    return (
                        <LayerSubgraph
                            key={layer.id}
                            layer={layer}
                            graph={sourceGraph}
                            playhead={typeof playhead === 'number' ? playhead : 0}
                            isPlaying={isPlaying}
                            poolKey={poolKey || '_global_'}
                            interactive={interactive}
                            onSelect={interactive && onSelectLayer ? () => onSelectLayer(layer.id) : undefined}
                            onTransform={
                                interactive && onTransformLayer
                                    ? (u) => onTransformLayer(layer.id, u)
                                    : undefined
                            }
                            onLoad={
                                onLayerVideoLoad
                                    ? (meta) => onLayerVideoLoad(layer.id, meta)
                                    : undefined
                            }
                            onInteractStart={onInteractStart}
                            onInteractEnd={onInteractEnd}
                            visible={true}
                        />
                    );
                }

                if (sourceCanvas) {
                    // Canvas-sourced layer: ignore the playhead, ignore
                    // activity gating (a live canvas has no intrinsic
                    // timeline of its own). The upstream renderer's playhead
                    // already decides which frames the canvas shows; here we
                    // just composite whatever's currently in it.
                    return (
                        <LayerCanvas
                            key={layer.id}
                            layer={layer}
                            sourceCanvas={sourceCanvas}
                            cssFilter={cssFilter}
                            interactive={interactive}
                            onSelect={interactive && onSelectLayer ? () => onSelectLayer(layer.id) : undefined}
                            onTransform={
                                interactive && onTransformLayer
                                    ? (u) => onTransformLayer(layer.id, u)
                                    : undefined
                            }
                            onLoad={
                                onLayerVideoLoad
                                    ? (meta) => onLayerVideoLoad(layer.id, meta)
                                    : undefined
                            }
                            onInteractStart={onInteractStart}
                            onInteractEnd={onInteractEnd}
                            visible={true}
                        />
                    );
                }

                if (kind === 'video' && url) {
                    const localTime =
                        typeof playhead === 'number'
                            ? Math.max(0, playhead - (layer.startTime || 0))
                            : undefined;
                    // Mute inactive clips even when the surface wants audio,
                    // so a paused-by-time-gating clip doesn't leak a frame of
                    // sound when the playhead briefly crosses its edge.
                    const layerMuted = muted || !isActive || !!layer.muted;
                    return (
                        <LayerVideo
                            key={layer.id}
                            layer={layer}
                            videoUrl={url}
                            interactive={interactive}
                            onSelect={interactive && onSelectLayer ? () => onSelectLayer(layer.id) : undefined}
                            onTransform={
                                interactive && onTransformLayer
                                    ? (u) => onTransformLayer(layer.id, u)
                                    : undefined
                            }
                            onLoad={
                                onLayerVideoLoad
                                    ? (meta) => onLayerVideoLoad(layer.id, meta)
                                    : undefined
                            }
                            onInteractStart={onInteractStart}
                            onInteractEnd={onInteractEnd}
                            localTime={localTime}
                            isPlaying={isPlaying && isActive}
                            visible={isActive}
                            poolKey={poolKey}
                            muted={layerMuted}
                        />
                    );
                }

                if (typeof playhead === 'number' && !isActive) {
                    return null;
                }

                if (kind === 'image' && url) {
                    return (
                        <LayerImage
                            key={layer.id}
                            layer={layer}
                            imageUrl={url}
                            interactive={interactive}
                            onSelect={interactive && onSelectLayer ? () => onSelectLayer(layer.id) : undefined}
                            onTransform={
                                interactive && onTransformLayer
                                    ? (u) => onTransformLayer(layer.id, u)
                                    : undefined
                            }
                            // Auto-center on first image load fires in both
                            // preview and editor — the receiver's idempotency
                            // guard (isAutoCentered) makes this safe.
                            onLoad={
                                onLayerImageLoad
                                    ? (img) => onLayerImageLoad(layer.id, img)
                                    : undefined
                            }
                            onInteractStart={onInteractStart}
                            onInteractEnd={onInteractEnd}
                        />
                    );
                }
                if (asText !== null) {
                    return (
                        <LayerText
                            key={layer.id}
                            layer={layer}
                            text={asText}
                            interactive={interactive}
                            onSelect={interactive && onSelectLayer ? () => onSelectLayer(layer.id) : undefined}
                            onTransform={
                                interactive && onTransformLayer
                                    ? (u) => onTransformLayer(layer.id, u)
                                    : undefined
                            }
                            onInteractStart={onInteractStart}
                            onInteractEnd={onInteractEnd}
                        />
                    );
                }
                return null;
            })}
        </>
    );
});
