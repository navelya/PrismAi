'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Rect, Path, Transformer } from 'react-konva';
import {
    Eye, EyeOff, Lock, Unlock, Layers2,
    RotateCcw, FlipHorizontal, FlipVertical, Plus,
    Monitor, Smartphone, Maximize2, Crop,
    Instagram, Youtube, Facebook, Linkedin, Video, Play, Twitter,
    Image as ImageIcon, Type, AlignLeft, AlignCenter, AlignRight, AlignJustify,
    ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Undo2, Redo2, MousePointer2, Hand, Minus,
    Download, Loader2, Check
} from 'lucide-react';
import { Reorder } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store/app-store';
import { useShallow } from 'zustand/react/shallow';
import { NumberInput } from '@/components/ui/NumberInput';
import { Select } from '@/components/ui/Select';
import { ToolbarButton } from '@/components/editor/canvas/CanvasToolbar';
import { CompositorConfig, CompositorLayer, LayerTransform, calculateInitialTransform, calculateFirstLayerFitToCanvas } from '../definition';
import { toLegacyRenderableOutput } from '@/lib/workflow/result-format';
import { CompositorLayerNodes, RenderableLayer } from './Renderer';
import Timeline from './Timeline';
import { detectSourceKind, LayerSourceKind, computeTimelineDuration } from '../shared';

const VIEWPORT_PADDING = 1000;

const CANVAS_PRESETS = [
    { label: 'IG Story', width: 1080, height: 1920, icon: Instagram, color: '#E4405F', category: 'Instagram' },
    { label: 'IG Post', width: 1080, height: 1080, icon: Instagram, color: '#E4405F', category: 'Instagram' },
    { label: 'IG Portrait', width: 1080, height: 1350, icon: Instagram, color: '#E4405F', category: 'Instagram' },
    { label: 'TikTok', width: 1080, height: 1920, icon: Video, color: '#00F2EA', category: 'TikTok' },
    { label: 'YouTube', width: 1920, height: 1080, icon: Youtube, color: '#FF0000', category: 'YouTube' },
    { label: 'YT Shorts', width: 1080, height: 1920, icon: Play, color: '#FF0000', category: 'YouTube' },
    { label: 'FB Post', width: 1200, height: 630, icon: Facebook, color: '#1877F2', category: 'Facebook' },
    { label: 'LinkedIn', width: 1200, height: 627, icon: Linkedin, color: '#0A66C2', category: 'LinkedIn' },
    { label: 'X Post', width: 1200, height: 675, icon: Twitter, color: '#1DA1F2', category: 'X' },
    { label: 'Full HD', width: 1920, height: 1080, icon: Monitor, color: '#6366f1', category: 'General' },
];

const FONTS = [
    { id: 'Arial', display_name: 'Arial' },
    { id: 'Inter', display_name: 'Inter' },
    { id: 'Roboto', display_name: 'Roboto' },
    { id: 'Open Sans', display_name: 'Open Sans' },
    { id: 'Georgia', display_name: 'Georgia' },
    { id: 'Courier New', display_name: 'Courier New' },
    { id: 'Times New Roman', display_name: 'Times New Roman' },
];

const BLEND_MODES = [
    { id: 'source-over', display_name: 'Normal' },
    { id: 'multiply', display_name: 'Multiply' },
    { id: 'screen', display_name: 'Screen' },
    { id: 'overlay', display_name: 'Overlay' },
    { id: 'darken', display_name: 'Darken' },
    { id: 'lighten', display_name: 'Lighten' },
    { id: 'color-dodge', display_name: 'Color Dodge' },
    { id: 'color-burn', display_name: 'Color Burn' },
    { id: 'hard-light', display_name: 'Hard Light' },
    { id: 'soft-light', display_name: 'Soft Light' },
    { id: 'difference', display_name: 'Difference' },
    { id: 'exclusion', display_name: 'Exclusion' },
];

const LayerListItem = React.memo(({
    layer,
    isSelected,
    type,
    onSelect,
    onToggleVisibility,
    onToggleLock,
    onDragEnd,
}: any) => {
    let Icon = ImageIcon;
    if (type === 'prompt') Icon = Type;
    if (type === 'media_input') Icon = Smartphone;

    // Reorder.Item is a framer-motion drag source: the element itself follows
    // the pointer and siblings animate to fill the gap. `whileDrag` lifts the
    // active item visually. Inner buttons stop pointer-down propagation so
    // toggling visibility/lock can't be misread as a drag start.
    return (
        <Reorder.Item
            value={layer}
            onDragEnd={onDragEnd}
            onClick={() => onSelect(layer.id)}
            whileDrag={{ scale: 1.04, zIndex: 30, boxShadow: '0 20px 40px rgba(0,0,0,0.5)' }}
            className={cn(
                "flex items-center gap-2 p-1.5 rounded-lg border cursor-grab active:cursor-grabbing select-none transition-colors duration-200",
                isSelected
                    ? "bg-accent-primary/20 border-accent-primary/40 shadow-lg shadow-accent-primary/5"
                    : "bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/20"
            )}
        >
            <div className={cn("w-5 h-5 rounded-md flex items-center justify-center border", isSelected ? "bg-accent-primary text-white border-white/20" : "bg-white/10 text-white/40 border-white/10")}>
                <Icon className="w-2.5 h-2.5" />
            </div>
            <span className={cn("flex-1 text-[10px] font-bold truncate", isSelected ? "text-white" : "text-white/60")}>{layer.name}</span>
            <div className="flex items-center gap-1 opacity-40 group-hover:opacity-100">
                <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); onToggleVisibility(layer.id); }}
                    className="p-0.5 hover:text-white transition-colors cursor-pointer"
                >
                    {layer.visible ? <Eye className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5" />}
                </button>
                <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); onToggleLock(layer.id); }}
                    className="p-0.5 hover:text-white transition-colors cursor-pointer"
                >
                    {layer.locked ? <Lock className="w-2.5 h-2.5 text-amber-500" /> : <Unlock className="w-2.5 h-2.5" />}
                </button>
            </div>
        </Reorder.Item>
    );
});

interface CompositorEditorModalProps {
    nodeId: string;
    /** Initial config snapshot. Live edits flow through the store, not this prop. */
    config: CompositorConfig;
    onClose: () => void;
    /** Forwarded so callers can intercept; the modal also writes via updateNodeConfig directly. */
    onConfigChange?: (config: Partial<CompositorConfig>) => void;
    /** True when the compositor's effective output is video (any wired video layer). */
    canDownload?: boolean;
    /** Owner POSTs the compositor's config + resolved layer URLs to the server export route. */
    onRequestDownload?: () => void | Promise<void>;
    /** Driven by the owner: shown in the Download button as a label/spinner. */
    downloadState?: 'idle' | 'rendering' | 'success' | 'error';
}

export default function CompositorEditorModal({
    nodeId,
    config: initialConfig,
    onClose,
    canDownload = false,
    onRequestDownload,
    downloadState = 'idle',
}: CompositorEditorModalProps) {
    const updateNodeConfig = useAppStore((state) => state.updateNodeConfig);
    const setIsDragging = useAppStore((state) => state.setIsDragging);

    /**
     * Local undo/redo for this editor session only.
     *
     * Decoupled from the global workflow undo intentionally: the editor is a
     * separate "studio" surface, so its history shouldn't pollute outside-the-
     * modal Ctrl+Z. Closing the modal discards local history. Edits still
     * flow live to the workflow store via updateNodeConfig — they just don't
     * push entries onto the global past/future stack.
     */
    const [past, setPast] = useState<CompositorConfig[]>([]);
    const [future, setFuture] = useState<CompositorConfig[]>([]);

    const pushSnapshot = useCallback(() => {
        const node = useAppStore.getState().currentWorkflow?.nodes.find((n) => n.id === nodeId);
        const cfg = node?.data?.config as CompositorConfig | undefined;
        if (!cfg) return;
        setPast((p) => [...p, JSON.parse(JSON.stringify(cfg))].slice(-50));
        setFuture([]);
    }, [nodeId]);

    const localUndo = useCallback(() => {
        const node = useAppStore.getState().currentWorkflow?.nodes.find((n) => n.id === nodeId);
        const cfg = node?.data?.config as CompositorConfig | undefined;
        if (!cfg || past.length === 0) return;
        const prev = past[past.length - 1];
        // Compute new state outside the setState updater. Calling
        // updateNodeConfig (which triggers a Zustand set()) inside a setPast()
        // callback violates React's "no setState during render of another
        // component" rule and surfaces as a console warning.
        setPast((p) => p.slice(0, -1));
        setFuture((f) => [JSON.parse(JSON.stringify(cfg)), ...f].slice(0, 50));
        updateNodeConfig(nodeId, prev);
    }, [past, nodeId, updateNodeConfig]);

    const localRedo = useCallback(() => {
        const node = useAppStore.getState().currentWorkflow?.nodes.find((n) => n.id === nodeId);
        const cfg = node?.data?.config as CompositorConfig | undefined;
        if (!cfg || future.length === 0) return;
        const next = future[0];
        setFuture((f) => f.slice(1));
        setPast((p) => [...p, JSON.parse(JSON.stringify(cfg))].slice(-50));
        updateNodeConfig(nodeId, next);
    }, [future, nodeId, updateNodeConfig]);

    const canLocalUndo = past.length > 0;
    const canLocalRedo = future.length > 0;

    // Subscribe to the LIVE config for this compositor. Edits in either the
    // editor modal or the small canvas preview flow through updateNodeConfig
    // and re-render this component immediately. This is what makes the editor
    // and preview always show the same thing.
    const liveConfig = useAppStore((state) => {
        const node = state.currentWorkflow?.nodes.find((n) => n.id === nodeId);
        return (node?.data?.config as CompositorConfig | undefined) ?? initialConfig;
    });

    const config: CompositorConfig = useMemo(() => {
        const defaults: CompositorConfig = {
            canvasWidth: 1920,
            canvasHeight: 1080,
            backgroundColor: '#00000000',
            outputFormat: 'png',
            outputQuality: 1.0,
            layers: [],
            fps: 30,
            timelineDuration: null,
        };
        return { ...defaults, ...liveConfig };
    }, [liveConfig]);

    const layers = config.layers || [];
    const canvasWidth = config.canvasWidth;
    const canvasHeight = config.canvasHeight;

    // Edges that currently target this compositor (for the layer panel and resolved-value lookup).
    const layerEdges = useAppStore(useShallow((state) =>
        state.currentWorkflow?.edges?.filter(
            (e) => e.target === nodeId && (e.targetHandle === 'layers' || !e.targetHandle)
        ) || []
    ));

    // Per-edge upstream output. We read from nodeOutputs only (not from node
    // configs directly) because Phase 1 seeds source nodes (Prompt, MediaInput)
    // into nodeOutputs whenever their config changes — so this single map is
    // the live source of truth.
    const upstreamBySource = useAppStore(useShallow((state) => {
        const out: Record<string, any> = {};
        layerEdges.forEach((e) => {
            if (state.nodeOutputs[e.source] !== undefined) {
                out[e.source] = state.nodeOutputs[e.source];
            }
        });
        return out;
    }));

    // Per-edge node type, for the layer panel icon.
    const nodeTypesBySource = useAppStore(useShallow((state) => {
        const out: Record<string, string> = {};
        layerEdges.forEach((e) => {
            const node = state.currentWorkflow?.nodes.find((n) => n.id === e.source);
            if (node) out[e.source] = node.type;
        });
        return out;
    }));

    // Build the renderable layers (one entry per saved layer with its currently
    // resolved upstream value). Layers whose edge no longer exists are filtered
    // out — onEdgesChange already drops layers when their edge is removed, so
    // this is just defensive.
    const renderable: RenderableLayer[] = useMemo(() => {
        return layers
            .map((layer) => {
                const edge = layerEdges.find((e) => e.id === layer.sourceHandleId);
                if (!edge) return null;
                const upstream = upstreamBySource[edge.source];
                const normalized = upstream !== undefined ? toLegacyRenderableOutput(upstream) : null;
                const selected = Array.isArray(normalized)
                    ? (normalized[layer.selectedIndex] ?? normalized[0] ?? null)
                    : normalized;
                return { layer, resolved: selected ?? null };
            })
            .filter((r): r is RenderableLayer => r !== null);
    }, [layers, layerEdges, upstreamBySource]);

    // ---------- Live-write helpers ----------

    /**
     * Updater pattern: read fresh config from the store, compute new layers,
     * write the merged config back. Reading from the store (not closure) avoids
     * stale-state bugs when several edits land in the same render cycle.
     */
    const updateLayers = useCallback((updater: (prev: CompositorLayer[]) => CompositorLayer[]) => {
        const node = useAppStore.getState().currentWorkflow?.nodes.find((n) => n.id === nodeId);
        if (!node) return;
        const cfg = (node.data?.config as CompositorConfig) || initialConfig;
        const next = updater(cfg.layers || []);
        updateNodeConfig(nodeId, { ...cfg, layers: next });
    }, [nodeId, updateNodeConfig, initialConfig]);

    const updatePartialConfig = useCallback((partial: Partial<CompositorConfig>) => {
        const node = useAppStore.getState().currentWorkflow?.nodes.find((n) => n.id === nodeId);
        if (!node) return;
        const cfg = (node.data?.config as CompositorConfig) || initialConfig;
        updateNodeConfig(nodeId, { ...cfg, ...partial });
    }, [nodeId, updateNodeConfig, initialConfig]);

    const updateTransform = useCallback((layerId: string, updates: Partial<LayerTransform>) => {
        updateLayers((prev) => prev.map((l) =>
            l.id === layerId ? { ...l, transform: { ...l.transform, ...updates } } : l
        ));
    }, [updateLayers]);

    const toggleVisibility = useCallback((layerId: string) => {
        pushSnapshot();
        updateLayers((prev) => prev.map((l) => l.id === layerId ? { ...l, visible: !l.visible } : l));
    }, [updateLayers, pushSnapshot]);

    const toggleLock = useCallback((layerId: string) => {
        pushSnapshot();
        updateLayers((prev) => prev.map((l) => l.id === layerId ? { ...l, locked: !l.locked } : l));
    }, [updateLayers, pushSnapshot]);

    // ---------- Reorder buffering ----------
    //
    // framer-motion's Reorder fires onReorder every time items pass each other.
    // If we wrote each tick straight to the workflow store, every swap would
    // trigger a Zustand cascade → modal re-render → Konva re-render of every
    // layer, making the drag feel sluggish (this was the original bug).
    //
    // Instead we mirror the order in local state, render the Reorder.Group from
    // local, and only commit to the global store on drag-end. The store still
    // owns the truth — local just buffers the in-flight gesture.
    const [localLayers, setLocalLayers] = useState<CompositorLayer[]>(layers);
    const [isReordering, setIsReordering] = useState(false);
    const localLayersRef = useRef<CompositorLayer[]>(layers);
    const isReorderingRef = useRef(false);
    localLayersRef.current = localLayers;
    isReorderingRef.current = isReordering;

    // Sync local from store whenever the store changes AND no drag is in flight.
    // This picks up external mutations (new edge, undo, etc.) without clobbering
    // the user's mid-gesture order.
    useEffect(() => {
        if (!isReordering) {
            setLocalLayers(layers);
        }
    }, [layers, isReordering]);

    const handleReorder = useCallback((newOrder: CompositorLayer[]) => {
        setLocalLayers(newOrder);
        setIsReordering(true);
    }, []);

    const commitReorder = useCallback(() => {
        if (!isReorderingRef.current) return;
        setIsReordering(false);
        const next = localLayersRef.current;
        const prevLayers = (
            useAppStore.getState().currentWorkflow?.nodes.find((n) => n.id === nodeId)
                ?.data?.config as CompositorConfig | undefined
        )?.layers || [];
        const changed =
            prevLayers.length !== next.length ||
            prevLayers.some((l, i) => l.id !== next[i]?.id);
        if (!changed) return;
        pushSnapshot();
        updateLayers(() => next);
    }, [nodeId, pushSnapshot, updateLayers]);

    // ---------- Fit canvas to layer content ----------
    // Compute the rotated AABB across every layer (including invisible ones —
    // hiding doesn't change a layer's geometry, and ignoring them would surprise
    // users who toggled visibility temporarily). Then resize the canvas to that
    // box and shift every layer so the box origin sits at (0, 0).
    const fitCanvasToContent = useCallback(() => {
        if (layers.length === 0) return;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const l of layers) {
            const t = l.transform;
            const cx = t.x + t.width / 2;
            const cy = t.y + t.height / 2;
            const rad = ((t.rotation || 0) * Math.PI) / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            const hw = t.width / 2;
            const hh = t.height / 2;
            const corners = [
                { x: -hw, y: -hh },
                { x:  hw, y: -hh },
                { x:  hw, y:  hh },
                { x: -hw, y:  hh },
            ];
            for (const c of corners) {
                const rx = c.x * cos - c.y * sin + cx;
                const ry = c.x * sin + c.y * cos + cy;
                if (rx < minX) minX = rx;
                if (ry < minY) minY = ry;
                if (rx > maxX) maxX = rx;
                if (ry > maxY) maxY = ry;
            }
        }

        if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return;

        const newWidth = Math.max(1, Math.round(maxX - minX));
        const newHeight = Math.max(1, Math.round(maxY - minY));

        pushSnapshot();

        const node = useAppStore.getState().currentWorkflow?.nodes.find((n) => n.id === nodeId);
        if (!node) return;
        const cfg = (node.data?.config as CompositorConfig) || initialConfig;
        const shiftedLayers = (cfg.layers || []).map((l) => ({
            ...l,
            transform: {
                ...l.transform,
                x: l.transform.x - minX,
                y: l.transform.y - minY,
            },
        }));
        updateNodeConfig(nodeId, {
            ...cfg,
            canvasWidth: newWidth,
            canvasHeight: newHeight,
            layers: shiftedLayers,
        });
    }, [layers, nodeId, updateNodeConfig, pushSnapshot, initialConfig]);

    const alignLayer = useCallback((layerId: string, type: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
        pushSnapshot();
        updateLayers((prev) => prev.map((l) => {
            if (l.id !== layerId) return l;
            const { width, height } = l.transform;
            let x = l.transform.x;
            let y = l.transform.y;
            if (type === 'left') x = 0;
            if (type === 'center') x = (canvasWidth - width) / 2;
            if (type === 'right') x = canvasWidth - width;
            if (type === 'top') y = 0;
            if (type === 'middle') y = (canvasHeight - height) / 2;
            if (type === 'bottom') y = canvasHeight - height;
            return { ...l, transform: { ...l.transform, x, y } };
        }));
    }, [updateLayers, canvasWidth, canvasHeight, pushSnapshot]);

    const resetTransform = useCallback((layerId: string) => {
        pushSnapshot();
        updateTransform(layerId, { rotation: 0, flipX: false, flipY: false, opacity: 1 });
    }, [updateTransform, pushSnapshot]);

    /**
     * One-shot auto-fit when a layer's intrinsic dimensions first become known.
     * First-layer (only layer on the compositor) → canvas resizes to match the
     * layer, layer fills it. Layer 2+ → legacy auto-center inside whatever
     * canvas dims the user/first-layer already set.
     */
    const applyIntrinsicFit = useCallback((layerId: string, intrinsicW: number, intrinsicH: number) => {
        if (!intrinsicW || !intrinsicH) return;
        const node = useAppStore.getState().currentWorkflow?.nodes.find((n) => n.id === nodeId);
        const cfg = node?.data?.config as CompositorConfig | undefined;
        if (!cfg) return;
        const layer = cfg.layers?.find((l) => l.id === layerId);
        if (!layer) return;
        if (layer.transform.isAutoCentered) return;
        const t = layer.transform;
        const isPlaceholder = (t.width === 400 && t.height === 300) || (t.width === 600 && t.height === 200);
        if (!isPlaceholder) return;

        const isFirstLayer = (cfg.layers?.length ?? 0) === 1;
        if (isFirstLayer) {
            const fit = calculateFirstLayerFitToCanvas(intrinsicW, intrinsicH);
            updateNodeConfig(nodeId, {
                ...cfg,
                canvasWidth: fit.canvasWidth,
                canvasHeight: fit.canvasHeight,
                layers: (cfg.layers || []).map((l) =>
                    l.id === layerId ? { ...l, transform: fit.transform } : l
                ),
            });
            return;
        }

        const newT = calculateInitialTransform(intrinsicW, intrinsicH, cfg.canvasWidth || 1920, cfg.canvasHeight || 1080);
        updateLayers((prev) => prev.map((l) =>
            l.id === layerId ? { ...l, transform: { ...newT, isAutoCentered: true } } : l
        ));
    }, [nodeId, updateNodeConfig, updateLayers]);

    const handleImageLoad = useCallback((layerId: string, img: HTMLImageElement) => {
        applyIntrinsicFit(layerId, img.width, img.height);
    }, [applyIntrinsicFit]);

    // ---------- Selection / viewport (purely local UI state) ----------

    const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
    const selectedLayerIdRef = useRef<string | null>(null);
    selectedLayerIdRef.current = selectedLayerId;
    const [tool, setTool] = useState<'move' | 'pan'>('move');

    // Delete = drop the upstream connection that fed this layer in. The store's
    // onEdgesChange handler already strips the matching layer from the
    // compositor config when the edge is removed (workflow-slice.ts) — we just
    // need to dispatch the removal and clear local selection.
    const deleteSelectedLayer = useCallback((layerId: string) => {
        const node = useAppStore.getState().currentWorkflow?.nodes.find((n) => n.id === nodeId);
        const cfg = node?.data?.config as CompositorConfig | undefined;
        const layer = cfg?.layers?.find((l) => l.id === layerId);
        if (!layer) return;
        const edgeId = layer.sourceHandleId;
        if (!edgeId) return;
        useAppStore.getState().onEdgesChange([{ id: edgeId, type: 'remove' } as any]);
        setSelectedLayerId(null);
    }, [nodeId]);
    const stageRef = useRef<any>(null);
    const transformerRef = useRef<any>(null);
    const stageContainerRef = useRef<HTMLDivElement>(null);

    const [stageZoom, setStageZoom] = useState(1);
    const [stagePan, setStagePan] = useState({ x: VIEWPORT_PADDING, y: VIEWPORT_PADDING });
    const [isPanning, setIsPanning] = useState(false);
    const [spaceHeld, setSpaceHeld] = useState(false);

    // ---------- Timeline playback state (purely local) ----------
    //
    // Playhead drives the Konva renderer's activity gating + video seeks. The
    // rAF loop below advances `playhead` while `isPlaying`. Intrinsic durations
    // are reported by `LayerVideo` via `onLayerVideoLoad`.
    const [playhead, setPlayhead] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [audioMuted, setAudioMuted] = useState(true);
    const [intrinsicDurations, setIntrinsicDurations] = useState<Record<string, number | null>>({});

    const handleLayerVideoLoad = useCallback(
        (layerId: string, meta: { duration: number; width: number; height: number }) => {
            setIntrinsicDurations((prev) =>
                prev[layerId] === meta.duration ? prev : { ...prev, [layerId]: meta.duration || null }
            );
            applyIntrinsicFit(layerId, meta.width, meta.height);
        },
        [applyIntrinsicFit],
    );

    // Per-layer source kind derived from renderable.resolved; the timeline
    // and renderer both want this so we compute once.
    const sourceKindByLayerId = useMemo(() => {
        const out: Record<string, LayerSourceKind> = {};
        renderable.forEach(({ layer, resolved }) => {
            out[layer.id] = detectSourceKind(resolved);
        });
        return out;
    }, [renderable]);

    const totalDuration = useMemo(
        () => computeTimelineDuration(layers, config.timelineDuration ?? null, intrinsicDurations),
        [layers, config.timelineDuration, intrinsicDurations],
    );

    // Timeline only makes sense once a video is wired in — for purely static
    // image/text compositions there's nothing to scrub. Recomputes when a
    // layer's resolved source kind flips (e.g. an upstream finishes producing).
    const hasVideoLayer = useMemo(
        () => layers.some((l) => sourceKindByLayerId[l.id] === 'video'),
        [layers, sourceKindByLayerId],
    );

    /**
     * Auto-sequence new video layers onto the end of the timeline so they
     * never pile up at t=0. Runs once per video layer; the `isAutoSequenced`
     * flag freezes the layer's start position after the first placement so
     * later manual drags are preserved.
     *
     * Strategy ("append to end"):
     *   1. Collect end-times of every video layer that's already settled
     *      (isAutoSequenced=true OR user-customized startTime/duration).
     *   2. For each unsequenced video, place it at max(known ends) and mark
     *      it settled. Walking oldest→newest (high array index first) means
     *      a freshly-placed layer can serve as the anchor for the next one
     *      in the same pass.
     *   3. If an older video hasn't reported its intrinsic duration yet, we
     *      halt — the effect re-runs when the intrinsic arrives.
     */
    useEffect(() => {
        const node = useAppStore.getState().currentWorkflow?.nodes.find((n) => n.id === nodeId);
        const cfg = node?.data?.config as CompositorConfig | undefined;
        if (!cfg || !cfg.layers || cfg.layers.length === 0) return;

        const endByLayerId = new Map<string, number>();

        // Pass 1: already-settled video layers contribute their current end.
        for (const l of cfg.layers) {
            if (sourceKindByLayerId[l.id] !== 'video') continue;
            const userCustomized =
                (l.startTime || 0) !== 0 || (l.duration !== null && l.duration !== undefined);
            if (!l.isAutoSequenced && !userCustomized) continue;
            const intrinsic = intrinsicDurations[l.id];
            const dur = l.duration ?? intrinsic ?? 0;
            endByLayerId.set(l.id, (l.startTime || 0) + dur);
        }

        // Pass 2: place untouched video layers, oldest first.
        const targets: { id: string; startTime: number }[] = [];
        for (let i = cfg.layers.length - 1; i >= 0; i--) {
            const l = cfg.layers[i];
            if (sourceKindByLayerId[l.id] !== 'video') continue;
            if (l.isAutoSequenced) continue;
            const userCustomized =
                (l.startTime || 0) !== 0 || (l.duration !== null && l.duration !== undefined);
            if (userCustomized) {
                // User already positioned this layer manually before the
                // sequencer could run; respect it and freeze.
                targets.push({ id: l.id, startTime: l.startTime || 0 });
                continue;
            }
            const intrinsic = intrinsicDurations[l.id];
            if (intrinsic === undefined || intrinsic === null) {
                // Wait for this layer's intrinsic before sequencing it (and
                // any newer layers); guarantees add-order placement.
                break;
            }
            let maxEnd = 0;
            for (const end of endByLayerId.values()) {
                if (end > maxEnd) maxEnd = end;
            }
            endByLayerId.set(l.id, maxEnd + intrinsic);
            targets.push({ id: l.id, startTime: maxEnd });
        }

        if (targets.length === 0) return;
        updateLayers((prev) => prev.map((l) => {
            const t = targets.find((x) => x.id === l.id);
            return t ? { ...l, startTime: t.startTime, isAutoSequenced: true } : l;
        }));
    }, [layers, intrinsicDurations, sourceKindByLayerId, nodeId, updateLayers]);

    // rAF playback loop. Halts when paused, when the modal closes, or when the
    // playhead would step past the end (we wrap to 0 so playback feels looping).
    useEffect(() => {
        if (!isPlaying) return;
        let raf: number | null = null;
        let last = performance.now();
        const tick = (now: number) => {
            const dt = (now - last) / 1000;
            last = now;
            setPlayhead((p) => {
                const next = p + dt;
                return next >= totalDuration ? 0 : next;
            });
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => { if (raf !== null) cancelAnimationFrame(raf); };
    }, [isPlaying, totalDuration]);

    const handleUpdateLayer = useCallback((layerId: string, patch: Partial<CompositorLayer>) => {
        updateLayers((prev) => prev.map((l) => l.id === layerId ? { ...l, ...patch } : l));
    }, [updateLayers]);

    // Wire the Konva Transformer to the currently-selected Konva node by name.
    useEffect(() => {
        if (selectedLayerId && transformerRef.current && stageRef.current) {
            const selectedNode = stageRef.current.findOne(`.img-${selectedLayerId}`);
            if (selectedNode) {
                transformerRef.current.nodes([selectedNode]);
                transformerRef.current.getLayer().batchDraw();
            } else {
                transformerRef.current.nodes([]);
                transformerRef.current.getLayer().batchDraw();
            }
        } else if (transformerRef.current) {
            transformerRef.current.nodes([]);
            transformerRef.current.getLayer().batchDraw();
        }
    }, [selectedLayerId, renderable]);

    const fitToView = useCallback(() => {
        const container = stageContainerRef.current;
        if (!container) return;
        const cw = container.clientWidth;
        const ch = container.clientHeight;
        const padding = 100;
        const zoomX = (cw - padding * 2) / canvasWidth;
        const zoomY = (ch - padding * 2) / canvasHeight;
        const zoom = Math.min(zoomX, zoomY, 2);
        const panX = (cw - canvasWidth * zoom) / 2;
        const panY = (ch - canvasHeight * zoom) / 2;
        setStageZoom(zoom);
        setStagePan({ x: panX, y: panY });
    }, [canvasWidth, canvasHeight]);

    useEffect(() => { fitToView(); }, [fitToView]);

    // Keyboard: pan toggle + local undo/redo + delete-selected-layer.
    //
    // The Delete branch runs in CAPTURE phase and calls stopImmediatePropagation
    // so React Flow's own delete-key handler (registered on the canvas) never
    // sees the event. Without that, Delete inside the modal would also fire RF's
    // onNodesDelete and remove the entire compositor node.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.code === 'Space' && !e.repeat && e.target === document.body) {
                e.preventDefault();
                setSpaceHeld(true);
            }
            if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
                e.preventDefault();
                if (e.shiftKey) localRedo(); else localUndo();
            }
            if (e.key === 'Delete' || e.key === 'Backspace') {
                // Skip when the user is typing into a real input/textarea — they
                // expect Backspace/Delete to edit text, not remove a layer.
                const target = e.target as HTMLElement | null;
                const tag = target?.tagName;
                const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || (target?.isContentEditable === true);
                if (isEditable) return;
                const layerId = selectedLayerIdRef.current;
                if (!layerId) return;
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                deleteSelectedLayer(layerId);
            }
        };
        const onKeyUp = (e: KeyboardEvent) => { if (e.code === 'Space') { setSpaceHeld(false); setIsPanning(false); } };
        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('keyup', onKeyUp);
        return () => { window.removeEventListener('keydown', onKeyDown, true); window.removeEventListener('keyup', onKeyUp); };
    }, [localUndo, localRedo, deleteSelectedLayer]);

    const checkDeselect = (e: any) => {
        const clickedOnEmpty = e.target === e.target.getStage() || e.target.name() === 'background';
        if (clickedOnEmpty) setSelectedLayerId(null);
    };

    // Snapshot once at the start of an interaction (drag/transform). The
    // checkpoint goes to LOCAL history only — outside-the-modal Ctrl+Z is
    // unaffected. setIsDragging keeps the small-canvas preview from doing
    // expensive work mid-gesture.
    const handleInteractStart = useCallback(() => {
        pushSnapshot();
        setIsDragging(true);
    }, [pushSnapshot, setIsDragging]);

    const handleInteractEnd = useCallback(() => {
        setIsDragging(false);
    }, [setIsDragging]);

    const selectedLayer = useMemo(() => layers.find((l) => l.id === selectedLayerId) || null, [layers, selectedLayerId]);
    const selectedEdge = useMemo(
        () => selectedLayer ? layerEdges.find((e) => e.id === selectedLayer.sourceHandleId) : null,
        [selectedLayer, layerEdges]
    );
    const selectedSourceType = selectedEdge ? nodeTypesBySource[selectedEdge.source] : undefined;
    const isTextLayer = selectedSourceType === 'prompt';

    const dimmerPathData = `M -99999 -99999 L 99999 -99999 L 99999 99999 L -99999 99999 Z M 0 0 L 0 ${canvasHeight} L ${canvasWidth} ${canvasHeight} L ${canvasWidth} 0 Z`;

    return (
        <div className="fixed inset-0 z-[100000] bg-black/60 backdrop-blur-sm flex items-center justify-center pointer-events-auto">
            <div className="bg-surface-primary/90 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl w-[96vw] h-[92vh] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-white/5">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-accent-primary/20 flex items-center justify-center border border-accent-primary/30">
                            <Layers2 className="w-6 h-6 text-accent-primary" />
                        </div>
                        <div>
                            <h2 className="font-bold text-lg text-content-primary leading-tight tracking-tight">Compositor Studio</h2>
                            <p className="text-[10px] text-content-tertiary uppercase tracking-widest font-black opacity-40">Live Editor</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {canDownload && onRequestDownload && (
                            <button
                                onClick={() => { if (downloadState !== 'rendering') void onRequestDownload(); }}
                                disabled={downloadState === 'rendering'}
                                className={cn(
                                    'px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white font-black text-xs shadow-lg transition-all uppercase tracking-widest flex items-center gap-2',
                                    'disabled:opacity-70 disabled:cursor-wait disabled:hover:bg-white/10',
                                )}
                                title={
                                    downloadState === 'rendering' ? 'Rendering the full timeline on the server (video + audio, H.264)…'
                                    : downloadState === 'success' ? 'Saved'
                                    : downloadState === 'error' ? 'Export failed — click to retry'
                                    : 'Download the full composition (video + audio, exact duration)'
                                }
                            >
                                {downloadState === 'rendering' ? (<><Loader2 className="w-3.5 h-3.5 animate-spin" />Rendering</>)
                                : downloadState === 'success' ? (<><Check className="w-3.5 h-3.5" />Saved</>)
                                : (<><Download className="w-3.5 h-3.5" />Download</>)}
                            </button>
                        )}
                        <button onClick={onClose} className="px-6 py-2 rounded-xl bg-accent-primary text-white font-black text-xs shadow-lg shadow-accent-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all uppercase tracking-widest">Done</button>
                    </div>
                </div>

                {/* Main Content (canvas + side panels) */}
                <div className="flex-1 flex overflow-hidden min-h-0">
                    {/* Left Panel - Layers */}
                    <div className="w-56 border-r border-white/5 flex flex-col bg-white/5 backdrop-blur-3xl">
                        <div className="p-4 border-b border-white/5 bg-white/5 flex items-center justify-between">
                            <span className="text-[10px] font-black text-content-tertiary uppercase tracking-widest">Layers</span>
                            <div className="w-2 h-2 rounded-full bg-accent-primary animate-pulse" />
                        </div>
                        <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
                            {/* Reorder.Group itself stays overflow:visible so a dragged
                                item can extend past sibling rows without getting clipped.
                                The scroll container is the parent div above. */}
                            <Reorder.Group
                                axis="y"
                                values={localLayers}
                                onReorder={handleReorder}
                                className="flex flex-col gap-1.5"
                            >
                                {localLayers.map((layer) => {
                                    const edge = layerEdges.find((e) => e.id === layer.sourceHandleId);
                                    const type = edge ? nodeTypesBySource[edge.source] : undefined;
                                    return (
                                        <LayerListItem
                                            key={layer.id}
                                            layer={layer}
                                            isSelected={selectedLayerId === layer.id}
                                            type={type}
                                            onSelect={setSelectedLayerId}
                                            onToggleVisibility={toggleVisibility}
                                            onToggleLock={toggleLock}
                                            onDragEnd={commitReorder}
                                        />
                                    );
                                })}
                            </Reorder.Group>
                            {layers.length === 0 && (
                                <div className="text-center text-[10px] text-white/30 py-8 px-2">
                                    Connect a node to the Compositor to add a layer.
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Center - Stage Container */}
                    <div ref={stageContainerRef} className="flex-1 relative bg-[#080808] overflow-hidden" style={{ cursor: (spaceHeld || tool === 'pan') ? (isPanning ? 'grabbing' : 'grab') : 'default' }}>
                        <Stage
                            ref={stageRef}
                            width={stageContainerRef.current?.clientWidth || window.innerWidth}
                            height={stageContainerRef.current?.clientHeight || window.innerHeight}
                            onWheel={(e) => {
                                e.evt.preventDefault();
                                const stage = e.target.getStage();
                                if (!stage) return;
                                const oldScale = stage.scaleX();
                                const pointer = stage.getPointerPosition();
                                if (!pointer) return;
                                const mousePointTo = { x: (pointer.x - stage.x()) / oldScale, y: (pointer.y - stage.y()) / oldScale };
                                const zoomFactor = e.evt.deltaY < 0 ? 1.1 : 0.9;
                                const newScale = Math.min(Math.max(oldScale * zoomFactor, 0.05), 10);
                                setStageZoom(newScale);
                                setStagePan({ x: pointer.x - mousePointTo.x * newScale, y: pointer.y - mousePointTo.y * newScale });
                            }}
                            scaleX={stageZoom} scaleY={stageZoom} x={stagePan.x} y={stagePan.y}
                            draggable={spaceHeld || tool === 'pan'}
                            onDragStart={() => setIsPanning(true)}
                            onDragEnd={(e) => { if (e.target === e.target.getStage()) { setIsPanning(false); setStagePan({ x: e.target.x(), y: e.target.y() }); } }}
                            onMouseDown={checkDeselect}
                        >
                            <Layer>
                                <Rect name="background" x={0} y={0} width={canvasWidth} height={canvasHeight} fill="#121212" stroke="rgba(255,255,255,0.05)" strokeWidth={1} shadowColor="black" shadowBlur={100} shadowOpacity={0.5} />
                                <CompositorLayerNodes
                                    layers={renderable}
                                    interactive
                                    selectedLayerId={selectedLayerId}
                                    onSelectLayer={setSelectedLayerId}
                                    onTransformLayer={updateTransform}
                                    onLayerImageLoad={handleImageLoad}
                                    onLayerVideoLoad={handleLayerVideoLoad}
                                    onInteractStart={handleInteractStart}
                                    onInteractEnd={handleInteractEnd}
                                    playhead={playhead}
                                    isPlaying={isPlaying}
                                    muted={audioMuted}
                                    intrinsicDurations={intrinsicDurations}
                                    poolKey={nodeId}
                                />
                                <Path data={dimmerPathData} fill="rgba(0,0,0,0.7)" fillRule="evenodd" listening={false} />
                                {selectedLayer && !selectedLayer.locked && (
                                    <Transformer ref={transformerRef} flipEnabled={false} borderStroke="#00F2EA" anchorStroke="#00F2EA" anchorFill="#00F2EA" anchorSize={8} borderDash={[3, 3]} />
                                )}
                            </Layer>
                        </Stage>

                        {/* TOOLBOX */}
                        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-1.5 rounded-lg bg-surface-elevated/90 backdrop-blur-md border border-stroke-subtle shadow-xl z-50">
                            <ToolbarButton icon={Undo2} onClick={localUndo} disabled={!canLocalUndo} title="Undo" />
                            <ToolbarButton icon={Redo2} onClick={localRedo} disabled={!canLocalRedo} title="Redo" />

                            <ToolbarButton icon={MousePointer2} onClick={() => setTool('move')} active={tool === 'move'} title="Select Tool" />
                            <ToolbarButton icon={Hand} onClick={() => setTool('pan')} active={tool === 'pan'} title="Pan Tool" />
                            <ToolbarButton icon={Maximize2} onClick={fitToView} title="Fit to View" />
                            <ToolbarButton icon={Crop} onClick={fitCanvasToContent} disabled={layers.length === 0} title="Fit Canvas to Content" />

                            <ToolbarButton icon={Minus} onClick={() => setStageZoom(z => Math.max(z * 0.8, 0.05))} title="Zoom Out" />
                            <span className="px-2 text-xs font-medium text-content-secondary min-w-[40px] text-center tabular-nums">{Math.round(stageZoom * 100)}%</span>
                            <ToolbarButton icon={Plus} onClick={() => setStageZoom(z => Math.min(z * 1.25, 10))} title="Zoom In" />
                        </div>
                    </div>

                    {/* Right Panel - Properties */}
                    <div className="w-96 border-l border-white/5 flex flex-col bg-white/5 backdrop-blur-3xl overflow-hidden shadow-2xl">
                        <div className="p-4 border-b border-white/5 bg-white/5 font-black text-[10px] uppercase tracking-[0.2em] text-white/30 flex items-center gap-2">
                            <Plus className="w-3 h-3" /> Properties
                        </div>

                        {selectedLayer ? (
                            <div className="flex-1 overflow-y-auto p-4 space-y-8 custom-scrollbar pb-20">
                                {/* Section: Alignment */}
                                <div className="space-y-3">
                                    <label className="text-[9px] font-black text-white/20 uppercase tracking-widest">Alignment</label>
                                    <div className="grid grid-cols-6 gap-1 bg-white/5 p-1 rounded-xl border border-white/5">
                                        <button onClick={() => alignLayer(selectedLayerId!, 'left')} className="p-2 rounded-lg hover:bg-white/10 text-white/40 flex items-center justify-center transition-all" title="Align Left"><ArrowLeft className="w-3.5 h-3.5" /></button>
                                        <button onClick={() => alignLayer(selectedLayerId!, 'center')} className="p-2 rounded-lg hover:bg-white/10 text-white/40 flex items-center justify-center transition-all" title="Horizontal Center"><AlignCenter className="w-3.5 h-3.5" /></button>
                                        <button onClick={() => alignLayer(selectedLayerId!, 'right')} className="p-2 rounded-lg hover:bg-white/10 text-white/40 flex items-center justify-center transition-all" title="Align Right"><ArrowRight className="w-3.5 h-3.5" /></button>
                                        <button onClick={() => alignLayer(selectedLayerId!, 'top')} className="p-2 rounded-lg hover:bg-white/10 text-white/40 flex items-center justify-center transition-all" title="Align Top"><ArrowUp className="w-3.5 h-3.5" /></button>
                                        <button onClick={() => alignLayer(selectedLayerId!, 'middle')} className="p-2 rounded-lg hover:bg-white/10 text-white/40 flex items-center justify-center transition-all" title="Vertical Middle"><AlignJustify className="w-3.5 h-3.5 rotate-90" /></button>
                                        <button onClick={() => alignLayer(selectedLayerId!, 'bottom')} className="p-2 rounded-lg hover:bg-white/10 text-white/40 flex items-center justify-center transition-all" title="Align Bottom"><ArrowDown className="w-3.5 h-3.5" /></button>
                                    </div>
                                </div>

                                {/* Section: Transform */}
                                <div className="space-y-4">
                                    <label className="text-[9px] font-black text-white/20 uppercase tracking-widest">Geometry</label>
                                    <div className="grid grid-cols-2 gap-3">
                                        <NumberInput variant="minimal" label="X" value={Math.round(selectedLayer.transform.x)} onChange={(e) => updateTransform(selectedLayerId!, { x: Number(e.target.value) })} />
                                        <NumberInput variant="minimal" label="Y" value={Math.round(selectedLayer.transform.y)} onChange={(e) => updateTransform(selectedLayerId!, { y: Number(e.target.value) })} />
                                        <NumberInput variant="minimal" label="Width" value={Math.round(selectedLayer.transform.width)} onChange={(e) => updateTransform(selectedLayerId!, { width: Number(e.target.value) })} />
                                        <NumberInput variant="minimal" label="Height" value={Math.round(selectedLayer.transform.height)} onChange={(e) => updateTransform(selectedLayerId!, { height: Number(e.target.value) })} />
                                    </div>
                                    <div className="grid grid-cols-2 gap-3 items-end">
                                        <div className="relative group">
                                            <label className="text-[8px] font-bold text-white/20 uppercase tracking-widest pl-1 mb-1 block">Rotation</label>
                                            <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-2 h-8">
                                                <RotateCcw className="w-3 h-3 text-white/20" />
                                                <input type="number" value={Math.round(selectedLayer.transform.rotation)} onChange={(e) => updateTransform(selectedLayerId!, { rotation: Number(e.target.value) })} className="w-full bg-transparent border-none focus:outline-none text-xs text-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                                                <span className="text-[10px] font-bold text-white/20">°</span>
                                            </div>
                                        </div>
                                        <div className="flex gap-1 bg-white/5 p-1 rounded-lg border border-white/5 h-8">
                                            <button onClick={() => updateTransform(selectedLayerId!, { flipX: !selectedLayer.transform.flipX })} className={cn("flex-1 rounded flex items-center justify-center transition-all", selectedLayer.transform.flipX ? "bg-accent-primary text-white" : "text-white/20 hover:text-white")}><FlipHorizontal className="w-3 h-3" /></button>
                                            <button onClick={() => updateTransform(selectedLayerId!, { flipY: !selectedLayer.transform.flipY })} className={cn("flex-1 rounded flex items-center justify-center transition-all", selectedLayer.transform.flipY ? "bg-accent-primary text-white" : "text-white/20 hover:text-white")}><FlipVertical className="w-3 h-3" /></button>
                                            <button onClick={() => resetTransform(selectedLayerId!)} className="flex-1 rounded flex items-center justify-center text-white/20 hover:text-white"><RotateCcw className="w-3 h-3" /></button>
                                        </div>
                                    </div>
                                </div>

                                {/* Section: Appearance */}
                                <div className="space-y-4">
                                    <label className="text-[9px] font-black text-white/20 uppercase tracking-widest">Effects</label>
                                    <Select variant="minimal" label="Blend Mode" value={selectedLayer.transform.blendMode || 'source-over'} options={BLEND_MODES} onChange={(e) => updateTransform(selectedLayerId!, { blendMode: e.target.value })} />
                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center px-1"><label className="text-[8px] font-bold text-white/30 uppercase tracking-widest">Opacity</label><span className="text-[10px] font-black text-accent-primary tabular-nums">{Math.round(selectedLayer.transform.opacity * 100)}%</span></div>
                                        <input type="range" min="0" max="1" step="0.01" value={selectedLayer.transform.opacity} onChange={(e) => updateTransform(selectedLayerId!, { opacity: Number(e.target.value) })} className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-accent-primary" />
                                    </div>
                                </div>

                                {/* Section: Typography (Conditional) */}
                                {isTextLayer && (
                                    <div className="space-y-4 pt-4 border-t border-white/5">
                                        <label className="text-[9px] font-black text-accent-primary uppercase tracking-[0.2em]">Typography</label>
                                        <Select variant="minimal" label="Font Family" value={selectedLayer.transform.fontFamily || 'Inter'} options={FONTS} onChange={(e) => updateTransform(selectedLayerId!, { fontFamily: e.target.value })} />
                                        <div className="grid grid-cols-2 gap-3 items-end">
                                            <Select variant="minimal" label="Weight" value={selectedLayer.transform.fontWeight || 'bold'} options={[
                                                { id: 'normal', display_name: 'Normal' },
                                                { id: 'medium', display_name: 'Medium' },
                                                { id: 'semibold', display_name: 'Semibold' },
                                                { id: 'bold', display_name: 'Bold' },
                                                { id: '900', display_name: 'Black' },
                                            ]} onChange={(e) => updateTransform(selectedLayerId!, { fontWeight: e.target.value })} />
                                            <div className="space-y-1">
                                                <label className="text-[8px] font-bold text-white/20 uppercase tracking-widest pl-1">Style</label>
                                                <div className="flex gap-1 bg-white/5 p-1 rounded-lg border border-white/5 h-8">
                                                    <button onClick={() => updateTransform(selectedLayerId!, { fontStyle: 'normal' })} className={cn("flex-1 py-1 rounded text-[10px] font-bold transition-all", (selectedLayer.transform.fontStyle !== 'italic') ? "bg-accent-primary text-white" : "text-white/20 hover:text-white")}>Abc</button>
                                                    <button onClick={() => updateTransform(selectedLayerId!, { fontStyle: 'italic' })} className={cn("flex-1 py-1 rounded text-[10px] font-bold italic transition-all", (selectedLayer.transform.fontStyle === 'italic') ? "bg-accent-primary text-white" : "text-white/20 hover:text-white")}>Abc</button>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3 items-end">
                                            <NumberInput variant="minimal" label="Size" value={selectedLayer.transform.fontSize || 100} onChange={(e) => updateTransform(selectedLayerId!, { fontSize: Number(e.target.value) })} />
                                            <div className="space-y-1">
                                                <label className="text-[8px] font-bold text-white/20 uppercase tracking-widest pl-1">Fill</label>
                                                <div className="relative h-8 bg-white/5 border border-white/10 rounded-lg overflow-hidden group">
                                                    <input type="color" value={selectedLayer.transform.fillColor || '#ffffff'} onChange={(e) => updateTransform(selectedLayerId!, { fillColor: e.target.value })} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                                                    <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: selectedLayer.transform.fillColor || '#ffffff' }}>
                                                        <div className="w-3 h-3 rounded-full border border-black/20" />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <NumberInput variant="minimal" label="Line Height" step={0.1} value={selectedLayer.transform.lineHeight || 1.2} onChange={(e) => updateTransform(selectedLayerId!, { lineHeight: Number(e.target.value) })} />
                                            <NumberInput variant="minimal" label="Spacing" value={selectedLayer.transform.letterSpacing || 0} onChange={(e) => updateTransform(selectedLayerId!, { letterSpacing: Number(e.target.value) })} />
                                        </div>
                                        <div className="grid grid-cols-4 gap-1 bg-white/5 p-1 rounded-xl border border-white/5">
                                            {(['left', 'center', 'right', 'justify'] as const).map(align => (
                                                <button key={align} onClick={() => updateTransform(selectedLayerId!, { textAlign: align })} className={cn("p-1.5 rounded-lg transition-all flex items-center justify-center", (selectedLayer.transform.textAlign || 'center') === align ? "bg-accent-primary text-white" : "text-white/20 hover:text-white")}>
                                                    {align === 'left' && <AlignLeft className="w-3.5 h-3.5" />}
                                                    {align === 'center' && <AlignCenter className="w-3.5 h-3.5" />}
                                                    {align === 'right' && <AlignRight className="w-3.5 h-3.5" />}
                                                    {align === 'justify' && <AlignJustify className="w-3.5 h-3.5" />}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col p-4 space-y-6 min-h-0">
                                <div className="space-y-4 shrink-0">
                                    <label className="text-[9px] font-black text-white/20 uppercase tracking-widest">Canvas Dimensions</label>
                                    <div className="grid grid-cols-2 gap-3">
                                        <NumberInput variant="minimal" label="Width" value={canvasWidth} onChange={(e) => updatePartialConfig({ canvasWidth: Math.max(100, Number(e.target.value)) })} />
                                        <NumberInput variant="minimal" label="Height" value={canvasHeight} onChange={(e) => updatePartialConfig({ canvasHeight: Math.max(100, Number(e.target.value)) })} />
                                    </div>
                                </div>
                                <div className="space-y-3 flex-1 flex flex-col min-h-0 overflow-hidden">
                                    <label className="text-[9px] font-black text-white/20 uppercase tracking-widest">Studio Presets</label>
                                    <div className="grid grid-cols-2 gap-2 overflow-y-auto flex-1 custom-scrollbar pr-1">
                                        {CANVAS_PRESETS.map((preset) => {
                                            const Icon = preset.icon;
                                            const isActive = canvasWidth === preset.width && canvasHeight === preset.height;
                                            return (
                                                <button key={preset.label} onClick={() => updatePartialConfig({ canvasWidth: preset.width, canvasHeight: preset.height })} className={cn("flex flex-col items-center p-3 rounded-xl border transition-all duration-300 gap-2 h-fit w-full", isActive ? "bg-accent-primary/10 border-accent-primary/40" : "bg-white/5 border-white/5 hover:bg-white/10")}>
                                                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: preset.color + '15', color: preset.color }}><Icon className="w-4 h-4" /></div>
                                                    <div className="text-center"><p className={cn("text-[9px] font-black leading-tight uppercase tracking-tighter", isActive ? "text-white" : "text-white/40")}>{preset.label}</p><p className="text-[8px] text-white/10 font-bold">{preset.width}×{preset.height}</p></div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Timeline panel — only mounted when a video is on the canvas.
                    Image/text-only compositions don't need a transport bar. */}
                {hasVideoLayer && (
                    <div className="h-[260px] flex-shrink-0 border-t border-white/10">
                        <Timeline
                            layers={layers}
                            sourceKindByLayerId={sourceKindByLayerId}
                            intrinsicDurations={intrinsicDurations}
                            configuredTotalDuration={config.timelineDuration ?? null}
                            fps={config.fps || 30}
                            playhead={playhead}
                            isPlaying={isPlaying}
                            audioMuted={audioMuted}
                            selectedLayerId={selectedLayerId}
                            onTogglePlay={() => setIsPlaying((p) => !p)}
                            onSeek={(t) => { setIsPlaying(false); setPlayhead(t); }}
                            onToggleAudioMute={() => setAudioMuted((m) => !m)}
                            onSelectLayer={setSelectedLayerId}
                            onUpdateLayer={handleUpdateLayer}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
