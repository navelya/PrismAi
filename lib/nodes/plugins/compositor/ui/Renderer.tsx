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
import {
    detectSourceKindFromUrl,
    getSourceSeekTime,
    isLayerActiveAt,
    LayerSourceKind,
    GraphDescription,
    graphDimensions,
    resolveGraphDuration,
} from '../shared';
import {
    acquireVideo,
    onVideoMetadata,
    releaseVideo,
    setPlayState,
    setMuted,
    subscribeFrames,
    supportsVideoFrameCallback,
} from '../video-pool';
import { GraphRenderCache, paintGraphFrame } from '../graph-renderer';
import { TransportClock } from '../transport-clock';

/**
 * What the shared renderer needs to draw one layer:
 *   - the layer record (transform, visibility, etc.)
 *   - its resolved upstream value: an image object `{ url, ... }`, a text
 *     string, an object carrying a `graph` description (pull model), or
 *     null when the upstream hasn't produced anything yet
 */
export interface RenderableLayer {
    layer: CompositorLayer;
    resolved: { url?: string; graph?: GraphDescription; resolution?: { width: number; height: number } } | string | null;
}

interface CompositorLayerNodesProps {
    layers: RenderableLayer[];
    interactive?: boolean;
    onSelectLayer?: (layerId: string, additive: boolean) => void;
    onTransformLayer?: (layerId: string, updates: Partial<LayerTransform>) => void;
    /** Live position during a drag (canvas coords), used to drive group drag. */
    onLayerDragMove?: (layerId: string, pos: { x: number; y: number }) => void;
    /** Ids currently in the multi-selection; reserved for future group-aware rendering. */
    selectedLayerIds?: string[];
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
    /**
     * Surface transport clock (see transport-clock.ts). When provided, video
     * and subgraph layers follow it per-frame while playing: exact seeks on
     * clip-activation edges, frame-granular visibility at cuts, and drift
     * correction. The React `playhead` prop then only needs its ~10Hz commit
     * cadence — it serves structural/paused rendering.
     */
    clock?: TransportClock | null;
    /** Redraw-rate ceiling forwarded to CompositorAnimator (cards pass ~30). */
    maxFps?: number;
}

// When a compositor is PAUSED, its scene is static — there's no reason to repaint
// every frame forever (the old behavior pegged the GPU and made the whole canvas,
// incl. node selection, stutter). Instead we run a short redraw burst after any
// change (mount, scrub, play→pause) so an async-decoding video/seek lands, then
// idle. Long enough to cover a typical seek+decode; restarts on the next change.
const PAUSED_SETTLE_MS = 800;

function safeImageUrl(url: string): string {
    if (!url) return '';
    if (url.startsWith('data:')) return url;
    return url + (url.includes('?') ? '&' : '?') + 'notaint=1';
}

const LayerImage = memo(function LayerImage({
    layer,
    imageUrl,
    interactive,
    isSelected,
    onSelect,
    onTransform,
    onLoad,
    onInteractStart,
    onInteractEnd,
    onDragMove,
}: {
    layer: CompositorLayer;
    imageUrl: string;
    interactive: boolean;
    isSelected?: boolean;
    onSelect?: (e?: any) => void;
    onTransform?: (updates: Partial<LayerTransform>) => void;
    onLoad?: (img: HTMLImageElement) => void;
    onInteractStart?: () => void;
    onInteractEnd?: () => void;
    onDragMove?: (x: number, y: number) => void;
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
                if (!isSelected) onSelect?.();
                onInteractStart?.();
            }}
            onDragMove={(e) => onDragMove?.(e.target.x(), e.target.y())}
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
    isSelected,
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
    onDragMove,
    clock = null,
    intrinsicDuration = null,
    surfacePlaying = false,
}: {
    layer: CompositorLayer;
    videoUrl: string;
    interactive: boolean;
    isSelected?: boolean;
    onSelect?: (e?: any) => void;
    onTransform?: (updates: Partial<LayerTransform>) => void;
    onLoad?: (meta: { duration: number; width: number; height: number }) => void;
    onInteractStart?: () => void;
    onInteractEnd?: () => void;
    onDragMove?: (x: number, y: number) => void;
    /** Layer-local time in seconds; clamped to [0, video.duration] by the component. */
    localTime: number | undefined;
    isPlaying: boolean;
    /**
     * Surface transport clock. When provided AND the surface is playing, this
     * component follows the clock per-frame: exact seek on clip-activation
     * edges, Konva visibility toggled at frame granularity (a 10Hz React
     * prop would cut clips up to ~100ms late — reads as a flash/overlap),
     * and drift correction while playing. The React props (`localTime`,
     * `visible`, `isPlaying`) remain the paused/structural path.
     */
    clock?: TransportClock | null;
    /**
     * Intrinsic source duration (seconds) once metadata is known. Needed by
     * the per-frame activity gating above; null before metadata.
     */
    intrinsicDuration?: number | null;
    /**
     * UNGATED surface-level playing flag. The `isPlaying` prop above is
     * activity-gated by the parent (isPlaying && isActive) at React cadence;
     * the clock-follow subscription must outlive activity transitions so a
     * clip can be activated frame-accurately — keying it on the gated prop
     * would tear it down while the clip is inactive and reintroduce the
     * ~100ms-late activation it exists to fix.
     */
    surfacePlaying?: boolean;
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
    // `ready` (readyState >= 1 / HAVE_METADATA) gates only the timing effects
    // below — it must flip at metadata so the decode kick can RUN. It is NOT
    // the compositing gate (see `hasFrame`): drawing the element at readyState
    // 1 paints nothing and the opaque base shows through as black.
    const [ready, setReady] = useState(() => !!pooledEl && (pooledEl as any).readyState >= 1);
    // `hasFrame` (readyState >= 2 / HAVE_CURRENT_DATA) is the COMPOSITING gate.
    // Konva's drawImage(video) copies pixels only once a frame is decoded; at
    // readyState 1 it copies nothing, so the layer contributes nothing and the
    // compositor's opaque base fill reads as a black frame — repainted every
    // tick of the paused settle burst, which is the "multiple black frames
    // before the video appears" symptom. We therefore refuse to mount the
    // KonvaImage until a frame actually exists. Sticky: once true it stays true
    // (a transient mid-playback buffer dip must not un-mount and flicker the
    // clip — Konva keeps drawing the last decoded frame, the correct behavior).
    // Decoupled from `ready` so the decode kick (gated on `ready`) is still the
    // thing that drives 1 -> 2; gating the kick on `hasFrame` would deadlock.
    const [hasFrame, setHasFrame] = useState(() => !!pooledEl && (pooledEl as any).readyState >= 2);
    const t = layer.transform;

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

    // Detect when the pooled element actually has a DECODED frame
    // (readyState >= 2) and flip `hasFrame` — the compositing gate. We listen
    // for the deterministic decode signals (`loadeddata`/`canplay` fire when
    // readyState first reaches HAVE_CURRENT_DATA; `seeked` fires once a sought
    // frame is decoded; a one-shot requestVideoFrameCallback fires exactly when
    // a frame is presented) rather than trusting the force-decode `play()`
    // promise, which resolves on playback-START, not frame-decode. Sticky: only
    // ever sets true here; it resets to false (re-armed) when `pooledEl`
    // changes, i.e. a different element/URL. The batchDraw nudge handles the
    // case where the frame lands after the parent animator's settle burst has
    // already stopped.
    useEffect(() => {
        if (!pooledEl) { setHasFrame(false); return; }
        if (pooledEl.readyState >= 2) { setHasFrame(true); return; }
        setHasFrame(false);
        let cancelled = false;
        let rvfcHandle = 0;
        const mark = () => {
            if (cancelled) return;
            if (pooledEl.readyState >= 2) {
                setHasFrame(true);
                try { shapeRef.current?.getLayer()?.batchDraw(); } catch { /* noop */ }
            }
        };
        pooledEl.addEventListener('loadeddata', mark);
        pooledEl.addEventListener('canplay', mark);
        pooledEl.addEventListener('seeked', mark);
        const rvfc = (pooledEl as any).requestVideoFrameCallback;
        if (typeof rvfc === 'function') {
            // A presented frame implies readyState >= 2; one-shot is enough.
            rvfcHandle = rvfc.call(pooledEl, () => mark());
        }
        return () => {
            cancelled = true;
            pooledEl.removeEventListener('loadeddata', mark);
            pooledEl.removeEventListener('canplay', mark);
            pooledEl.removeEventListener('seeked', mark);
            if (rvfcHandle) {
                try { (pooledEl as any).cancelVideoFrameCallback?.(rvfcHandle); } catch { /* gone */ }
            }
        };
    }, [pooledEl]);

    // When the first frame becomes available the component re-renders and
    // mounts the KonvaImage; this effect runs AFTER that commit (so shapeRef is
    // set) and forces the one repaint that reveals it — covering the case where
    // the parent CompositorAnimator's settle burst already ended.
    useEffect(() => {
        if (hasFrame) {
            try { shapeRef.current?.getLayer()?.batchDraw(); } catch { /* noop */ }
        }
    }, [hasFrame]);

    // Force the first frame to DECODE.
    //
    // A pooled element with preload="auto" reaches readyState 1 (metadata) and
    // then idles — it won't decode a frame until something seeks or plays it.
    // Konva drawing an element at readyState 1 paints nothing, so the
    // compositor's black base shows through: the "first frame is black" on
    // editor open, and "the incoming clip flashes black" at a cut (the next
    // clip's element was warm-but-undecoded until its turn). Kick a decode at
    // the clip's source in-point (muted play→pause — the reliable cross-browser
    // wakeup; a no-op seek to the same currentTime fires no decode). Skipped
    // while the element is already playing or decoded, so it never fights the
    // clock-driven active clip.
    useEffect(() => {
        if (!pooledEl || !ready) return;
        // Skip while the surface is playing: the clock owns play votes then,
        // and a muted play→pause here could pause the active clip the clock
        // wants playing. Pre-decoding happens while paused (open editor/card →
        // clips warm up → press play → smooth transitions), which is the
        // dominant flow.
        if (surfacePlaying) return;
        if (pooledEl.readyState >= 2 || !pooledEl.paused) return;
        let cancelled = false;
        const inT = Math.max(0, layer.trimIn || 0);
        try {
            if (Math.abs(pooledEl.currentTime - inT) > 0.01) pooledEl.currentTime = inT;
        } catch { /* not seekable yet */ }
        const wasMuted = pooledEl.muted;
        try { pooledEl.muted = true; } catch { /* noop */ }
        pooledEl.play()
            .then(() => {
                if (cancelled) return;
                try { pooledEl.pause(); } catch { /* noop */ }
                if (!wasMuted) { try { pooledEl.muted = false; } catch { /* noop */ } }
                // Nudge a repaint so the freshly-decoded frame reaches the
                // Stage even if the animator's settle burst already ended.
                try { shapeRef.current?.getLayer()?.batchDraw(); } catch { /* noop */ }
            })
            .catch(() => {
                if (!wasMuted) { try { pooledEl.muted = false; } catch { /* noop */ } }
            });
        return () => { cancelled = true; };
    }, [ready, pooledEl, layer.trimIn, surfacePlaying]);

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
    // While playing the clock-follow subscription below owns timing — manual
    // 10Hz seeks here would stutter. Prefer `fastSeek` when available — it
    // jumps to the nearest keyframe rather than the exact PTS, which paints a
    // frame much sooner during a scrub (Chrome/Firefox/Safari all support it).
    useEffect(() => {
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

    // ── Per-frame clock follow (playing path) ──
    //
    // Handles the two things the React-prop path can't, WITHOUT ever seeking a
    // steadily-playing element (which would stall its decoder and flash black —
    // see the no-drift note below):
    //   1. FRAME-ACCURATE CUTS / clip positioning: on each activation edge the
    //      element is seeked to the exact clip-local source time and voted to
    //      play; on each deactivation edge it is paused and parked at trimIn so
    //      the next activation starts on the right frame. This is what makes a
    //      split/trimmed clip ("the cut clip") play its correct region instead
    //      of replaying trimmed-out content — it's driven by the edges, not by
    //      per-frame drift correction. Konva visibility is also toggled here at
    //      frame granularity (the ~10Hz React `visible` prop would cut up to
    //      ~100ms late, reading as a flash/overlap).
    //   2. Between edges the clip FREE-RUNS at the pooled element's native rate
    //      (loop=true re-aligns it at the source boundary), exactly as the
    //      pre-overhaul renderer did — no per-frame `currentTime =` write.
    const layerStateRef = useRef({ layer, intrinsicDuration, muted });
    layerStateRef.current = { layer, intrinsicDuration, muted };
    // When the clock is driving playback it is the SOLE authority on this
    // node's Konva visibility — the React `visible` prop (computed from the
    // ~10Hz playhead) is omitted below so it can't overwrite the per-frame
    // value mid-flight (which caused a clip to stay visible ~100ms past a cut).
    const clockOwnsVisibility = !!(clock && surfacePlaying);
    useEffect(() => {
        if (!clock || !surfacePlaying || !pooledEl || consumerId === null || !ready) return;
        let wasActive: boolean | null = null;
        const unsub = clock.subscribe((t) => {
            const { layer: l, intrinsicDuration: intrinsic } = layerStateRef.current;
            const active = isLayerActiveAt(l, 'video', intrinsic ?? null, t);
            const local = getSourceSeekTime(l, t);
            const clamped = Math.max(0, Math.min(local, Math.max(0, pooledEl.duration || 0)));

            // Visibility is synced EVERY tick (not just on edges): React's
            // reconciliation can momentarily reset it (e.g. on a play/pause
            // transition or any re-render), and a once-per-edge set would
            // never re-correct until the next transition. The `!== active`
            // guard keeps it a no-op when nothing changed.
            const node = shapeRef.current;
            if (node && node.visible() !== active) {
                node.visible(active);
                node.getLayer()?.batchDraw();
            }

            if (active !== wasActive) {
                wasActive = active;
                if (active) {
                    // Activation edge (also the first tick after mount/wrap):
                    // position the source exactly before letting it play.
                    try { pooledEl.currentTime = clamped; } catch { /* not seekable yet */ }
                    setPlayState(videoUrl, consumerId, true, poolKey);
                } else {
                    setPlayState(videoUrl, consumerId, false, poolKey);
                    // Park at the clip's trim-in so the next activation
                    // starts on the right frame with no visible seek.
                    try { pooledEl.currentTime = Math.max(0, l.trimIn || 0); } catch { /* noop */ }
                }
                return;
            }

            // NO steady-state drift-correction seek. While a clip is
            // continuously active we let its pooled element FREE-RUN — it was
            // already seeked to the exact source position on the activation
            // edge above and voted to play. A per-frame `currentTime =`
            // correction knocks the decoder back to readyState 1 until the
            // target frame re-decodes; any redraw (the 100ms animator
            // heartbeat, a sibling's rVFC, a visibility sync) landing in that
            // window clears the Konva layer and draws this still-undecoded
            // element as nothing, so the opaque base shows through as a black
            // frame — the "blinking during playback" regression. The
            // pre-overhaul renderer free-ran here and never blinked; the tiny
            // clock-vs-frame drift that can accrue over a long clip is
            // imperceptible (and loop=true re-aligns at the source boundary),
            // which is the correct trade for flawless frames.
        });
        return unsub;
    }, [clock, surfacePlaying, pooledEl, consumerId, ready, videoUrl, poolKey]);

    // Compositing gate: never bind an undecoded element. Until a frame exists
    // the layer is simply absent (the opaque base shows — a single clean black
    // until the reveal, NOT a per-paint flash of an empty element). `hasFrame`
    // implies `ready`, but both are checked for clarity.
    if (!ready || !pooledEl || !hasFrame) return null;

    const commonProps: any = {
        image: pooledEl,
        ref: shapeRef,
        // Clock owns visibility during playback (see clockOwnsVisibility); the
        // React prop is the authority only when paused / on a clock-less surface.
        ...(clockOwnsVisibility ? {} : { visible }),
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
                if (!isSelected) onSelect?.();
                onInteractStart?.();
            }}
            onDragMove={(e) => onDragMove?.(e.target.x(), e.target.y())}
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
 * Konva tree as a KonvaImage source — the canvas's contents are computed
 * locally instead of being a reference to an upstream node's surface.
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
    isSelected,
    onSelect,
    onTransform,
    onLoad,
    onInteractStart,
    onInteractEnd,
    visible = true,
    muted = true,
    onDragMove,
    clock = null,
    surfacePlaying = false,
}: {
    layer: CompositorLayer;
    graph: GraphDescription;
    /**
     * Layer-local time (seconds) inside the subgraph — the parent maps its
     * own playhead through getSourceSeekTime(layer, t) before passing it, so
     * trimming/cutting a graph-sourced clip shifts the subgraph's content
     * exactly like it does a plain video clip's.
     */
    playhead: number;
    isPlaying: boolean;
    poolKey: string;
    interactive: boolean;
    isSelected?: boolean;
    onSelect?: (e?: any) => void;
    onTransform?: (updates: Partial<LayerTransform>) => void;
    onLoad?: (meta: { duration: number; width: number; height: number }) => void;
    onInteractStart?: () => void;
    onInteractEnd?: () => void;
    visible?: boolean;
    onDragMove?: (x: number, y: number) => void;
    /**
     * Mute vote forwarded to the upstream graph's media layers. Without this,
     * pull-model surfaces (chained compositor, downstream blur) had no path
     * for their transport's volume toggle to reach the pooled <video>, so
     * chained graphs stayed silent regardless of UI state.
     */
    muted?: boolean;
    /** Surface transport clock — see LayerVideo. Continuous time + per-frame gating. */
    clock?: TransportClock | null;
    /** Ungated surface-level playing flag — see LayerVideo.surfacePlaying. */
    surfacePlaying?: boolean;
}) {
    const shapeRef = useRef<any>(null);
    const t = layer.transform;
    const dims = graphDimensions(graph);

    // Offscreen canvas + render cache live for the component's lifetime. The
    // cache owns pooled video voters and image loads; releasing it on unmount
    // is what removes this consumer's votes from the shared pool.
    //
    // The cache gets a per-layer pool namespace (`poolKey:sub:layerId`) so (a)
    // its decoders are isolated per clip like LayerVideo's, and (b) the frame
    // subscription below only fires for THIS subgraph's videos rather than
    // every sibling's.
    const offscreenRef = useRef<HTMLCanvasElement | null>(null);
    const cacheRef = useRef<GraphRenderCache | null>(null);
    const cachePoolKey = `${poolKey}:sub:${layer.id}`;
    if (!offscreenRef.current && typeof document !== 'undefined') {
        const c = document.createElement('canvas');
        c.width = Math.max(1, dims.width);
        c.height = Math.max(1, dims.height);
        offscreenRef.current = c;
    }
    if (!cacheRef.current) {
        cacheRef.current = new GraphRenderCache(cachePoolKey);
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

    // Resolved timeline length of the subgraph. The published `duration` is
    // trusted when positive, but blur's URL-wrap graphs publish duration 0
    // (the client executor can't know the video's length synchronously) —
    // there we recompute from our own pooled decoders' metadata as it
    // arrives. Re-checked from the paint loops below (cheap walk) and pushed
    // into state only on change.
    const [resolvedDuration, setResolvedDuration] = useState<number>(() =>
        resolveGraphDuration(graph, () => null),
    );
    const resolvedDurationRef = useRef(resolvedDuration);
    resolvedDurationRef.current = resolvedDuration;
    const refreshResolvedDuration = () => {
        const cache = cacheRef.current;
        if (!cache) return;
        const next = resolveGraphDuration(graph, (url, layerId) => cache.getVideoDuration(url, layerId));
        if (Math.abs(next - resolvedDurationRef.current) > 0.01) {
            resolvedDurationRef.current = next;
            setResolvedDuration(next);
        }
    };

    // Fire onLoad once we know the subgraph's dimensions AND its timeline
    // length. Reporting the resolved duration here is what lets the parent
    // compositor populate `intrinsicDurations[layerId]` correctly, so its own
    // `computeTimelineDuration` sums to the right total (and activity gating
    // can bound this clip) instead of treating the clip as always-on.
    const onLoadRef = useRef(onLoad);
    onLoadRef.current = onLoad;
    useEffect(() => {
        if (dims.width > 0 && dims.height > 0) {
            onLoadRef.current?.({ duration: resolvedDuration, width: dims.width, height: dims.height });
        }
    }, [dims.width, dims.height, resolvedDuration]);

    // rAF loop driving the subgraph repaint. While PLAYING we repaint every
    // frame (the subgraph is animating). While PAUSED the subgraph is static at
    // this playhead, so we only run a short settle burst on change (covers an
    // async-decoding upstream video) and then idle — running this loop forever
    // when paused is what made idle compositor cards peg the GPU and stutter the
    // whole canvas. `paintDep` is constant ('__playing__') while playing so the
    // loop isn't torn down every frame, and equals the playhead while paused so
    // a scrub re-triggers the burst.
    const playheadRef = useRef(playhead);
    playheadRef.current = playhead;
    const isPlayingRef = useRef(isPlaying);
    isPlayingRef.current = isPlaying;
    const mutedRef = useRef(muted);
    mutedRef.current = muted;
    const layerRef = useRef(layer);
    layerRef.current = layer;
    const surfacePlayingActive = !!(clock ? surfacePlaying : isPlaying);
    const paintDep = surfacePlayingActive ? '__playing__' : playhead;
    useEffect(() => {
        const c = offscreenRef.current;
        const cache = cacheRef.current;
        if (!c || !cache) return;
        const ctx = c.getContext('2d');
        let stopped = false;
        let raf = 0;

        // While the SURFACE is playing, repaint on the producer pattern:
        // a pool frame-subscription marks the offscreen dirty whenever one of
        // THIS subgraph's videos presents a new frame (so paint cadence
        // follows the decoder instead of a fixed 60Hz loop — the old
        // uncapped loop burned ~4 of every 5 paints that the throttled Stage
        // blit never even showed), plus a 100ms heartbeat that covers
        // non-video changes (activity windows opening/closing, text/image
        // layers, nested still graphs). Browsers without rVFC fall back to
        // painting every rAF tick, as before.
        //
        // Per-frame clip gating also lives here when a clock is present:
        // compute this graph-layer's own active window and toggle the Konva
        // node's visibility at frame granularity; when the clip deactivates,
        // paint one final frame with isPlaying=false so the nested videos'
        // pool votes reconcile to paused (otherwise they'd keep playing —
        // the old "blur clip keeps looping past its cut" symptom).
        if (surfacePlayingActive) {
            const HEARTBEAT_MS = 100;
            const hasRVFC = supportsVideoFrameCallback();
            let dirty = true;
            const unsubFrames = hasRVFC
                ? subscribeFrames(cachePoolKey, () => { dirty = true; })
                : null;
            let lastPaint = -1;
            let wasActive: boolean | null = null;

            const paintAt = (time: number, playing: boolean) => {
                if (!ctx) return;
                cache.releaseAllScratch();
                paintGraphFrame(graph, time, ctx, cache, playing, mutedRef.current);
                refreshResolvedDuration();
            };
            const blit = () => { try { shapeRef.current?.getLayer()?.batchDraw(); } catch { /* noop */ } };

            const draw = (now: number) => {
                if (stopped) return;
                raf = requestAnimationFrame(draw);

                const surfaceTime = clock ? clock.getTime() : null;
                const localTime = surfaceTime !== null
                    ? getSourceSeekTime(layerRef.current, surfaceTime)
                    : playheadRef.current;

                // Per-frame activity gating (clock surfaces only; clock-less
                // callers keep the parent's React-cadence visible prop).
                if (surfaceTime !== null) {
                    const active = isLayerActiveAt(
                        layerRef.current,
                        'video',
                        resolvedDurationRef.current > 0 ? resolvedDurationRef.current : null,
                        surfaceTime,
                    );
                    // Sync visibility EVERY tick (not just on edges) — a
                    // React re-render can momentarily reset the Konva prop,
                    // and an edge-only set would never re-correct until the
                    // next transition. The `!== active` guard keeps it cheap.
                    const node = shapeRef.current;
                    if (node && node.visible() !== active) {
                        node.visible(active);
                        node.getLayer()?.batchDraw();
                    }
                    if (active !== wasActive) {
                        wasActive = active;
                        if (!active) {
                            // Final pause-paint so nested pool votes settle.
                            paintAt(localTime, false);
                            return;
                        }
                    }
                    if (!active) return; // hidden — skip paint work entirely
                }

                const heartbeatDue = lastPaint < 0 || now - lastPaint >= HEARTBEAT_MS;
                if (!hasRVFC || dirty || heartbeatDue) {
                    dirty = false;
                    lastPaint = now;
                    paintAt(localTime, true);
                    if (hasRVFC) blit();
                }
            };
            raf = requestAnimationFrame(draw);
            return () => {
                stopped = true;
                if (raf) cancelAnimationFrame(raf);
                unsubFrames?.();
            };
        }

        // PAUSED: the scene is static, so we must NOT repaint forever (that
        // pegged the GPU and stuttered the whole canvas). But a fixed-length
        // burst races the nested media's async load — on a cold page load the
        // upstream image/video frequently isn't decoded within the window, so
        // the offscreen canvas paints empty and idles black until some later
        // interaction (e.g. a zoom) happens to re-arm a burst. Instead, keep
        // painting until `paintGraphFrame` reports the frame is COMPLETE (all
        // active media ready), then run the short settle and idle. A hard cap
        // guarantees we still stop if a source never loads.
        const MAX_PAUSED_WAIT_MS = 10000;
        // Blit the freshly-painted offscreen canvas onto the visible Stage.
        // Required because a frame that completes AFTER the parent
        // CompositorAnimator's own settle burst has stopped would otherwise
        // land in the offscreen canvas but never reach the screen.
        const blit = () => { try { shapeRef.current?.getLayer()?.batchDraw(); } catch { /* noop */ } };
        let startMs = -1;
        let completeAtMs = -1;
        const draw = (now: number) => {
            if (stopped) return;
            if (startMs < 0) startMs = now;
            let complete = false;
            if (ctx) {
                cache.releaseAllScratch();
                complete = paintGraphFrame(graph, playhead, ctx, cache, false, mutedRef.current);
                refreshResolvedDuration();
            }
            blit();
            if (complete) {
                if (completeAtMs < 0) completeAtMs = now;
                if (now - completeAtMs >= PAUSED_SETTLE_MS) { stopped = true; return; }
            }
            if (now - startMs >= MAX_PAUSED_WAIT_MS) { stopped = true; return; }
            raf = requestAnimationFrame(draw);
        };
        raf = requestAnimationFrame(draw);
        return () => { stopped = true; if (raf) cancelAnimationFrame(raf); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [graph, paintDep, clock, cachePoolKey]);

    const imageEl = offscreenRef.current;
    if (!imageEl) return null;

    // When the clock drives playback it owns this node's visibility per-frame
    // (the gating loop above); omit the ~10Hz React prop so it can't overwrite
    // the fresh value at a cut. Paused / clock-less surfaces keep the prop.
    const clockOwnsVisibility = !!(clock && surfacePlaying);
    const commonProps: any = {
        image: imageEl,
        ref: shapeRef,
        ...(clockOwnsVisibility ? {} : { visible }),
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
                if (!isSelected) onSelect?.();
                onInteractStart?.();
            }}
            onDragMove={(e) => onDragMove?.(e.target.x(), e.target.y())}
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
    isSelected,
    onSelect,
    onTransform,
    onInteractStart,
    onInteractEnd,
    onDragMove,
}: {
    layer: CompositorLayer;
    text: string;
    interactive: boolean;
    isSelected?: boolean;
    onSelect?: (e?: any) => void;
    onTransform?: (updates: Partial<LayerTransform>) => void;
    onInteractStart?: () => void;
    onInteractEnd?: () => void;
    onDragMove?: (x: number, y: number) => void;
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
                if (!isSelected) onSelect?.();
                onInteractStart?.();
            }}
            onDragMove={(e) => onDragMove?.(e.target.x(), e.target.y())}
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
 *
 * Redraw cadence:
 *   - PLAYING: continuous, every frame (videos/subgraphs advance).
 *   - PAUSED: a single short settle burst (PAUSED_SETTLE_MS) whenever
 *     `redrawKey` changes, then idle. A paused compositor's scene is static, so
 *     repainting it every frame forever was pure waste — it pegged the GPU and
 *     made even node selection stutter. The burst covers async video decode /
 *     seek; `redrawKey` restarts it on scrub, layer add/remove, or play→pause.
 */
export const CompositorAnimator = memo(function CompositorAnimator({
    enabled,
    isPlaying,
    redrawKey,
    poolKey,
    maxFps,
}: {
    enabled: boolean;
    isPlaying: boolean;
    redrawKey: string;
    /**
     * Pool namespace whose video elements drive the redraw. When provided
     * (and the browser supports requestVideoFrameCallback), the Stage blit
     * follows the DECODERS' actual frame cadence instead of a fixed-rate
     * loop: paints happen exactly when a new video frame exists, and when a
     * decoder stalls no paint work competes with it — the starvation
     * feedback loop that forced the old hard 15fps cap can't occur. A 10Hz
     * heartbeat covers non-video changes (clip windows opening/closing,
     * text/image layers). Without a poolKey (or without rVFC) we fall back
     * to a fixed-rate loop.
     */
    poolKey?: string;
    /**
     * Optional ceiling on blit rate. Cards pass ~30 to bound the cost of
     * many simultaneous previews; the fullscreen editor omits it (source
     * cadence, typically 24-30fps, is the natural rate).
     */
    maxFps?: number;
}) {
    // The Group is a no-op visually — its sole purpose is to hold a ref so
    // we can reach the parent Konva.Layer at runtime. We don't render
    // anything inside it.
    const anchorRef = useRef<any>(null);

    useEffect(() => {
        if (!enabled) return;
        const node = anchorRef.current;
        const konvaLayer = node?.getLayer?.();
        if (!konvaLayer) return;
        if (isPlaying) {
            const minIntervalMs = maxFps && maxFps > 0 ? 1000 / maxFps : 0;
            let lastDraw = 0;
            const draw = () => {
                const now = performance.now();
                if (minIntervalMs && now - lastDraw < minIntervalMs) return;
                lastDraw = now;
                // batchDraw is internally rAF-coalesced by Konva — N producer
                // callbacks in one display frame still cost one layer paint.
                konvaLayer.batchDraw();
            };

            if (poolKey && supportsVideoFrameCallback()) {
                const unsub = subscribeFrames(poolKey, draw);
                const heartbeat = setInterval(draw, 100);
                return () => { unsub(); clearInterval(heartbeat); };
            }

            // Fallback (no poolKey / no rVFC): fixed-rate rAF loop at
            // maxFps, defaulting to 30 — twice the old 15fps floor but still
            // bounded so a stalled decoder isn't starved by paint work.
            const FRAME_MS = 1000 / Math.min(maxFps || 30, 30);
            let raf = 0;
            let last = 0;
            const tick = (now: number) => {
                if (now - last >= FRAME_MS) {
                    last = now;
                    konvaLayer.batchDraw();
                }
                raf = requestAnimationFrame(tick);
            };
            raf = requestAnimationFrame(tick);
            return () => { cancelAnimationFrame(raf); };
        }
        // Paused: settle-burst at full rate so async video decode/seek
        // lands cleanly, then idle. A paused compositor's scene is static,
        // so repainting forever was pure waste.
        const anim = new Konva.Animation(() => {}, konvaLayer);
        anim.start();
        const timer = setTimeout(() => anim.stop(), PAUSED_SETTLE_MS);
        return () => { clearTimeout(timer); anim.stop(); };
    }, [enabled, isPlaying, redrawKey, poolKey, maxFps]);

    return <Group ref={anchorRef} listening={false} />;
});

/**
 * Render the compositor's layers as Konva nodes. Mount inside any Konva `<Layer>`.
 * Pass `interactive` to enable drag/transform/select; omit for static preview.
 */
export const CompositorLayerNodes = memo(function CompositorLayerNodes({
    layers,
    interactive = false,
    selectedLayerIds,
    onSelectLayer,
    onTransformLayer,
    onLayerDragMove,
    onLayerImageLoad,
    onLayerVideoLoad,
    onInteractStart,
    onInteractEnd,
    playhead,
    isPlaying = false,
    intrinsicDurations,
    poolKey,
    muted = true,
    clock = null,
    maxFps,
}: CompositorLayerNodesProps) {
    // Detect if any visible layer needs the continuous redraw loop. That's
    // true when the layer is a video URL (frames decode over time) or a
    // graph description (pull model — the subgraph might be animating).
    // Image-only compositors don't need the rAF loop.
    const hasVideo = useMemo(
        () =>
            layers.some(({ layer, resolved }) => {
                if (!layer.visible) return false;
                if (resolved && typeof resolved === 'object' && (resolved as any).graph) return true;
                const url =
                    resolved && typeof resolved === 'object' && typeof (resolved as any).url === 'string'
                        ? ((resolved as any).url as string)
                        : null;
                return !!(url && detectSourceKindFromUrl(url) === 'video');
            }),
        [layers],
    );

    // Constant while playing (so the animator runs continuously without being
    // torn down each frame); encodes scrub position + layer count while paused
    // so a settle burst re-fires on those changes.
    const animatorRedrawKey = isPlaying
        ? '__playing__'
        : `${typeof playhead === 'number' ? playhead.toFixed(3) : 'n'}|${layers.length}`;

    return (
        <>
            <CompositorAnimator
                enabled={hasVideo}
                isPlaying={isPlaying}
                redrawKey={animatorRedrawKey}
                poolKey={poolKey}
                maxFps={maxFps}
            />
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
                const asText = typeof resolved === 'string' ? resolved : null;

                let kind: LayerSourceKind = 'unknown';
                if (asText !== null) kind = 'text';
                else if (sourceGraph) kind = 'video'; // graphs behave like video for gating/redraw
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
                    //
                    // Graph-sourced layers are CLIPS like any other: their
                    // activity window gates rendering (a cut blur clip used
                    // to ignore its window and loop forever), and the time
                    // handed to the subgraph is the clip-local source time
                    // (startTime shifts it, trimIn advances it) so trims and
                    // blade cuts behave identically to plain video clips.
                    const subLocalTime = typeof playhead === 'number'
                        ? getSourceSeekTime(layer, playhead)
                        : 0;
                    return (
                        <LayerSubgraph
                            key={layer.id}
                            layer={layer}
                            graph={sourceGraph}
                            playhead={subLocalTime}
                            isPlaying={isPlaying && isActive}
                            poolKey={poolKey || '_global_'}
                            interactive={interactive}
                            isSelected={!!selectedLayerIds?.includes(layer.id)}
                            onSelect={interactive && onSelectLayer
                                ? (e?: any) => onSelectLayer(layer.id, !!(e?.evt?.ctrlKey || e?.evt?.metaKey))
                                : undefined}
                            onTransform={
                                interactive && onTransformLayer
                                    ? (u) => onTransformLayer(layer.id, u)
                                    : undefined
                            }
                            onDragMove={interactive && onLayerDragMove
                                ? (x: number, y: number) => onLayerDragMove(layer.id, { x, y })
                                : undefined}
                            onLoad={
                                onLayerVideoLoad
                                    ? (meta) => onLayerVideoLoad(layer.id, meta)
                                    : undefined
                            }
                            onInteractStart={onInteractStart}
                            onInteractEnd={onInteractEnd}
                            visible={isActive}
                            muted={muted || !isActive || !!layer.muted}
                            clock={clock}
                            surfacePlaying={isPlaying}
                        />
                    );
                }

                if (kind === 'video' && url) {
                    const localTime =
                        typeof playhead === 'number'
                            ? Math.max(0, playhead - (layer.startTime || 0)) + Math.max(0, layer.trimIn || 0)
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
                            isSelected={!!selectedLayerIds?.includes(layer.id)}
                            onSelect={interactive && onSelectLayer
                                ? (e?: any) => onSelectLayer(layer.id, !!(e?.evt?.ctrlKey || e?.evt?.metaKey))
                                : undefined}
                            onTransform={
                                interactive && onTransformLayer
                                    ? (u) => onTransformLayer(layer.id, u)
                                    : undefined
                            }
                            onDragMove={interactive && onLayerDragMove
                                ? (x: number, y: number) => onLayerDragMove(layer.id, { x, y })
                                : undefined}
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
                            clock={clock}
                            surfacePlaying={isPlaying}
                            intrinsicDuration={intrinsicDurations?.[layer.id] ?? null}
                            // Per-LAYER pool key: two split clips share one URL
                            // and one sourceHandleId but are independent clips
                            // (non-overlapping in time). Suffixing layer.id gives
                            // each its own pooled <video> decoder + currentTime,
                            // so the inactive half's seek effect can't thrash the
                            // active half's shared element. The pool releases the
                            // entry when this layer unmounts (effect cleanup keyed
                            // on poolKey), so distinct keys don't leak.
                            poolKey={`${poolKey || '_global_'}:${layer.id}`}
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
                            isSelected={!!selectedLayerIds?.includes(layer.id)}
                            onSelect={interactive && onSelectLayer
                                ? (e?: any) => onSelectLayer(layer.id, !!(e?.evt?.ctrlKey || e?.evt?.metaKey))
                                : undefined}
                            onTransform={
                                interactive && onTransformLayer
                                    ? (u) => onTransformLayer(layer.id, u)
                                    : undefined
                            }
                            onDragMove={interactive && onLayerDragMove
                                ? (x: number, y: number) => onLayerDragMove(layer.id, { x, y })
                                : undefined}
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
                            isSelected={!!selectedLayerIds?.includes(layer.id)}
                            onSelect={interactive && onSelectLayer
                                ? (e?: any) => onSelectLayer(layer.id, !!(e?.evt?.ctrlKey || e?.evt?.metaKey))
                                : undefined}
                            onTransform={
                                interactive && onTransformLayer
                                    ? (u) => onTransformLayer(layer.id, u)
                                    : undefined
                            }
                            onDragMove={interactive && onLayerDragMove
                                ? (x: number, y: number) => onLayerDragMove(layer.id, { x, y })
                                : undefined}
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
