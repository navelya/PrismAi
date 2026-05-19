'use client';

import React, { memo, useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { NodeProps, useUpdateNodeInternals } from 'reactflow';
import { Plus, Edit3 } from 'lucide-react';
import { Stage, Layer, Group } from 'react-konva';
import { useAppStore } from '@/lib/store/app-store';
import { useShallow } from 'zustand/react/shallow';
import BaseNode from '@/lib/nodes/core/canvas/BaseNode';
import { CompositorConfig, CompositorLayer, calculateInitialTransform, calculateFirstLayerFitToCanvas, compositorSharedDef } from './definition';
import CompositorEditorModal from './ui/EditorModal';
import { toLegacyRenderableOutput } from '@/lib/workflow/result-format';
import { CompositorLayerNodes, RenderableLayer } from './ui/Renderer';
import MiniTransport from './ui/MiniTransport';
import {
    detectSourceKindFromUrl,
    computeTimelineDuration,
    GraphDescription,
    GraphLayer,
    GraphLayerSource,
} from './shared';
import { useNodeAutoCompute } from '@/lib/hooks/use-node-auto-compute';
import { Tooltip } from '@/components/ui/Tooltip';
import { registerDownloadHandler, unregisterDownloadHandler } from '@/lib/workflow/download-registry';
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

/**
 * Convert a layer's resolved upstream value (from useResolvedNodeValue /
 * nodeOutputs) into a serializable `GraphLayerSource` for inclusion in the
 * graph description this compositor publishes downstream.
 *
 * Returns null when the upstream isn't a usable source yet — the layer is
 * skipped in the published graph so downstream renderers don't see partial
 * data. The compositor's own preview keeps rendering whatever it can locally
 * even if a layer is skipped here.
 */
function resolveToGraphSource(resolved: any): GraphLayerSource | null {
    if (resolved === null || resolved === undefined) return null;
    if (typeof resolved === 'string') return { kind: 'text', text: resolved };
    if (typeof resolved !== 'object') return null;
    // Nested graph from an upstream pull-model node (compositor or filter).
    // Pass through verbatim — downstream renderers handle recursion via
    // `paintGraphFrame` / `LayerSubgraph`.
    if ((resolved as any).graph) {
        return { kind: 'graph', graph: (resolved as any).graph as GraphDescription };
    }
    const url = (resolved as any).url;
    if (typeof url === 'string' && url.length > 0) {
        const mediaKind = detectSourceKindFromUrl(url);
        if (mediaKind === 'image' || mediaKind === 'video') {
            return { kind: 'media', url, mediaKind };
        }
    }
    return null;
}

/**
 * Content-equality check for a GraphLayer pair. Compares the layer ref
 * (stable from config.layers) and the source fields by value. Used to keep
 * the compositor's published graphLayers reference stable across renders
 * that produce identical content, so downstream republishing converges.
 */
function graphLayerContentEqual(a: GraphLayer, b: GraphLayer): boolean {
    if (a === b) return true;
    if (a.layer !== b.layer) return false;
    if (a.source.kind !== b.source.kind) return false;
    if (a.source.kind === 'media' && b.source.kind === 'media') {
        return a.source.url === b.source.url && a.source.mediaKind === b.source.mediaKind;
    }
    if (a.source.kind === 'text' && b.source.kind === 'text') {
        return a.source.text === b.source.text;
    }
    if (a.source.kind === 'graph' && b.source.kind === 'graph') {
        // Ref equality is the right check here: upstream's stabilization (this
        // same memo applied at every node in the chain) means identical
        // content produces identical reference.
        return a.source.graph === b.source.graph;
    }
    return false;
}

function graphLayersContentEqual(a: GraphLayer[], b: GraphLayer[]): boolean {
    if (a === b) return true;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (!graphLayerContentEqual(a[i], b[i])) return false;
    }
    return true;
}

/**
 * Content-equality check for two published GraphDescriptions of kind
 * 'compositor'. graphLayers is compared by reference (already stabilized
 * above); the rest are primitives or a shallow Record<string, number|null>.
 */
function publishedGraphContentEqual(a: GraphDescription, b: GraphDescription): boolean {
    if (a === b) return true;
    if (a.kind !== 'compositor' || b.kind !== 'compositor') return false;
    if (a.layers !== b.layers) return false;
    if (a.canvasWidth !== b.canvasWidth) return false;
    if (a.canvasHeight !== b.canvasHeight) return false;
    if (a.duration !== b.duration) return false;
    if (a.fps !== b.fps) return false;
    const ak = Object.keys(a.intrinsicDurations);
    const bk = Object.keys(b.intrinsicDurations);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
        if (a.intrinsicDurations[k] !== b.intrinsicDurations[k]) return false;
    }
    return true;
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
 */
function LivePreview({
    config,
    renderable,
    stageRef,
    onLayerImageLoad,
    onLayerVideoLoad,
    intrinsicDurations,
    playhead,
    isPlaying,
    onPlayheadChange,
    onTotalDurationChange,
    poolKey,
    muted,
}: {
    config: CompositorConfig;
    renderable: RenderableLayer[];
    stageRef: React.RefObject<any>;
    onLayerImageLoad?: (layerId: string, img: HTMLImageElement) => void;
    onLayerVideoLoad?: (layerId: string, meta: { duration: number; width: number; height: number }) => void;
    intrinsicDurations: Record<string, number | null>;
    /** External playhead control. Owner (the parent card) drives this; preview just renders. */
    playhead: number;
    isPlaying: boolean;
    /** Called when the rAF loop advances the playhead during playback. */
    onPlayheadChange: (t: number) => void;
    /** Called when the computed total timeline duration changes; lets the parent size the transport scrubber. */
    onTotalDurationChange: (total: number) => void;
    /** Video-pool scope for this surface. See `CompositorLayerNodesProps.poolKey`. */
    poolKey: string;
    /** Mute state from the parent's transport bar; forwarded to layer videos. */
    muted: boolean;
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
        // Track the value we last *pushed* to React (not `live`). The
        // external-seek detector below compares the incoming prop against
        // THIS — otherwise the moment we wrap `live` to 0 without yet
        // committing, the next tick sees `playheadRef.current` (≈ totalDuration)
        // far from `live` (≈ 0), interprets that as an external seek, and
        // snaps `live` straight back to the end. Net effect: indicator
        // freezes near the end while the pooled <video> keeps looping.
        let lastCommittedValue = live;
        const tick = (now: number) => {
            const dt = (now - last) / 1000;
            last = now;
            // Honor external playhead resets (e.g., the lightbox forcing
            // playback to t=0). External = prop diverged from what we
            // pushed; internal wraps don't trip this because they update
            // lastCommittedValue at commit time.
            if (Math.abs(playheadRef.current - lastCommittedValue) > 0.5) {
                live = playheadRef.current;
                lastCommittedValue = live;
                lastCommit = now;
            }
            live += dt;
            let wrapped = false;
            if (live >= totalDuration) {
                live = 0;
                wrapped = true;
            }
            // Wraps commit immediately so the indicator snaps back to 0
            // without waiting on the throttle — the next tick's external-
            // seek check then sees lastCommittedValue=0 ≈ live=0+dt and
            // leaves us alone.
            if (wrapped || now - lastCommit >= THROTTLE_MS) {
                lastCommit = now;
                lastCommittedValue = live;
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
             * `pixelRatio = 1 / scale` means the internal canvas is drawn at
             * (canvasWidth × canvasHeight) pixels and downsampled to display
             * via the Stage's CSS box. We tried `transform: scale` on the
             * Stage container instead; Konva managing width/height on its
             * own container made that layer brittle in practice.
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
                                poolKey={poolKey}
                                muted={muted}
                            />
                        </Group>
                    </Layer>
                </Stage>
            )}
        </div>
    );
}

function CompositorNode({ data, id, selected }: NodeProps<CompositorNodeData>) {
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const stageRef = useRef<any>(null);
    const updateNodeInternals = useUpdateNodeInternals();

    const updateNodeConfig = useAppStore((state) => state.updateNodeConfig);

    // Drive the client-side compositor executor so this node's composited
    // output is published into nodeOutputs[id]. Downstream nodes (Blur, AI
    // Generator, ...) read through that same path.
    useNodeAutoCompute(id);

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

    const setNodeOutput = useAppStore((state) => state.setNodeOutput);

    // Card-level playback state. The card preview is paused by default —
    // we don't auto-loop videos in the workspace anymore. User presses play
    // in the MiniTransport to start playback.
    const [cardPlayhead, setCardPlayhead] = useState(0);
    const [cardIsPlaying, setCardIsPlaying] = useState(false);
    const [cardMuted, setCardMuted] = useState(true);
    const [cardTotalDuration, setCardTotalDuration] = useState(0);

    const openEditor = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsEditorOpen(true);
    };

    // ---------- Download flow ----------
    //
    // The download lives in the editor modal; the modal's Download button
    // invokes this callback. We POST the compositor config + a map of
    // resolved layer URLs to /api/compositor/export, where fluent-ffmpeg
    // re-renders the timeline (with audio) and streams the mp4 back.
    const [downloadState, setDownloadState] =
        useState<'idle' | 'rendering' | 'success' | 'error'>('idle');

    const canvasW = config.canvasWidth || 1920;
    const canvasH = config.canvasHeight || 1080;

    // Card sizing: cap the LONGER dimension at MAX_DIM and derive the other
    // from the canvas aspect. Pure max-content + a width-only maxWidth would
    // let portrait canvases blow up the height (a 9:16 card pinned to 420
    // wide via aspect-ratio reads ~747 tall — too much). Picking the binding
    // axis explicitly keeps the card balanced for any aspect.
    //
    // MIN_DIM is a safety floor for extreme aspects only; reasonable canvas
    // ratios (≥ ~9:21) never hit it.
    const cardWidth = useMemo(() => {
        const MAX_DIM = 420;
        const MIN_DIM = 200;
        const aspect = canvasW / Math.max(1, canvasH);
        let w = aspect >= 1 ? MAX_DIM : MAX_DIM * aspect;
        if (w < MIN_DIM) w = MIN_DIM;
        return Math.round(w);
    }, [canvasW, canvasH]);

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

    // Build the pull-model graph description: a serializable "how to render
    // this compositor's output at any time t" that downstream consumers can
    // each render independently into their own canvases at their own
    // playheads. Replaces the previous canvas/stream push: the compositor no
    // longer hands out a reference to its own surface; it hands out a
    // description, and every consumer renders its own copy.
    //
    // CRITICAL: both graphLayers and publishedGraph are stabilized by CONTENT
    // equality, not just dep-reference equality. Without this, every config
    // mutation (or even an unrelated upstream reseed) returns a freshly-
    // constructed object whose downstream effect — `setNodeOutput(id, ...)` —
    // republishes a new envelope reference, which any consumer reading
    // `nodeOutputs[id]` sees as a change, re-executes, and republishes back.
    // The propagation never converges; React's commit phase keeps detaching
    // and reattaching refs (Radix's composedRefs chain), hitting React #185
    // ("Maximum update depth exceeded") inside the setRef recursion.
    const lastGraphLayersRef = useRef<GraphLayer[]>([]);
    const graphLayers: GraphLayer[] = useMemo(() => {
        const next: GraphLayer[] = [];
        for (const { layer, resolved } of renderable) {
            const source = resolveToGraphSource(resolved);
            if (!source) continue;
            next.push({ layer, source });
        }
        if (graphLayersContentEqual(lastGraphLayersRef.current, next)) {
            return lastGraphLayersRef.current;
        }
        lastGraphLayersRef.current = next;
        return next;
    }, [renderable]);

    const lastStablePublishedGraphRef = useRef<GraphDescription | null>(null);
    const publishedGraph: GraphDescription | null = useMemo(() => {
        if (graphLayers.length === 0) {
            if (lastStablePublishedGraphRef.current !== null) {
                lastStablePublishedGraphRef.current = null;
            }
            return null;
        }
        const next: GraphDescription = {
            kind: 'compositor',
            layers: graphLayers,
            canvasWidth: canvasW,
            canvasHeight: canvasH,
            duration: cardTotalDuration || 0,
            fps: config.fps || 30,
            intrinsicDurations,
        };
        const prev = lastStablePublishedGraphRef.current;
        if (prev && publishedGraphContentEqual(prev, next)) {
            return prev;
        }
        lastStablePublishedGraphRef.current = next;
        return next;
    }, [graphLayers, canvasW, canvasH, cardTotalDuration, config.fps, intrinsicDurations]);

    // Publish the graph envelope to `nodeOutputs[id]`. Downstream live
    // consumers (Blur, chained Compositor, etc.) read `graph` and mount their
    // own renderers at their own playheads via `LayerSubgraph`. They never
    // see this compositor's canvas reference — that's local state used only
    // by THIS card's preview + lightbox.
    //
    // `cssFilter: ''` is the "start of a chain" marker — downstream filter
    // nodes wrap this graph in a `{ kind: 'filter', upstream, cssFilter }`
    // graph rather than mutating the cssFilter field directly. The field
    // stays for any legacy consumer that still pattern-matches on it; new
    // consumers should descend into the graph instead.
    //
    // Once the user clicks Run and the server writes a real URL into
    // `nodeOutputs[id]`, we stop republishing — `lastPublishedGraphRef`
    // remembers the graph identity that was current at our last publish, so
    // when nothing has changed since that point we leave the URL in place
    // (downstream is using it). The next config edit changes
    // `publishedGraph` identity, the ref check falls through, and we publish
    // the live graph again — invalidating the URL until the user re-runs.
    const lastPublishedGraphRef = useRef<GraphDescription | null>(null);
    useEffect(() => {
        if (!hasVideoLayer) return;
        if (!publishedGraph) return;

        const currentlyPublished = useAppStore.getState().nodeOutputs[id];
        const hasAnyOutput = currentlyPublished !== undefined;
        if (lastPublishedGraphRef.current === publishedGraph && hasAnyOutput) {
            return;
        }
        lastPublishedGraphRef.current = publishedGraph;

        setNodeOutput(id, {
            type: 'video',
            data: [{
                url: '',
                graph: publishedGraph,
                cssFilter: '',
                resolution: { width: canvasW, height: canvasH },
                metadata: { source: 'Compositor', processedBy: 'GraphLive' },
            }],
        });
    }, [hasVideoLayer, publishedGraph, id, canvasW, canvasH, setNodeOutput]);

    // Server-side export: resolves each wired layer to its upstream URL (same
    // path the LivePreview uses), POSTs config + URL map to /api/compositor/export,
    // and returns the rendered mp4 as a Blob. fluent-ffmpeg on the server handles
    // audio mixing + H.264 encoding so quality and duration come out right by
    // construction.
    //
    // This is the shared core for both the editor-modal Download button (which
    // saves via a.click immediately) and the bulk-download registry (which
    // collects the blob into a zip with the rest of the selection). It owns
    // the per-node `downloadState` lifecycle in either case; the caller adds
    // its own UX layer (anchor click vs zip entry) on top of the returned blob.
    const fetchCompositorExport = useCallback(async (): Promise<{ filename: string; blob: Blob }[]> => {
        // Reject (rather than silently return) on early-out branches so callers
        // — including Promise.allSettled in the bulk orchestrator — see an
        // accurate success/failure outcome.
        if (downloadState === 'rendering') {
            throw new Error('Already rendering');
        }

        const inputs: Record<string, string> = {};
        for (const layer of config.layers || []) {
            const edge = layerEdges.find((e) => e.id === layer.sourceHandleId);
            if (!edge) continue;
            const upstream = upstreamBySource[edge.source];
            const normalized = upstream !== undefined ? toLegacyRenderableOutput(upstream) : null;
            const item = Array.isArray(normalized)
                ? normalized[layer.selectedIndex ?? 0] ?? normalized[0]
                : normalized;
            const url =
                item && typeof item === 'object' && typeof (item as any).url === 'string'
                    ? ((item as any).url as string)
                    : null;
            if (url) inputs[layer.sourceHandleId] = url;
        }

        if (Object.keys(inputs).length === 0) {
            setDownloadState('error');
            setTimeout(() => setDownloadState((s) => (s === 'error' ? 'idle' : s)), 2500);
            throw new Error('No wired inputs');
        }

        setDownloadState('rendering');
        try {
            const resp = await fetch('/api/compositor/export', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    config,
                    inputs,
                    filename: data.label || 'compositor',
                }),
            });
            if (!resp.ok) {
                const errText = await resp.text().catch(() => '');
                throw new Error(`server ${resp.status}: ${errText || resp.statusText}`);
            }

            const blob = await resp.blob();
            const cd = resp.headers.get('Content-Disposition') || '';
            const match = cd.match(/filename="([^"]+)"/);
            const safeLabel = (data.label || 'compositor').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
            const filename = match?.[1] || `${safeLabel}.mp4`;

            setDownloadState('success');
            setTimeout(() => setDownloadState((s) => (s === 'success' ? 'idle' : s)), 1500);
            return [{ filename, blob }];
        } catch (err) {
            console.error('[Compositor:download] export failed', err);
            setDownloadState('error');
            setTimeout(() => setDownloadState((s) => (s === 'error' ? 'idle' : s)), 2500);
            throw err;
        }
    }, [downloadState, config, layerEdges, upstreamBySource, data.label]);

    // Modal Download button: render the mp4, then save it directly via a click.
    const handleRequestDownload = useCallback(async () => {
        const [item] = await fetchCompositorExport();
        if (!item) return;
        const blobUrl = URL.createObjectURL(item.blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = item.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    }, [fetchCompositorExport]);

    // Bulk-download path: register the export-to-blob path with the registry.
    // EditorCanvas's multi-select Download zips everything it gets back from
    // selected nodes' registered handlers + the generic media-URL fallback.
    useEffect(() => {
        registerDownloadHandler(id, fetchCompositorExport);
        return () => unregisterDownloadHandler(id);
    }, [id, fetchCompositorExport]);

    return (
        <>
            <BaseNode
                id={id}
                type="compositor"
                label={data.label}
                selected={selected}
                nodeData={data}
                isNew={(data as any).isNew}
                width={cardWidth}
                hideStatus={true}
                customOutputs={customOutputs}
                customActions={
                    <Tooltip content="Edit compositor" position="top" delay={600}>
                        <button
                            type="button"
                            onClick={openEditor}
                            onMouseDown={(e) => e.stopPropagation()}
                            className="w-6 h-6 rounded flex items-center justify-center text-content-primary hover:bg-white/10 hover:text-accent-primary transition-all"
                        >
                            <Edit3 className="w-3 h-3 pointer-events-none" />
                        </button>
                    </Tooltip>
                }
                contentClassName="p-0 overflow-hidden"
            >
                <div
                    onClick={openEditor}
                    className="relative w-full group/compositor transition-all duration-500 cursor-pointer flex flex-col min-h-[200px]"
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
                                playhead={cardPlayhead}
                                isPlaying={cardIsPlaying}
                                onPlayheadChange={setCardPlayhead}
                                onTotalDurationChange={setCardTotalDuration}
                                poolKey={id}
                                muted={cardMuted}
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
                    canDownload={hasVideoLayer}
                    onRequestDownload={handleRequestDownload}
                    downloadState={downloadState}
                />,
                document.body
            )}
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
