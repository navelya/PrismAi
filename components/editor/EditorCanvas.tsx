'use client';

import React, { useCallback, useRef, useEffect, useMemo, useState } from 'react';
import ReactFlow, {
    NodeMouseHandler,
    ReactFlowProvider,
    Edge,
    Node,
    NodeDragHandler,
    NodeChange,
    getIncomers,
    getOutgoers,
    getConnectedEdges,
    Connection,
    Panel,
    useReactFlow,
    useNodesInitialized,
    applyNodeChanges,
    NodeToolbar,
    Position,
    SelectionMode,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { BaseGridLayers, SpotlightGridLayers } from './canvas/GridLayers';
import { CanvasToolbar } from './canvas/CanvasToolbar';
import { NodeType } from '@/lib/nodes/types';
import { useAppStore } from '@/lib/store/app-store';
import { Trash2, Copy, Group as GroupIcon, Ungroup as UngroupIcon, Download } from 'lucide-react';
import { autoLayoutNodesAsync } from '@/lib/utils/graph-layout';
import CanvasContextMenu from './CanvasContextMenu';
import { Tooltip } from '@/components/ui/Tooltip';
import { Toast } from '@/components/ui/Toast';
import { collectNodeMediaBlobs, triggerBlobDownload, type DownloadItem } from '@/lib/workflow/download-output';
import { getDownloadHandler } from '@/lib/workflow/download-registry';
import { extractMediaUrls } from '@/lib/workflow/result-format';
import JSZip from 'jszip';
import { stableNodeTypes, stableEdgeTypes } from './reactflow-types';
import { useTheme } from '@/components/theme/ThemeProvider';
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';
import {
    PendingConnection,
    getNodeHandleType,
    typesAreCompatible,
    findHandleForNode,
    wouldCreateCycle,
} from '@/lib/editor/handle-compatibility';
import { WireDragProvider, type WireDragState } from '@/lib/editor/wire-drag-context';

// Stable references for <ReactFlow> object props — see
// https://reactflow.dev/learn/advanced-use/performance. Hoisted to module
// scope so they never change identity across renders.
const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 0.8 } as const;
const FIT_VIEW_OPTIONS = { padding: 0.3, maxZoom: 0.8 } as const;
const PRO_OPTIONS = { hideAttribution: true } as const;
// Hoisted so the panOnDrag prop is reference-stable across renders — React
// Flow re-binds pointer handlers when this prop changes identity.
const PAN_ON_DRAG_PAN: number[] = [0, 1];
const PAN_ON_DRAG_SELECT: number[] = [1];
const preventDefault = (e: React.DragEvent) => e.preventDefault();

/**
 * Sanitize an arbitrary string (workflow name, label) into a filesystem-safe
 * filename stem. Returns an empty string for null/empty inputs so the caller
 * can fall back to a default name.
 */
function sanitizeFsName(name: string | null | undefined): string {
    if (!name) return '';
    return name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase().replace(/^-+|-+$/g, '').slice(0, 64);
}

/**
 * Deduplicate zip entry names. If `name` is already in `used`, insert an
 * incrementing `-2`, `-3`, … suffix before the extension. Mutates `used` to
 * include the chosen final name.
 */
function uniqueZipName(name: string, used: Set<string>): string {
    if (!used.has(name)) {
        used.add(name);
        return name;
    }
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let i = 2;
    while (used.has(`${stem}-${i}${ext}`)) i++;
    const next = `${stem}-${i}${ext}`;
    used.add(next);
    return next;
}

interface EditorCanvasProps {
    nodes: any[];
    edges: any[];
    onNodesChange: any;
    onEdgesChange: any;
    onConnect: any;
    onNodeClick?: NodeMouseHandler;
    onDrop: (
        type: NodeType,
        position: { x: number; y: number },
        nodeTypeId?: string,
        modelId?: number,
        initialConfig?: Record<string, any>,
        autoConnect?: PendingConnection,
    ) => void;
    updatePositions?: (positions: Map<string, { x: number; y: number }>) => void;
    // Undo/Redo Props
    undo?: () => void;
    redo?: () => void;
    canUndo?: boolean;
    canRedo?: boolean;
    // Drag Handlers
    onNodeDragStart?: (event: React.MouseEvent, node: Node, nodes: Node[]) => void;
    onNodeDragStop?: (event: React.MouseEvent, node: Node, nodes: Node[]) => void;
    // Action Handlers
    onDuplicate?: (nodes: Node[], edges: Edge[]) => void;
    onDelete?: (nodeIds: string[]) => void;
    onCopy?: (nodeId: string) => void;
    onPaste?: () => void;
    // Fires once after React Flow has measured all nodes AND the first paint
    // has committed — used by the parent to dismiss a covering loader so the
    // user never sees the canvas pop in unfurnished.
    onCanvasReady?: () => void;
}

const EditorCanvasInner = ({
    nodes: propNodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    onNodeClick,
    onDrop,
    updatePositions,
    undo,
    redo,
    canUndo,
    canRedo,
    onNodeDragStart,
    onNodeDragStop,
    onDuplicate,
    onDelete,
    onCanvasReady,
}: EditorCanvasProps) => {
    const reactFlowWrapper = useRef<HTMLDivElement>(null);
    const [reactFlowInstance, setReactFlowInstance] = React.useState<any>(null);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
    const [pendingConnection, setPendingConnection] = useState<PendingConnection | null>(null);
    // Screen-space anchor for the source handle of the dragged wire — used to
    // draw a static line from the handle to the open menu while the user picks.
    const [pendingWireAnchor, setPendingWireAnchor] = useState<{ x: number; y: number } | null>(null);
    // Node that's mid-positioning after a wire drop. Rendered with visibility:
    // hidden via the injected <style> below until we measure its handle and
    // shift it so the handle lands exactly under the original drop point.
    const [positioningNodeId, setPositioningNodeId] = useState<string | null>(null);
    // Holds the in-flight connection origin between onConnectStart and onConnectEnd.
    const connectStartRef = useRef<{ nodeId: string; handleId: string | null; handleType: 'source' | 'target' } | null>(null);
    const [wireDrag, setWireDrag] = useState<WireDragState>(null);
    // Timestamp of the last wire-drop menu open. React Flow can fire onPaneClick
    // right after a wire drop on the pane — ignore those clicks for a short window
    // so they don't immediately close the menu we just opened.
    const wireDropOpenedAtRef = useRef<number>(0);
    const [isPanMode, setIsPanMode] = useState(false);
    const [isMouseActive, setIsMouseActive] = useState(false);

    // 🚀 THE CORE FIX: Local state for nodes during interaction
    const [localNodes, setLocalNodes] = useState(propNodes);

    // Sync local nodes when prop nodes change externally (but NOT while dragging)
    const isDraggingRef = useRef(false);
    useEffect(() => {
        if (!isDraggingRef.current) {
            setLocalNodes(propNodes);
        }
    }, [propNodes]);

    // ── Canvas-ready signal ──────────────────────────────────────────────
    // useNodesInitialized() flips true once every node has been measured by
    // RF's resize observer (width/height set on the internal node record).
    // That's the canonical "nodes have a real layout" signal — it covers the
    // gap between data-loaded and visually-rendered that a plain isLoading
    // flag misses. Combined with one rAF afterwards to guarantee the first
    // paint has actually committed before we tell the parent to dismiss the
    // covering loader. Fires at most once per mount.
    //
    // Two subtleties that bit us before:
    //   1. onCanvasReady is inlined by the parent so its identity changes
    //      every render. Keeping it out of the deps (via a latest-ref) stops
    //      unrelated parent re-renders from re-running this effect and
    //      cancelling the pending rAF.
    //   2. The "fired" flag flips inside the rAF, not before it. If something
    //      (e.g. a node added/removed mid-flight) does invalidate the rAF,
    //      we want a subsequent run to retry — locking before the call could
    //      strand us with the flag set but the callback never actually fired.
    const nodesInitialized = useNodesInitialized();
    const hasFiredReadyRef = useRef(false);
    const onCanvasReadyRef = useRef(onCanvasReady);
    onCanvasReadyRef.current = onCanvasReady;
    // RF's useNodesInitialized() returns false for an empty node array (its
    // internal check is `nodes.every(measured) && nodes.length > 0`), so an
    // empty workflow would otherwise leave the loader spinning forever. Treat
    // a zero-node canvas as immediately ready — there's nothing to measure.
    const hasNodesToMeasure = localNodes.length > 0;
    useEffect(() => {
        if (hasFiredReadyRef.current) return;
        if (!reactFlowInstance) return;
        if (hasNodesToMeasure && !nodesInitialized) return;
        const raf = requestAnimationFrame(() => {
            hasFiredReadyRef.current = true;
            onCanvasReadyRef.current?.();
        });
        return () => cancelAnimationFrame(raf);
    }, [nodesInitialized, reactFlowInstance, hasNodesToMeasure]);

    // One-shot smooth fit-to-node when something elsewhere (e.g. the Run
    // Workflow error popover) sets `pendingCenterNodeId`. We pan + zoom-to-fit
    // the single node, select it, and clear the field.
    const pendingCenterNodeId = useAppStore((s) => s.pendingCenterNodeId);
    const clearPendingCenterNodeId = useAppStore((s) => s.clearPendingCenterNodeId);
    useEffect(() => {
        if (!pendingCenterNodeId || !reactFlowInstance) return;
        const node = reactFlowInstance.getNode(pendingCenterNodeId);
        if (!node) {
            clearPendingCenterNodeId();
            return;
        }
        // fitView with a single-node selection both pans AND zooms so the
        // node fills the viewport (modulo padding). maxZoom caps the zoom so
        // a tiny node doesn't pull the camera uncomfortably close.
        reactFlowInstance.fitView({
            nodes: [{ id: pendingCenterNodeId }],
            duration: 500,
            padding: 0.5,
            maxZoom: 1.5,
        });
        // Mirror click-to-select: clear other selections, select the target.
        reactFlowInstance.setNodes((nds: any[]) =>
            nds.map((n) => ({ ...n, selected: n.id === pendingCenterNodeId })),
        );
        clearPendingCenterNodeId();
    }, [pendingCenterNodeId, reactFlowInstance, clearPendingCenterNodeId]);

    const { resolvedTheme } = useTheme();

    const edgeStyle = useMemo(() => ({
        strokeWidth: 2,
        stroke: 'rgb(var(--canvas-edge))',
        cursor: 'pointer',
    }), [resolvedTheme]);

    // Stable id array for the multi-select toolbar's nodeId prop. Recomputed only
    // when the selected set changes — without this, every render of localNodes
    // (drag, hover, etc.) would produce a fresh array, churning NodeToolbar's
    // internal store subscription and risking remounts mid-click.
    const selectedNodeIds = useMemo(
        () => localNodes.filter(n => n.selected).map(n => n.id),
        // Depend on a stable string key built from sorted ids so we don't
        // re-create the array when the underlying nodes' positions change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [localNodes.filter(n => n.selected).map(n => n.id).sort().join('|')],
    );

    const handleDuplicateSelected = useCallback(() => {
        const rfNodes = reactFlowInstance?.getNodes() ?? localNodes;
        const directlySelected = rfNodes.filter((n: any) => n.selected);
        if (!onDuplicate || directlySelected.length === 0) return;

        // If any selected node is a group, fold its children into the duplication
        // set so the group + its contents move as one bundle.
        const expandedSet = new Map<string, any>();
        directlySelected.forEach((n: any) => expandedSet.set(n.id, n));
        for (const sel of directlySelected) {
            if (sel.type === 'group_container') {
                const children = rfNodes.filter((n: any) => n.parentNode === sel.id);
                children.forEach((c: any) => expandedSet.set(c.id, c));
            }
        }
        const selectedNodes = Array.from(expandedSet.values());
        const selectedNodeIdSet = new Set(selectedNodes.map((n: any) => n.id));

        // Filter the raw edges (not memoizedEdges, which carry runtime style fields).
        const selectedEdges = (edges || []).filter((e: any) =>
            selectedNodeIdSet.has(e.source) && selectedNodeIdSet.has(e.target)
        );

        // Clone with fresh ids, remap edge endpoints, and remap parentNode refs
        // so duplicated children point at the duplicated group, not the original.
        const idMap = new Map<string, string>();
        const stamp = Date.now();
        const newNodes = selectedNodes.map((n: any, i: number) => {
            const newId = (n.type === 'group_container' ? 'group_' : 'node_')
                + `${stamp}_${i}_${Math.random().toString(36).slice(2, 8)}`;
            idMap.set(n.id, newId);
            const { width: _w, height: _h, positionAbsolute: _pa, dragging: _dr, ...rest } = n as any;
            // For non-group nodes, original copy logic offsets by +40,+40. For
            // group children, we keep the relative position (since their parent
            // is also being duplicated and itself shifts by +40,+40).
            const offset = n.parentNode ? { x: 0, y: 0 } : { x: 40, y: 40 };
            return {
                ...JSON.parse(JSON.stringify(rest)),
                id: newId,
                position: {
                    x: (n.position?.x || 0) + offset.x,
                    y: (n.position?.y || 0) + offset.y,
                },
                selected: false,
            };
        });

        // Second pass: remap parentNode on duplicated children to point at the
        // duplicated parent. Drop parentNode if its target wasn't duplicated
        // (defensive — shouldn't happen given the expandedSet logic above).
        for (const n of newNodes) {
            if (n.parentNode) {
                const remapped = idMap.get(n.parentNode);
                if (remapped) n.parentNode = remapped;
                else delete n.parentNode;
            }
        }

        const newEdges = selectedEdges.map((e: any, i: number) => {
            const cloned = JSON.parse(JSON.stringify(e));
            return {
                ...cloned,
                id: `edge_${stamp}_${i}_${Math.random().toString(36).slice(2, 8)}`,
                source: idMap.get(e.source) as string,
                target: idMap.get(e.target) as string,
                selected: false,
            };
        });

        onDuplicate(newNodes, newEdges);
    }, [reactFlowInstance, localNodes, edges, onDuplicate]);

    const handleDeleteSelected = useCallback(() => {
        if (!onDelete) return;
        const rfNodes = reactFlowInstance?.getNodes() ?? localNodes;
        const directlySelected = rfNodes.filter((n: any) => n.selected);
        if (directlySelected.length === 0) return;

        // Fold each selected group's children into the delete set so groups
        // delete as a single bundle.
        const idsToDelete = new Set<string>();
        directlySelected.forEach((n: any) => idsToDelete.add(n.id));
        for (const sel of directlySelected) {
            if (sel.type === 'group_container') {
                rfNodes
                    .filter((n: any) => n.parentNode === sel.id)
                    .forEach((c: any) => idsToDelete.add(c.id));
            }
        }

        onDelete(Array.from(idsToDelete));
    }, [reactFlowInstance, localNodes, onDelete]);

    // Bulk-download toast (local, auto-dismissed). Set when the user clicks
    // Download in the multi-select toolbar; cleared by the Toast itself.
    // closeDownloadToast is stabilized because Toast's auto-dismiss effect
    // has `onClose` in its deps — passing a fresh arrow each render would
    // reset the timer on every parent re-render, so the toast would never
    // auto-close.
    const [downloadToast, setDownloadToast] = useState<string | null>(null);
    const closeDownloadToast = useCallback(() => setDownloadToast(null), []);

    /**
     * Bulk-download for the multi-select toolbar.
     *
     * Collects every selected node's media output (image / video / audio / 3D)
     * into a single zip and triggers one download. Two collection paths:
     *
     *   1. If a per-instance override is registered (download-registry), call
     *      it for an artifact the node has authored itself. This is how the
     *      compositor returns its server-side ffmpeg export rather than the
     *      cached preview frame.
     *   2. Otherwise fall back to extractMediaUrls on nodeOutputs[id], fetched
     *      one by one into blobs.
     *
     * Text/JSON outputs are skipped on purpose — bulk download targets media
     * only (see CLAUDE.md task notes).
     *
     * Progress is published to `bulkDownload` in the store as we go (one tick
     * per fetched file plus one for the final zip), so EditorToolbar can show
     * a "Preparing download…" indicator next to the Run button. Filenames
     * collide between nodes get auto-disambiguated when added to the zip.
     */
    const setBulkDownloadProgress = useAppStore((s) => s.setBulkDownloadProgress);
    const clearBulkDownload = useAppStore((s) => s.clearBulkDownload);

    const handleDownloadSelected = useCallback(async () => {
        const rfNodes = reactFlowInstance?.getNodes() ?? localNodes;
        const directlySelected = rfNodes.filter((n: any) => n.selected);
        if (directlySelected.length === 0) return;

        // Fold each selected group's children into the download set so groups
        // download as a single bundle (mirrors handleDeleteSelected).
        const ids = new Set<string>();
        directlySelected.forEach((n: any) => ids.add(n.id));
        for (const sel of directlySelected) {
            if (sel.type === 'group_container') {
                rfNodes
                    .filter((n: any) => n.parentNode === sel.id)
                    .forEach((c: any) => ids.add(c.id));
            }
        }
        // Group containers have no output of their own — strip them.
        const downloadIds = Array.from(ids).filter((id) => {
            const n = rfNodes.find((x: any) => x.id === id);
            return !!n && n.type !== 'group_container';
        });

        if (downloadIds.length === 0) {
            setDownloadToast('Nothing to download');
            return;
        }

        const { nodeOutputs, currentWorkflow } = useAppStore.getState();

        // Estimate progress total: count URLs from generic fallbacks + 1 per
        // override + 1 for the final zip. Overrides can return >1 file but
        // we can't tell ahead of time — they count as a single unit.
        let total = 1; // zip step
        for (const id of downloadIds) {
            if (getDownloadHandler(id)) {
                total += 1;
            } else {
                const out = nodeOutputs[id];
                if (out) total += extractMediaUrls(out).length;
            }
        }

        if (total <= 1) {
            // Only the zip step exists — selection has no downloadable media.
            setDownloadToast('Nothing to download — selected nodes have no media output');
            return;
        }

        // Per-call operation id so concurrent downloads each render their own
        // pill in the EditorToolbar. crypto.randomUUID is available in every
        // modern browser; the fallback is defensive for older test envs.
        const opId =
            typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                ? crypto.randomUUID()
                : `dl-${Date.now()}-${Math.random().toString(36).slice(2)}`;

        let current = 0;
        const tick = () => {
            current = Math.min(current + 1, total);
            setBulkDownloadProgress(opId, { current, total });
        };

        setBulkDownloadProgress(opId, { current: 0, total });
        setDownloadToast(`Preparing ${downloadIds.length} node${downloadIds.length === 1 ? '' : 's'}…`);

        try {
            const collected: DownloadItem[] = [];

            // Run nodes in parallel via Promise.allSettled so a slow compositor
            // doesn't block faster image fetches.
            const settled = await Promise.allSettled(
                downloadIds.map(async (id) => {
                    const node = currentWorkflow?.nodes.find((n) => n.id === id);
                    const label = node?.data?.label || node?.type || 'node';
                    const override = getDownloadHandler(id);
                    if (override) {
                        const items = await override();
                        tick();
                        return items;
                    }
                    return await collectNodeMediaBlobs(nodeOutputs[id], label, tick);
                }),
            );

            let failed = 0;
            for (const r of settled) {
                if (r.status === 'rejected') {
                    failed++;
                    continue;
                }
                if (r.value.length === 0) continue;
                collected.push(...r.value);
            }

            if (collected.length === 0) {
                setDownloadToast(failed > 0 ? `${failed} failed` : 'Nothing to download');
                return;
            }

            // Build the zip. Disambiguate same-named entries across nodes by
            // appending an incrementing suffix; common because two duplicated
            // ai_generator nodes both end up named "image.png".
            const zip = new JSZip();
            const used = new Set<string>();
            for (const item of collected) {
                zip.file(uniqueZipName(item.filename, used), item.blob);
            }

            const zipBlob = await zip.generateAsync({ type: 'blob' });
            tick();

            const wfLabel = sanitizeFsName(currentWorkflow?.name) || 'prism-download';
            const zipName = `${wfLabel}.zip`;
            triggerBlobDownload(zipBlob, zipName);

            const parts: string[] = [`Downloaded ${collected.length} file${collected.length === 1 ? '' : 's'} as ${zipName}`];
            // "N had no media" intentionally omitted — selecting extra nodes
            // alongside the media-producing ones is normal usage, not a
            // failure worth reporting.
            if (failed > 0) parts.push(`${failed} failed`);
            setDownloadToast(parts.join(' · '));
        } finally {
            // Always clear progress — guarantees the pill never strands
            // on-screen even if zip generation or one of the awaits throws.
            clearBulkDownload(opId);
        }
    }, [reactFlowInstance, localNodes, setBulkDownloadProgress, clearBulkDownload]);

    // Group button is shown only when 2+ nodes are selected AND none are already
    // in a group. Mixed selections (some grouped, some not) would be ambiguous —
    // the user must ungroup first.
    const canGroupSelection = useMemo(() => {
        if (selectedNodeIds.length < 2) return false;
        const rfNodes = reactFlowInstance?.getNodes() ?? localNodes;
        const selectedNodes = rfNodes.filter((n: any) => selectedNodeIds.includes(n.id));
        if (selectedNodes.length < 2) return false;
        // No selected node may already have a parentNode, AND none may BE a group
        // (no nesting per spec).
        return selectedNodes.every((n: any) => !n.parentNode && n.type !== 'group_container');
    }, [reactFlowInstance, localNodes, selectedNodeIds]);

    const groupNodes = useAppStore((state) => state.groupNodes);

    const handleGroupSelected = useCallback(() => {
        if (!canGroupSelection) return;
        // Selection of the new group is set inside the slice (selected: true on
        // the group, false on children). Do NOT call reactFlowInstance.setNodes
        // here — RF's internal store doesn't yet contain the new group, so any
        // setNodes diff would emit a reset that wipes the group via onNodesChange.
        groupNodes(selectedNodeIds);
    }, [canGroupSelection, groupNodes, selectedNodeIds]);

    const ungroupNode = useAppStore((state) => state.ungroupNode);

    // True when exactly one node is selected AND it's a group.
    const singleSelectedGroupId = useMemo(() => {
        if (selectedNodeIds.length !== 1) return null;
        const rfNodes = reactFlowInstance?.getNodes() ?? localNodes;
        const sel = rfNodes.find((n: any) => n.id === selectedNodeIds[0]);
        return sel && sel.type === 'group_container' ? sel.id : null;
    }, [reactFlowInstance, localNodes, selectedNodeIds]);

    const handleUngroup = useCallback(() => {
        if (!singleSelectedGroupId) return;
        ungroupNode(singleSelectedGroupId);
    }, [singleSelectedGroupId, ungroupNode]);

    // Reuse handleDeleteSelected — it already folds group children into the
    // delete set when a group is in the selection (Task 9).

    const mouseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const wrapperRectRef = useRef<{ left: number; top: number } | null>(null);

    const setIsDragging = useAppStore((state) => state.setIsDragging);
    const models = useAppStore((state) => state.models);

    const dimmedNodeIds = useMemo(() => {
        if (!wireDrag) return null;
        const set = new Set<string>();
        const nodes = reactFlowInstance?.getNodes() ?? localNodes;
        const pendingFromDrag: PendingConnection = {
            nodeId: wireDrag.originNodeId,
            handleId: wireDrag.originHandleId,
            handleType: wireDrag.originHandleType,
            dataType: wireDrag.dataType,
        };
        for (const n of nodes) {
            if (n.id === wireDrag.originNodeId) continue;
            const compatible = findHandleForNode(
                n as any,
                pendingFromDrag,
                models,
                sharedRegistry,
            );
            if (!compatible) set.add(n.id);
        }
        return set;
    }, [wireDrag, reactFlowInstance, localNodes, models]);

    const memoizedEdges = useMemo(() => edges.map(e => {
        const isDimmed = dimmedNodeIds && (
            dimmedNodeIds.has(e.source) || dimmedNodeIds.has(e.target)
        );
        return {
            ...e,
            type: 'default',
            animated: false,
            style: isDimmed
                ? { ...edgeStyle, opacity: 0.3, filter: 'grayscale(0.6)', transition: 'opacity 150ms, filter 150ms' }
                : edgeStyle,
        };
    }), [edges, edgeStyle, dimmedNodeIds]);

    const { getRFNode, getRFNodes, getRFEdges } = {
        getRFNode: (id: string) => reactFlowInstance?.getNode(id),
        getRFNodes: () => reactFlowInstance?.getNodes() || [],
        getRFEdges: () => reactFlowInstance?.getEdges() || [],
    };

    const copyNode = useAppStore((state) => state.copyNode);
    const pasteNode = useAppStore((state) => state.pasteNode);

    const touchInteraction = useAppStore((state) => state.touchInteraction);

    // stableNodeTypes is a Proxy defined at module scope — see reactflow-types.ts.
    // Unknown ids resolve to AIGeneratorNode, so we don't need to rebuild this
    // object when ai_generator node type ids load.
    const nodeTypes = stableNodeTypes;
    const edgeTypes = stableEdgeTypes;

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

            const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
            const ctrlKey = isMac ? event.metaKey : event.ctrlKey;

            if (ctrlKey && event.key.toLowerCase() === 'z' && !event.shiftKey) {
                event.preventDefault();
                if (canUndo) undo?.();
                return;
            }

            if ((ctrlKey && event.key.toLowerCase() === 'y') || (ctrlKey && event.shiftKey && event.key.toLowerCase() === 'z')) {
                event.preventDefault();
                if (canRedo) redo?.();
                return;
            }

            if (ctrlKey && event.key.toLowerCase() === 'g') {
                if (!canGroupSelection) return;
                event.preventDefault();
                handleGroupSelected();
                return;
            }
        };

        document.addEventListener('keydown', handleKeyDown, true);
        return () => document.removeEventListener('keydown', handleKeyDown, true);
    }, [undo, redo, canUndo, canRedo, canGroupSelection, handleGroupSelected]);

    const handleNodesChange = useCallback((changes: NodeChange[]) => {
        // Selection redirection: a node inside a group must never appear
        // selected — its parent group is selected instead. Both click and
        // marquee paths flow through this handler, so transforming the
        // 'select' changes here covers every selection source uniformly.
        const lookupNodes = reactFlowInstance?.getNodes() ?? localNodes;
        const groupsToSelect = new Set<string>();
        const transformed: NodeChange[] = [];
        for (const change of changes) {
            if (change.type === 'select') {
                const target = lookupNodes.find((n: any) => n.id === (change as any).id);
                if (target?.parentNode && (change as any).selected) {
                    // Drop the child select; queue a parent-group select instead.
                    groupsToSelect.add(target.parentNode);
                    continue;
                }
            }
            transformed.push(change);
        }
        for (const groupId of groupsToSelect) {
            transformed.push({ type: 'select', id: groupId, selected: true } as NodeChange);
        }

        // Update local state immediately for zero-lag UI
        setLocalNodes((nds) => applyNodeChanges(transformed, nds));

        // Only propagate non-position changes to the global store immediately.
        // Position changes are batched and sent onDragStop.
        const structuralChanges = transformed.filter(c => c.type !== 'position');
        if (structuralChanges.length > 0) {
            onNodesChange(structuralChanges);
        }
    }, [onNodesChange, reactFlowInstance, localNodes]);

    const handleNodeDragStart: NodeDragHandler = useCallback((event, node, nodes) => {
        isDraggingRef.current = true;
        setIsDragging(true);
        if (onNodeDragStart) onNodeDragStart(event, node, nodes);
    }, [onNodeDragStart, setIsDragging]);

    // Bring node to front on press — LOCAL ONLY for instant visual feedback.
    // The global store write (bringNodeToFront) is deferred to drag-stop or
    // onNodeClick, because writing to the store on mousedown rebuilds
    // currentWorkflow.nodes, which changes the `nodes` prop ref and forces
    // an extra render cycle right before the drag begins — visible as a
    // first-frame stall when the user grabs a node.
    const handleWrapperMouseDown = useCallback((e: React.MouseEvent) => {
        const nodeEl = (e.target as HTMLElement).closest?.('.react-flow__node') as HTMLElement | null;
        if (!nodeEl) return;
        const nodeId = nodeEl.getAttribute('data-id');
        if (!nodeId) return;

        setLocalNodes(nds => {
            const maxZ = Math.max(0, ...nds.map(n => n.zIndex || 0));
            const target = nds.find(n => n.id === nodeId);
            if (!target || ((target.zIndex || 0) >= maxZ && maxZ > 0)) return nds;
            return nds.map(n => n.id === nodeId ? { ...n, zIndex: maxZ + 1 } : n);
        });
    }, []);

    const setNodeParent = useAppStore((state) => state.setNodeParent);
    const setDragHoverGroupId = useAppStore((state) => state.setDragHoverGroupId);

    const handleNodeDrag: NodeDragHandler = useCallback((_event, node, _nodes) => {
        // Only consider drag-IN for nodes that are NOT already inside a group.
        // (A node already in a group can be dragged out — Task 6 handles that.)
        if ((node as any).parentNode) {
            setDragHoverGroupId(null);
            return;
        }
        if (node.type === 'group_container') {
            setDragHoverGroupId(null);
            return;
        }

        const allNodes = reactFlowInstance?.getNodes() ?? [];
        const childW = node.width ?? (node as any).measured?.width ?? 200;
        const childH = node.height ?? (node as any).measured?.height ?? 100;
        const childRect = {
            left: node.position.x,
            top: node.position.y,
            right: node.position.x + childW,
            bottom: node.position.y + childH,
        };

        // Find the first group whose rect overlaps the dragged node's rect.
        // "Touching" per spec — any overlap counts.
        let hoverId: string | null = null;
        for (const g of allNodes) {
            if (g.type !== 'group_container') continue;
            const cfg = (g.data?.config as any) || {};
            const gRect = {
                left: g.position.x,
                top: g.position.y,
                right: g.position.x + (cfg.width || 0),
                bottom: g.position.y + (cfg.height || 0),
            };
            const overlaps =
                childRect.right >= gRect.left &&
                childRect.left <= gRect.right &&
                childRect.bottom >= gRect.top &&
                childRect.top <= gRect.bottom;
            if (overlaps) {
                hoverId = g.id;
                break;
            }
        }
        setDragHoverGroupId(hoverId);
    }, [reactFlowInstance, setDragHoverGroupId]);

    const handleNodeDragStop: NodeDragHandler = useCallback((event, node, nodes) => {
        isDraggingRef.current = false;
        setIsDragging(false);

        // Sync final positions to global store
        const positionsMap = new Map<string, { x: number; y: number }>();
        nodes.forEach(n => positionsMap.set(n.id, n.position));

        if (updatePositions) {
            updatePositions(positionsMap);
        }

        // ── DRAG-IN: attach the dragged node to the hovered group, if any. ─────
        // Only the primary `node` arg is the one being dragged. Selection drags
        // route through handleSelectionDragStop (which does not currently
        // attach into groups — explicitly out of scope: drag-in is single-node).
        const hoveredGroupId = useAppStore.getState().dragHoverGroupId;
        if (hoveredGroupId && !(node as any).parentNode && node.type !== 'group_container') {
            setNodeParent(node.id, hoveredGroupId);
        }
        setDragHoverGroupId(null);

        // ── DRAG-OUT: detect parented children whose center has left the rect. ─
        const allNodes = reactFlowInstance?.getNodes() ?? [];
        for (const dragged of nodes as any[]) {
            if (!dragged.parentNode) continue;
            const parent = allNodes.find((n: any) => n.id === dragged.parentNode);
            if (!parent || parent.type !== 'group_container') continue;
            const childW = dragged.width ?? dragged.measured?.width ?? 200;
            const childH = dragged.height ?? dragged.measured?.height ?? 100;
            const childCenterX = dragged.position.x + childW / 2;
            const childCenterY = dragged.position.y + childH / 2;
            const cfg = (parent.data?.config as any) || {};
            const insideX = childCenterX >= 0 && childCenterX <= (cfg.width || 0);
            const insideY = childCenterY >= 0 && childCenterY <= (cfg.height || 0);
            if (!insideX || !insideY) {
                setNodeParent(dragged.id, null);
            }
        }

        // Commit the local zIndex pop applied in handleWrapperMouseDown so it
        // survives the next prop sync. Doing it here keeps the global store
        // write away from the moment of grab.
        useAppStore.getState().bringNodeToFront(node.id);

        touchInteraction();
        if (onNodeDragStop) onNodeDragStop(event, node, nodes);
    }, [setIsDragging, onNodeDragStop, touchInteraction, updatePositions, reactFlowInstance, setNodeParent, setDragHoverGroupId]);

    // After a marquee selection, React Flow renders a `.react-flow__nodesselection-rect`
    // overlay with `pointer-events: all` — grabbing anywhere inside it (even on a
    // node) fires the SELECTION drag, not the node drag. That hits onSelectionDrag*
    // instead of onNodeDrag*, so without these handlers the position changes never
    // reach the store and the next deselect re-syncs localNodes from stale propNodes.
    const handleSelectionDragStart = useCallback(() => {
        isDraggingRef.current = true;
        setIsDragging(true);
    }, [setIsDragging]);

    const handleSelectionDragStop = useCallback((_event: React.MouseEvent, nodes: any[]) => {
        isDraggingRef.current = false;
        setIsDragging(false);

        const positionsMap = new Map<string, { x: number; y: number }>();
        nodes.forEach(n => positionsMap.set(n.id, n.position));

        if (updatePositions) {
            updatePositions(positionsMap);
        }

        // Same drag-OUT detection as handleNodeDragStop. Multi-drag is just a
        // batched version of single-node drag.
        const allNodes = reactFlowInstance?.getNodes() ?? [];
        for (const dragged of nodes as any[]) {
            if (!dragged.parentNode) continue;
            const parent = allNodes.find((n: any) => n.id === dragged.parentNode);
            if (!parent || parent.type !== 'group_container') continue;
            const childW = dragged.width ?? dragged.measured?.width ?? 200;
            const childH = dragged.height ?? dragged.measured?.height ?? 100;
            const childCenterX = dragged.position.x + childW / 2;
            const childCenterY = dragged.position.y + childH / 2;
            const cfg = (parent.data?.config as any) || {};
            const insideX = childCenterX >= 0 && childCenterX <= (cfg.width || 0);
            const insideY = childCenterY >= 0 && childCenterY <= (cfg.height || 0);
            if (!insideX || !insideY) {
                setNodeParent(dragged.id, null);
            }
        }

        touchInteraction();
    }, [setIsDragging, touchInteraction, updatePositions, reactFlowInstance, setNodeParent]);

    const handleEdgesChange = useCallback((changes: any) => {
        touchInteraction();
        onEdgesChange(changes);
    }, [touchInteraction, onEdgesChange]);

    const handleConnect = useCallback((connection: Connection) => {
        touchInteraction();
        onConnect(connection);
    }, [touchInteraction, onConnect]);

    // Capture the originating side of a connection drag so we can filter the
    // context menu by data-type compatibility when it ends on empty canvas.
    const handleConnectStart = useCallback((_event: any, params: { nodeId: string | null; handleId: string | null; handleType: 'source' | 'target' | null }) => {
        if (!params.nodeId || !params.handleType) return;
        connectStartRef.current = {
            nodeId: params.nodeId,
            handleId: params.handleId,
            handleType: params.handleType,
        };

        if (!reactFlowInstance) return;
        const originNode = reactFlowInstance.getNode(params.nodeId);
        if (!originNode) return;
        const resolved = getNodeHandleType(
            originNode as any,
            params.handleId,
            params.handleType,
            models,
            sharedRegistry,
        );
        if (!resolved) return;
        setWireDrag({
            originNodeId: params.nodeId,
            originHandleId: params.handleId,
            originHandleType: params.handleType,
            dataType: resolved.type,
        });
    }, [reactFlowInstance, models]);

    // Wire dropped on canvas (not on a handle/node) → open the filtered context
    // menu so the user can pick a compatible node and have it auto-wired.
    const handleConnectEnd = useCallback((event: MouseEvent | TouchEvent) => {
        const start = connectStartRef.current;
        connectStartRef.current = null;
        setWireDrag(null);
        if (!start) return;

        const clientX = 'clientX' in event
            ? (event as MouseEvent).clientX
            : (event as TouchEvent).changedTouches?.[0]?.clientX ?? 0;
        const clientY = 'clientY' in event
            ? (event as MouseEvent).clientY
            : (event as TouchEvent).changedTouches?.[0]?.clientY ?? 0;

        // Use the element under the actual drop point (event.target during a
        // connection drag is often the SVG connection line itself, not the pane).
        const elAtPoint = document.elementFromPoint(clientX, clientY) as Element | null;
        const target = elAtPoint || (event.target as Element | null);

        // If we dropped on a handle, React Flow's onConnect already handled it.
        // If we dropped on a node body but not a handle, we also don't want to
        // spawn a new node. Anything else (pane, grid, viewport) is fair game.
        if (target?.closest?.('.react-flow__handle')) return;
        if (target?.closest?.('.react-flow__node')) return;

        const sourceNode = reactFlowInstance?.getNode(start.nodeId);
        const models = useAppStore.getState().models;
        const handleInfo = getNodeHandleType(sourceNode, start.handleId, start.handleType, models, sharedRegistry);
        // If we can't resolve the source handle's type, fall back to 'any' so
        // the user still gets a menu (just not type-filtered).
        const dataType = handleInfo?.type ?? 'any';

        // Snapshot the source handle's screen position so we can draw a static
        // wire from it to the menu while the user picks a node.
        const handleSelector = start.handleId
            ? `.react-flow__handle[data-nodeid="${start.nodeId}"][data-handleid="${start.handleId}"]`
            : `.react-flow__handle[data-nodeid="${start.nodeId}"].${start.handleType}`;
        const handleEl = document.querySelector(handleSelector) as HTMLElement | null;
        const handleRect = handleEl?.getBoundingClientRect();
        const wrapperRect = reactFlowWrapper.current?.getBoundingClientRect();
        if (handleRect && wrapperRect) {
            setPendingWireAnchor({
                x: handleRect.left + handleRect.width / 2 - wrapperRect.left,
                y: handleRect.top + handleRect.height / 2 - wrapperRect.top,
            });
        }

        setPendingConnection({
            nodeId: start.nodeId,
            handleId: start.handleId,
            handleType: start.handleType,
            dataType,
            isArray: handleInfo?.isArray,
        });
        setContextMenu({ x: clientX, y: clientY });
        wireDropOpenedAtRef.current = Date.now();
    }, [reactFlowInstance]);

    const handleEdgeClick = useCallback((e: React.MouseEvent, edge: Edge) => {
        e.stopPropagation();
        touchInteraction();
        onEdgesChange([{ type: 'remove', id: edge.id }]);
    }, [touchInteraction, onEdgesChange]);

    const handleDrop = useCallback((event: React.DragEvent) => {
        event.preventDefault();
        if (!reactFlowInstance) return;

        const rawData = event.dataTransfer.getData('application/reactflow');
        if (rawData) {
            try {
                const payload = JSON.parse(rawData);
                const position = reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
                onDrop(payload.type, position, payload.node_type_id, undefined, payload.initialConfig);
                return;
            } catch (e) { /* fallback to file-drop handling */ }
        }

        // OS-file drop: mirror the assets-panel UX. Filter to image/video,
        // spawn an empty media_input at the drop point with a transient
        // _isUploading flag that drives the in-node GlassyLoader, then upload
        // in the background and populate config.images on success.
        const mediaFiles = Array.from(event.dataTransfer.files || []).filter(
            (f) => f.type.startsWith('image/') || f.type.startsWith('video/'),
        );
        if (mediaFiles.length === 0) return;

        const activeSessionId = useAppStore.getState().activeSessionId;
        if (!activeSessionId) return;

        const position = reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
        const beforeIds = new Set(
            (useAppStore.getState().currentWorkflow?.nodes || []).map((n: any) => n.id),
        );
        onDrop('media_input', position, undefined, undefined, { images: [], _isUploading: true });

        const wf = useAppStore.getState().currentWorkflow;
        const newNode = wf?.nodes.find((n: any) => !beforeIds.has(n.id));
        if (!newNode) return;
        const newNodeId = newNode.id;

        (async () => {
            try {
                const { uploadApi } = await import('@/lib/api/client');
                const uploaded = await Promise.all(
                    mediaFiles.map(async (file) => {
                        const result = await uploadApi.upload(file, {
                            sessionId: activeSessionId,
                            nodeId: newNodeId,
                        });
                        return { url: result.publicUrl, path: result.path };
                    }),
                );

                const store = useAppStore.getState();
                const currentNode = store.currentWorkflow?.nodes.find((n: any) => n.id === newNodeId);
                if (!currentNode) return; // node was deleted mid-upload
                const currentConfig = (currentNode.data?.config as any) || {};
                const existing = Array.isArray(currentConfig.images) ? currentConfig.images : [];
                store.updateNodeConfig(newNodeId, {
                    ...currentConfig,
                    images: [...existing, ...uploaded],
                    _isUploading: false,
                });
            } catch (err) {
                console.error('Canvas file-drop upload failed:', err);
                const store = useAppStore.getState();
                const currentNode = store.currentWorkflow?.nodes.find((n: any) => n.id === newNodeId);
                if (!currentNode) return;
                const currentConfig = (currentNode.data?.config as any) || {};
                store.updateNodeConfig(newNodeId, { ...currentConfig, _isUploading: false });
            }
        })();
    }, [reactFlowInstance, onDrop]);

    const handleNodesDelete = useCallback((deleted: any[]) => {
        touchInteraction();
        onDelete?.(deleted.map(n => n.id));
    }, [touchInteraction, onDelete]);

    const handleIsValidConnection = useCallback((connection: Connection) => {
        if (connection.source === connection.target) return false;
        if (!reactFlowInstance) return true;

        const sourceNode = reactFlowInstance.getNode(connection.source!);
        const targetNode = reactFlowInstance.getNode(connection.target!);
        if (!sourceNode || !targetNode) return true;

        const src = getNodeHandleType(sourceNode as any, connection.sourceHandle, 'source', models, sharedRegistry);
        const tgt = getNodeHandleType(targetNode as any, connection.targetHandle, 'target', models, sharedRegistry);
        // Fail open when either side can't be resolved (unknown plugin, missing
        // model row) — better to allow a connection we can't classify than to
        // silently block legitimate ones.
        if (!src || !tgt) return true;
        if (!typesAreCompatible(src.type, tgt.type)) return false;

        // Refuse drops that would close a directed cycle in the graph. React
        // Flow paints the wire red and silently discards on `false`; the
        // BaseNode toast (rendered separately) explains the rejection.
        if (wouldCreateCycle(connection.source!, connection.target!, reactFlowInstance.getEdges())) {
            return false;
        }
        return true;
    }, [reactFlowInstance, models]);

    const handlePaneClick = useCallback(() => {
        // Ignore the trailing pane click that React Flow fires immediately after
        // a wire-drop on the pane — otherwise it closes the menu we just opened.
        if (Date.now() - wireDropOpenedAtRef.current < 300) return;
        setContextMenu(null);
        setPendingConnection(null);
        setPendingWireAnchor(null);
    }, []);

    useEffect(() => {
        const updateRect = () => {
            if (!reactFlowWrapper.current) return;
            const r = reactFlowWrapper.current.getBoundingClientRect();
            wrapperRectRef.current = { left: r.left, top: r.top };
        };
        updateRect();
        window.addEventListener('resize', updateRect);
        return () => window.removeEventListener('resize', updateRect);
    }, []);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (!reactFlowWrapper.current) return;
        setIsMouseActive(true);
        if (mouseTimeoutRef.current) clearTimeout(mouseTimeoutRef.current);
        mouseTimeoutRef.current = setTimeout(() => setIsMouseActive(false), 600);

        const rect = wrapperRectRef.current;
        if (!rect) return;
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        reactFlowWrapper.current.style.setProperty('--mouse-x', `${x}px`);
        reactFlowWrapper.current.style.setProperty('--mouse-y', `${y}px`);
    }, []);

    return (
        <div
            ref={reactFlowWrapper}
            className="w-full h-full relative canvas-container"
            onContextMenu={(e) => {
                // CanvasContextMenu dispatches a synthetic contextmenu event on mount
                // (to drive Radix's Trigger). Don't treat that as a fresh user gesture
                // — otherwise it wipes the pendingConnection we just set on wire-drop.
                if ((e.nativeEvent as any)._isSynthetic) return;
                e.preventDefault();
                if ((e.target as HTMLElement).closest('.react-flow__node')) return;
                setPendingConnection(null);
                setPendingWireAnchor(null);
                setContextMenu({ x: e.clientX, y: e.clientY });
            }}
            onMouseDownCapture={handleWrapperMouseDown}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setIsMouseActive(false)}
        >
            <WireDragProvider value={wireDrag}>
            <ReactFlow
                nodes={localNodes}
                edges={memoizedEdges}
                onNodesChange={handleNodesChange}
                onEdgesChange={handleEdgesChange}
                onConnect={handleConnect}
                onConnectStart={handleConnectStart}
                onConnectEnd={handleConnectEnd}
                onNodeClick={onNodeClick}
                onNodeDragStart={handleNodeDragStart}
                onNodeDrag={handleNodeDrag}
                onNodeDragStop={handleNodeDragStop}
                onSelectionDragStart={handleSelectionDragStart}
                onSelectionDragStop={handleSelectionDragStop}
                onEdgeClick={handleEdgeClick}
                onInit={setReactFlowInstance}
                onDrop={handleDrop}
                onDragOver={preventDefault}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                defaultViewport={DEFAULT_VIEWPORT}
                fitView
                fitViewOptions={FIT_VIEW_OPTIONS}
                minZoom={0.1}
                maxZoom={2}
                nodeDragThreshold={1}
                deleteKeyCode="Delete"
                onNodesDelete={handleNodesDelete}
                isValidConnection={handleIsValidConnection}
                panOnScroll={true}
                zoomOnScroll={false}
                zoomOnPinch={true}
                panOnDrag={isPanMode ? PAN_ON_DRAG_PAN : PAN_ON_DRAG_SELECT}
                selectionOnDrag={!isPanMode}
                selectNodesOnDrag={!isPanMode}
                nodesDraggable={!isPanMode}
                selectionMode={!isPanMode ? SelectionMode.Partial : undefined}
                connectionMode={"loose" as any}
                onPaneClick={handlePaneClick}
                proOptions={PRO_OPTIONS}
            >
                <BaseGridLayers />
                <SpotlightGridLayers isMouseActive={isMouseActive} />

                {selectedNodeIds.length >= 2 && (
                    <NodeToolbar
                        isVisible={true}
                        nodeId={selectedNodeIds}
                        position={Position.Top}
                        align="end"
                    >
                        {/* nopan/nowheel keep RF from grabbing the pointer; pointer-events:auto
                            and z-index 50 protect against any sibling overlay sitting on top. */}
                        <div
                            className="nopan nowheel flex items-center gap-0.5 p-0.5 rounded-md bg-surface-elevated/95 backdrop-blur-md border border-stroke-subtle shadow-lg"
                            style={{ pointerEvents: 'auto', zIndex: 50 }}
                            onMouseDown={(e) => e.stopPropagation()}
                        >
                            {canGroupSelection && (
                                <Tooltip content="Group selected (Cmd+G)" position="top" delay={600}>
                                    <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleGroupSelected(); }}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        className="w-6 h-6 rounded flex items-center justify-center text-content-primary hover:bg-white/10 hover:text-accent-primary transition-all"
                                    >
                                        <GroupIcon className="w-3 h-3 pointer-events-none" />
                                    </button>
                                </Tooltip>
                            )}
                            <Tooltip content="Duplicate selected" position="top" delay={600}>
                                <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleDuplicateSelected(); }}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    className="w-6 h-6 rounded flex items-center justify-center text-content-primary hover:bg-white/10 hover:text-accent-primary transition-all"
                                >
                                    <Copy className="w-3 h-3 pointer-events-none" />
                                </button>
                            </Tooltip>
                            <Tooltip content="Download selected" position="top" delay={600}>
                                <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); void handleDownloadSelected(); }}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    className="w-6 h-6 rounded flex items-center justify-center text-content-primary hover:bg-white/10 hover:text-accent-primary transition-all"
                                >
                                    <Download className="w-3 h-3 pointer-events-none" />
                                </button>
                            </Tooltip>
                            <Tooltip content="Delete selected" position="top" delay={600}>
                                <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleDeleteSelected(); }}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    className="w-6 h-6 rounded flex items-center justify-center text-accent-error hover:bg-accent-error/20 transition-all"
                                >
                                    <Trash2 className="w-3 h-3 pointer-events-none" />
                                </button>
                            </Tooltip>
                        </div>
                    </NodeToolbar>
                )}

                {singleSelectedGroupId && (
                    <NodeToolbar
                        isVisible={true}
                        nodeId={singleSelectedGroupId}
                        position={Position.Top}
                        align="end"
                    >
                        <div
                            className="nopan nowheel flex items-center gap-0.5 p-0.5 rounded-md bg-surface-elevated/95 backdrop-blur-md border border-stroke-subtle shadow-lg"
                            style={{ pointerEvents: 'auto', zIndex: 50 }}
                            onMouseDown={(e) => e.stopPropagation()}
                        >
                            <Tooltip content="Ungroup" position="top" delay={600}>
                                <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleUngroup(); }}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    className="w-6 h-6 rounded flex items-center justify-center text-content-primary hover:bg-white/10 hover:text-accent-primary transition-all"
                                >
                                    <UngroupIcon className="w-3 h-3 pointer-events-none" />
                                </button>
                            </Tooltip>
                            <Tooltip content="Duplicate group" position="top" delay={600}>
                                <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleDuplicateSelected(); }}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    className="w-6 h-6 rounded flex items-center justify-center text-content-primary hover:bg-white/10 hover:text-accent-primary transition-all"
                                >
                                    <Copy className="w-3 h-3 pointer-events-none" />
                                </button>
                            </Tooltip>
                            <Tooltip content="Delete group + contents" position="top" delay={600}>
                                <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleDeleteSelected(); }}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    className="w-6 h-6 rounded flex items-center justify-center text-accent-error hover:bg-accent-error/20 transition-all"
                                >
                                    <Trash2 className="w-3 h-3 pointer-events-none" />
                                </button>
                            </Tooltip>
                        </div>
                    </NodeToolbar>
                )}

                <CanvasToolbar
                    undo={undo}
                    redo={redo}
                    canUndo={canUndo}
                    canRedo={canRedo}
                    onAutoLayout={async () => {
                        if (localNodes.length === 0 || !updatePositions) return;
                        // RF's internal nodes are guaranteed measured (width/height set
                        // after the DOM round-trip). localNodes can be missing dimensions
                        // right after a workflow load before measurement propagates.
                        const measured = reactFlowInstance?.getNodes() ?? localNodes;
                        const newPositions = await autoLayoutNodesAsync(measured, edges);
                        updatePositions(newPositions);
                        // Wait for the position write to propagate through the store
                        // and re-render before fitting the viewport — fitView reads RF's
                        // current node bounds, so calling it synchronously fits the OLD layout.
                        requestAnimationFrame(() => {
                            reactFlowInstance?.fitView({ duration: 600, padding: 0.3 });
                        });
                    }}
                    isPanMode={isPanMode}
                    onTogglePanMode={setIsPanMode}
                    isNodesEmpty={localNodes.length === 0}
                />
            </ReactFlow>
            </WireDragProvider>

            {/* Hide the just-placed wire-drop node on its first commit, until we
                measure its handle and shift the node so the handle lands exactly
                under the drop point. Using visibility (not display) so the DOM is
                still measurable via getBoundingClientRect. */}
            {positioningNodeId && (
                <style>{`.react-flow__node[data-id="${positioningNodeId}"]{visibility:hidden}`}</style>
            )}

            {/* Static "ghost" wire from the source handle to the open menu while
                the user picks a node. The SVG covers the wrapper but lets clicks
                through (pointer-events: none). */}
            {pendingConnection && pendingWireAnchor && contextMenu && wrapperRectRef.current && (
                <svg
                    className="absolute inset-0 pointer-events-none z-[40]"
                    width="100%"
                    height="100%"
                    style={{ overflow: 'visible' }}
                >
                    <path
                        d={(() => {
                            const sx = pendingWireAnchor.x;
                            const sy = pendingWireAnchor.y;
                            const tx = contextMenu.x - wrapperRectRef.current.left;
                            const ty = contextMenu.y - wrapperRectRef.current.top;
                            const dx = Math.max(40, Math.abs(tx - sx) * 0.5);
                            const c1x = pendingConnection.handleType === 'source' ? sx + dx : sx - dx;
                            const c2x = pendingConnection.handleType === 'source' ? tx - dx : tx + dx;
                            return `M ${sx} ${sy} C ${c1x} ${sy}, ${c2x} ${ty}, ${tx} ${ty}`;
                        })()}
                        fill="none"
                        stroke="rgb(var(--canvas-edge))"
                        strokeWidth={2}
                    />
                </svg>
            )}

            {contextMenu && (
                <CanvasContextMenu
                    position={contextMenu}
                    pendingConnection={pendingConnection}
                    onSelectNode={(type, pos, tid, mid) => {
                        const flowPos = reactFlowInstance.screenToFlowPosition({ x: pos.x, y: pos.y });
                        const pending = pendingConnection;
                        const dropClient = pending ? { x: pos.x, y: pos.y } : null;
                        const beforeIds = new Set(
                            (useAppStore.getState().currentWorkflow?.nodes || []).map((n: any) => n.id),
                        );

                        onDrop(type, flowPos, tid, mid, undefined, pending || undefined);
                        setContextMenu(null);
                        setPendingConnection(null);
                        setPendingWireAnchor(null);

                        // Wire-drop alignment: after the new node renders, shift it so its
                        // connecting handle is exactly under the original drop point.
                        if (pending && dropClient) {
                            // The store updated synchronously when onDrop ran — read the
                            // new node's id NOW so React can batch our hide-flag update
                            // with the addition. The injected <style> rule then hides the
                            // node on its very first commit, so the user never sees it
                            // briefly at the wrong spot.
                            const wf = useAppStore.getState().currentWorkflow;
                            const newNode = wf?.nodes.find((n: any) => !beforeIds.has(n.id));
                            if (newNode) setPositioningNodeId(newNode.id);

                            requestAnimationFrame(() => {
                                const state = useAppStore.getState();
                                const wf2 = state.currentWorkflow;
                                if (!wf2 || !newNode) {
                                    setPositioningNodeId(null);
                                    return;
                                }

                                const newEdge = (wf2.edges || []).find(
                                    (e: any) => e.source === newNode.id || e.target === newNode.id,
                                );
                                if (!newEdge) {
                                    setPositioningNodeId(null);
                                    return;
                                }

                                const handleId = newNode.id === newEdge.source
                                    ? newEdge.sourceHandle
                                    : newEdge.targetHandle;

                                const nodeEl = document.querySelector(
                                    `.react-flow__node[data-id="${newNode.id}"]`,
                                ) as HTMLElement | null;
                                if (!nodeEl) {
                                    setPositioningNodeId(null);
                                    return;
                                }

                                const handleEl = (handleId
                                    ? nodeEl.querySelector(`.react-flow__handle[data-handleid="${handleId}"]`)
                                    : nodeEl.querySelector('.react-flow__handle')) as HTMLElement | null;
                                if (!handleEl) {
                                    setPositioningNodeId(null);
                                    return;
                                }

                                // Walk the offsetParent chain from handle → node to get the
                                // handle's position in the node's *natural* layout (in
                                // un-transformed CSS pixels). offsetLeft/offsetTop ignore
                                // the entrance scale animation, so this measurement is
                                // stable from the very first frame.
                                let offX = handleEl.offsetWidth / 2;
                                let offY = handleEl.offsetHeight / 2;
                                let walker: HTMLElement | null = handleEl;
                                while (walker && walker !== nodeEl) {
                                    offX += walker.offsetLeft;
                                    offY += walker.offsetTop;
                                    walker = walker.offsetParent as HTMLElement | null;
                                }

                                // Convert the original drop point to flow space, then place
                                // the node so handle offset lines up with it exactly.
                                const dropFlow = reactFlowInstance.screenToFlowPosition(dropClient);
                                const correctedX = dropFlow.x - offX;
                                const correctedY = dropFlow.y - offY;

                                if (
                                    Math.abs(correctedX - newNode.position.x) < 0.5 &&
                                    Math.abs(correctedY - newNode.position.y) < 0.5
                                ) {
                                    setPositioningNodeId(null);
                                    return;
                                }

                                useAppStore.getState().updateNodePositions(
                                    new Map([[newNode.id, { x: correctedX, y: correctedY }]]),
                                );
                                // Reveal the node on the next frame so the position
                                // update has actually applied to the DOM.
                                requestAnimationFrame(() => setPositioningNodeId(null));
                            });
                        }
                    }}
                    onClose={() => {
                        setContextMenu(null);
                        setPendingConnection(null);
                        setPendingWireAnchor(null);
                    }}
                    models={models}
                />
            )}

            {downloadToast && (
                <Toast
                    message={downloadToast}
                    duration={3500}
                    onClose={closeDownloadToast}
                    position="bottom-right"
                />
            )}
        </div>
    );
};

function EditorCanvas(props: EditorCanvasProps) {
    return (
        <ReactFlowProvider>
            <EditorCanvasInner {...props} />
        </ReactFlowProvider>
    );
}

export default React.memo(EditorCanvas);
