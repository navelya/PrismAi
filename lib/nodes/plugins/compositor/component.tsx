'use client';

import React, { memo, useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { NodeProps, useUpdateNodeInternals } from 'reactflow';
import { Plus, Edit3, X } from 'lucide-react';
import { Stage, Layer, Group } from 'react-konva';
import { useAppStore } from '@/lib/store/app-store';
import { useShallow } from 'zustand/react/shallow';
import BaseNode from '@/lib/nodes/core/canvas/BaseNode';
import { CompositorConfig, CompositorLayer, calculateInitialTransform, calculateFirstLayerFitToCanvas, compositorSharedDef } from './definition';
import CompositorEditorModal from './ui/EditorModal';
import ImageLightbox from '@/components/ui/ImageLightbox';
import { toLegacyRenderableOutput } from '@/lib/workflow/result-format';
import { CompositorLayerNodes, RenderableLayer } from './ui/Renderer';
import MiniTransport from './ui/MiniTransport';
import { detectSourceKindFromUrl, computeTimelineDuration } from './shared';
import { useNodeAutoCompute } from '@/lib/hooks/use-node-auto-compute';
import { NodeClientDef } from '../../core/types';
import { compositorClientExecutor } from './executor.client';

const defaultConfig: CompositorConfig = {
    canvasWidth: 1920,
    canvasHeight: 1080,
    backgroundColor: '#00000000',
    layers: [],
    outputFormat: 'png',
    outputQuality: 1.0,
    fps: 30,
    timelineDuration: null,
};

interface CompositorNodeData {
    label: string;
    config: CompositorConfig;
}

// Professional CSS Checkerboard to indicate transparent areas
const checkerboardStyle = {
    backgroundImage: 'repeating-linear-gradient(45deg, rgb(var(--checker-1)) 25%, transparent 25%, transparent 75%, rgb(var(--checker-1)) 75%, rgb(var(--checker-1))), repeating-linear-gradient(45deg, rgb(var(--checker-1)) 25%, transparent 25%, transparent 75%, rgb(var(--checker-1)) 75%, rgb(var(--checker-1)))',
    backgroundPosition: '0 0, 8px 8px',
    backgroundSize: '16px 16px',
    backgroundColor: 'rgb(var(--checker-2))'
};

/**
 * Auto-scaling Konva preview. The container's measured width drives a single
 * scale factor; layers render unscaled inside a scaled <Group>. The preview
 * shares its layer rendering with the editor modal via <CompositorLayerNodes>,
 * so pixel output is identical between the two surfaces.
 *
 * Card-level playhead loops over the timeline so activity gating mirrors the
 * modal's behavior — clips only appear when their time window is active.
 * `onCanvasReady` reports the live Konva Layer canvas to the parent so it
 * can be published as `nodeOutputs[id]` for downstream live consumption.
 */
function LivePreview({
    config,
    renderable,
    stageRef,
    onLayerImageLoad,
    onLayerVideoLoad,
    intrinsicDurations,
    onCanvasReady,
    playhead,
    isPlaying,
    onPlayheadChange,
    onTotalDurationChange,
}: {
    config: CompositorConfig;
    renderable: RenderableLayer[];
    stageRef: React.RefObject<any>;
    onLayerImageLoad?: (layerId: string, img: HTMLImageElement) => void;
    onLayerVideoLoad?: (layerId: string, meta: { duration: number; width: number; height: number }) => void;
    intrinsicDurations: Record<string, number | null>;
    onCanvasReady?: (canvas: HTMLCanvasElement | null) => void;
    /** External playhead control. Owner (the parent card) drives this; preview just renders. */
    playhead: number;
    isPlaying: boolean;
    /** Called when the rAF loop advances the playhead during playback. */
    onPlayheadChange: (t: number) => void;
    /** Called when the computed total timeline duration changes; lets the parent size the transport scrubber. */
    onTotalDurationChange: (total: number) => void;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });

    const canvasWidth = config.canvasWidth || 1920;
    const canvasHeight = config.canvasHeight || 1080;

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const observer = new ResizeObserver((entries) => {
            const rect = entries[0].contentRect;
            setSize({ width: rect.width, height: rect.height });
        });

        observer.observe(container);
        return () => observer.disconnect();
    }, []);

    const scale = size.width > 0 ? size.width / canvasWidth : 0;

    // Compute total timeline length. computeTimelineDuration handles the
    // null-duration fallback (image/text layers default to "full timeline")
    // and the configured-vs-derived choice.
    const layers = config.layers || [];
    const totalDuration = useMemo(
        () => computeTimelineDuration(layers, config.timelineDuration ?? null, intrinsicDurations),
        [layers, config.timelineDuration, intrinsicDurations],
    );

    // Bubble up the computed total so the parent's transport bar can size its
    // scrubber against the same number we use for activity gating.
    useEffect(() => {
        onTotalDurationChange(totalDuration);
    }, [totalDuration, onTotalDurationChange]);

    // Advance the playhead only when the parent says we're playing. When
    // paused, the rAF loop doesn't run and pooled videos are paused via the
    // LayerVideo isPlaying effect — "paused = nothing moves" is honest.
    const playheadRef = useRef(playhead);
    playheadRef.current = playhead;
    useEffect(() => {
        if (!isPlaying) return;
        if (totalDuration <= 0) return;
        let raf: number | null = null;
        let last = performance.now();
        // The accumulator advances every frame so playback timing stays
        // exact. We only push it into React state every THROTTLE_MS — the
        // Konva <Stage> redraws video frames itself via Konva.Animation, so
        // a 60Hz React commit was pure waste. 10Hz keeps activity gating
        // (clip appear/disappear) within 100ms, which is imperceptible.
        const THROTTLE_MS = 100;
        let live = playheadRef.current;
        let lastCommit = last;
        const tick = (now: number) => {
            const dt = (now - last) / 1000;
            last = now;
            // Honor external playhead resets (e.g., the lightbox forcing
            // playback to t=0 before it starts recording). Without this snap,
            // the local `live` accumulator ignores the prop change and the
            // canvas keeps advancing from wherever playback already was —
            // which made the recorded video start mid-timeline and look
            // truncated at the end.
            if (Math.abs(playheadRef.current - live) > 0.5) {
                live = playheadRef.current;
                lastCommit = now;
            }
            live += dt;
            if (live >= totalDuration) live = 0;
            if (now - lastCommit >= THROTTLE_MS) {
                lastCommit = now;
                onPlayheadChange(live);
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => {
            if (raf !== null) cancelAnimationFrame(raf);
            // Commit the final position so React state matches where
            // playback actually stopped (otherwise the preview can freeze up
            // to THROTTLE_MS behind the real playhead on pause).
            onPlayheadChange(live);
        };
    }, [isPlaying, totalDuration, onPlayheadChange]);

    // After the Stage mounts, grab its first Layer's live `<canvas>` element
    // and report it to the parent. Downstream nodes (Blur, etc.) can later
    // read frames from this canvas directly via `drawImage` for live data
    // flow without going through dataURLs.
    useEffect(() => {
        if (!onCanvasReady) return;
        if (scale <= 0) return;
        const stage = stageRef.current;
        if (!stage) return;
        const konvaLayer = stage.getLayers?.()[0];
        const canvasEl: HTMLCanvasElement | null = konvaLayer?.getCanvas?.()?._canvas ?? null;
        onCanvasReady(canvasEl);
    }, [scale, stageRef, onCanvasReady]);

    return (
        <div
            ref={containerRef}
            className="w-full relative overflow-hidden flex items-center justify-center rounded-xl border border-stroke-subtle shadow-2xl"
            style={{
                ...checkerboardStyle,
                aspectRatio: `${canvasWidth} / ${canvasHeight}`
            }}
        >
            {/*
             * Stage is sized to the card's display size; the Layer's
             * `pixelRatio` upsamples the internal canvas to FULL canvas
             * resolution. This keeps `canvas.captureStream(fps)` producing
             * crisp full-resolution frames (so the lightbox's native <video>
             * isn't blurry) without CSS-transforming the Stage — Konva
             * manages width/height styling on its own container, and
             * layering a `transform: scale` on top of that has been
             * brittle in practice.
             *
             * pixelRatio = canvasWidth / displayWidth means the Layer
             * draws at (canvasWidth × canvasHeight) pixels internally,
             * downsampled to display via the Stage's CSS box.
             */}
            {scale > 0 && (
                <Stage
                    ref={stageRef}
                    width={size.width}
                    height={size.height}
                    listening={false}
                >
                    <Layer listening={false} pixelRatio={1 / scale}>
                        <Group scaleX={scale} scaleY={scale}>
                            <CompositorLayerNodes
                                layers={renderable}
                                interactive={false}
                                onLayerImageLoad={onLayerImageLoad}
                                onLayerVideoLoad={onLayerVideoLoad}
                                isPlaying={isPlaying}
                                playhead={playhead}
                                intrinsicDurations={intrinsicDurations}
                            />
                        </Group>
                    </Layer>
                </Stage>
            )}
        </div>
    );
}

/**
 * Instant lightbox for the compositor's live video output.
 *
 * Pure consumer of the same MediaStream the blur preview already consumes —
 * binds `srcObject` to the existing captureStream, so the lightbox opens
 * instantly with whatever the card's Konva canvas is currently producing.
 * No recording, no second renderer mount, no card-playback hijack.
 *
 * Native `<video controls>` provides play / pause / volume / fullscreen.
 * Scrubbing and duration display are inherently broken for live MediaStream
 * sources (the browser reports duration as Infinity and the scrubber is
 * non-interactive) — that's a platform limitation of MediaStream, not
 * something we can paper over without recording. The compositor's own
 * MiniTransport remains the source of truth for timeline position.
 */
function InstantVideoLightbox({
    stream,
    resolution,
    onClose,
}: {
    stream: MediaStream | null;
    resolution: { width: number; height: number };
    onClose: () => void;
}) {
    const videoRef = useRef<HTMLVideoElement | null>(null);

    useEffect(() => {
        const el = videoRef.current;
        if (!el || !stream) return;
        if (el.srcObject !== stream) {
            el.srcObject = stream;
            el.play().catch(() => { /* gesture-required; ignore */ });
        }
        return () => { try { el.srcObject = null; } catch { /* noop */ } };
    }, [stream]);

    return createPortal(
        <div
            className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center"
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onClose(); }}
        >
            <button
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onClose(); }}
                className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                title="Close"
            >
                <X className="w-6 h-6" />
            </button>
            {stream ? (
                <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    loop
                    controls
                    className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl bg-black"
                    style={{ aspectRatio: `${resolution.width} / ${resolution.height}` }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                />
            ) : (
                <div className="text-white/60 text-sm">Preview unavailable in this browser.</div>
            )}
        </div>,
        document.body,
    );
}

function CompositorNode({ data, id, selected }: NodeProps<CompositorNodeData>) {
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const stageRef = useRef<any>(null);
    const updateNodeInternals = useUpdateNodeInternals();

    const updateNodeConfig = useAppStore((state) => state.updateNodeConfig);

    // Drive the client-side compositor executor so this node's composited
    // output is published into nodeOutputs[id]. Downstream nodes (Blur, AI
    // Generator, ...) read through that same path.
    useNodeAutoCompute(id);

    // Read this compositor's published output (envelope) for the lightbox so
    // the user downloads the full-canvas composition, not the down-scaled
    // Konva preview capture.
    const composedOutput = useAppStore((state) => state.nodeOutputs[id]);

    // Edges currently targeting this compositor's "layers" input.
    const layerEdges = useAppStore(useShallow((state) =>
        state.currentWorkflow?.edges?.filter(
            (e) => e.target === id && (e.targetHandle === 'layers' || !e.targetHandle)
        ) || []
    ));

    // Per-source upstream output. Source nodes (Prompt, MediaInput) are seeded
    // into nodeOutputs by the workflow slice on every config change, so this
    // map is the live source of truth — no separate "is this executed yet?"
    // check is needed.
    const upstreamBySource = useAppStore(useShallow((state) => {
        const out: Record<string, any> = {};
        layerEdges.forEach((e) => {
            if (state.nodeOutputs[e.source] !== undefined) {
                out[e.source] = state.nodeOutputs[e.source];
            }
        });
        return out;
    }));

    const config: CompositorConfig = useMemo(() => ({
        ...defaultConfig,
        ...data.config,
        layers: data.config?.layers || defaultConfig.layers,
    }), [data.config]);

    /**
     * Build the renderable list.
     *
     * Iteration order is `config.layers` (user-controlled z-order) — matching
     * what the editor modal uses. The earlier version walked `layerEdges`
     * (insertion order), which meant z-order changes made in the editor never
     * showed up in this preview.
     *
     * Orphan edges that don't yet have a saved layer (the narrow window before
     * onConnect's auto-create lands, plus legacy data) are appended at the end
     * with placeholder transforms so they still render.
     *
     * Image URLs that come from Supabase Storage are routed through the
     * /render/image/ endpoint at ~800px width. The compositor preview is at
     * most ~320px wide on screen, so even a 1920×1080 layer image is grossly
     * oversized — downscaling cuts the GPU's backdrop-blur sample cost
     * dramatically without any visible quality loss at the rendered size.
     */
    const renderable: RenderableLayer[] = useMemo(() => {
        const savedById = new Map<string, CompositorLayer>(
            (config.layers || []).map((l) => [l.sourceHandleId, l])
        );
        const edgeById = new Map(layerEdges.map((e) => [e.id, e]));
        const canvasW = config.canvasWidth || 1920;
        const canvasH = config.canvasHeight || 1080;

        const resolveUpstream = (edge: typeof layerEdges[number], selectedIndex: number) => {
            const upstream = upstreamBySource[edge.source];
            const normalized = upstream !== undefined ? toLegacyRenderableOutput(upstream) : null;
            const item = Array.isArray(normalized)
                ? (normalized[selectedIndex] ?? normalized[0] ?? null)
                : normalized;
            return item;
        };

        const out: RenderableLayer[] = [];
        const seenEdgeIds = new Set<string>();

        // 1. Saved layers in user-controlled z-order.
        (config.layers || []).forEach((layer) => {
            const edge = edgeById.get(layer.sourceHandleId);
            if (!edge) return;
            seenEdgeIds.add(edge.id);
            out.push({ layer, resolved: resolveUpstream(edge, layer.selectedIndex ?? 0) });
        });

        // 2. Orphan edges (no saved layer yet) — appended on top.
        layerEdges.forEach((edge) => {
            if (seenEdgeIds.has(edge.id)) return;
            const layer: CompositorLayer = savedById.get(edge.id) ?? {
                id: `layer_${edge.id}`,
                name: 'Layer',
                sourceHandleId: edge.id,
                selectedIndex: 0,
                transform: { ...calculateInitialTransform(400, 300, canvasW, canvasH), isAutoCentered: false },
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
            out.push({ layer, resolved: resolveUpstream(edge, layer.selectedIndex ?? 0) });
        });

        return out;
    }, [layerEdges, upstreamBySource, config.layers, config.canvasWidth, config.canvasHeight]);

    const updateConfig = useCallback((newConfig: Partial<CompositorConfig>) => {
        updateNodeConfig(id, { ...config, ...newConfig });
    }, [id, updateNodeConfig, config]);

    /**
     * One-shot auto-fit when an image or video layer first reveals its
     * intrinsic dimensions. Two regimes:
     *
     *   - Layer is the ONLY layer on the compositor → resize the canvas to
     *     match the layer's dimensions, layer fills the whole canvas. This
     *     gives the user a sane default canvas size for their first input
     *     without forcing them into the editor.
     *
     *   - Layer 2+ → fall back to the legacy auto-center-and-scale behavior
     *     so it fits inside whatever canvas size the first layer (or the
     *     user) already established.
     *
     * Idempotent — the `isAutoCentered` guard ensures repeat fires (preview +
     * editor mounted at the same time) don't fight each other.
     */
    const handleLayerIntrinsicLoad = useCallback((layerId: string, intrinsicW: number, intrinsicH: number) => {
        const liveConfig = useAppStore.getState().currentWorkflow?.nodes.find((n) => n.id === id)?.data
            ?.config as CompositorConfig | undefined;
        if (!liveConfig) return;
        const layer = liveConfig.layers?.find((l) => l.id === layerId);
        // `isAutoCentered` is the sole idempotency guard — once a layer has
        // been positioned automatically, the user owns its transform and we
        // don't re-stomp on it. (The previous placeholder-only guard meant
        // videos whose metadata loaded AFTER first paint never got a fit
        // pass: the placeholder might have been replaced by the time the
        // metadata callback fired.)
        if (!layer || layer.transform.isAutoCentered) return;
        if (!intrinsicW || !intrinsicH) return;

        const isFirstLayer = (liveConfig.layers?.length ?? 0) === 1;
        if (isFirstLayer) {
            const fit = calculateFirstLayerFitToCanvas(intrinsicW, intrinsicH);
            updateNodeConfig(id, {
                ...liveConfig,
                canvasWidth: fit.canvasWidth,
                canvasHeight: fit.canvasHeight,
                layers: (liveConfig.layers || []).map((l) =>
                    l.id === layerId ? { ...l, transform: fit.transform } : l
                ),
            });
            return;
        }

        // Subsequent layers: if the source's aspect ratio matches the canvas
        // closely (≤2% off), fill the canvas edge-to-edge. This catches the
        // "drop a second video the same size as the first" case where the
        // user expects the new clip to occupy the exact same screen area —
        // the scale-and-center fallback would shrink it to 80% and feel wrong.
        // Different-aspect layers (logo overlays, etc.) still fall through to
        // the legacy scale-and-center behavior.
        const canvasW = liveConfig.canvasWidth || 1920;
        const canvasH = liveConfig.canvasHeight || 1080;
        const canvasAspect = canvasW / Math.max(1, canvasH);
        const layerAspect = intrinsicW / Math.max(1, intrinsicH);
        const aspectsMatch = Math.abs(canvasAspect - layerAspect) / canvasAspect < 0.02;

        let nextTransform;
        if (aspectsMatch) {
            nextTransform = {
                x: 0,
                y: 0,
                width: canvasW,
                height: canvasH,
                rotation: 0,
                opacity: 1,
                flipX: false,
                flipY: false,
                isAutoCentered: true,
                crop: null,
            };
        } else {
            const centered = calculateInitialTransform(intrinsicW, intrinsicH, canvasW, canvasH);
            nextTransform = { ...centered, isAutoCentered: true };
        }

        updateNodeConfig(id, {
            ...liveConfig,
            layers: (liveConfig.layers || []).map((l) =>
                l.id === layerId ? { ...l, transform: nextTransform as any } : l
            ),
        });
    }, [id, updateNodeConfig]);

    const handleLayerImageLoad = useCallback((layerId: string, img: HTMLImageElement) => {
        handleLayerIntrinsicLoad(layerId, img.width, img.height);
    }, [handleLayerIntrinsicLoad]);

    // Per-layer intrinsic video duration (seconds). Drives card-side activity
    // gating + total timeline length. Populated by LayerVideo when its
    // pooled element fires `loadedmetadata`.
    const [intrinsicDurations, setIntrinsicDurations] = useState<Record<string, number | null>>({});

    const handleLayerVideoLoad = useCallback(
        (layerId: string, meta: { duration: number; width: number; height: number }) => {
            setIntrinsicDurations((prev) => {
                const dur = meta.duration || null;
                if (prev[layerId] === dur) return prev;
                return { ...prev, [layerId]: dur };
            });
            handleLayerIntrinsicLoad(layerId, meta.width, meta.height);
        },
        [handleLayerIntrinsicLoad],
    );

    // Live canvas surface published downstream. Set by LivePreview once the
    // Konva Stage's Layer has its canvas; downstream consumers can later read
    // frames from this via `drawImage` for live data flow (the same way
    // they read `url` for static images today).
    const [liveCanvas, setLiveCanvas] = useState<HTMLCanvasElement | null>(null);
    const setNodeOutput = useAppStore((state) => state.setNodeOutput);

    // Card-level playback state. The card preview is paused by default —
    // we don't auto-loop videos in the workspace anymore. User presses play
    // in the MiniTransport to start playback.
    const [cardPlayhead, setCardPlayhead] = useState(0);
    const [cardIsPlaying, setCardIsPlaying] = useState(false);
    const [cardMuted, setCardMuted] = useState(true);
    const [cardTotalDuration, setCardTotalDuration] = useState(0);

    // Live MediaStream captured from the Konva canvas. We feed this to the
    // lightbox's native <video srcObject> AND publish it for any downstream
    // consumer that prefers a stream over per-frame drawImage. Single source
    // of truth → no duplicate Konva mounts.
    const [liveStream, setLiveStream] = useState<MediaStream | null>(null);

    // Create / refresh the stream whenever the canvas (re-)mounts. The
    // stream's track list is bound to the canvas element, so as long as
    // Konva keeps drawing to that element, the stream keeps producing
    // frames at the requested fps (frames are repeated if Konva isn't
    // animating, dropped if it animates faster).
    //
    // No cleanup that stops the tracks: in React 18 strict mode (Next.js
    // dev default) every effect runs setup → cleanup → setup on mount,
    // which would `.stop()` the freshly-created stream's tracks. Once a
    // MediaStream track is stopped it can't be restarted, and any consumer
    // still holding the reference (the lightbox's `<video srcObject>`,
    // downstream blur, etc.) gets a permanently-loading element with no
    // frames. The browser inactivates the tracks automatically when the
    // source canvas goes away — that's sufficient cleanup; explicit
    // `.stop()` here only causes harm.
    useEffect(() => {
        if (!liveCanvas) { setLiveStream(null); return; }
        if (typeof (liveCanvas as any).captureStream !== 'function') {
            // Older Safari — captureStream isn't available. Lightbox falls
            // back to a "preview unavailable" state in that case.
            setLiveStream(null);
            return;
        }
        const fps = config.fps || 30;
        const stream = (liveCanvas as any).captureStream(fps) as MediaStream;
        setLiveStream(stream);
    }, [liveCanvas, config.fps]);

    // (Previously: opening the lightbox force-reset the card to playhead=0
    // and isPlaying=true, snapshotting+restoring the prior state on close.
    // That hijack is gone — the lightbox is now a pure consumer of the live
    // stream and never touches the card's playback. The lightbox has its own
    // display-only play/pause that only toggles its <video> element.)

    const openEditor = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsEditorOpen(true);
    };

    const canvasW = config.canvasWidth || 1920;
    const canvasH = config.canvasHeight || 1080;

    // Classify wired layers to derive the effective output kind. Any video
    // layer → 'video' (temporal render). A canvas-sourced layer (chained
    // compositor or blur wrapping one) also counts as 'video' — it's a live
    // signal, same gating semantics. Otherwise any image layer → 'image'
    // (still composite). No wired media yet (only text, or nothing) → null
    // (broad polymorphic, "Media").
    const outputKind = useMemo<'image' | 'video' | null>(() => {
        let sawImage = false;
        for (const { resolved } of renderable) {
            if (resolved && typeof resolved === 'object' && (resolved as any).canvas instanceof HTMLCanvasElement) {
                return 'video';
            }
            const url =
                resolved && typeof resolved === 'object' && typeof (resolved as any).url === 'string'
                    ? ((resolved as any).url as string)
                    : null;
            if (!url) continue;
            const kind = detectSourceKindFromUrl(url);
            if (kind === 'video') return 'video';
            if (kind === 'image') sawImage = true;
        }
        return sawImage ? 'image' : null;
    }, [renderable]);

    // Kept as a named alias for downstream readers (lightbox branch, live
    // canvas publish) that only care about the binary video/not question.
    const hasVideoLayer = outputKind === 'video';

    // Narrow the single output handle's visible label/color to match what's
    // actually flowing out. Connection validation lives on the static def
    // (broad union) + resolveDynamicOutputType (narrows symmetrically); this
    // just communicates the runtime kind to the user. Mirrors blur.
    const customOutputs = useMemo(
        () => [{
            id: 'image_out',
            label: outputKind === 'video' ? 'Video' : outputKind === 'image' ? 'Image' : 'Media',
            color:
                outputKind === 'video' ? 'rgb(139, 92, 246)'
                : outputKind === 'image' ? 'rgb(59, 130, 246)'
                : '#f8fafc',
        }],
        [outputKind],
    );

    // Re-measure the handle so the wire stays aligned when the label width
    // changes ('Media' / 'Image' / 'Video').
    useEffect(() => {
        updateNodeInternals(id);
    }, [id, outputKind, updateNodeInternals]);

    // When the effective output type narrows, prune any outgoing edge whose
    // downstream target doesn't accept the new type. Without this, swapping
    // an upstream from image to video (or vice versa) leaves orphaned-but-
    // still-rendered edges; the connection validator already refuses NEW
    // drops, but pre-existing edges would linger.
    useEffect(() => {
        if (!outputKind) return; // broad polymorphic — nothing to prune
        useAppStore.getState().pruneIncompatibleOutgoingEdges(id, outputKind);
    }, [id, outputKind]);

    // Publish live canvas + stream to `nodeOutputs[id]`. Downstream live
    // consumers can pick whichever surface fits their pipeline:
    //   - canvas → per-frame drawImage (sync, cheap, no audio)
    //   - stream → <video srcObject> / MediaStreamTrackProcessor (audio-capable later)
    // We publish an empty `url` because the live-data story is the canonical
    // one for video compositors — the server-rendered URL is ephemeral and
    // unreliable, so callers should never depend on it for the live preview.
    //
    // `cssFilter: ''` is the "start of a chain" marker — downstream filters
    // (Blur, etc.) concatenate their own filter onto this string and propagate
    // forward. Mirrors the chained-blur pattern for static video URLs, only
    // with a live MediaStream/canvas as the source instead of a seekable file.
    useEffect(() => {
        if (!hasVideoLayer) return;
        if (!liveCanvas) return;
        setNodeOutput(id, {
            type: 'video',
            data: [{
                url: '',
                canvas: liveCanvas,
                stream: liveStream ?? undefined,
                cssFilter: '',
                resolution: { width: canvasW, height: canvasH },
                metadata: { source: 'Compositor', processedBy: 'LiveCanvas' },
            }],
        });
    }, [hasVideoLayer, liveCanvas, liveStream, id, canvasW, canvasH, setNodeOutput]);

    const openLightbox = (e: React.MouseEvent) => {
        e.stopPropagation();
        setLightboxOpen(true);
    };

    const handleLightboxClose = useCallback(() => setLightboxOpen(false), []);

    return (
        <>
            <BaseNode
                id={id}
                type="compositor"
                label={data.label}
                selected={selected}
                nodeData={data}
                isNew={(data as any).isNew}
                badgeCount={renderable.length}
                width={320}
                hideStatus={true}
                customOutputs={customOutputs}
                customActions={
                    <button
                        onClick={openEditor}
                        className="w-6 h-6 rounded-full bg-accent-primary/90 hover:bg-accent-primary backdrop-blur-sm
                                flex items-center justify-center shadow-lg hover:scale-110 transition-all duration-200"
                        title="Edit compositor"
                    >
                        <Edit3 className="w-3 h-3 text-content-inverted" />
                    </button>
                }
                contentClassName="p-0 overflow-hidden"
            >
                <div
                    onClick={openLightbox}
                    className="relative w-full group/compositor transition-all duration-500 cursor-zoom-in flex flex-col min-h-[200px]"
                >
                    {renderable.length > 0 ? (
                        <div className="w-full p-1">
                            <LivePreview
                                config={config}
                                renderable={renderable}
                                stageRef={stageRef}
                                onLayerImageLoad={handleLayerImageLoad}
                                onLayerVideoLoad={handleLayerVideoLoad}
                                intrinsicDurations={intrinsicDurations}
                                onCanvasReady={setLiveCanvas}
                                playhead={cardPlayhead}
                                isPlaying={cardIsPlaying}
                                onPlayheadChange={setCardPlayhead}
                                onTotalDurationChange={setCardTotalDuration}
                            />
                            {hasVideoLayer && (
                                <MiniTransport
                                    playhead={cardPlayhead}
                                    totalDuration={cardTotalDuration}
                                    fps={config.fps || 30}
                                    isPlaying={cardIsPlaying}
                                    muted={cardMuted}
                                    onTogglePlay={() => setCardIsPlaying((p) => !p)}
                                    onSeek={(t) => { setCardIsPlaying(false); setCardPlayhead(t); }}
                                    onToggleMute={() => setCardMuted((m) => !m)}
                                />
                            )}
                        </div>
                    ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-content-tertiary border border-stroke-subtle rounded-xl bg-surface-secondary/50 m-1">
                            <Plus className="w-8 h-8 opacity-20" />
                            <span className="text-[10px] font-medium uppercase tracking-wider opacity-40">Connect Inputs</span>
                        </div>
                    )}

                </div>
            </BaseNode>

            {isEditorOpen && createPortal(
                <CompositorEditorModal
                    nodeId={id}
                    config={config}
                    onClose={() => setIsEditorOpen(false)}
                    onConfigChange={updateConfig}
                />,
                document.body
            )}
            {lightboxOpen && (() => {
                // Resolve the server-published URL from this node's
                // composedOutput (set by the workflow runner after the server
                // executor uploads the rendered file). Common path for both
                // image and video.
                const normalized = composedOutput
                    ? toLegacyRenderableOutput(composedOutput)
                    : null;
                const first = Array.isArray(normalized) ? normalized[0] : normalized;
                const composedUrl =
                    first && typeof first === 'object' && typeof (first as any).url === 'string' && (first as any).url
                        ? ((first as any).url as string)
                        : null;

                if (hasVideoLayer) {
                    // Instant lightbox: same MediaStream the blur preview
                    // already consumes, bound via srcObject to a fullscreen
                    // <video controls>. Opens immediately, no recording.
                    return (
                        <InstantVideoLightbox
                            stream={liveStream}
                            resolution={{ width: canvasW, height: canvasH }}
                            onClose={handleLightboxClose}
                        />
                    );
                }

                let mediaSrc: string | null = composedUrl;
                if (!mediaSrc && stageRef.current) {
                    const scale = stageRef.current.scaleX?.() || 1;
                    mediaSrc = stageRef.current.toDataURL({
                        pixelRatio: scale > 0 ? 1 / scale : 1,
                    });
                }

                if (!mediaSrc) return null;

                return (
                    <ImageLightbox
                        media={mediaSrc}
                        type="image"
                        initialIndex={0}
                        onClose={() => setLightboxOpen(false)}
                    />
                );
            })()}
        </>
    );
}

export default memo(CompositorNode);

export const compositorClientDef: NodeClientDef = {
    ...compositorSharedDef,
    component: memo((props: any) => <CompositorNode {...props} type="compositor" />),
    // Live compositor: useNodeAutoCompute runs this whenever the layer
    // config or any upstream input changes, writing the composited image
    // into nodeOutputs so downstream nodes (Blur, AI Generator, etc.) see
    // the result through the same path they use for every other node.
    clientExecutor: compositorClientExecutor,
};
