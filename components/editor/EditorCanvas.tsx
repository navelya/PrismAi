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
    useUpdateNodeInternals,
    applyNodeChanges,
    NodeToolbar,
    Position,
    SelectionMode,
    ConnectionMode,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { BaseGridLayers, SpotlightGridLayers } from './canvas/GridLayers';
import { CanvasToolbar } from './canvas/CanvasToolbar';
import { NodeType } from '@/lib/nodes/types';
import { useAppStore } from '@/lib/store/app-store';
import { Trash2, Copy, Group as GroupIcon, Ungroup as UngroupIcon, Download, Play } from 'lucide-react';
import { autoLayoutNodesAsync } from '@/lib/utils/graph-layout';
import CanvasContextMenu from './CanvasContextMenu';
import { AiAddedZoom } from './AiAddedZoom';
import { Tooltip } from '@/components/ui/Tooltip';
import { Toast } from '@/components/ui/Toast';
import { collectNodeMediaBlobs, triggerBlobDownload, type DownloadItem } from '@/lib/workflow/download-output';
import { getDownloadHandler } from '@/lib/workflow/download-registry';
import { extractMediaUrls } from '@/lib/workflow/result-format';
import JSZip from 'jszip';
import { stableNodeTypes, stableEdgeTypes } from './reactflow-types';
import { useTheme } from '@/components/theme/ThemeProvider';
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';
import { validateExecution } from '@/lib/workflow/validate-execution';
import { formatValidationError } from '@/lib/workflow/validate-execution-messages';
import {
    PendingConnection,
    getNodeHandleType,
    getInputHandleMaxItems,
    typesAreCompatible,
    findHandleForNode,
    wouldCreateCycle,
} from '@/lib/editor/handle-compatibility';
import { WireDragProvider, type WireDragState } from '@/lib/editor/wire-drag-context';
import { CollabCanvasProvider } from '@/lib/editor/collab-canvas-context';
import { NodeValidationProvider } from '@/lib/hooks/use-node-validation';
import { useWorkflowCollaboration } from '@/lib/hooks/use-workflow-collaboration';
import { useCurrentUser } from '@/lib/hooks/use-current-user';
import { CollaboratorCursors, type CursorsHandle } from '@/components/collab/CollaboratorCursors';
import { CollaboratorSelections } from '@/components/collab/CollaboratorSelections';

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
    // Fires on a genuine click on the empty canvas (not a pan / wire-drop).
    // Used by the parent to dismiss the property panel when the user clicks
    // away from the selected node.
    onPaneClick?: () => void;
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
    // View-only mode (mobile canvas preview): pan + zoom stay enabled, but
    // every edit affordance (node drag, selection, connection, delete) is off.
    readOnly?: boolean;
}

const EditorCanvasInner = ({
    nodes: propNodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    onNodeClick,
    onPaneClick: onPaneClickProp,
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
    readOnly = false,
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

    const isDraggingRef = useRef(false);
    const isSelectingRef = useRef(false);
    // True while a node is being resized (NodeResizer). Like isDraggingRef, this
    // gates the propNodes→localNodes sync below so the live resize (size AND
    // position, both held only in localNodes mid-resize) isn't wiped by a store
    // round-trip. Flipped by the resizing flag on dimension changes in
    // handleNodesChange. Without it, RF's ResizeObserver emits measured
    // dimension changes that leak to the store, re-fire the sync, and reset the
    // node to its stale pre-resize position every tick.
    const isResizingRef = useRef(false);
    // Reactive mirror of isSelectingRef used to gate selection-derived render
    // work (validation memos, pill mirror, multi-select toolbar) so it computes
    // once on selection-end rather than per node entering the marquee.
    const [isMarqueeActive, setIsMarqueeActive] = useState(false);

    // Sync local nodes when prop nodes change externally (but NOT while dragging
    // or marquee-selecting). Selection is a VIEW-ONLY concern: it lives in
    // localNodes and is never written to currentWorkflow (see handleNodesChange),
    // so a structural store update carries no `selected` flags. We re-apply the
    // live selection here so a structural change (add/remove/config/group) never
    // wipes the visual selection. A previously-selected node that just became a
    // group child redirects its selection to the parent group — this is what
    // makes "Group selected" leave the new group highlighted without the store
    // driving selection.
    useEffect(() => {
        if (isDraggingRef.current || isSelectingRef.current || isResizingRef.current) return;
        setLocalNodes((prev) => {
            const prevSelected = new Set<string>();
            for (const n of prev) if ((n as any).selected) prevSelected.add(n.id);
            if (prevSelected.size === 0) return propNodes;
            const want = new Set<string>();
            for (const n of propNodes as any[]) {
                if (prevSelected.has(n.id)) want.add(n.parentNode ?? n.id);
            }
            let changed = false;
            const next = (propNodes as any[]).map((n) => {
                const sel = want.has(n.id);
                if (!!n.selected === sel) return n;
                changed = true;
                return { ...n, selected: sel };
            });
            return changed ? (next as typeof propNodes) : propNodes;
        });
    }, [propNodes]);

    // Defensive: if the canvas unmounts while a marquee is active, make sure the
    // body class doesn't get stuck and leave overlays click-through.
    useEffect(() => () => { document.body.classList.remove('marquee-selecting'); }, []);

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
    // A session's workflow loads on a separate async path (loadSession ->
    // setCurrentWorkflow) that the catalog boot flags don't gate. Until that
    // settles, currentWorkflow is empty, so the zero-node shortcut above would
    // fire ready against an empty canvas — dismissing the loader, then nodes
    // pop in seconds later. Hold the ready signal while a session is still
    // loading so "empty" means "genuinely empty", not "not fetched yet".
    // Scoped to activeSessionId so the welcome page (no session, isLoadingSession
    // stays true) isn't stranded with the loader spinning forever.
    const isLoadingSession = useAppStore((s) => s.isLoadingSession);
    const activeSessionId = useAppStore((s) => s.activeSessionId);
    const sessionLoadPending = !!activeSessionId && isLoadingSession;
    useEffect(() => {
        if (hasFiredReadyRef.current) return;
        if (!reactFlowInstance) return;
        if (sessionLoadPending) return;
        if (hasNodesToMeasure && !nodesInitialized) return;
        const raf = requestAnimationFrame(() => {
            hasFiredReadyRef.current = true;
            onCanvasReadyRef.current?.();
        });
        return () => cancelAnimationFrame(raf);
    }, [nodesInitialized, reactFlowInstance, hasNodesToMeasure, sessionLoadPending]);

    // ── Wire-render race fix ─────────────────────────────────────────────
    // RF can only draw an edge once it has measured the handleBounds of BOTH
    // endpoint nodes. On a session load, the workflow (nodes + edges) arrives
    // on a path separate from the catalog gate, and the edges reach <ReactFlow>
    // directly while nodes route through the lagged `localNodes` copy. When the
    // timing lands so edges are committed to RF's store before the endpoint
    // handles are measured — and nothing afterward re-triggers a measure (the
    // memoized edges array reference stays stable) — the wires never get drawn
    // until a full page refresh re-runs the whole mount/measure sequence. This
    // is the intermittent "nodes load but wires are missing until I refresh
    // again" bug.
    //
    // Once nodesInitialized flips true, force a re-scan of handle geometry so
    // any edge whose endpoints weren't measured when it was committed gets valid
    // handle bounds and is redrawn.
    //
    // CRITICAL: only re-measure nodes we have NOT measured before — NOT the whole
    // graph. On the initial load that's every node (closes the race for all the
    // freshly-arrived wires). On an incremental add (e.g. duplicating a node) it's
    // just the new node(s): existing nodes were already measured and their wires
    // already drawn, so re-measuring them buys nothing — but `updateNodeInternals`
    // on all N nodes forces RF to synchronously re-commit every node wrapper,
    // which on a large graph froze the main thread for ~1.7s on EVERY add. Scoping
    // to new ids keeps the wire-race fix while making duplication O(1).
    const updateNodeInternals = useUpdateNodeInternals();
    const sweptInternalIdsRef = useRef<Set<string>>(new Set());
    useEffect(() => {
        if (!nodesInitialized) return;
        const swept = sweptInternalIdsRef.current;
        for (const n of localNodes) {
            if (swept.has(n.id)) continue;
            updateNodeInternals(n.id);
            swept.add(n.id);
        }
        // Drop ids that no longer exist so a future re-add of the same id (rare)
        // is re-measured, and the set doesn't grow unbounded across a session.
        if (swept.size > localNodes.length) {
            const live = new Set(localNodes.map((n) => n.id));
            for (const id of Array.from(swept)) if (!live.has(id)) swept.delete(id);
        }
    }, [nodesInitialized, localNodes, updateNodeInternals]);

    // One-shot smooth fit-to-node when something elsewhere (e.g. the Run
    // Workflow error popover) sets `pendingCenterNodeId`. We pan + zoom-to-fit
    // the single node, select it, and clear the field.
    const pendingCenterNodeId = useAppStore((s) => s.pendingCenterNodeId);
    const clearPendingCenterNodeId = useAppStore((s) => s.clearPendingCenterNodeId);
    const setCurrentSelectedNodeIds = useAppStore((s) => s.setCurrentSelectedNodeIds);
    const selectionClearToken = useAppStore((s) => s.selectionClearToken);
    const liveNodePositions = useAppStore((s) => s.liveNodePositions);

    // Overlay live peer-drag positions onto localNodes for rendering. When the
    // map is empty (no collaboration, or no peer currently dragging) this returns
    // the exact same localNodes reference — zero overhead for solo sessions. Only
    // the peer-dragged node gets a new object, so only it re-renders.
    const renderedNodes = useMemo(() => {
        if (!liveNodePositions || Object.keys(liveNodePositions).length === 0) return localNodes;
        return localNodes.map((n: any) =>
            liveNodePositions[n.id]
                ? { ...n, position: liveNodePositions[n.id] }
                : n
        );
    }, [localNodes, liveNodePositions]);

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

    // One-shot add-by-click from side panels (e.g. Characters): drop the
    // requested node at the current viewport center. Routes through the same
    // `onDrop` as drag-and-drop, so it gets model resolution + the `isNew`
    // pop animation. Window center maps into the full-bleed canvas pane (and
    // sits clear of the left-edge panels), with a little jitter so repeated
    // adds don't stack exactly on top of each other.
    const pendingAddNode = useAppStore((s) => s.pendingAddNode);
    const clearPendingAddNode = useAppStore((s) => s.clearPendingAddNode);
    useEffect(() => {
        if (!pendingAddNode || !reactFlowInstance) return;
        const jitter = () => (Math.random() - 0.5) * 80;
        const position = reactFlowInstance.screenToFlowPosition({
            x: window.innerWidth / 2 + jitter(),
            y: window.innerHeight / 2 + jitter(),
        });
        onDrop(pendingAddNode.type as any, position, pendingAddNode.nodeTypeId, pendingAddNode.modelId, pendingAddNode.initialConfig);
        clearPendingAddNode();
    }, [pendingAddNode, reactFlowInstance, onDrop, clearPendingAddNode]);

    // ── Realtime collaboration (live cursors, presence, peer drags + ops) ────
    // Everything here is INERT for the single-user / owner-not-collaborating
    // path: `me` is null until auth resolves, and `canvasId` is the shared
    // canvas id. The hook returns no-op senders while `me` is null, and the
    // cursor overlay renders nothing until a peer broadcasts. None of these
    // sends fire for a non-collaborative session because peers never join the
    // channel.
    const me = useCurrentUser();
    const collabRole = useAppStore((s) => s.collabRole);
    const canvasId = useAppStore((s) => s.activeCanvasId);
    const cursorsRef = useRef<CursorsHandle>(null);
    // Throttle timestamps for high-frequency broadcasts (cursor move, peer-drag).
    const lastCursorSentRef = useRef(0);
    const lastDragSentRef = useRef(0);
    // Bug 2 fix: last-known cursor position in flow coords. Updated on every
    // cursor send so onPeerJoined can re-emit it once to seed a new joiner.
    const lastCursorPosRef = useRef<{ x: number; y: number } | null>(null);
    // Ephemeral peer-selection marquee tracking. isMarqueeingRef gates the
    // wrapper mousemove path; marqueeStartRef holds the drag origin (flow
    // coords); marqueeRef holds the current rect so the selection-change effect
    // can include it. All refs — they never trigger a local re-render.
    const isMarqueeingRef = useRef(false);
    const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
    const marqueeRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
    // Viewers may broadcast their cursor but never edit ops.
    const canEdit = collabRole !== 'viewer';

    // Merge an incoming peer's full structural state into currentWorkflow.
    // We take the peer's nodes/edges as the source of truth for STRUCTURE
    // (positions, config, parentNode, add/delete, group geometry) but preserve
    // the RECEIVER's own selection and execution state, since those are local
    // concerns the peer has no authority over:
    //   - `selected` comes from this client's React Flow store, not the peer.
    //   - status/output/outputMetadata/error come from node_results (the
    //     execution engine), never from a peer's canvas blob.
    // Applying with dirty=false means this does NOT retrigger our outbound
    // state broadcast or the autosave — that's how the echo is avoided.
    const applyRemoteState = useCallback((payload: { nodes?: any[]; edges?: any[] }) => {
        // Don't yank a node out from under a local drag; the next broadcast (or
        // the 2s DB sync) reconciles once the drag settles.
        if (useAppStore.getState().isDragging) return;
        const cur = useAppStore.getState().currentWorkflow;
        if (!cur) return;
        const existingById = new Map(cur.nodes.map((n) => [n.id, n]));
        const mergedNodes = (payload.nodes || []).map((inc: any) => {
            const ex = existingById.get(inc.id);
            return {
                ...inc,
                selected: (ex as any)?.selected ?? false, // preserve receiver's selection
                data: {
                    ...inc.data,
                    // Preserve receiver's execution state (results come from
                    // node_results, not the peer's structure-only broadcast).
                    status: ex?.data?.status,
                    output: ex?.data?.output,
                    outputMetadata: ex?.data?.outputMetadata,
                    errorMessage: ex?.data?.errorMessage,
                    error: (ex?.data as any)?.error,
                },
            };
        });
        // dirty=false → applied peer state does NOT rebroadcast/save.
        useAppStore.getState().setCurrentWorkflow(
            { ...cur, name: cur.name, id: cur.id, nodes: mergedNodes, edges: payload.edges || [] },
            false,
        );
        // Committed positions/sizes now live in currentWorkflow — drop any live
        // ghosts (peer drag positions + peer group-resize geometry).
        useAppStore.getState().clearLiveNodePositions();
        useAppStore.getState().clearLiveNodeSizes();
    }, []);

    const { sendCursor, sendNodeDrag, sendNodeDrags, sendState, sendSelection, sendGroupResize } = useWorkflowCollaboration(
        canvasId,
        me ? { id: me.id, name: me.name, role: (collabRole || 'editor') } : null,
        {
            // Ephemeral peer selection (marquee box + selected-node outlines).
            // Writes ONLY to peerSelections — never to the local RF selection.
            onSelection: (p) => {
                useAppStore.getState().setPeerSelection(p.userId, {
                    selectedIds: p.selectedIds || [],
                    marquee: p.marquee || null,
                });
            },
            onCursor: (c) => {
                const p = useAppStore.getState().presence[c.userId];
                cursorsRef.current?.update(c.userId, p?.name || 'User', p?.color || '#888', c.x, c.y);
            },
            onNodeDrag: (e) => {
                // Normalize both the new multi-node shape ({ items: [{id,x,y}] })
                // and the legacy single-node shape ({ nodeId, x, y }).
                const store = useAppStore.getState();
                if (Array.isArray(e?.items)) {
                    for (const item of e.items) {
                        store.setLiveNodePosition(item.id, { x: item.x, y: item.y });
                    }
                } else if (e?.nodeId && typeof e.x === 'number' && typeof e.y === 'number') {
                    store.setLiveNodePosition(e.nodeId, { x: e.x, y: e.y });
                }
            },
            onState: (payload) => { applyRemoteState(payload); },
            // In-flight group resize from a peer → live size override read by
            // that group's GroupNode (cleared when the committed state arrives).
            onGroupResize: (e) => {
                if (!e?.nodeId) return;
                useAppStore.getState().setLiveNodeSize(e.nodeId, { w: e.w, h: e.h, sx: e.sx, sy: e.sy });
            },
            // Bug 2 fix: a new peer just joined — re-emit our last cursor
            // position once so they immediately see where we are, without us
            // having to move. This is a single extra broadcast per join event;
            // joins are rare so steady-state cost is ~zero. No-ops when we
            // haven't moved yet (lastCursorPosRef is null) or when we're not a
            // real user (me is null — sendCursor is already a no-op then).
            onPeerJoined: () => {
                const pos = lastCursorPosRef.current;
                if (pos) sendCursor(pos.x, pos.y);
            },
        },
    );

    // Broadcast the current structural state to peers right now (no debounce).
    // Shared by the debounced auto-broadcast effect and the gesture-commit path.
    const broadcastStateNow = useCallback(() => {
        const latest = useAppStore.getState().currentWorkflow;
        if (!latest) return;
        // Sanitize: structure only. Stripping execution state keeps the payload
        // small and avoids clobbering the peer's own results.
        const sanitizedNodes = latest.nodes.map((n) => ({
            ...n,
            data: {
                ...n.data,
                status: undefined,
                output: undefined,
                outputMetadata: undefined,
                errorMessage: undefined,
                error: undefined,
            },
        }));
        sendState(sanitizedNodes, latest.edges || []);
    }, [sendState]);

    // Canvas-level collaboration API for node components that own their pointer
    // gestures (GroupNode's resize handles) and so can't ride ReactFlow's drag
    // events. Lets them broadcast live resize geometry + cursor during the drag.
    // Throttle mirrors handlePaneMouseMove (shared 35ms cursor gate).
    const collabCanvasApi = useMemo(() => ({
        liveResize: (nodeId: string, w: number, h: number, sx: number, sy: number) => {
            if (!me || !canvasId) return;
            sendGroupResize(nodeId, w, h, sx, sy);
        },
        cursorMove: (clientX: number, clientY: number) => {
            if (!me || !reactFlowInstance) return;
            const now = Date.now();
            if (now - lastCursorSentRef.current < 35) return;
            lastCursorSentRef.current = now;
            const pos = reactFlowInstance.screenToFlowPosition({ x: clientX, y: clientY });
            sendCursor(pos.x, pos.y);
        },
        // On gesture commit, push the settled structure at once so it replaces
        // the peer's live ghost immediately instead of after the 250ms debounce
        // (which post-commit measured-size churn keeps rescheduling). Gated like
        // the debounced effect — viewers/solo don't send.
        commitNow: () => {
            if (!canEdit || !me || !canvasId) return;
            broadcastStateNow();
        },
    }), [me, canvasId, canEdit, reactFlowInstance, sendGroupResize, sendCursor, broadcastStateNow]);

    // ── Outbound structural state broadcast (instant peer sync) ──────────────
    // Mirrors the autosave trigger but on a much shorter debounce. Fires ONLY
    // for a SETTLED local edit: gated on isWorkflowDirty so applied peer state
    // (which sets dirty=false) can't echo, and on !isDragging so we send one
    // structural snapshot when the drag commits rather than spamming per tick
    // (live in-flight motion rides the separate node-drag channel). The 2s DB
    // autosave still runs alongside this for durability.
    const isWorkflowDirtyForBroadcast = useAppStore((s) => s.isWorkflowDirty);
    const isDraggingForBroadcast = useAppStore((s) => s.isDragging);
    const currentWorkflowForBroadcast = useAppStore((s) => s.currentWorkflow);
    const stateBroadcastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        if (!canEdit || !me || !canvasId) return;
        if (!isWorkflowDirtyForBroadcast || isDraggingForBroadcast) return;
        const wf = currentWorkflowForBroadcast;
        if (!wf) return;

        if (stateBroadcastTimerRef.current) clearTimeout(stateBroadcastTimerRef.current);
        stateBroadcastTimerRef.current = setTimeout(broadcastStateNow, 250);

        return () => {
            if (stateBroadcastTimerRef.current) clearTimeout(stateBroadcastTimerRef.current);
        };
    }, [canEdit, me, canvasId, isWorkflowDirtyForBroadcast, isDraggingForBroadcast, currentWorkflowForBroadcast, broadcastStateNow]);

    // Drop a peer's cursor element when they leave the roster.
    const presenceForCursors = useAppStore((s) => s.presence);
    const knownCursorIdsRef = useRef<Set<string>>(new Set());
    useEffect(() => {
        const live = new Set(Object.keys(presenceForCursors));
        // Remove cursors for anyone who left + our own (never render self).
        for (const id of Array.from(knownCursorIdsRef.current)) {
            if (!live.has(id)) {
                cursorsRef.current?.remove(id);
                // Drop the departed peer's selection overlay too, so a stale
                // marquee/outline doesn't linger after they leave.
                useAppStore.getState().clearPeerSelection(id);
                knownCursorIdsRef.current.delete(id);
            }
        }
        for (const id of live) {
            if (me && id === me.id) continue;
            knownCursorIdsRef.current.add(id);
        }
        if (me) cursorsRef.current?.remove(me.id);
    }, [presenceForCursors, me]);

    // Throttled pane-move → broadcast our cursor in FLOW coordinates so peers
    // map it through their own viewport. Viewers may still send cursors.
    const handlePaneMouseMove = useCallback((e: React.MouseEvent) => {
        if (!me || !reactFlowInstance) return;
        const now = Date.now();
        if (now - lastCursorSentRef.current < 35) return;
        lastCursorSentRef.current = now;
        const pos = reactFlowInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY });
        lastCursorPosRef.current = pos;
        sendCursor(pos.x, pos.y);
        // While drag-to-selecting, also broadcast the live marquee rectangle so
        // peers see A's selection box. Reuses the cursor throttle gate above.
        if (isMarqueeingRef.current && marqueeStartRef.current) {
            const start = marqueeStartRef.current;
            const rect = {
                x: Math.min(start.x, pos.x),
                y: Math.min(start.y, pos.y),
                w: Math.abs(pos.x - start.x),
                h: Math.abs(pos.y - start.y),
            };
            marqueeRef.current = rect;
            // Read the live selected ids from the store at send time so the
            // outlines stay in sync as nodes enter the box.
            sendSelection(useAppStore.getState().currentSelectedNodeIds, rect);
        }
    }, [me, reactFlowInstance, sendCursor, sendSelection]);

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

    // Mirror the live React Flow selection into the global store so the chat
    // can render the selection pill and build the NodeRef focus hint. Depends
    // on the same stable string key the memo uses, so it only fires when the
    // selected SET changes — not on drag/hover re-renders.
    useEffect(() => {
        // During a marquee, hold off mirroring to the store — the chat pill is
        // a downstream effect that doesn't need per-node updates mid-drag. When
        // isMarqueeActive flips false on selection-end, this re-runs with the
        // final selectedNodeIds and writes once.
        if (isMarqueeActive) return;
        setCurrentSelectedNodeIds(selectedNodeIds);
    }, [isMarqueeActive, selectedNodeIds, setCurrentSelectedNodeIds]);

    // Broadcast the local selection-node set to peers so they see A's selected
    // nodes outlined (the live marquee box rides the separate mousemove path).
    // Watches the store's currentSelectedNodeIds so it fires once the selection
    // settles — including after a marquee, when the mirror effect above writes
    // the final set. sendSelection no-ops while solo (me === null), so this is
    // inert for non-collaborative sessions. We only READ the selection here;
    // nothing writes back to the local RF selection.
    const localSelectedIds = useAppStore((s) => s.currentSelectedNodeIds);
    useEffect(() => {
        if (!me) return;
        sendSelection(localSelectedIds, marqueeRef.current);
    }, [localSelectedIds, me?.id, sendSelection]);

    // When the chat pill's X button bumps selectionClearToken, deselect every
    // node on the canvas. Skip the initial mount (token unchanged) so we don't
    // fight an existing selection on load. Mirrors the pendingCenterNodeId pattern.
    const lastClearTokenRef = useRef(selectionClearToken);
    useEffect(() => {
        if (selectionClearToken === lastClearTokenRef.current) return;
        lastClearTokenRef.current = selectionClearToken;
        if (!reactFlowInstance) return;
        reactFlowInstance.setNodes((nds: any[]) =>
            nds.map((n) => (n.selected ? { ...n, selected: false } : n)),
        );
    }, [selectionClearToken, reactFlowInstance]);

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

    // Selection-mode run: validate the selected set as if they ran together
    // (treating siblings as fellow executors), so the multi-select toolbar's
    // Run button can disable itself when any selected node has wiring errors.
    // Reads the same nodeOutputs the workflow-wide validator does — a cached
    // upstream from a prior run satisfies missing-input checks.
    const currentWorkflowForSelectionValidation = useAppStore((s) => s.currentWorkflow);
    const nodeOutputsForSelectionValidation = useAppStore((s) => s.nodeOutputs);
    const modelsForSelectionValidation = useAppStore((s) => s.models);

    // Expand selectedNodeIds to also include children of any selected group
    // containers. Mirrors the fold pattern used by delete/download so that
    // selecting a group acts on its contents. Returns a list of actual
    // executable node ids (groups themselves filtered out).
    const expandSelectionWithGroupChildren = useCallback((selIds: string[]): string[] => {
        const wf = useAppStore.getState().currentWorkflow;
        if (!wf) return [];
        const out = new Set<string>();
        const selSet = new Set(selIds);
        for (const n of wf.nodes) {
            if (selSet.has(n.id) && n.type !== 'group_container') out.add(n.id);
            // Child of a selected group → include the child (but never the group).
            if (n.parentNode && selSet.has(n.parentNode) && n.type !== 'group_container') {
                out.add(n.id);
            }
        }
        return Array.from(out);
    }, []);

    const selectionRunErrors = useMemo(() => {
        // Skip the full-workflow validation while a marquee is in flight — it'd
        // run once per node entering the box. Recomputes on selection-end.
        if (isMarqueeActive) return [];
        if (selectedNodeIds.length < 2 || !currentWorkflowForSelectionValidation) return [];
        const wf = currentWorkflowForSelectionValidation;
        // Fold group children in so selecting a group with an AI gen inside
        // counts the AI gen as a run target.
        const targetIds = expandSelectionWithGroupChildren(selectedNodeIds);
        if (targetIds.length === 0) return [];
        const completedNodeIds = new Set<string>();
        for (const n of wf.nodes) {
            const liveOut = nodeOutputsForSelectionValidation?.[n.id];
            const persistedOut = (n.data as any)?.output;
            if (liveOut != null || persistedOut != null) completedNodeIds.add(n.id);
        }
        return validateExecution({
            workflow: wf,
            runMode: 'selection',
            targetNodeId: null,
            targetNodeIds: targetIds,
            completedNodeIds,
            sharedRegistry,
            models: modelsForSelectionValidation ?? [],
        });
    }, [isMarqueeActive, selectedNodeIds, currentWorkflowForSelectionValidation, nodeOutputsForSelectionValidation, modelsForSelectionValidation]);

    const triggerRunSelection = useAppStore((s) => s.triggerRunSelection);
    const selectNodeAndCenter = useAppStore((s) => s.selectNodeAndCenter);
    const [showSelectionErrorPopover, setShowSelectionErrorPopover] = useState(false);

    // Only show the Run button if at least one effectively-selected node has
    // a "run" affordance — i.e. a generative node that actually triggers a
    // new generation. "Effectively selected" includes children of any selected
    // group container, so selecting a group with an AI gen inside still shows
    // the button. Pure ephemeral selections (prompts, compositors, blurs)
    // recompute live in the canvas and don't need an explicit run.
    const selectionHasRunnable = useMemo(() => {
        if (isMarqueeActive) return false;
        if (selectedNodeIds.length < 2 || !currentWorkflowForSelectionValidation) return false;
        const wf = currentWorkflowForSelectionValidation;
        const expandedIds = expandSelectionWithGroupChildren(selectedNodeIds);
        return expandedIds.some((id) => {
            const n = wf.nodes.find((nn) => nn.id === id);
            if (!n) return false;
            const def = (sharedRegistry as any)[n.type];
            return !!def && def.family === 'generative';
        });
    }, [isMarqueeActive, selectedNodeIds, currentWorkflowForSelectionValidation, expandSelectionWithGroupChildren]);

    const handleRunSelected = useCallback(() => {
        if (selectionRunErrors.length > 0) return;
        // Same expansion as the validator — selecting a group runs its
        // contents, not the group itself.
        const targetIds = expandSelectionWithGroupChildren(selectedNodeIds);
        if (targetIds.length === 0) return;
        triggerRunSelection(targetIds);
    }, [selectionRunErrors.length, selectedNodeIds, triggerRunSelection, expandSelectionWithGroupChildren]);

    // Reuse handleDeleteSelected — it already folds group children into the
    // delete set when a group is in the selection (Task 9).

    const mouseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const wrapperRectRef = useRef<{ left: number; top: number } | null>(null);
    // Cursor-spotlight throttling: high-poll mice fire many mousemove events per
    // frame, and each `--mouse-x/y` write repositions a full-viewport gradient
    // mask (a full-layer repaint). We coalesce to at most one write per frame.
    const mouseRafRef = useRef<number | null>(null);
    const latestMousePosRef = useRef<{ x: number; y: number } | null>(null);

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

    // Nodes the AI just added are held invisible (BaseNode/GroupNode opacity 0)
    // until the end-of-turn measured re-layout reveals them in their settled
    // positions. Hide any edge touching one of those nodes too — otherwise the
    // wires dangle to not-yet-visible / mis-positioned nodes, which is the
    // "only lines, nothing sitting right" intermediate the user sees mid-turn.
    // revealAddedNodes() clears the set, so the edges appear with their nodes.
    const hiddenAddedIds = useAppStore((s) => s.aiTurn?.hiddenAddedIds);

    const memoizedEdges = useMemo(() => {
        const hiddenSet = hiddenAddedIds && hiddenAddedIds.length > 0
            ? new Set(hiddenAddedIds)
            : null;
        return edges.map(e => {
            if (hiddenSet && (hiddenSet.has(e.source) || hiddenSet.has(e.target))) {
                return { ...e, type: 'default', animated: false, hidden: true };
            }
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
        });
    }, [edges, edgeStyle, dimmedNodeIds, hiddenAddedIds]);

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

        // Track resize lifecycle. NodeResizer marks its dimension changes with
        // resizing:true per tick and resizing:false on release; flip the ref so
        // the sync effect (above) and the store filter (below) both know a
        // resize is in flight. Persisted across calls because RF's ResizeObserver
        // emits flagless measured-dimension changes mid-resize that must also be
        // recognised as "still resizing".
        for (const c of transformed as any[]) {
            if (c.type === 'dimensions' && typeof c.resizing === 'boolean') {
                isResizingRef.current = c.resizing;
            }
        }

        // Update local state immediately for zero-lag UI
        setLocalNodes((nds) => applyNodeChanges(transformed, nds));

        // Only propagate non-position changes to the global store immediately.
        // Position changes are batched and sent onDragStop. Dimension changes
        // mid-resize (NodeResizer emits one per pointer tick with resizing:true)
        // are likewise skipped — the node component commits the final size on
        // resize-end so per-tick writes don't cascade through every Zustand
        // subscriber.
        const structuralChanges = transformed.filter(c => {
            if (c.type === 'position') return false;
            // Keep ALL dimension changes out of the store while a resize is in
            // flight — not just the resizing:true ticks. RF's ResizeObserver
            // also emits flagless measured-dimension changes during the drag;
            // letting those reach the store re-fires the propNodes sync and
            // resets the node's live position. The final size is committed once
            // by BaseNode's onResizeEnd.
            if (c.type === 'dimensions' && (isResizingRef.current || (c as any).resizing === true)) return false;
            // Selection is view-only — it lives in localNodes (applied above for
            // an instant highlight) and is NEVER pushed to currentWorkflow.
            // Writing it to the store rebuilt currentWorkflow on every select,
            // re-rendering every subscriber (chat Messages, GroupNodes,
            // AppLayout, panels, toolbar validation) — O(workflow) per click,
            // the residual large-graph lag. Nothing reads currentWorkflow's
            // `.selected` (only RF's internal store), so dropping it is safe.
            if (c.type === 'select') return false;
            return true;
        });
        if (structuralChanges.length > 0) {
            onNodesChange(structuralChanges);
        }
    }, [onNodesChange, reactFlowInstance, localNodes]);

    // Marquee box-selection lifecycle. Selection lives only in localNodes; these
    // handlers just gate the downstream (pill/validation/toolbar) work so it runs
    // once on release rather than per node entering the box.
    const handleSelectionStart = useCallback((event?: React.MouseEvent) => {
        isSelectingRef.current = true;
        // Begin tracking the peer-selection marquee. The origin is the drag's
        // start point in flow coords; the wrapper mousemove path computes + sends
        // the rect from here. No-op for solo (sendSelection guards on `me`).
        if (reactFlowInstance && event && typeof event.clientX === 'number') {
            isMarqueeingRef.current = true;
            marqueeStartRef.current = reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
        }
        // Make floating overlays click-through for the drag so the marquee
        // pointer never leaves the React Flow pane (which would fire the pane's
        // mouseleave → onSelectionEnd and cancel the selection) and so it can't
        // start a native text selection in the chat — see the
        // `.marquee-passthrough` rule in globals.css. Toggled imperatively to
        // avoid re-rendering the canvas/overlays mid-drag.
        document.body.classList.add('marquee-selecting');
        // Suspends the selection-derived heavy work (run-validation, pill
        // mirror, multi-select toolbar) for the duration of the drag — see the
        // gates below. The live node highlight is unaffected (it rides on
        // localNodes), so nodes still select instantly; only the downstream
        // logic waits until the box is released.
        setIsMarqueeActive(true);
    }, [reactFlowInstance]);

    const handleSelectionEnd = useCallback(() => {
        // Always restore overlay interactivity, even if we early-return below.
        document.body.classList.remove('marquee-selecting');
        // Tear down the peer-selection marquee tracking and clear the box for
        // peers (the selected-node outlines persist via the selection-change
        // effect below). Done unconditionally so a stray end can't strand the box.
        isMarqueeingRef.current = false;
        marqueeStartRef.current = null;
        marqueeRef.current = null;
        sendSelection(useAppStore.getState().currentSelectedNodeIds, null);
        if (!isSelectingRef.current) return;
        isSelectingRef.current = false;
        // Un-gating isMarqueeActive lets the pill mirror + validation memos run
        // once now, against the final localNodes selection. Selection itself is
        // already committed locally (handleNodesChange) — there's nothing to push
        // to the store, since selection no longer lives in currentWorkflow.
        setIsMarqueeActive(false);
    }, [sendSelection]);

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

    const handleNodeDrag: NodeDragHandler = useCallback((event, node, nodes) => {
        // Broadcast the live drag to peers (throttled). Editors/owners only —
        // viewers can't reach this handler since nodesDraggable is gated by
        // readOnly, but guard on canEdit defensively. No-op when not collaborating.
        if (canEdit) {
            const now = Date.now();
            if (now - lastDragSentRef.current >= 35) {
                lastDragSentRef.current = now;
                // Broadcast ALL dragged nodes (multi-select). The peer overlays
                // each onto liveNodePositions. Dragging a group node carries only
                // the group; its children render parentNode-relative so they
                // follow automatically. Fall back to the single node if RF didn't
                // supply the multi-node array.
                if (nodes && nodes.length > 0) {
                    sendNodeDrags(nodes.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y })));
                } else {
                    sendNodeDrag(node.id, node.position.x, node.position.y);
                }
                // Cursor freezes for peers during a node drag because RF captures
                // the pointer (wrapper onMouseMove stops firing). Re-broadcast the
                // cursor from the drag event so the dragger's cursor keeps moving.
                if (event && reactFlowInstance && 'clientX' in event) {
                    const p = reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
                    sendCursor(p.x, p.y);
                }
            }
        }

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
    }, [reactFlowInstance, setDragHoverGroupId, canEdit, sendNodeDrag, sendNodeDrags, sendCursor]);

    const handleNodeDragStop: NodeDragHandler = useCallback((event, node, nodes) => {
        isDraggingRef.current = false;
        setIsDragging(false);

        // Sync final positions to global store
        const positionsMap = new Map<string, { x: number; y: number }>();
        nodes.forEach(n => positionsMap.set(n.id, n.position));

        if (updatePositions) {
            updatePositions(positionsMap);
        }
        // Committed positions are picked up by the outbound `state` broadcast
        // (the position write dirties the workflow → debounced full-structure
        // sync). No per-node op broadcast here anymore.

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

    // Live selection drag — broadcast all dragged nodes' positions (throttled)
    // plus the dragger's cursor (RF captures the pointer during a selection
    // drag too, so the wrapper onMouseMove stops firing). Mirrors handleNodeDrag.
    const handleSelectionDrag = useCallback((event: React.MouseEvent, nodes: Node[]) => {
        if (!canEdit) return;
        const now = Date.now();
        if (now - lastDragSentRef.current < 35) return;
        lastDragSentRef.current = now;
        if (nodes && nodes.length > 0) {
            sendNodeDrags(nodes.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y })));
        }
        if (event && reactFlowInstance && 'clientX' in event) {
            const p = reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
            sendCursor(p.x, p.y);
        }
    }, [canEdit, reactFlowInstance, sendNodeDrags, sendCursor]);

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
        if (readOnly) return;
        touchInteraction();
        onConnect(connection);
        // The new edge dirties the workflow → the outbound `state` broadcast
        // syncs the full {nodes, edges} structure to peers (no per-op send).
    }, [touchInteraction, onConnect, readOnly]);

    // Capture the originating side of a connection drag so we can filter the
    // context menu by data-type compatibility when it ends on empty canvas.
    const handleConnectStart = useCallback((_event: any, params: { nodeId: string | null; handleId: string | null; handleType: 'source' | 'target' | null }) => {
        if (readOnly) return;
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
    }, [reactFlowInstance, models, readOnly]);

    // Wire dropped on canvas (not on a handle/node) → open the filtered context
    // menu so the user can pick a compatible node and have it auto-wired.
    const handleConnectEnd = useCallback((event: MouseEvent | TouchEvent) => {
        const start = connectStartRef.current;
        connectStartRef.current = null;
        setWireDrag(null);
        if (readOnly || !start) return;

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
    }, [reactFlowInstance, readOnly]);

    const handleEdgeClick = useCallback((e: React.MouseEvent, edge: Edge) => {
        e.stopPropagation();
        if (readOnly) return;
        touchInteraction();
        onEdgesChange([{ type: 'remove', id: edge.id }]);
    }, [touchInteraction, onEdgesChange, readOnly]);

    const handleDrop = useCallback((event: React.DragEvent) => {
        event.preventDefault();
        if (!reactFlowInstance) return;

        const rawData = event.dataTransfer.getData('application/reactflow');
        if (rawData) {
            try {
                const payload = JSON.parse(rawData);
                const position = reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
                onDrop(payload.type, position, payload.node_type_id, payload.model_id, payload.initialConfig);
                return;
            } catch (e) { /* fallback to file-drop handling */ }
        }

        // OS-file drop: mirror the assets-panel UX. Filter to image/video/audio,
        // spawn an empty media_input at the drop point with a transient
        // _isUploading flag that drives the in-node GlassyLoader, then upload
        // in the background and populate config.images on success.
        const mediaFiles = Array.from(event.dataTransfer.files || []).filter(
            (f) => f.type.startsWith('image/') || f.type.startsWith('video/') || f.type.startsWith('audio/'),
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

        // Enforce the per-handle max_items limit on array-capable model inputs.
        // Reject the drop once the handle already holds its configured maximum.
        const maxItems = getInputHandleMaxItems(targetNode as any, connection.targetHandle, models);
        if (maxItems != null) {
            const existing = reactFlowInstance.getEdges().filter(
                (e: any) => e.target === connection.target && (e.targetHandle ?? null) === (connection.targetHandle ?? null),
            ).length;
            if (existing >= maxItems) return false;
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
        // Clicking empty canvas clears the property-panel selection.
        onPaneClickProp?.();
    }, [onPaneClickProp]);

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

    // RF's wheel handler skips events whose target sits inside a `.nowheel`
    // element (toolbars, group title, etc.) — correct for plain wheel-pan, but
    // it also means Ctrl+wheel over those elements falls through to the
    // browser, which zooms the whole page. Catch that case at the wrapper and
    // do a cursor-anchored canvas zoom instead. Native listener with
    // passive:false is required so preventDefault() actually blocks the
    // browser zoom.
    useEffect(() => {
        const wrapper = reactFlowWrapper.current;
        if (!wrapper || !reactFlowInstance) return;

        const handleWheel = (e: WheelEvent) => {
            if (!(e.ctrlKey || e.metaKey)) return;
            const target = e.target as HTMLElement | null;
            if (!target || !target.closest('.nowheel')) return;

            e.preventDefault();
            e.stopPropagation();

            const { x, y, zoom } = reactFlowInstance.getViewport();
            const zoomFactor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
            const newZoom = Math.min(2, Math.max(0.1, zoom * zoomFactor));
            if (newZoom === zoom) return;

            const rect = wrapper.getBoundingClientRect();
            const cursorX = e.clientX - rect.left;
            const cursorY = e.clientY - rect.top;
            const worldX = (cursorX - x) / zoom;
            const worldY = (cursorY - y) / zoom;
            reactFlowInstance.setViewport({
                x: cursorX - worldX * newZoom,
                y: cursorY - worldY * newZoom,
                zoom: newZoom,
            });
        };

        wrapper.addEventListener('wheel', handleWheel, { passive: false, capture: true });
        return () => wrapper.removeEventListener('wheel', handleWheel, { capture: true } as any);
    }, [reactFlowInstance]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (!reactFlowWrapper.current) return;
        // While a selection box, pan, or node drag is in flight, do NOT move the
        // cursor spotlight. Repositioning its full-viewport gradient mask repaints
        // a screen-sized layer every frame, which competes with the drag for the
        // frame budget and makes the box stutter. Freezing the mask (no var change
        // → no repaint) keeps the drag buttery; the spotlight resumes on release.
        if (isSelectingRef.current || isDraggingRef.current) return;

        const rect = wrapperRectRef.current;
        if (!rect) return;
        latestMousePosRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };

        if (!isMouseActive) setIsMouseActive(true);
        if (mouseTimeoutRef.current) clearTimeout(mouseTimeoutRef.current);
        mouseTimeoutRef.current = setTimeout(() => setIsMouseActive(false), 600);

        // Coalesce to one mask reposition per animation frame.
        if (mouseRafRef.current !== null) return;
        mouseRafRef.current = requestAnimationFrame(() => {
            mouseRafRef.current = null;
            const pos = latestMousePosRef.current;
            const el = reactFlowWrapper.current;
            if (!pos || !el) return;
            el.style.setProperty('--mouse-x', `${pos.x}px`);
            el.style.setProperty('--mouse-y', `${pos.y}px`);
        });
    }, [isMouseActive]);

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
                if (readOnly) return;
                if ((e.target as HTMLElement).closest('.react-flow__node')) return;
                setPendingConnection(null);
                setPendingWireAnchor(null);
                setContextMenu({ x: e.clientX, y: e.clientY });
            }}
            onMouseDownCapture={handleWrapperMouseDown}
            onMouseMove={(e) => { handleMouseMove(e); handlePaneMouseMove(e); }}
            onMouseLeave={() => setIsMouseActive(false)}
        >
            <WireDragProvider value={wireDrag}>
            <NodeValidationProvider>
            <CollabCanvasProvider value={collabCanvasApi}>
            <ReactFlow
                nodes={renderedNodes}
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
                onSelectionStart={handleSelectionStart}
                onSelectionEnd={handleSelectionEnd}
                onSelectionDragStart={handleSelectionDragStart}
                onSelectionDrag={handleSelectionDrag}
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
                deleteKeyCode={readOnly ? null : "Delete"}
                onNodesDelete={handleNodesDelete}
                isValidConnection={handleIsValidConnection}
                panOnScroll={true}
                zoomOnScroll={false}
                zoomOnPinch={true}
                panOnDrag={readOnly ? true : (isPanMode ? PAN_ON_DRAG_PAN : PAN_ON_DRAG_SELECT)}
                selectionOnDrag={!readOnly && !isPanMode}
                selectNodesOnDrag={!readOnly && !isPanMode}
                nodesDraggable={!readOnly && !isPanMode}
                // Don't let React Flow auto-elevate the *selected* node by +1000.
                // The app does its own bring-to-front (bringNodeToFront on click /
                // drag-stop + a local zIndex pop on mousedown), so this default is
                // redundant — and it actively breaks duplication: a freshly created
                // copy is `selected: false` with an explicit zIndex of maxZ+1, but
                // the still-selected SOURCE gets +1000 from RF and renders on top of
                // it. Turning this off makes RF honor the explicit zIndex, so the
                // copy lands above the original deterministically.
                elevateNodesOnSelect={false}
                nodesConnectable={!readOnly}
                elementsSelectable={!readOnly}
                selectionMode={!isPanMode ? SelectionMode.Partial : undefined}
                // Strict mode: React Flow only permits output(source)→input(target)
                // wires and refuses source→source / target→target. Loose mode
                // disabled that guard (it only blocks connecting a handle to
                // itself), which let outputs wire to outputs. The whole
                // validation layer (handleIsValidConnection / getNodeHandleType)
                // already assumes source=output, target=input, so Strict is the
                // correct contract. Dragging from an input handle and node-body
                // auto-wiring still work — neither is gated by connectionMode.
                connectionMode={ConnectionMode.Strict}
                onPaneClick={handlePaneClick}
                proOptions={PRO_OPTIONS}
            >
                <BaseGridLayers />
                <SpotlightGridLayers isMouseActive={isMouseActive} />
                <AiAddedZoom edges={edges} updatePositions={updatePositions} />

                {!isMarqueeActive && selectedNodeIds.length >= 2 && (
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
                            {/* Run selected — only rendered when the selection
                                contains at least one runnable (generative) node.
                                Disabled when any selected node has a wiring error
                                in the selection-set context. Hovering a disabled
                                button opens a popover listing the issues. */}
                            {selectionHasRunnable && (
                            <div
                                className="relative"
                                onMouseEnter={() => selectionRunErrors.length > 0 && setShowSelectionErrorPopover(true)}
                                onMouseLeave={() => setShowSelectionErrorPopover(false)}
                            >
                                <Tooltip
                                    content={selectionRunErrors.length > 0
                                        ? `Can't run — ${selectionRunErrors.length} issue${selectionRunErrors.length === 1 ? '' : 's'}`
                                        : 'Run selected'}
                                    position="top"
                                    delay={600}
                                >
                                    <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleRunSelected(); }}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        disabled={selectionRunErrors.length > 0}
                                        className={
                                            selectionRunErrors.length > 0
                                                ? "w-6 h-6 rounded flex items-center justify-center text-content-tertiary cursor-not-allowed opacity-50"
                                                : "w-6 h-6 rounded flex items-center justify-center text-content-primary hover:bg-white/10 hover:text-accent-primary transition-all"
                                        }
                                    >
                                        <Play className="w-3 h-3 pointer-events-none fill-current" />
                                    </button>
                                </Tooltip>

                                {showSelectionErrorPopover && selectionRunErrors.length > 0 && (
                                    <div className="absolute top-full left-0 mt-1 w-72 max-h-80 overflow-y-auto bg-surface-elevated/95 backdrop-blur-md border border-stroke-subtle rounded-lg shadow-xl shadow-black/20 z-[60] p-2">
                                        <div className="px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider text-content-tertiary">
                                            Can&apos;t run — {selectionRunErrors.length} issue{selectionRunErrors.length === 1 ? '' : 's'}
                                        </div>
                                        <div className="flex flex-col gap-0.5">
                                            {selectionRunErrors.map((err, i) => (
                                                <button
                                                    key={i}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        selectNodeAndCenter(err.nodeId);
                                                        setShowSelectionErrorPopover(false);
                                                    }}
                                                    className="text-left px-2 py-1.5 rounded-md hover:bg-white/5 transition-colors"
                                                >
                                                    <div className="text-xs font-semibold text-content-primary truncate">{err.nodeLabel}</div>
                                                    <div className="text-[11px] text-content-secondary">{formatValidationError(err)}</div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                            )}
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
                    readOnly={readOnly}
                />
            </ReactFlow>
            {/* Remote collaborator cursors — inside the RF provider subtree so
                useReactFlow works, and inside the positioned wrapper so the
                absolute overlay aligns with the canvas. Renders nothing until a
                peer broadcasts a cursor. */}
            <CollaboratorCursors ref={cursorsRef} />
            {/* Peer selection overlay (marquee box + selected-node outlines).
                Same provider subtree so useStore/useViewport resolve; renders
                nothing until a peer broadcasts a selection. */}
            <CollaboratorSelections />
            </CollabCanvasProvider>
            </NodeValidationProvider>
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
                    onSelectNode={(type, pos, tid, mid, _autoHandle, initialConfig) => {
                        const flowPos = reactFlowInstance.screenToFlowPosition({ x: pos.x, y: pos.y });
                        const pending = pendingConnection;
                        const dropClient = pending ? { x: pos.x, y: pos.y } : null;
                        const beforeIds = new Set(
                            (useAppStore.getState().currentWorkflow?.nodes || []).map((n: any) => n.id),
                        );

                        onDrop(type, flowPos, tid, mid, initialConfig, pending || undefined);
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
