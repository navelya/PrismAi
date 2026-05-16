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
import { detectSourceKindFromUrl, isLayerActiveAt, LayerSourceKind } from '../shared';
import { acquireVideo, onVideoMetadata, releaseVideo, setPlayState } from '../video-pool';

/**
 * What the shared renderer needs to draw one layer:
 *   - the layer record (transform, visibility, etc.)
 *   - its resolved upstream value: an image object `{ url, ... }`, a text
 *     string, or null when the upstream hasn't produced anything yet
 */
export interface RenderableLayer {
    layer: CompositorLayer;
    resolved: { url?: string } | string | null;
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
     * Intrinsic source duration per layer id (seconds). Drives time gating for
     * video layers when `layer.duration` is null. Populated by the editor from
     * `onLayerVideoLoad` callbacks.
     */
    intrinsicDurations?: Record<string, number | null>;
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
}) {
    // Acquire a pooled element on mount; pool returns the shared element and
    // a unique consumer id so this instance can vote on play state without
    // stomping other surfaces' votes. See video-pool.ts for the consensus
    // logic.
    const handle = useMemo(
        () => (typeof document !== 'undefined' ? acquireVideo(videoUrl) : null),
        [videoUrl],
    );
    const videoEl = handle?.el ?? null;
    const consumerId = handle?.id ?? null;
    const shapeRef = useRef<any>(null);
    const [ready, setReady] = useState(() => !!videoEl && (videoEl as any).readyState >= 1);
    const t = layer.transform;

    // Keep onLoad in a ref so we don't refire the metadata subscription when
    // the parent (CompositorLayerNodes) hands us a fresh arrow callback per
    // render. Without this, every parent re-render unsubscribed + resubscribed
    // and (in earlier versions) tore down the <video> element entirely — the
    // root cause of the "canvas loader stays forever" bug.
    const onLoadRef = useRef(onLoad);
    onLoadRef.current = onLoad;

    useEffect(() => {
        if (!videoEl || consumerId === null) return;
        const unsub = onVideoMetadata(videoUrl, (el) => {
            setReady(true);
            onLoadRef.current?.({
                duration: el.duration || 0,
                width: el.videoWidth || 0,
                height: el.videoHeight || 0,
            });
        });
        return () => {
            unsub();
            releaseVideo(videoUrl, consumerId);
        };
    }, [videoUrl, videoEl, consumerId]);

    // Vote on play state. The pool plays if any consumer wants play, pauses
    // if none do. When this LayerVideo unmounts, releaseVideo removes the
    // vote and the pool re-reconciles — which fixes the case "modal was
    // playing → user closes modal → element should pause because the card
    // never voted to play."
    useEffect(() => {
        if (consumerId === null) return;
        setPlayState(videoUrl, consumerId, !!isPlaying);
    }, [isPlaying, consumerId, videoUrl]);

    // Seek when not playing (covers two cases: paused & user scrubs; inactive
    // clip that the parent is keeping mounted so the decoder stays warm).
    // While playing we let the pooled video advance naturally — manual seeks
    // would stutter. Prefer `fastSeek` when available — it jumps to the
    // nearest keyframe rather than the exact PTS, which paints a frame much
    // sooner during a scrub (Chrome/Firefox/Safari all support it).
    useEffect(() => {
        if (!videoEl || !ready || isPlaying) return;
        if (typeof localTime !== 'number') return;
        const clamped = Math.max(0, Math.min(localTime, Math.max(0, videoEl.duration || 0)));
        if (Math.abs(videoEl.currentTime - clamped) > 0.05) {
            const fastSeek = (videoEl as any).fastSeek;
            if (typeof fastSeek === 'function') {
                try { fastSeek.call(videoEl, clamped); return; } catch { /* fall through */ }
            }
            videoEl.currentTime = clamped;
        }
    }, [localTime, ready, isPlaying, videoEl]);

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
}: CompositorLayerNodesProps) {
    // Detect if any visible layer is video-sourced — drives whether we mount
    // the shared CompositorAnimator. Image-only compositors don't need an
    // active rAF loop.
    const hasVideo = useMemo(
        () =>
            layers.some(({ layer, resolved }) => {
                if (!layer.visible) return false;
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
                const asText = typeof resolved === 'string' ? resolved : null;

                let kind: LayerSourceKind = 'unknown';
                if (asText !== null) kind = 'text';
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

                if (kind === 'video' && url) {
                    const localTime =
                        typeof playhead === 'number'
                            ? Math.max(0, playhead - (layer.startTime || 0))
                            : undefined;
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
