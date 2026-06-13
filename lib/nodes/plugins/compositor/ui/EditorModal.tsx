'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Rect, Path, Transformer, Line } from 'react-konva';
import {
    Eye, EyeOff, Lock, Unlock, Layers2,
    RotateCcw, FlipHorizontal, FlipVertical, Plus,
    Monitor, Smartphone, Maximize2, Crop,
    Instagram, Youtube, Facebook, Linkedin, Video, Play, Twitter,
    Image as ImageIcon, Type, AlignLeft, AlignCenter, AlignRight, AlignJustify,
    ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Undo2, Redo2, MousePointer2, Hand, Minus,
    Download, Loader2, Check, AlertCircle,
} from 'lucide-react';
import { Reorder } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store/app-store';
import { useShallow } from 'zustand/react/shallow';
import { NumberInput } from '@/components/ui/NumberInput';
import { Select } from '@/components/ui/Select';
import { ToolbarButton } from '@/components/editor/canvas/CanvasToolbar';
import { CompositorConfig, CompositorLayer, LayerTransform, calculateInitialTransform, calculateFirstLayerFitToCanvas } from '../definition';
import { resolveSourceLayerTitle } from '@/lib/store/slices/workflow-slice';
import { toLegacyRenderableOutput } from '@/lib/workflow/result-format';
import { CompositorLayerNodes, RenderableLayer } from './Renderer';
import CompositorAudio from './CompositorAudio';
import Timeline from './Timeline';
import { detectSourceKind, LayerSourceKind, computeTimelineDuration, getEffectiveDuration, splitLayerAtPlayhead, layerAABB, rectsIntersect, resolveCompositeBaseFill } from '../shared';
import { useTransportClock } from '../transport-clock';
import { useInertBackground } from '@/lib/hooks/use-inert-background';
import MultiLayerProperties from './MultiLayerProperties';

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
    displayName,
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
            onClick={(e) => onSelect(layer.id, e.ctrlKey || e.metaKey)}
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
            <span className={cn("flex-1 text-[10px] font-bold truncate", isSelected ? "text-white" : "text-white/60")}>{displayName || layer.name}</span>
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
    /** The portal wrapper element; used to keep this modal interactive while the rest of the page is inert. */
    portalEl?: HTMLElement | null;
    /**
     * Export/download trigger shared with the card's Download button (same
     * in-flight dedupe + server render). When provided, the header shows a
     * Download button whose visual state follows `downloadState`.
     */
    onDownload?: () => void;
    downloadState?: 'idle' | 'rendering' | 'success' | 'error';
}

export default function CompositorEditorModal({
    nodeId,
    config: initialConfig,
    onClose,
    portalEl = null,
    onDownload,
    downloadState = 'idle',
}: CompositorEditorModalProps) {
    useInertBackground(true, portalEl);
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

    // LIVE layer titles — mirror each source node's CURRENT title (the same
    // resolution the connect-time auto-namer uses), so renaming a node
    // updates its layer name in the panel + timeline. Derived at display time
    // rather than read from the frozen `layer.name` stored at connect time.
    const layerTitleBySource = useAppStore(useShallow((state) => {
        const out: Record<string, string> = {};
        layerEdges.forEach((e) => {
            const node = state.currentWorkflow?.nodes.find((n) => n.id === e.source);
            if (node) out[e.source] = resolveSourceLayerTitle(node, state.nodeTypes || []);
        });
        return out;
    }));

    // layerId → live display title, keyed for the timeline + panel.
    const layerNames = useMemo(() => {
        const out: Record<string, string> = {};
        for (const layer of layers) {
            const edge = layerEdges.find((ed) => ed.id === layer.sourceHandleId);
            const title = edge ? layerTitleBySource[edge.source] : undefined;
            out[layer.id] = title || layer.name || 'Layer';
        }
        return out;
    }, [layers, layerEdges, layerTitleBySource]);

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

    // Self-heal orphan layers. A CompositorLayer is materialized 1:1 with the
    // edge that feeds it (layer.sourceHandleId === edge.id), and the store strips
    // the layer when its edge is removed. But that strip is duplicated across the
    // edge-removal paths and any path that misses it leaves a "ghost": a layer
    // whose edge is gone, which renders as a name-only row in the list/timeline
    // (renderable already drops it from the canvas — no edge, no media) and CANNOT
    // be deleted, because its delete routes through "remove the edge" and the edge
    // is already gone (a no-op). Layers and edges always co-load atomically in
    // currentWorkflow, so an unmatched sourceHandleId is genuinely dead — prune it
    // here so the invariant (every layer has a live edge) self-corrects no matter
    // which path dropped the edge. No snapshot: this is cleanup, not a user edit.
    useEffect(() => {
        if (layers.length === 0) return;
        const edgeIds = new Set(layerEdges.map((e) => e.id));
        if (!layers.some((l) => !edgeIds.has(l.sourceHandleId))) return;
        updateLayers((prev) => prev.filter((l) => edgeIds.has(l.sourceHandleId)));
    }, [layers, layerEdges, updateLayers]);

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
            const b = layerAABB(l);
            if (b.minX < minX) minX = b.minX;
            if (b.minY < minY) minY = b.minY;
            if (b.maxX > maxX) maxX = b.maxX;
            if (b.maxY > maxY) maxY = b.maxY;
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

    const updateAllSelectedTransform = useCallback((patch: Partial<LayerTransform>) => {
        pushSnapshot();
        const ids = new Set(selectedLayerIdsRef.current);
        updateLayers((prev) => prev.map((l) => ids.has(l.id) && !l.locked ? { ...l, transform: { ...l.transform, ...patch } } : l));
    }, [updateLayers, pushSnapshot]);

    const alignAllSelected = useCallback((type: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
        pushSnapshot();
        const ids = new Set(selectedLayerIdsRef.current);
        updateLayers((prev) => prev.map((l) => {
            if (!ids.has(l.id) || l.locked) return l;
            const { width, height } = l.transform;
            let x = l.transform.x, y = l.transform.y;
            if (type === 'left') x = 0;
            if (type === 'center') x = (canvasWidth - width) / 2;
            if (type === 'right') x = canvasWidth - width;
            if (type === 'top') y = 0;
            if (type === 'middle') y = (canvasHeight - height) / 2;
            if (type === 'bottom') y = canvasHeight - height;
            return { ...l, transform: { ...l.transform, x, y } };
        }));
    }, [updateLayers, pushSnapshot, canvasWidth, canvasHeight]);

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

        // "First layer" = first VISUAL layer. Audio carries no dimensions and
        // must not count, so an image/video connected after an audio clip still
        // fits the canvas as if it were the first.
        const kinds = sourceKindByLayerIdRef.current;
        const visualCount = (cfg.layers || []).filter((l) => kinds[l.id] !== 'audio').length;
        const isFirstLayer = visualCount === 1;
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

    const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);
    const selectedLayerIdsRef = useRef<string[]>([]);
    selectedLayerIdsRef.current = selectedLayerIds;

    // Primary = last added; single-select surfaces (Timeline, single-layer
    // panel) key off this. Selection is LOCAL UI state and must NEVER be
    // written into currentWorkflow (project rule: selection must not churn the
    // store hot-path).
    const selectedLayerId = selectedLayerIds.length > 0 ? selectedLayerIds[selectedLayerIds.length - 1] : null;

    const selectLayer = useCallback((layerId: string, additive: boolean) => {
        setSelectedLayerIds((prev) => {
            if (additive) {
                return prev.includes(layerId) ? prev.filter((id) => id !== layerId) : [...prev, layerId];
            }
            return [layerId];
        });
    }, []);

    const clearSelection = useCallback(() => setSelectedLayerIds([]), []);

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
        setSelectedLayerIds((prev) => prev.filter((id) => id !== layerId));
    }, [nodeId]);
    const stageRef = useRef<any>(null);
    const transformerRef = useRef<any>(null);
    const stageContainerRef = useRef<HTMLDivElement>(null);

    // Group-drag bookkeeping: positions of every selected Konva node captured
    // at drag START (before any movement), so siblings can be shifted by the
    // dragged node's delta during the gesture and committed together on end.
    const groupDragRef = useRef<{ start: Map<string, { x: number; y: number }>; nodes: Map<string, any> } | null>(null);

    const [stageZoom, setStageZoom] = useState(1);
    // Timeline panel height — session-only; drag the top border to resize.
    const [timelineHeight, setTimelineHeight] = useState(260);
    const TIMELINE_MIN_H = 140;
    const TIMELINE_MAX_H = 560;
    const [stagePan, setStagePan] = useState({ x: VIEWPORT_PADDING, y: VIEWPORT_PADDING });
    const [isPanning, setIsPanning] = useState(false);
    const [spaceHeld, setSpaceHeld] = useState(false);

    // ---------- Canvas snapping (move + resize) ----------
    // Snap a layer's edges + center to the canvas borders (0, W/H) and the
    // canvas mid-lines (W/2, H/2), with a guide line drawn while a snap is live.
    // The threshold is in SCREEN pixels (constant feel regardless of zoom).
    const SNAP_THRESHOLD_PX = 6;
    const [snapGuides, setSnapGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
    // Compare-and-set guard: drag/resize fires many times per second but the
    // active guide set rarely changes — only re-render React when it does.
    const snapGuidesRef = useRef<{ v: number[]; h: number[] }>({ v: [], h: [] });
    const stageZoomRef = useRef(stageZoom);
    stageZoomRef.current = stageZoom;
    const canvasSizeRef = useRef({ w: canvasWidth, h: canvasHeight });
    canvasSizeRef.current = { w: canvasWidth, h: canvasHeight };

    const sameGuides = (a: { v: number[]; h: number[] }, b: { v: number[]; h: number[] }) =>
        a.v.length === b.v.length && a.h.length === b.h.length &&
        a.v.every((x, i) => x === b.v[i]) && a.h.every((y, i) => y === b.h[i]);

    const commitGuides = useCallback((guides: { v: number[]; h: number[] }) => {
        if (sameGuides(snapGuidesRef.current, guides)) return;
        snapGuidesRef.current = guides;
        setSnapGuides(guides);
    }, []);

    const clearGuides = useCallback(() => commitGuides({ v: [], h: [] }), [commitGuides]);

    // Snap a Konva node's axis-aligned box (in canvas coords) to the canvas
    // borders/mid-lines. Mutates the node's x/y to the snapped position and
    // returns the guide lines (canvas coords) to draw. Rotation/flip are ignored
    // for the test — the common case is unrotated layers, where snapping the
    // position attribute reads correctly.
    const snapNodeToCanvas = useCallback((node: any): { v: number[]; h: number[] } => {
        const zoom = stageZoomRef.current || 1;
        const thr = SNAP_THRESHOLD_PX / zoom;
        const { w: cw, h: ch } = canvasSizeRef.current;
        const w = node.width();
        const h = node.height();
        let x = node.x();
        let y = node.y();
        const guides: { v: number[]; h: number[] } = { v: [], h: [] };

        const snapAxis = (targets: number[], pos: number, size: number) => {
            let best: { target: number; off: number } | null = null;
            for (const target of targets) {
                for (const pt of [pos, pos + size / 2, pos + size]) {
                    const off = target - pt;
                    if (Math.abs(off) <= thr && (!best || Math.abs(off) < Math.abs(best.off))) {
                        best = { target, off };
                    }
                }
            }
            return best;
        };

        const vx = snapAxis([0, cw / 2, cw], x, w);
        if (vx) { x += vx.off; guides.v.push(vx.target); }
        const hy = snapAxis([0, ch / 2, ch], y, h);
        if (hy) { y += hy.off; guides.h.push(hy.target); }

        node.x(x);
        node.y(y);
        return guides;
    }, []);

    const startTimelineResize = useCallback((e: React.PointerEvent) => {
        e.preventDefault();
        const startY = e.clientY;
        const startH = timelineHeight;
        const onMove = (ev: PointerEvent) => {
            const next = Math.max(TIMELINE_MIN_H, Math.min(TIMELINE_MAX_H, startH + (startY - ev.clientY)));
            setTimelineHeight(next);
        };
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }, [timelineHeight]);

    // Stage pixel size, measured via ResizeObserver and held in state. Reading
    // `stageContainerRef.current.clientWidth` inline in the Stage props forced a
    // synchronous layout reflow on EVERY render — once per marquee mousemove,
    // which is a real per-frame cost. Measuring once and storing keeps render
    // pure (no layout thrash).
    const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
    useEffect(() => {
        const el = stageContainerRef.current;
        if (!el) return;
        const update = () => setStageSize({ width: el.clientWidth, height: el.clientHeight });
        update();
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // Marquee selection rectangle in CANVAS coords (null when not dragging).
    const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
    const marqueeRef = useRef<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
    marqueeRef.current = marquee;

    // Safety net: if the pointer is released outside the Konva stage, the
    // Stage's onMouseUp never fires — clear the rubber-band so it can't stick.
    useEffect(() => {
        if (!marquee) return;
        const onUp = () => setMarquee(null);
        window.addEventListener('mouseup', onUp);
        return () => window.removeEventListener('mouseup', onUp);
    }, [marquee]);

    // Convert the stage pointer position into canvas coordinates (undo the
    // stage pan/zoom) so marquee math is in the same space as layer transforms.
    const stagePointerToCanvas = useCallback(() => {
        const stage = stageRef.current;
        if (!stage) return null;
        const p = stage.getPointerPosition();
        if (!p) return null;
        return { x: (p.x - stage.x()) / stage.scaleX(), y: (p.y - stage.y()) / stage.scaleY() };
    }, []);

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

    // Audio reports only a duration (no dimensions). Record it for timeline
    // sizing but never auto-fit the canvas to it.
    const handleLayerAudioLoad = useCallback((layerId: string, duration: number) => {
        setIntrinsicDurations((prev) =>
            prev[layerId] === duration ? prev : { ...prev, [layerId]: duration || null }
        );
    }, []);

    // Per-layer source kind derived from renderable.resolved; the timeline
    // and renderer both want this so we compute once.
    const sourceKindByLayerId = useMemo(() => {
        const out: Record<string, LayerSourceKind> = {};
        renderable.forEach(({ layer, resolved }) => {
            out[layer.id] = detectSourceKind(resolved);
        });
        return out;
    }, [renderable]);
    // Ref mirror so applyIntrinsicFit (reads live store state, not renderable)
    // can exclude audio layers from the first-visual-layer count.
    const sourceKindByLayerIdRef = useRef(sourceKindByLayerId);
    sourceKindByLayerIdRef.current = sourceKindByLayerId;

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

    // Audio is temporal too — surface the timeline/transport when there's
    // video OR audio so an audio-only composition is still playable/scrubbable.
    const hasAudioLayer = useMemo(
        () => layers.some((l) => sourceKindByLayerId[l.id] === 'audio'),
        [layers, sourceKindByLayerId],
    );
    const hasTransport = hasVideoLayer || hasAudioLayer;

    const compositeBaseFill = resolveCompositeBaseFill(config.backgroundColor, hasVideoLayer);

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

    // Transport clock. Time advances in a ref via rAF and only commits to
    // React (~10Hz + on wrap/seek/pause) — the previous loop called
    // setPlayhead EVERY frame, re-rendering this entire modal (timeline,
    // panels, Konva tree) at ~60fps during playback, which was the dominant
    // cause of choppy playback and laggy dragging. Per-frame consumers
    // (Konva gating/seeks in LayerVideo/LayerSubgraph, the timeline playhead
    // line) subscribe to the clock directly.
    const clock = useTransportClock(totalDuration, setPlayhead);
    useEffect(() => {
        if (isPlaying) clock.play(); else clock.pause();
    }, [isPlaying, clock]);

    const handleSeek = useCallback((t: number) => {
        setIsPlaying(false);
        clock.pause();
        // Clamp a hair off the exact end: at t === totalDuration every clip's
        // `t < start + duration` window is closed, so nothing renders and the
        // canvas goes black. Half a frame back keeps the last clip's final
        // frame on screen (imperceptible position difference).
        const fps = config.fps || 30;
        const clamped = Math.max(0, Math.min(t, Math.max(0, totalDuration - 0.5 / fps)));
        clock.seek(clamped);
    }, [clock, totalDuration, config.fps]);

    const handleUpdateLayer = useCallback((layerId: string, patch: Partial<CompositorLayer>) => {
        updateLayers((prev) => prev.map((l) => l.id === layerId ? { ...l, ...patch } : l));
    }, [updateLayers]);

    /** Blade-cut the clip at the current playhead into two clips on the same row. */
    const handleSplitLayer = useCallback((layerId: string) => {
        const node = useAppStore.getState().currentWorkflow?.nodes.find((n) => n.id === nodeId);
        const cfg = (node?.data?.config as CompositorConfig) || initialConfig;
        const list = cfg.layers || [];
        const layer = list.find((l) => l.id === layerId);
        if (!layer) return;
        const kind = sourceKindByLayerId[layerId] ?? 'unknown';
        const intrinsic = intrinsicDurations[layerId] ?? null;
        const total = computeTimelineDuration(list, cfg.timelineDuration ?? null, intrinsicDurations);
        const eff = getEffectiveDuration(layer, kind, intrinsic, total);
        // Cut at the CLOCK's position, not the throttled React playhead — the
        // committed state can lag up to ~100ms during playback.
        const [left, right] = splitLayerAtPlayhead(layer, clock.getTime(), eff);
        if (!right) return; // playhead outside the clip — nothing to cut
        pushSnapshot();
        updateLayers((prev) => {
            const i = prev.findIndex((l) => l.id === layerId);
            if (i < 0) return prev;
            const copy = [...prev];
            copy.splice(i, 1, left, right);
            return copy;
        });
    }, [nodeId, initialConfig, sourceKindByLayerId, intrinsicDurations, clock, updateLayers, pushSnapshot]);

    /**
     * Delete a single clip. If other clips still share its source row, drop
     * just this layer (the edge/connection survives). If it is the LAST clip
     * on the row, remove the edge — the store cascade drops the layer and the
     * "row" disappears entirely (the "remove only when row completely deleted"
     * rule).
     */
    const handleDeleteClip = useCallback((layerId: string) => {
        const node = useAppStore.getState().currentWorkflow?.nodes.find((n) => n.id === nodeId);
        const cfg = (node?.data?.config as CompositorConfig) || initialConfig;
        const list = cfg.layers || [];
        const layer = list.find((l) => l.id === layerId);
        if (!layer) return;
        const siblings = list.filter((l) => l.sourceHandleId === layer.sourceHandleId);
        if (siblings.length > 1) {
            pushSnapshot();
            updateLayers((prev) => prev.filter((l) => l.id !== layerId));
            setSelectedLayerIds((prev) => prev.filter((id) => id !== layerId));
        } else {
            deleteSelectedLayer(layerId); // removes the edge; store strips the layer
        }
    }, [nodeId, initialConfig, updateLayers, deleteSelectedLayer, pushSnapshot]);

    /** Toggle a boolean flag across every clip sharing a source row. */
    const handleToggleRow = useCallback((sourceHandleId: string, field: 'visible' | 'locked' | 'muted') => {
        pushSnapshot();
        updateLayers((prev) => {
            const rowLayers = prev.filter((l) => l.sourceHandleId === sourceHandleId);
            if (rowLayers.length === 0) return prev;
            // Drive all clips to the negation of the FIRST clip's value, so the
            // row toggles as a unit even if clips drifted out of sync.
            const next = !rowLayers[0][field];
            return prev.map((l) => l.sourceHandleId === sourceHandleId ? { ...l, [field]: next } : l);
        });
    }, [updateLayers, pushSnapshot]);

    /** Remove an entire row (drops the upstream edge → all its clips). */
    const handleRemoveRow = useCallback((sourceHandleId: string) => {
        useAppStore.getState().onEdgesChange([{ id: sourceHandleId, type: 'remove' } as any]);
        setSelectedLayerIds([]);
    }, []);

    /** Commit a left-edge trim-in (startTime + duration + trimIn move together). */
    const handleTrimStart = useCallback((layerId: string, startTime: number, duration: number, trimIn: number) => {
        handleUpdateLayer(layerId, { startTime, duration, trimIn });
    }, [handleUpdateLayer]);

    // Lock aspect ratio for the Transformer's edge (middle) anchors. Corner
    // anchors already keep ratio via Konva's default `keepRatio`, but the
    // middle anchors normally resize a single axis. Here we drive the
    // perpendicular dimension from the dragged one (using the box's current
    // ratio) and re-center the box along that axis so it grows symmetrically
    // about the fixed edge's midpoint. Box coords are post-rotation, so the
    // recentering shift is applied along the box's rotated local axes
    // (rotation is in radians). Returning `null`/`undefined` falls back to
    // the unmodified box (corner anchors, no active anchor).
    const keepRatioBoundBox = useCallback((oldBox: any, newBox: any) => {
        const anchor = transformerRef.current?.getActiveAnchor?.();
        const horizontal = anchor === 'middle-left' || anchor === 'middle-right';
        const vertical = anchor === 'top-center' || anchor === 'bottom-center';

        const box: any = { ...newBox };

        // Aspect-lock the edge (middle) anchors — corner anchors already keep
        // ratio via Konva's `keepRatio`. (Unchanged from before; just no longer
        // an early return so snapping below applies to every anchor.)
        if ((horizontal || vertical) && oldBox.width !== 0 && oldBox.height !== 0) {
            const ratio = oldBox.width / oldBox.height; // width / height
            const rad = newBox.rotation || 0;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            if (horizontal) {
                const newHeight = Math.abs(box.width) / ratio;
                const dh = newHeight - box.height;
                box.height = newHeight;
                box.x += (dh / 2) * sin;
                box.y -= (dh / 2) * cos;
            } else {
                const newWidth = Math.abs(box.height) * ratio;
                const dw = newWidth - box.width;
                box.width = newWidth;
                box.x -= (dw / 2) * cos;
                box.y -= (dw / 2) * sin;
            }
        }

        // Snap the box edges + center to the canvas borders/mid-lines. boundBox
        // coords are ABSOLUTE (stage-transformed), so convert the canvas targets
        // into that space (threshold stays in screen px → constant feel). Only
        // for unrotated boxes — the snap test is axis-aligned. Snapping releases
        // aspect ratio at the snapped edge (the expected "stick to the border"
        // behavior).
        const stage = stageRef.current;
        if (stage && !box.rotation) {
            const zoom = stage.scaleX() || 1;
            const panX = stage.x();
            const panY = stage.y();
            const { w: cw, h: ch } = canvasSizeRef.current;
            const thr = SNAP_THRESHOLD_PX;
            const guides: { v: number[]; h: number[] } = { v: [], h: [] };

            const vAbs = [0, cw / 2, cw].map((c) => panX + c * zoom);
            const left = box.x, right = box.x + box.width, cx = box.x + box.width / 2;
            let bx: { target: number; off: number; kind: 'l' | 'c' | 'r' } | null = null;
            for (const target of vAbs) {
                for (const ref of [{ pt: left, kind: 'l' as const }, { pt: cx, kind: 'c' as const }, { pt: right, kind: 'r' as const }]) {
                    const off = target - ref.pt;
                    if (Math.abs(off) <= thr && (!bx || Math.abs(off) < Math.abs(bx.off))) bx = { target, off, kind: ref.kind };
                }
            }
            if (bx) {
                if (bx.kind === 'l') { box.width = right - bx.target; box.x = bx.target; }
                else if (bx.kind === 'r') { box.width = bx.target - box.x; }
                else { box.x = bx.target - box.width / 2; }
                guides.v.push((bx.target - panX) / zoom);
            }

            const hAbs = [0, ch / 2, ch].map((c) => panY + c * zoom);
            const top = box.y, bottom = box.y + box.height, cy = box.y + box.height / 2;
            let by: { target: number; off: number; kind: 't' | 'c' | 'b' } | null = null;
            for (const target of hAbs) {
                for (const ref of [{ pt: top, kind: 't' as const }, { pt: cy, kind: 'c' as const }, { pt: bottom, kind: 'b' as const }]) {
                    const off = target - ref.pt;
                    if (Math.abs(off) <= thr && (!by || Math.abs(off) < Math.abs(by.off))) by = { target, off, kind: ref.kind };
                }
            }
            if (by) {
                if (by.kind === 't') { box.height = bottom - by.target; box.y = by.target; }
                else if (by.kind === 'b') { box.height = by.target - box.y; }
                else { box.y = by.target - box.height / 2; }
                guides.h.push((by.target - panY) / zoom);
            }

            commitGuides(guides);
        }

        // A snap can shrink an edge past the opposite one — clamp to a min size.
        if (box.width < 5) box.width = 5;
        if (box.height < 5) box.height = 5;
        return box;
    }, [commitGuides]);

    // Wire the Konva Transformer to every selected (unlocked) Konva node by
    // name, so one bounding box wraps the whole multi-selection.
    useEffect(() => {
        const tr = transformerRef.current;
        const stage = stageRef.current;
        if (!tr || !stage) return;
        const lockedIds = new Set(layers.filter((l) => l.locked).map((l) => l.id));
        const ids = selectedLayerIds.filter((id) => !lockedIds.has(id));
        if (ids.length === 0) {
            tr.nodes([]);
            tr.getLayer()?.batchDraw();
            return;
        }
        const nodes = ids
            .map((lid) => stage.findOne(`.img-${lid}`))
            .filter((n: any) => !!n);
        tr.nodes(nodes);
        tr.getLayer()?.batchDraw();
    }, [selectedLayerIds, renderable, layers]);

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
            // Firewall: keep the workflow canvas's global chords from firing
            // behind the editor (the editor owns its OWN undo/redo locally). We
            // stop only these specific chords so the modal's own inputs still
            // receive every other key. Editable targets inside the modal are
            // exempted so typing a literal 'z'/'y'/'g' isn't swallowed.
            const tgt = e.target as HTMLElement | null;
            const tag = tgt?.tagName;
            const editable = tag === 'INPUT' || tag === 'TEXTAREA' || tgt?.isContentEditable === true;
            const mod = e.metaKey || e.ctrlKey;
            const k = e.key.toLowerCase();
            if (!editable && mod && (k === 'z' || k === 'y' || k === 'g')) {
                e.stopImmediatePropagation();
            }
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
                const ids = selectedLayerIdsRef.current;
                if (ids.length === 0) return;
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                // Route through handleDeleteClip (NOT deleteSelectedLayer): the
                // latter removes the upstream edge, which the store cascades into
                // dropping EVERY clip sharing that sourceHandleId — so deleting one
                // half of a split clip wiped both. handleDeleteClip removes just the
                // selected clip while siblings remain, and only drops the edge when
                // it's the last clip on the row. Each call re-reads fresh store state,
                // so multi-select on one row deletes clips one at a time correctly
                // (last call sees a single sibling → removes the edge).
                ids.forEach((lid) => handleDeleteClip(lid));
            }
        };
        const onKeyUp = (e: KeyboardEvent) => { if (e.code === 'Space') { setSpaceHeld(false); setIsPanning(false); } };
        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('keyup', onKeyUp);
        return () => { window.removeEventListener('keydown', onKeyDown, true); window.removeEventListener('keyup', onKeyUp); };
    }, [localUndo, localRedo, handleDeleteClip]);

    // Snapshot once at the start of an interaction (drag/transform). The
    // checkpoint goes to LOCAL history only — outside-the-modal Ctrl+Z is
    // unaffected. setIsDragging keeps the small-canvas preview from doing
    // expensive work mid-gesture.
    const handleInteractStart = useCallback(() => {
        pushSnapshot();
        setIsDragging(true);
        // Snapshot positions of all selected nodes up front (pre-movement) so a
        // multi-selection moves in lockstep. Single selection => no group ref.
        const sel = selectedLayerIdsRef.current;
        if (sel.length < 2) { groupDragRef.current = null; return; }
        const stage = stageRef.current;
        if (!stage) { groupDragRef.current = null; return; }
        const cfg = useAppStore.getState().currentWorkflow?.nodes.find((n) => n.id === nodeId)?.data?.config as CompositorConfig | undefined;
        const lockedIds = new Set((cfg?.layers || []).filter((l) => l.locked).map((l) => l.id));
        // Cache both start positions AND the live Konva node references up
        // front, so the per-frame drag handler never has to `findOne` (a tree
        // search) for each sibling on every mousemove.
        const start = new Map<string, { x: number; y: number }>();
        const nodes = new Map<string, any>();
        for (const lid of sel) {
            if (lockedIds.has(lid)) continue;
            const node = stage.findOne(`.img-${lid}`);
            if (node) { start.set(lid, { x: node.x(), y: node.y() }); nodes.set(lid, node); }
        }
        groupDragRef.current = { start, nodes };
    }, [pushSnapshot, setIsDragging]);

    const handleLayerDragMove = useCallback((layerId: string, _pos: { x: number; y: number }) => {
        const stage = stageRef.current;
        const gd = groupDragRef.current;
        // The anchor is the node Konva is actively dragging (single OR group).
        const anchor = gd?.nodes.get(layerId) || stage?.findOne(`.img-${layerId}`);
        if (!anchor) return;

        // Snap the anchor to the canvas borders/mid-lines (mutates its x/y).
        commitGuides(snapNodeToCanvas(anchor));

        // Group drag: shift every sibling by the SNAPPED anchor's delta so the
        // whole selection follows the snap in lockstep.
        if (gd) {
            const anchorStart = gd.start.get(layerId);
            if (anchorStart) {
                const dx = anchor.x() - anchorStart.x;
                const dy = anchor.y() - anchorStart.y;
                for (const [lid, s] of gd.start) {
                    if (lid === layerId) continue;
                    const node = gd.nodes.get(lid);
                    if (node) { node.x(s.x + dx); node.y(s.y + dy); }
                }
            }
        }
        // Redraw ONLY the content layer the moved nodes live on. A stage-wide
        // batchDraw here repainted the static chrome layer too — including the
        // 100px shadowBlur rect that was split onto its own layer precisely to
        // keep it out of per-drag-frame paints.
        anchor.getLayer()?.batchDraw();
    }, [commitGuides, snapNodeToCanvas]);

    const handleInteractEnd = useCallback(() => {
        setIsDragging(false);
        clearGuides(); // drop any snap guide lines from the just-ended gesture
        const gd = groupDragRef.current;
        groupDragRef.current = null;
        if (!gd) return;
        const stage = stageRef.current;
        if (!stage) return;
        // Read final positions of every selected node and commit in one write.
        // (The anchor's own onDragEnd also committed its x/y; this is the
        // authoritative batch that includes the siblings too.)
        // Iterate gd.start (the captured group) — not the live selection, which
        // may have collapsed to just the anchor if the drag triggered onSelect.
        const updates = new Map<string, { x: number; y: number }>();
        for (const [lid, node] of gd.nodes) {
            if (node) updates.set(lid, { x: node.x(), y: node.y() });
        }
        if (updates.size === 0) return;
        updateLayers((prev) => prev.map((l) => {
            const u = updates.get(l.id);
            return u ? { ...l, transform: { ...l.transform, x: u.x, y: u.y } } : l;
        }));
    }, [setIsDragging, updateLayers, clearGuides]);

    const selectedLayer = useMemo(() => layers.find((l) => l.id === selectedLayerId) || null, [layers, selectedLayerId]);
    const selectedEdge = useMemo(
        () => selectedLayer ? layerEdges.find((e) => e.id === selectedLayer.sourceHandleId) : null,
        [selectedLayer, layerEdges]
    );
    const selectedSourceType = selectedEdge ? nodeTypesBySource[selectedEdge.source] : undefined;
    const isTextLayer = selectedSourceType === 'prompt';

    const dimmerPathData = `M -99999 -99999 L 99999 -99999 L 99999 99999 L -99999 99999 Z M 0 0 L 0 ${canvasHeight} L ${canvasWidth} ${canvasHeight} L ${canvasWidth} 0 Z`;

    return (
        // No backdrop-filter anywhere in this modal: a blur ancestor over a
        // 60fps canvas forces per-frame re-rasterization and throttles
        // <video> descendants in Chromium (twice root-caused in this app).
        // The modal covers 96vw×92vh, so the frosted backdrop was invisible
        // anyway — near-opaque fills read the same and paint for free.
        <div className="fixed inset-0 z-[100000] bg-black/70 flex items-center justify-center pointer-events-auto">
            <div className="bg-surface-primary/[0.98] border border-white/10 rounded-2xl shadow-2xl w-[96vw] h-[92vh] flex flex-col overflow-hidden">
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
                        {onDownload && (
                            <button
                                onClick={() => { if (downloadState !== 'rendering') onDownload(); }}
                                disabled={downloadState === 'rendering'}
                                className={cn(
                                    'px-5 py-2 rounded-xl font-black text-xs uppercase tracking-widest transition-all flex items-center gap-2 border',
                                    downloadState === 'error'
                                        ? 'bg-red-500/15 border-red-400/30 text-red-300'
                                        : 'bg-white/5 border-white/10 text-white/80 hover:bg-white/10 hover:text-white',
                                    downloadState === 'rendering' && 'opacity-70 cursor-wait',
                                )}
                                title="Render and download this composition"
                            >
                                {downloadState === 'rendering' ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    : downloadState === 'success' ? <Check className="w-3.5 h-3.5 text-emerald-400" />
                                    : downloadState === 'error' ? <AlertCircle className="w-3.5 h-3.5" />
                                    : <Download className="w-3.5 h-3.5" />}
                                {downloadState === 'rendering' ? 'Rendering…' : 'Download'}
                            </button>
                        )}
                        <button onClick={onClose} className="px-6 py-2 rounded-xl bg-accent-primary text-white font-black text-xs shadow-lg shadow-accent-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all uppercase tracking-widest">Done</button>
                    </div>
                </div>

                {/* Main Content (canvas + side panels) */}
                <div className="flex-1 flex overflow-hidden min-h-0">
                    {/* Left Panel - Layers */}
                    <div className="w-56 border-r border-white/5 flex flex-col bg-white/5">
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
                                            displayName={layerNames[layer.id]}
                                            isSelected={selectedLayerIds.includes(layer.id)}
                                            type={type}
                                            onSelect={selectLayer}
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
                    <div ref={stageContainerRef} className="flex-1 relative bg-[#1c1c20] overflow-hidden" style={{ cursor: (spaceHeld || tool === 'pan') ? (isPanning ? 'grabbing' : 'grab') : 'default' }}>
                        <Stage
                            ref={stageRef}
                            width={stageSize.width || window.innerWidth}
                            height={stageSize.height || window.innerHeight}
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
                            onMouseDown={(e) => {
                                const clickedEmpty = e.target === e.target.getStage() || e.target.name() === 'background';
                                if (!clickedEmpty) return;             // clicks on a layer are handled by the layer
                                if (spaceHeld || tool === 'pan') return; // panning, not marqueeing
                                const c = stagePointerToCanvas();
                                if (!c) { clearSelection(); return; }
                                if (!(e.evt.ctrlKey || e.evt.metaKey)) clearSelection(); // plain marquee replaces
                                setMarquee({ x1: c.x, y1: c.y, x2: c.x, y2: c.y });
                            }}
                            onMouseMove={() => {
                                if (!marqueeRef.current) return;
                                const c = stagePointerToCanvas();
                                if (!c) return;
                                setMarquee((m) => (m ? { ...m, x2: c.x, y2: c.y } : m));
                            }}
                            onMouseUp={(e) => {
                                const m = marqueeRef.current;
                                if (!m) return;
                                setMarquee(null);
                                const box = { minX: Math.min(m.x1, m.x2), minY: Math.min(m.y1, m.y2), maxX: Math.max(m.x1, m.x2), maxY: Math.max(m.y1, m.y2) };
                                // Treat a click-sized box as a plain click (selection already cleared on mousedown).
                                if (Math.abs(m.x2 - m.x1) < 3 && Math.abs(m.y2 - m.y1) < 3) return;
                                const additive = e.evt.ctrlKey || e.evt.metaKey;
                                const hitIds = layers.filter((l) => l.visible && !l.locked && rectsIntersect(layerAABB(l), box)).map((l) => l.id);
                                setSelectedLayerIds((prev) => additive ? Array.from(new Set([...prev, ...hitIds])) : hitIds);
                            }}
                        >
                            {/* Static chrome layer: the canvas drop-shadow. A 100px
                                shadow blur over a canvas-sized rect is the single most
                                expensive paint here. On its OWN layer it is painted only
                                when the canvas size/fill or stage transform changes — NOT
                                on every drag/transform/marquee frame (those redraw only the
                                interactive layer below), which was the dominant editor lag. */}
                            <Layer listening={false}>
                                <Rect x={0} y={0} width={canvasWidth} height={canvasHeight} fill={compositeBaseFill ?? '#121212'} stroke="rgba(255,255,255,0.05)" strokeWidth={1} shadowColor="black" shadowBlur={100} shadowOpacity={0.5} />
                            </Layer>
                            <Layer>
                                {/* Flat blend base (NO shadow) — must live on the SAME layer
                                    as the layer nodes so blend modes composite against it. */}
                                <Rect name="background" x={0} y={0} width={canvasWidth} height={canvasHeight} fill={compositeBaseFill ?? '#121212'} />
                                <CompositorLayerNodes
                                    layers={renderable}
                                    interactive
                                    selectedLayerIds={selectedLayerIds}
                                    onSelectLayer={selectLayer}
                                    onTransformLayer={updateTransform}
                                    onLayerImageLoad={handleImageLoad}
                                    onLayerVideoLoad={handleLayerVideoLoad}
                                    onInteractStart={handleInteractStart}
                                    onInteractEnd={handleInteractEnd}
                                    onLayerDragMove={handleLayerDragMove}
                                    playhead={playhead}
                                    isPlaying={isPlaying}
                                    muted={audioMuted}
                                    intrinsicDurations={intrinsicDurations}
                                    clock={clock}
                                    // Distinct from the card's `poolKey={nodeId}` so the editor
                                    // gets its own decoders. Pull-model surfaces (LayerSubgraph)
                                    // seek the pool element every frame when paused; sharing
                                    // a poolKey with a simultaneously-playing card caused both
                                    // surfaces to fight over `el.currentTime` and render mostly
                                    // empty frames in the editor.
                                    poolKey={`${nodeId}__editor`}
                                />
                            </Layer>
                            {/* Overlay chrome on its OWN layer: the dimmer path,
                                marquee, and Transformer used to share the content
                                layer, so every video frame repainted the full-stage
                                even-odd dimmer fill + Transformer, and every
                                drag/marquee frame repainted all the videos. Split,
                                each redraw touches only what changed. */}
                            <Layer>
                                <Path data={dimmerPathData} fill="rgba(0,0,0,0.7)" fillRule="evenodd" listening={false} />
                                {marquee && (
                                    <Rect
                                        x={Math.min(marquee.x1, marquee.x2)}
                                        y={Math.min(marquee.y1, marquee.y2)}
                                        width={Math.abs(marquee.x2 - marquee.x1)}
                                        height={Math.abs(marquee.y2 - marquee.y1)}
                                        fill="rgba(0,242,234,0.12)"
                                        stroke="#00F2EA"
                                        strokeWidth={1 / stageZoom}
                                        dash={[4 / stageZoom, 4 / stageZoom]}
                                        listening={false}
                                    />
                                )}
                                {selectedLayerIds.some((lid) => {
                                    const l = layers.find((x) => x.id === lid);
                                    return l && !l.locked;
                                }) && (
                                    <Transformer ref={transformerRef} flipEnabled={false} keepRatio boundBoxFunc={keepRatioBoundBox} borderStroke="#00F2EA" anchorStroke="#00F2EA" anchorFill="#00F2EA" anchorSize={8} borderDash={[3, 3]} />
                                )}
                                {/* Canvas snap guides — thin dashed lines shown only
                                    while a move/resize is hitting a border or mid-line.
                                    Drawn full canvas-length; stroke is zoom-compensated
                                    so the line stays hairline at any zoom. */}
                                {snapGuides.v.map((vx, i) => (
                                    <Line key={`snap-v-${i}`} points={[vx, 0, vx, canvasHeight]} stroke="#00F2EA" strokeWidth={1 / stageZoom} dash={[5 / stageZoom, 5 / stageZoom]} opacity={0.9} listening={false} />
                                ))}
                                {snapGuides.h.map((hy, i) => (
                                    <Line key={`snap-h-${i}`} points={[0, hy, canvasWidth, hy]} stroke="#00F2EA" strokeWidth={1 / stageZoom} dash={[5 / stageZoom, 5 / stageZoom]} opacity={0.9} listening={false} />
                                ))}
                            </Layer>
                        </Stage>

                        {/* Headless audio playback for audio layers (no Konva
                            visual). Mounted beside the Stage; follows the
                            editor's playhead/transport. */}
                        <CompositorAudio
                            layers={renderable}
                            playhead={playhead}
                            isPlaying={isPlaying}
                            muted={audioMuted}
                            intrinsicDurations={intrinsicDurations}
                            onAudioLoad={handleLayerAudioLoad}
                        />

                        {/* TOOLBOX */}
                        {/* No backdrop-blur here: this toolbox floats OVER the playing
                            Stage, so a blur would re-rasterize on every canvas frame. */}
                        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-1.5 rounded-lg bg-surface-elevated/95 border border-stroke-subtle shadow-xl z-50">
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
                    <div className="w-96 border-l border-white/5 flex flex-col bg-white/5 overflow-hidden shadow-2xl">
                        <div className="p-4 border-b border-white/5 bg-white/5 font-black text-[10px] uppercase tracking-[0.2em] text-white/30 flex items-center gap-2">
                            <Plus className="w-3 h-3" /> Properties
                        </div>

                        {selectedLayerIds.length > 1 ? (
                            <MultiLayerProperties
                                layers={layers.filter((l) => selectedLayerIds.includes(l.id))}
                                onUpdateAll={updateAllSelectedTransform}
                                onAlignAll={alignAllSelected}
                            />
                        ) : selectedLayer ? (
                            <div className="flex-1 overflow-y-auto p-4 space-y-8 custom-scrollbar pb-20">
                                {/* Section: Typography (Conditional) — surfaced first for text layers */}
                                {isTextLayer && (
                                    <div className="space-y-4">
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

                {/* Timeline panel — mounted when temporal content (video OR
                    audio) is on the canvas. Image/text-only compositions don't
                    need a transport bar. */}
                {hasTransport && (
                    <div
                        className="flex-shrink-0 border-t border-white/10 relative"
                        style={{ height: timelineHeight }}
                    >
                        <div
                            className="absolute -top-1 left-0 right-0 h-2 cursor-ns-resize z-30 group"
                            onPointerDown={startTimelineResize}
                            title="Drag to resize timeline"
                        >
                            <div className="absolute top-1 left-0 right-0 h-px bg-transparent group-hover:bg-accent-primary/60 transition-colors" />
                        </div>
                        <Timeline
                            layers={layers}
                            layerNames={layerNames}
                            sourceKindByLayerId={sourceKindByLayerId}
                            intrinsicDurations={intrinsicDurations}
                            configuredTotalDuration={config.timelineDuration ?? null}
                            fps={config.fps || 30}
                            playhead={playhead}
                            clock={clock}
                            isPlaying={isPlaying}
                            audioMuted={audioMuted}
                            selectedLayerId={selectedLayerId}
                            onTogglePlay={() => setIsPlaying((p) => !p)}
                            onSeek={handleSeek}
                            onToggleAudioMute={() => setAudioMuted((m) => !m)}
                            onSelectLayer={(id) => selectLayer(id, false)}
                            onUpdateLayer={handleUpdateLayer}
                            onTrimStart={handleTrimStart}
                            onSplitLayer={handleSplitLayer}
                            onDeleteClip={handleDeleteClip}
                            onToggleRow={handleToggleRow}
                            onRemoveRow={handleRemoveRow}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
