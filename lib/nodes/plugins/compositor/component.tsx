'use client';

import React, { memo, useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { NodeProps, useUpdateNodeInternals } from 'reactflow';
import { Plus, Edit3, Download, Loader2, Check, AlertCircle } from 'lucide-react';
import { Stage, Layer, Group, Rect } from 'react-konva';
import { useAppStore } from '@/lib/store/app-store';
import { useShallow } from 'zustand/react/shallow';
import BaseNode from '@/lib/nodes/core/canvas/BaseNode';
import { CompositorConfig, CompositorLayer, calculateInitialTransform, calculateFirstLayerFitToCanvas, compositorSharedDef } from './definition';
import CompositorEditorModal from './ui/EditorModal';
import { toLegacyRenderableOutput } from '@/lib/workflow/result-format';
import { CompositorLayerNodes, RenderableLayer } from './ui/Renderer';
import CompositorAudio from './ui/CompositorAudio';
import MiniTransport from './ui/MiniTransport';
import { TransportClock, useTransportClock } from './transport-clock';
import {
    detectSourceKind,
    detectSourceKindFromUrl,
    computeTimelineDuration,
    GraphDescription,
    GraphLayer,
    GraphLayerSource,
    LayerSourceKind,
    resolveCompositeBaseFill,
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
 * Render a prompt-layer's text content to a transparent PNG sized to the
 * layer's bounding box, returning a PNG Blob ready to be uploaded as if it
 * were an image input. The server's compositor pipeline has no `drawtext`
 * step (still and temporal paths both expect URL → image/video), so this
 * lets text layers travel through the same overlay path the server
 * already handles. Font metrics match `drawTextLayer` in graph-renderer.ts
 * so the downloaded mp4 looks like the editor preview.
 */
async function renderTextLayerToBlob(layer: CompositorLayer, text: string): Promise<Blob | null> {
    if (typeof document === 'undefined') return null;
    const t = layer.transform || ({} as any);
    const w = Math.max(1, Math.round(t.width || 100));
    const h = Math.max(1, Math.round(t.height || 100));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const fontSize = t.fontSize || 48;
    const fontWeight = (t as any).fontWeight || 'bold';
    const fontStyle = t.fontStyle || 'normal';
    const fontFamily = t.fontFamily || 'Inter';

    ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
    ctx.fillStyle = t.fillColor || '#ffffff';
    ctx.textAlign = (t.textAlign as CanvasTextAlign) || 'center';
    ctx.textBaseline = 'middle';
    const xPos = t.textAlign === 'left' ? 0 : t.textAlign === 'right' ? w : w / 2;
    ctx.fillText(text, xPos, h / 2, w);

    return new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob), 'image/png');
    });
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
 *
 * `envelopeType` is the OUTER `{ type: 'image' | 'video' | ... }` from the
 * upstream envelope (which `toLegacyRenderableOutput` discards). It's the
 * authoritative classifier when the inner URL has no recognizable extension
 * (signed URLs, model-proxy paths). Falls back to URL detection only when
 * envelopeType doesn't disambiguate.
 */
function resolveToGraphSource(resolved: any, envelopeType?: string): GraphLayerSource | null {
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
        let mediaKind = detectSourceKindFromUrl(url);
        // Envelope-level fallback: a URL like `.../uuid` with no extension
        // would classify as 'unknown' and be filtered out, dropping the layer
        // from the downstream graph. The upstream node already published the
        // envelope type ('image' / 'video'); honor it.
        if (mediaKind !== 'image' && mediaKind !== 'video') {
            if (envelopeType === 'image') mediaKind = 'image';
            else if (envelopeType === 'video') mediaKind = 'video';
        }
        if (mediaKind === 'image' || mediaKind === 'video') {
            return { kind: 'media', url, mediaKind };
        }
    }
    return null;
}

/**
 * Deep content comparison for a CompositorLayer pair — covers all fields the
 * graph renderer actually reads. Used in place of a ref check because layer
 * objects can be re-created across renders even when their content didn't
 * change (orphan layers, store re-spreads of config), and a ref-only check
 * caused graphLayers identity to churn → publishedGraph to churn → infinite
 * publish/repaint loops in downstream consumers.
 */
function layerContentEqual(a: CompositorLayer, b: CompositorLayer): boolean {
    if (a === b) return true;
    if (a.id !== b.id) return false;
    if (a.sourceHandleId !== b.sourceHandleId) return false;
    if (a.visible !== b.visible) return false;
    if (a.startTime !== b.startTime) return false;
    if (a.duration !== b.duration) return false;
    if (a.selectedIndex !== b.selectedIndex) return false;
    if ((a.muted ?? false) !== (b.muted ?? false)) return false;
    const at = a.transform;
    const bt = b.transform;
    if (at === bt) return true;
    if (!at || !bt) return false;
    return (
        at.x === bt.x &&
        at.y === bt.y &&
        at.width === bt.width &&
        at.height === bt.height &&
        at.rotation === bt.rotation &&
        at.opacity === bt.opacity &&
        at.flipX === bt.flipX &&
        at.flipY === bt.flipY &&
        at.blendMode === bt.blendMode &&
        at.fontSize === bt.fontSize &&
        at.fontFamily === bt.fontFamily &&
        at.fontStyle === bt.fontStyle &&
        (at as any).fontWeight === (bt as any).fontWeight &&
        at.fillColor === bt.fillColor &&
        at.textAlign === bt.textAlign &&
        at.lineHeight === bt.lineHeight &&
        at.letterSpacing === bt.letterSpacing
    );
}

/**
 * Content-equality check for a GraphLayer pair. Compares the layer's actual
 * fields (not ref) and the source fields by value. Ref-only comparison
 * caused churn whenever the layer object was reconstructed for the same
 * content (orphan creation, store spreads), which translated into
 * downstream graph identity changes and infinite paint loops.
 */
function graphLayerContentEqual(a: GraphLayer, b: GraphLayer): boolean {
    if (a === b) return true;
    if (!layerContentEqual(a.layer, b.layer)) return false;
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

// --- Preview resolution experiment (A/B) ---------------------------------
// The card preview's Konva backing canvas was historically drawn at the FULL
// source resolution (pixelRatio = 1/scale ⇒ e.g. 1920×1080 for a ~420px card),
// which is 10-15× more fill per frame than the card actually displays — the
// suspected cause of the "smooth then stutters" video playback. Capping the
// backing store to display resolution × DPR is the cheap experiment.
// Set `localStorage.prismCompositorPreviewRes = 'full'` + reload to restore the
// old full-res behavior on the same card for an A/B comparison.
function previewResCapped(): boolean {
    if (typeof window === 'undefined') return true;
    try {
        return window.localStorage.getItem('prismCompositorPreviewRes') !== 'full';
    } catch {
        return true;
    }
}

// Clamp DPR to 2 so 3x phones don't reintroduce the over-render this fixes.
function maxPreviewDpr(): number {
    if (typeof window === 'undefined') return 1;
    return Math.min(window.devicePixelRatio || 1, 2);
}

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
    onLayerAudioLoad,
    intrinsicDurations,
    playhead,
    isPlaying,
    clock,
    onTotalDurationChange,
    poolKey,
    muted,
    baseFill,
}: {
    config: CompositorConfig;
    renderable: RenderableLayer[];
    stageRef: React.RefObject<any>;
    onLayerImageLoad?: (layerId: string, img: HTMLImageElement) => void;
    onLayerVideoLoad?: (layerId: string, meta: { duration: number; width: number; height: number }) => void;
    onLayerAudioLoad?: (layerId: string, duration: number) => void;
    intrinsicDurations: Record<string, number | null>;
    /** External playhead control. Owner (the parent card) drives this; preview just renders. */
    playhead: number;
    isPlaying: boolean;
    /** The parent card's transport clock — per-frame time for gating/seeks. */
    clock: TransportClock;
    /** Called when the computed total timeline duration changes; lets the parent size the transport scrubber. */
    onTotalDurationChange: (total: number) => void;
    /** Video-pool scope for this surface. See `CompositorLayerNodesProps.poolKey`. */
    poolKey: string;
    /** Mute state from the parent's transport bar; forwarded to layer videos. */
    muted: boolean;
    /** Opaque base color to composite against so blend modes have pixels to act on. null = keep transparent. */
    baseFill: string | null;
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

    // Backing-canvas resolution for the Konva layer. Capped to display res × DPR
    // (see previewResCapped above) instead of the legacy full-source 1/scale.
    const previewPixelRatio = scale > 0
        ? (previewResCapped() ? Math.min(1 / scale, maxPreviewDpr()) : 1 / scale)
        : 1;

    // One-shot log so the A/B is verifiable: confirms the mode is active and
    // prints the actual backing dimensions (capped vs. full source).
    const loggedResRef = useRef(false);
    useEffect(() => {
        if (scale <= 0 || loggedResRef.current) return;
        loggedResRef.current = true;
        console.log('[compositor:preview-res]', {
            mode: previewResCapped() ? 'capped' : 'full',
            display: `${Math.round(size.width)}×${Math.round(size.height)}`,
            backing: `${Math.round(size.width * previewPixelRatio)}×${Math.round(size.height * previewPixelRatio)}`,
            source: `${canvasWidth}×${canvasHeight}`,
            pixelRatio: Number(previewPixelRatio.toFixed(3)),
        });
    }, [scale, previewPixelRatio, size.width, size.height, canvasWidth, canvasHeight]);

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

    // Playback time is owned by the parent's TransportClock (see
    // transport-clock.ts) — media chases the clock, never the reverse. The
    // previous "master video" rVFC clock here was structurally broken: it
    // acquired its element under the plain poolKey while LayerVideo pools
    // per-layer (`poolKey:layerId`), so the master element was a separate
    // decoder that no consumer ever voted to play — rVFC fired at most once
    // and the card playhead froze whenever any video layer existed (gating
    // never advanced, clips looped their pooled elements forever, and
    // CompositorAudio stutter-looped re-seeking to the frozen target). It
    // also derived time as mediaTime + startTime (ignoring trimIn) and, with
    // loop=true elements, wrapped inside the first clip's window so
    // multi-clip timelines could never reach clip 2.

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
             * `pixelRatio` controls the internal backing-canvas resolution.
             * Legacy was `1 / scale` (full source res, e.g. 1920×1080); now
             * capped to display res × DPR via `previewPixelRatio` to cut the
             * per-frame fill cost for video playback. The result is downsampled
             * to display via the Stage's CSS box either way. We tried
             * `transform: scale` on the Stage container instead; Konva managing
             * width/height on its own container made that layer brittle.
             */}
            {scale > 0 && (
                <Stage
                    ref={stageRef}
                    width={size.width}
                    height={size.height}
                    listening={false}
                >
                    <Layer listening={false} pixelRatio={previewPixelRatio}>
                        <Group scaleX={scale} scaleY={scale}>
                            {baseFill && (
                                <Rect x={0} y={0} width={canvasWidth} height={canvasHeight} fill={baseFill} listening={false} />
                            )}
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
                                clock={clock}
                                // Cards can sit many-at-once on the canvas; bound
                                // each one's blit rate (the editor runs uncapped).
                                maxFps={30}
                            />
                        </Group>
                    </Layer>
                </Stage>
            )}
            {/* Headless audio playback — audio layers have no Konva visual, so
                they're driven imperatively here alongside (not inside) the
                Stage. */}
            <CompositorAudio
                layers={renderable}
                playhead={playhead}
                isPlaying={isPlaying}
                muted={muted}
                intrinsicDurations={intrinsicDurations}
                onAudioLoad={onLayerAudioLoad}
            />
        </div>
    );
}

function CompositorNode({ data, id, selected }: NodeProps<CompositorNodeData>) {
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const stageRef = useRef<any>(null);
    const [editorPortalEl, setEditorPortalEl] = useState<HTMLDivElement | null>(null);
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
    // Orphan-layer ref cache. The orphan branch below synthesizes a layer
    // object for edges that don't yet have a saved entry in config.layers
    // (the narrow window before onConnect's auto-create lands, plus legacy
    // data). Creating a fresh object on every renderable computation gave
    // those layers unstable refs across renders, which propagated through
    // graphLayers / publishedGraph and caused B to republish on every store
    // tick — a feedback loop that downstream consumers (Blur, chained
    // compositor) re-rendered through. Caching by edge id keeps the ref
    // stable so the memoized content-equality check actually converges.
    const orphanLayerCacheRef = useRef<Map<string, CompositorLayer>>(new Map());

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
        const liveEdgeIds = new Set(layerEdges.map((e) => e.id));

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
            let layer = savedById.get(edge.id) ?? orphanLayerCacheRef.current.get(edge.id);
            if (!layer) {
                layer = {
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
                orphanLayerCacheRef.current.set(edge.id, layer);
            }
            out.push({ layer, resolved: resolveUpstream(edge, layer.selectedIndex ?? 0) });
        });

        // Evict cache entries for edges that no longer exist so the map
        // doesn't grow unbounded across the workflow's lifetime.
        for (const cachedId of Array.from(orphanLayerCacheRef.current.keys())) {
            if (!liveEdgeIds.has(cachedId)) {
                orphanLayerCacheRef.current.delete(cachedId);
            }
        }

        return out;
    }, [layerEdges, upstreamBySource, config.layers, config.canvasWidth, config.canvasHeight]);

    const updateConfig = useCallback((newConfig: Partial<CompositorConfig>) => {
        updateNodeConfig(id, { ...config, ...newConfig });
    }, [id, updateNodeConfig, config]);

    // Per-layer source kind, kept in a ref so the auto-fit callback (which
    // reads live store state, not `renderable`) can tell audio layers apart
    // without taking them as a dep. Audio is excluded from the "first layer"
    // canvas-fit decision because it has no dimensions.
    const sourceKindByLayerIdRef = useRef<Record<string, LayerSourceKind>>({});
    useEffect(() => {
        const map: Record<string, LayerSourceKind> = {};
        renderable.forEach(({ layer, resolved }) => {
            map[layer.id] = detectSourceKind(resolved);
        });
        sourceKindByLayerIdRef.current = map;
    }, [renderable]);

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

        // "First layer" = first VISUAL layer. Audio layers carry no dimensions
        // and must not count, so a real image/video connected after an audio
        // clip still fits the canvas as if it were the first.
        const kinds = sourceKindByLayerIdRef.current;
        const visualCount = (liveConfig.layers || []).filter((l) => kinds[l.id] !== 'audio').length;
        const isFirstLayer = visualCount === 1;
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

    // Audio reports only a duration (no dimensions) — record it for timeline
    // sizing but never run the canvas auto-fit (a 0×0 source would break it).
    const handleLayerAudioLoad = useCallback((layerId: string, duration: number) => {
        setIntrinsicDurations((prev) => {
            const dur = duration || null;
            if (prev[layerId] === dur) return prev;
            return { ...prev, [layerId]: dur };
        });
    }, []);

    const setNodeOutput = useAppStore((state) => state.setNodeOutput);

    // Card-level playback state. The card preview is paused by default —
    // we don't auto-loop videos in the workspace anymore. User presses play
    // in the MiniTransport to start playback.
    const [cardPlayhead, setCardPlayhead] = useState(0);
    const [cardIsPlaying, setCardIsPlaying] = useState(false);
    const [cardMuted, setCardMuted] = useState(true);
    const [cardTotalDuration, setCardTotalDuration] = useState(0);

    // Transport clock: time advances in a ref, React commits at ~10Hz, and
    // per-frame consumers (LayerVideo/LayerSubgraph gating + drift
    // correction) subscribe directly. See transport-clock.ts.
    const cardClock = useTransportClock(cardTotalDuration, setCardPlayhead);
    useEffect(() => {
        if (cardIsPlaying) cardClock.play(); else cardClock.pause();
    }, [cardIsPlaying, cardClock]);

    const handleCardSeek = useCallback((t: number) => {
        setCardIsPlaying(false);
        cardClock.pause();
        // Clamp a hair off the exact end so the last clip's final frame stays
        // visible (at t === total every clip's window is closed → black). See
        // EditorModal.handleSeek.
        const fps = config.fps || 30;
        const clamped = Math.max(0, Math.min(t, Math.max(0, cardTotalDuration - 0.5 / fps)));
        cardClock.seek(clamped);
    }, [cardClock, cardTotalDuration, config.fps]);

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

    // Share a single in-flight Promise across overlapping callers (e.g. bulk
    // download triggers A's handler directly AND B's resolver also asks for
    // A — both should get the same blob from one render, not two parallel
    // renders or a "Already rendering" throw on the second caller).
    const inFlightExportRef = useRef<Promise<{ filename: string; blob: Blob }[]> | null>(null);

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
    // layer → 'video' (temporal render). A graph-sourced layer (chained
    // compositor or blur wrapping one) also counts as 'video' — its upstream
    // is itself a live graph, same gating semantics. Otherwise any image
    // layer → 'image' (still composite). No wired media yet (only text, or
    // nothing) → null (broad polymorphic, "Media").
    const outputKind = useMemo<'image' | 'video' | null>(() => {
        let sawImage = false;
        let sawAudio = false;
        for (const { resolved } of renderable) {
            if (resolved && typeof resolved === 'object' && (resolved as any).graph) {
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
            if (kind === 'audio') sawAudio = true;
        }
        // Any audio forces a video output — an mp4 is the only container that
        // can carry the audio track (image+audio → video, audio-only → video).
        if (sawAudio) return 'video';
        return sawImage ? 'image' : null;
    }, [renderable]);

    // Kept as a named alias for downstream readers (lightbox branch, live
    // canvas publish) that only care about the binary video/not question.
    const hasVideoLayer = outputKind === 'video';

    // Audio is invisible (no outputKind) but still temporal: surface the
    // transport when there's video OR audio so an audio-only / image+audio
    // compositor is playable. Audio deliberately does NOT flip outputKind,
    // publish a graph, or enable the (video-only) download button.
    const hasAudioLayer = useMemo(() => {
        for (const { resolved } of renderable) {
            const url =
                resolved && typeof resolved === 'object' && typeof (resolved as any).url === 'string'
                    ? ((resolved as any).url as string)
                    : null;
            if (url && detectSourceKindFromUrl(url) === 'audio') return true;
        }
        return false;
    }, [renderable]);
    const hasTransport = hasVideoLayer || hasAudioLayer;

    // Download is offered whenever there's renderable media to export — a still
    // composite (image/text → PNG/JPEG) or a temporal render (video/audio →
    // mp4). The server route (/api/compositor/export) picks the format the same
    // way the executor does. `null` (only text or nothing wired) has nothing to
    // render, so no button.
    const canDownload = outputKind !== null;

    const compositeBaseFill = useMemo(
        () => resolveCompositeBaseFill(config.backgroundColor, hasVideoLayer),
        [config.backgroundColor, hasVideoLayer],
    );

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
            // `type` drives the handle's type icon; narrowed kind when known.
            type: (outputKind === 'video' || outputKind === 'image' ? outputKind : ['image', 'video']) as string | string[],
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
    // Map sourceHandleId → envelope `type` for the per-layer upstream. Lets
    // resolveToGraphSource classify URLs whose extension is unrecognizable
    // (signed Supabase URLs, AI proxy paths) by trusting the envelope the
    // upstream node already declared. Without this, those layers got dropped
    // from the published graph and disappeared downstream.
    const envelopeTypeByHandleId = useMemo<Record<string, string | undefined>>(() => {
        const out: Record<string, string | undefined> = {};
        for (const edge of layerEdges) {
            const upstream = upstreamBySource[edge.source];
            const type =
                upstream && typeof upstream === 'object' && typeof (upstream as any).type === 'string'
                    ? ((upstream as any).type as string)
                    : undefined;
            out[edge.id] = type;
        }
        return out;
    }, [layerEdges, upstreamBySource]);

    const lastGraphLayersRef = useRef<GraphLayer[]>([]);
    const graphLayers: GraphLayer[] = useMemo(() => {
        const next: GraphLayer[] = [];
        for (const { layer, resolved } of renderable) {
            const envelopeType = envelopeTypeByHandleId[layer.sourceHandleId];
            const source = resolveToGraphSource(resolved, envelopeType);
            if (!source) continue;
            next.push({ layer, source });
        }
        if (graphLayersContentEqual(lastGraphLayersRef.current, next)) {
            return lastGraphLayersRef.current;
        }
        lastGraphLayersRef.current = next;
        return next;
    }, [renderable, envelopeTypeByHandleId]);

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
    const fetchCompositorExport = useCallback(async (
        // Optional fine-grained progress reporting. Card-Download passes one of
        // these to drive the EditorToolbar pill in real time during chained
        // renders (where a single coarse 0%→100% step is invisible for the
        // 30+ seconds upstream resolution can take). Bulk-download doesn't
        // pass it and falls back to the orchestrator's per-handler tick.
        onSubProgress?: (current: number, total: number) => void,
        isInternal?: boolean,
    ): Promise<{ filename: string; blob: Blob }[]> => {
        // If another caller's render is in flight, share its result. This
        // collapses the "bulk download + chained-compositor resolver both ask
        // for me" case into one server render. Note this also accepts repeat
        // calls from the same surface (e.g. user spam-clicking Download) and
        // returns the existing Promise.
        if (inFlightExportRef.current) {
            return inFlightExportRef.current;
        }

        const runExport = async (): Promise<{ filename: string; blob: Blob }[]> => {
        // Show 'rendering' immediately so the UI reflects work in progress
        // throughout — including the upstream-graph resolution phase below,
        // which can take a full A-render before B's own export even starts.
        if (!isInternal) setDownloadState('rendering');

        // The whole composition renders in ONE server request now (nested
        // graphs travel in the body — see the graph branch below), so the
        // progress total is a single render tick.
        const progressTotal = 1;
        let progressCurrent = 0;
        const tick = () => {
            progressCurrent += 1;
            onSubProgress?.(progressCurrent, progressTotal);
        };
        onSubProgress?.(progressCurrent, progressTotal);

        // Resolve each layer to a server-renderable input.
        //
        // Three cases per layer:
        //   1. Upstream resolved to a static URL (MediaInput, completed AI
        //      generator): use it directly.
        //   2. Upstream is a Prompt/Text string: rasterize client-side and
        //      upload a transparent PNG (editor-font fidelity).
        //   3. Upstream resolved to a live `GraphDescription` (a chained
        //      Compositor, or Blur/filters wrapping one): embed the graph in
        //      the request — the server flattens it (filters become ffmpeg
        //      atoms; nested compositors render to a local intermediate).
        //      This replaced the old client-side recursion through per-node
        //      download handlers, which did a full H.264 render + browser
        //      upload + server re-download PER chain hop (3 trips of the
        //      bytes, compounding generation loss) and threw outright for
        //      blur layers (blur never registered a handler).
        //
        // Temporary uploads (text PNGs) are tracked so we can DELETE them
        // after the render completes (success OR failure) — chat-assets isn't
        // TTL'd and we don't want orphans from every download.
        const inputs: Record<string, string | { graph: GraphDescription }> = {};
        const tempUploadPaths: string[] = [];

        for (const layer of config.layers || []) {
            const edge = layerEdges.find((e) => e.id === layer.sourceHandleId);
            if (!edge) continue;
            const upstream = upstreamBySource[edge.source];
            const normalized = upstream !== undefined ? toLegacyRenderableOutput(upstream) : null;
            const item = Array.isArray(normalized)
                ? normalized[layer.selectedIndex ?? 0] ?? normalized[0]
                : normalized;

            // Case 1: direct URL on the envelope item.
            const directUrl =
                item && typeof item === 'object' && typeof (item as any).url === 'string'
                    ? ((item as any).url as string)
                    : null;
            if (directUrl && directUrl.length > 0) {
                inputs[layer.sourceHandleId] = directUrl;
                continue;
            }

            // Case 2: text upstream (Prompt node → compositor). The server's
            // ffmpeg pipeline doesn't have a drawtext step, so we render the
            // text to a transparent PNG client-side at the layer's bounding-
            // box dimensions and feed it through the same image-overlay path
            // the server already handles. The visual matches the editor
            // preview because both use the same canvas font metrics.
            if (typeof item === 'string') {
                const textBlob = await renderTextLayerToBlob(layer, item);
                if (!textBlob) continue;
                const formData = new FormData();
                formData.append('file', textBlob, `text-${layer.id}.png`);
                const uploadResp = await fetch('/api/upload', {
                    method: 'POST',
                    body: formData,
                });
                if (!uploadResp.ok) {
                    const errText = await uploadResp.text().catch(() => '');
                    throw new Error(
                        `Layer "${layer.name}": text-PNG upload failed (${uploadResp.status}): ${errText}`,
                    );
                }
                const { publicUrl, path } = (await uploadResp.json()) as {
                    publicUrl: string;
                    path: string;
                };
                if (path) tempUploadPaths.push(path);
                inputs[layer.sourceHandleId] = publicUrl;
                continue;
            }

            // Case 3: live graph upstream — embed the serialized graph; the
            // server flattens and renders it inside the same request.
            const upstreamGraph =
                item && typeof item === 'object' && (item as any).graph
                    ? ((item as any).graph as GraphDescription)
                    : null;
            if (upstreamGraph) {
                inputs[layer.sourceHandleId] = { graph: upstreamGraph };
                continue;
            }
            // No usable input — skip this layer.
        }

        if (Object.keys(inputs).length === 0) {
            if (!isInternal) {
                setDownloadState('error');
                setTimeout(() => setDownloadState((s) => (s === 'error' ? 'idle' : s)), 2500);
            }
            throw new Error('No wired inputs');
        }

        // Diagnostic: log the resolved inputs map so layer-missing bugs can
        // be triaged from the browser console. Lists each saved layer in
        // config.layers and whether it ended up with a usable input URL.
        const savedLayerHandleIds = new Set((config.layers || []).map((l) => l.sourceHandleId));
        const inputKeys = new Set(Object.keys(inputs));
        console.log('[Compositor:download] resolved inputs', {
            nodeId: id,
            layers: (config.layers || []).map((l) => ({
                name: l.name,
                sourceHandleId: l.sourceHandleId,
                hasInput: inputKeys.has(l.sourceHandleId),
                inputUrl: inputs[l.sourceHandleId] ?? null,
            })),
            missingFromLayers: Object.keys(inputs).filter((k) => !savedLayerHandleIds.has(k)),
        });

        // Cleanup helper — fire and forget; we don't want temp-asset deletion
        // failures to mask the actual download outcome.
        const cleanupTempUploads = () => {
            tempUploadPaths.forEach((p) => {
                fetch('/api/upload', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: p, isFolder: false }),
                }).catch(() => { /* swallow */ });
            });
        };

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
            tick(); // own render complete
            const cd = resp.headers.get('Content-Disposition') || '';
            const match = cd.match(/filename="([^"]+)"/);
            const safeLabel = (data.label || 'compositor').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
            const filename = match?.[1] || `${safeLabel}.mp4`;

            if (!isInternal) {
                setDownloadState('success');
                setTimeout(() => setDownloadState((s) => (s === 'success' ? 'idle' : s)), 1500);
            }
            cleanupTempUploads();
            return [{ filename, blob }];
        } catch (err) {
            console.error('[Compositor:download] export failed', err);
            if (!isInternal) {
                setDownloadState('error');
                setTimeout(() => setDownloadState((s) => (s === 'error' ? 'idle' : s)), 2500);
            }
            cleanupTempUploads();
            throw err;
        }
        };

        const promise = runExport();
        inFlightExportRef.current = promise;
        try {
            return await promise;
        } finally {
            inFlightExportRef.current = null;
        }
    }, [config, layerEdges, upstreamBySource, data.label]);

    // Card Download button: render the mp4, save via anchor click. Wires the
    // global "Preparing download…" pill in the EditorToolbar so the user has
    // a top-of-screen indicator while a chained compositor is doing its
    // upstream resolution + upload + own render (which can be 30s+).
    const setBulkDownloadProgress = useAppStore((s) => s.setBulkDownloadProgress);
    const clearBulkDownload = useAppStore((s) => s.clearBulkDownload);

    const handleRequestDownload = useCallback(async () => {
        const opId =
            typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                ? crypto.randomUUID()
                : `dl-${Date.now()}-${Math.random().toString(36).slice(2)}`;

        try {
            const [item] = await fetchCompositorExport((current, total) => {
                setBulkDownloadProgress(opId, { current, total });
            });
            if (!item) {
                clearBulkDownload(opId);
                return;
            }
            const blobUrl = URL.createObjectURL(item.blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = item.filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
        } finally {
            // Hold the completed pill briefly so the user sees "done" before
            // it disappears. Matches the bulk-download cadence in EditorCanvas.
            setTimeout(() => clearBulkDownload(opId), 600);
        }
    }, [fetchCompositorExport, setBulkDownloadProgress, clearBulkDownload]);

    // Bulk-download path: register the export-to-blob path with the registry.
    // EditorCanvas's multi-select Download zips everything it gets back from
    // selected nodes' registered handlers + the generic media-URL fallback.
    useEffect(() => {
        registerDownloadHandler(id, (isInternal?: boolean) => fetchCompositorExport(undefined, isInternal));
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
                    <>
                        {canDownload && (
                            <Tooltip
                                content={
                                    downloadState === 'rendering' ? 'Rendering'
                                    : downloadState === 'success' ? 'Saved'
                                    : downloadState === 'error' ? 'Export failed — click to retry'
                                    : 'Download'
                                }
                                position="top"
                                delay={600}
                            >
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (downloadState === 'rendering') return;
                                        // Failures bubble through downloadState; catch here so the
                                        // promise doesn't reject unhandled at the boundary.
                                        handleRequestDownload().catch(() => {});
                                    }}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    disabled={downloadState === 'rendering'}
                                    className="w-6 h-6 rounded flex items-center justify-center text-content-primary hover:bg-white/10 hover:text-accent-primary transition-all disabled:cursor-wait"
                                >
                                    {downloadState === 'rendering' ? <Loader2 className="w-3 h-3 animate-spin pointer-events-none" />
                                    : downloadState === 'success' ? <Check className="w-3 h-3 pointer-events-none text-emerald-400" />
                                    : downloadState === 'error' ? <AlertCircle className="w-3 h-3 pointer-events-none text-red-400" />
                                    : <Download className="w-3 h-3 pointer-events-none" />}
                                </button>
                            </Tooltip>
                        )}
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
                    </>
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
                                onLayerAudioLoad={handleLayerAudioLoad}
                                intrinsicDurations={intrinsicDurations}
                                playhead={cardPlayhead}
                                isPlaying={cardIsPlaying}
                                clock={cardClock}
                                onTotalDurationChange={setCardTotalDuration}
                                poolKey={id}
                                muted={cardMuted}
                                baseFill={compositeBaseFill}
                            />
                            {hasTransport && (
                                <MiniTransport
                                    playhead={cardPlayhead}
                                    totalDuration={cardTotalDuration}
                                    fps={config.fps || 30}
                                    frameNumber={Math.round(Math.max(0, cardPlayhead) * (config.fps || 30))}
                                    totalFrames={cardTotalDuration > 0 ? Math.round(cardTotalDuration * (config.fps || 30)) : 0}
                                    isPlaying={cardIsPlaying}
                                    muted={cardMuted}
                                    onTogglePlay={() => setCardIsPlaying((p) => !p)}
                                    onSeek={handleCardSeek}
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
                <div ref={setEditorPortalEl}>
                    <CompositorEditorModal
                        nodeId={id}
                        config={config}
                        onClose={() => setIsEditorOpen(false)}
                        onConfigChange={updateConfig}
                        portalEl={editorPortalEl}
                        onDownload={canDownload ? () => { handleRequestDownload().catch(() => {}); } : undefined}
                        downloadState={downloadState}
                    />
                </div>,
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
