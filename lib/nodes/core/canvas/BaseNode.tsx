'use client';

import React, { memo, useEffect, useMemo, useState } from 'react';
import { Handle, Position, NodeToolbar, NodeResizer, useReactFlow, useEdges, useStore, useStoreApi, ReactFlowState, useUpdateNodeInternals } from 'reactflow';
import { Copy, Trash2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store/app-store';
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';
import type { NodeStatus } from '@/lib/nodes/types';
import { useWireDrag } from '@/lib/editor/wire-drag-context';
import { findHandleForNode, findAllCompatibleHandlesForNode, wouldCreateCycle } from '@/lib/editor/handle-compatibility';
import { useNodeValidationErrors } from '@/lib/hooks/use-node-validation';
import { formatValidationError } from '@/lib/workflow/validate-execution-messages';
import { NodeHeader } from '@/lib/nodes/core/canvas/NodeHeader';
import { Tooltip } from '@/components/ui/Tooltip';
import { motion } from 'framer-motion';

// Stable framer-motion prop references.
const ANIMATE_TARGET = { scale: 1, opacity: 1 };
// 🚀 PERFORMANCE FIX: Use a single stable transition object. 
// Toggling between two different transition objects on every drag-start 
// forced Framer Motion to re-reconcile its animation tree, causing the 
// "half-second hesitation" before the node followed the cursor.
const SHARED_TRANSITION = { 
    type: 'spring' as const, 
    bounce: 0, 
    duration: 0.3,
};

const DRAG_TRANSITION = {
    type: 'tween' as const,
    duration: 0,
};

// We use a CSS-only approach for the hover/active states and keep 
// Framer Motion purely for the initial entrance to minimize JS overhead 
// during the drag loop.


export interface BaseNodeProps extends React.HTMLAttributes<HTMLDivElement> {
    id: string;
    type: string;
    label?: string;
    selected?: boolean;
    children?: React.ReactNode;
    width?: string | number;
    // Handle controls
    renderInputs?: boolean;
    renderOutput?: boolean;
    customInputs?: Array<{ id: string; label: string; color: string; type?: string; is_array?: boolean; isMandatory?: boolean }>;
    customOutputs?: Array<{ id: string; label: string; color: string; type?: string; is_array?: boolean; isMandatory?: boolean }>;
    // Additional styling
    contentClassName?: string;
    badgeCount?: number;
    // Custom header actions
    customActions?: React.ReactNode;
    icon?: string;
    hideStatus?: boolean;
    isNew?: boolean;
    /**
     * Opt-in aspect-ratio-locked resizing. When true, BaseNode renders a
     * ReactFlow <NodeResizer> (handles on all four sides + corners, visible
     * only while the node is selected). `keepAspectRatio` snaps the ratio to
     * the node's measured size at grab-start, so dragging any handle — side or
     * diagonal — moves width and height together and the user can never change
     * one axis alone. Off by default; the other plugins are untouched.
     */
    resizable?: boolean;
    minWidth?: number;
    minHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
    // True when THIS node is being dragged. Forwarded from React Flow's NodeProps
    // by each per-type wrapper. Disables animations/transitions only on the node
    // actually moving — never the whole canvas.
    dragging?: boolean;
    /**
     * Node data (forwarded by per-type wrappers from React Flow's NodeProps.data).
     * Used by the wire-drag compatibility check on ai_generator nodes, which read
     * `data.config.model_id`. Optional — falling back to `undefined` is safe; the
     * compatibility helper treats a missing model as "no compatible handles".
     */
    nodeData?: any;
}

const BaseNode = React.forwardRef<HTMLDivElement, BaseNodeProps>(({
    id,
    type,
    label,
    selected,
    children,
    width = 'w-[280px]',
    renderInputs = true,
    renderOutput = true,
    customInputs,
    customOutputs,
    contentClassName = 'p-1',
    className,
    badgeCount,
    customActions,
    icon,
    hideStatus = false,
    isNew,
    dragging = false,
    resizable = false,
    minWidth = 160,
    minHeight = 120,
    maxWidth,
    maxHeight,
    nodeData,
    onDrag,
    onDragStart,
    onDragEnd,
    onAnimationStart,
    onAnimationEnd,
    onTransitionEnd,
    // Destructured out of `props` so the trailing `{...props}` spread on the
    // motion.div CAN'T re-apply it as a flat replacement that clobbers the
    // merged style object below — `borderWidth: 1/zoom` and the selection
    // outline live in that merged object, and losing them on plugins that
    // pass a `style` (Blur, Levels, AI Generator, …) is exactly why their
    // selection ring went sub-pixel on zoom out.
    style: propsStyle,
    ...props
}, ref) => {
    const isDragging = dragging;
    const sharedDef = sharedRegistry[type as keyof typeof sharedRegistry];
    const metadata = sharedDef?.meta;

    // Status and Store Actions
    //
    // Status resolution order:
    //   1. Known status from store (persisted from prior render OR set by
    //      DB hydration / realtime). Shown as-is.
    //   2. No known status BUT a session is currently loading: render as
    //      'pending' so the badge reads as "checking" instead of flashing
    //      'idle'. Critical for cross-device opens where localStorage is
    //      empty — the canvas mounts before getSessionExecutions returns,
    //      and without this fallback running nodes would briefly show no
    //      badge until DB hydration runs.
    //   3. Else: 'idle' (no badge).
    const rawStatus = useAppStore((state) => state.nodeStatuses[id]);
    // Server-side failure message for this node (e.g. the Replicate prediction
    // error), shown as a hover tooltip on the error badge below.
    const nodeError = useAppStore((state) => state.nodeErrors[id]);
    const isLoadingSession = useAppStore((state) => state.isLoadingSession);
    // Per-node validation comes from the canvas-wide NodeValidationProvider,
    // which computes it once and only while the error flash is active. Reading
    // it here (instead of calling useExecutionValidation per node) means a node
    // no longer subscribes to currentWorkflow, so selecting a node doesn't
    // re-render — or re-validate — the entire canvas.
    const validationErrors = useNodeValidationErrors(id);
    const wireDrag = useWireDrag();
    const models = useAppStore((s) => s.models);
    const edges = useEdges();

    const dragRole: 'none' | 'origin' | 'compatible' | 'incompatible' = useMemo(() => {
        if (!wireDrag) return 'none';
        if (wireDrag.originNodeId === id) return 'origin';
        const pending = {
            nodeId: wireDrag.originNodeId,
            handleId: wireDrag.originHandleId,
            handleType: wireDrag.originHandleType,
            dataType: wireDrag.dataType,
        };
        const match = findHandleForNode(
            { id, type, data: { config: nodeData?.config } } as any,
            pending,
            models,
            sharedRegistry,
        );
        return match ? 'compatible' : 'incompatible';
    }, [wireDrag, id, type, nodeData?.config, models]);

    // True when the prospective edge from the wire-drag origin to THIS node
    // (or the reverse, depending on which side originated) would close a
    // directed cycle. Drives the hover toast below; also flips the visual
    // state to 'incompatible' so cycle targets dim the same as type-bad ones.
    const isCycleTarget = useMemo(() => {
        if (!wireDrag) return false;
        if (wireDrag.originNodeId === id) return false;
        // 'source' origin (output handle) → prospective edge is origin → this.
        // 'target' origin (input handle)  → prospective edge is this → origin.
        const src = wireDrag.originHandleType === 'source' ? wireDrag.originNodeId : id;
        const tgt = wireDrag.originHandleType === 'source' ? id : wireDrag.originNodeId;
        return wouldCreateCycle(src, tgt, edges);
    }, [wireDrag, id, edges]);

    // Cycle targets visually read the same as type-incompatible targets — the
    // hover toast (rendered below) is what distinguishes the two cases for
    // the user. We deliberately do NOT fold isCycleTarget into `dragRole`
    // itself: label-reveal logic (compatibleHandleIds, isHandleLabelForced)
    // is type-driven and should keep reading the original dragRole.
    const effectiveDragRole = isCycleTarget ? 'incompatible' : dragRole;

    // Hover gate for the cycle toast. We only show the toast while the user's
    // cursor is over this node AND a cycle-forming wire is in flight — exiting
    // the node clears it ("gone when the user is moving away").
    const [isHoveredDuringWireDrag, setIsHoveredDuringWireDrag] = useState(false);
    // Generic hover state used to reveal the per-node action toolbar. Tracked
    // in React (not CSS :hover) because the toolbar is portaled outside this
    // node's DOM tree, so `group-hover` can't reach it.
    const [isHovered, setIsHovered] = useState(false);
    // Force the action toolbar closed immediately after a click action
    // (duplicate) even if the node stays selected/hovered. Clicking Duplicate
    // on a big graph kicks off a brief re-render cascade; without this the
    // toolbar sits there in its pressed state looking frozen. Dismissing it on
    // click makes the action feel acknowledged instantly. Re-armed on the next
    // pointer-enter so hovering the node again brings the toolbar back.
    const [toolbarDismissed, setToolbarDismissed] = useState(false);
    useEffect(() => {
        // If the wire drag ends while the cursor is still inside the card,
        // onPointerLeave won't fire — reset eagerly.
        if (!wireDrag) setIsHoveredDuringWireDrag(false);
    }, [wireDrag]);

    const compatibleHandleIds = useMemo(() => {
        if (dragRole !== 'compatible' || !wireDrag) return null;
        const pending = {
            nodeId: wireDrag.originNodeId,
            handleId: wireDrag.originHandleId,
            handleType: wireDrag.originHandleType,
            dataType: wireDrag.dataType,
        };
        const handles = findAllCompatibleHandlesForNode(
            { id, type, data: { config: nodeData?.config } } as any,
            pending,
            models,
            sharedRegistry,
        );
        return new Set(handles.map((h) => h.id));
    }, [dragRole, wireDrag, id, type, nodeData?.config, models]);

    /**
     * Decide whether this handle's label should be force-visible because a wire is being dragged.
     *
     * - On the ORIGIN node: the originating handle (matching side + id) is force-visible.
     *   For default-handle nodes (no explicit id) we match when originHandleId is null
     *   AND the handle's resolved id equals the registry's default handle id.
     * - On a COMPATIBLE node: any handle whose id is in `compatibleHandleIds` is force-visible.
     *   (The compatibility helper already restricts to the opposite side of the origin, so we
     *   don't need to gate on side here — the id-set is already side-correct.)
     * - Otherwise: not force-visible.
     */
    const isHandleLabelForced = (handleSide: 'source' | 'target', handleId: string): boolean => {
        if (!wireDrag) return false;
        if (dragRole === 'origin') {
            if (handleSide !== wireDrag.originHandleType) return false;
            // Default-handle case: originHandleId can be null. Treat any handle on
            // the originating side as the origin when the node has no explicit ids.
            if (wireDrag.originHandleId === null) return true;
            return handleId === wireDrag.originHandleId;
        }
        if (dragRole === 'compatible' && compatibleHandleIds) {
            return compatibleHandleIds.has(handleId);
        }
        return false;
    };

    const status: NodeStatus = rawStatus ?? (isLoadingSession ? 'pending' : 'idle');
    const updateNodeLabel = useAppStore((state) => state.updateNodeLabel);
    const setNodeLabelDraft = useAppStore((state) => state.setNodeLabelDraft);
    const touchInteraction = useAppStore((state) => state.touchInteraction);
    const { addNodes, getNode, getNodes, deleteElements } = useReactFlow();
    const updateNodeInternals = useUpdateNodeInternals();
    // Resize commit path. EditorCanvas.handleNodesChange intentionally drops
    // NodeResizer's per-tick `resizing:true` dimension changes from the store
    // (they only update the local-nodes copy for a lag-free preview) and
    // NodeResizer's resize-end change carries no width/height — so without an
    // explicit commit the final size is never written to currentWorkflow and
    // the node snaps back on the next local↔store re-sync. We commit the final
    // size (and position, for top/left handles) here on resize-end, and take a
    // snapshot on resize-start so the resize is a single undoable step.
    const commitNodesChange = useAppStore((state) => state.onNodesChange);
    const takeSnapshot = useAppStore((state) => state.takeSnapshot);
    const storeApi = useStoreApi();

    // Custom edge (border) resize. NodeResizer's edge/line controls anchor a
    // CORNER when aspect-locked — dragging the top edge grows the node up AND
    // sideways from a fixed corner, which reads as "dragging toward a corner".
    // For the border we want the dragged edge to expand with the OPPOSITE edge
    // anchored and the perpendicular axis kept centered (drag top → top expands,
    // bottom stays put, width grows symmetrically). NodeResizer can't reshape
    // the position it emits, so we drive these four edges ourselves and push the
    // same kind of live changes (position + resizing dimensions) through RF's
    // change pipeline — they flow to the canvas local-nodes copy exactly like
    // the corner handles, and stay out of the store until release.
    const beginEdgeResize = (edge: 'top' | 'right' | 'bottom' | 'left') => (e: React.PointerEvent) => {
        e.stopPropagation();
        e.preventDefault();
        const rf = storeApi.getState();
        const node = rf.nodeInternals.get(id);
        if (!node || !node.width || !node.height) return;
        const startW = node.width;
        const startH = node.height;
        const startX = node.position.x;
        const startY = node.position.y;
        const ratio = startW / startH;
        const startClientX = e.clientX;
        const startClientY = e.clientY;
        const zoomNow = rf.transform[2] || 1;
        const last = { W: startW, H: startH, X: startX, Y: startY };

        takeSnapshot();
        setIsResizing(true);
        // resizing:true flips EditorCanvas's isResizingRef so the live changes
        // below are held in localNodes (not the store) and the sync effect
        // doesn't reset our position mid-drag.
        rf.triggerNodeChanges([{ id, type: 'dimensions', resizing: true, updateStyle: true, dimensions: { width: startW, height: startH } } as any]);

        const clampWH = (w: number) => {
            let W = Math.max(minWidth, w);
            if (typeof maxWidth === 'number') W = Math.min(maxWidth, W);
            let H = W / ratio;
            if (H < minHeight) { H = minHeight; W = H * ratio; }
            if (typeof maxHeight === 'number' && H > maxHeight) { H = maxHeight; W = H * ratio; }
            return { W, H };
        };

        const onMove = (ev: PointerEvent) => {
            const dx = (ev.clientX - startClientX) / zoomNow;
            const dy = (ev.clientY - startClientY) / zoomNow;
            let baseW = startW;
            if (edge === 'right') baseW = startW + dx;
            else if (edge === 'left') baseW = startW - dx;
            else if (edge === 'bottom') baseW = (startH + dy) * ratio;
            else baseW = (startH - dy) * ratio; // top
            const { W, H } = clampWH(baseW);
            let X = startX;
            let Y = startY;
            if (edge === 'right' || edge === 'left') {
                Y = startY + (startH - H) / 2;           // vertical centered
                if (edge === 'left') X = startX + (startW - W); // right edge anchored
            } else {
                X = startX + (startW - W) / 2;           // horizontal centered
                if (edge === 'top') Y = startY + (startH - H);  // bottom edge anchored
            }
            last.W = W; last.H = H; last.X = X; last.Y = Y;
            setLiveResize({ width: W, height: H });
            rf.triggerNodeChanges([
                { id, type: 'position', position: { x: X, y: Y } } as any,
                { id, type: 'dimensions', resizing: true, updateStyle: true, dimensions: { width: W, height: H } } as any,
            ]);
        };

        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            setIsResizing(false);
            // resizing:false clears isResizingRef; then commit the final size +
            // position to the store once for persistence (mirrors the corner path).
            rf.triggerNodeChanges([{ id, type: 'dimensions', resizing: false } as any]);
            commitNodesChange([
                { id, type: 'position', position: { x: last.X, y: last.Y } },
                { id, type: 'dimensions', updateStyle: true, resizing: false, dimensions: { width: last.W, height: last.H } },
            ] as any);
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    };

    // Precompute the set of this node's connected target handles once per
    // render so the per-handle "missing mandatory" check is O(1) instead of
    // O(edges) per handle. The empty-targetHandle case (edge created without
    // an explicit handle id) is normalized to '__default__'.
    const connectedTargetHandles = useMemo(() => {
        const set = new Set<string>();
        for (const e of edges) {
            if (e.target === id) set.add(e.targetHandle || '__default__');
        }
        return set;
    }, [edges, id]);

    // Once NodeResizer has run, RF stores an explicit width on node.style
    // (the resize change carries updateStyle:true). Before that the wrapper
    // auto-sizes to content. We read it to decide whether the card should
    // fill the wrapper (post-resize) or keep its natural content size
    // (pre-resize) — flipping to width:100% before the wrapper has a concrete
    // size would collapse the card to zero. Only subscribed to when resizable,
    // so non-resizable nodes pay nothing.
    const explicitWidth = useStore((s: ReactFlowState) =>
        resizable ? (s.nodeInternals.get(id)?.style?.width as number | string | undefined) : undefined
    );
    const hasExplicitSize = resizable && explicitWidth != null;

    // Live drag size. NodeResizer's per-tick dimension changes only reach the
    // canvas's local-nodes copy (the store is intentionally skipped mid-resize),
    // and RF's internal node.style — which `hasExplicitSize` reads — doesn't
    // reflect that live, so the visible card wouldn't grow until the resize-end
    // store commit propagated (the "jumps to size on drop" symptom). We instead
    // read the size straight from NodeResizer's onResize callback and apply it
    // to the card inline, which is guaranteed live. Kept set after the drag (not
    // cleared) so there's no flicker between releasing and the committed style
    // landing in RF's store; resize-start clears it for the next interaction.
    const [liveResize, setLiveResize] = useState<{ width: number; height: number } | null>(null);
    // True only while a resize drag is in progress — used to hide the floating
    // action toolbar above the node so it doesn't fight the resize handles.
    const [isResizing, setIsResizing] = useState(false);

    // Get the current zoom level to compensate border-widths
    const zoom = useStore((s: ReactFlowState) => s.transform[2]);
    const b1 = 1 / zoom;
    const b2 = 2 / zoom;

    // Below ~25% zoom the selection border reads as a heavy band, so taper its
    // weight: full width at/above 25%, thinning toward 0.4x as zoom nears 0.
    const selBorderScale = Math.min(1, Math.max(0.4, zoom / 0.25));
    const selBorderWidth = b1 * selBorderScale;

    // Hide the per-node hover Copy/Delete buttons in multi-select mode (2+
    // selected). The floating multi-select toolbar handles the bulk action,
    // and per-node buttons would only act on this one node — confusing UX.
    // Runs for EVERY node on every React Flow store change (incl. each node
    // entering a marquee). Count with an early-exit and no array allocation —
    // the previous Array.from(...).filter(...).length was O(n) + a fresh n-sized
    // array per node per tick (O(n²) + GC churn across the canvas). Returns a
    // boolean, so nodes only re-render when the 1↔2 threshold actually flips.
    const isMultiSelectActive = useStore((s: ReactFlowState) => {
        let count = 0;
        for (const n of s.nodeInternals.values()) {
            if (n.selected && ++count >= 2) return true;
        }
        return false;
    });

    // Read-only canvas: suppress the per-node hover action toolbar
    // (duplicate/delete/etc.) when editing is disabled — either the mobile
    // canvas preview or a collaboration viewer (view-only) session.
    const isReadOnlyCanvas = useAppStore((state) => state.isMobileCanvasOpen || state.collabRole === 'viewer');

    // Node Color
    const nodeColor = metadata?.color || 'rgb(var(--accent-primary))';
    const displayLabel = label || metadata?.label || 'Node';

    // Labels
    const defaultInputLabel = sharedDef?.handles?.inputs?.[0]?.label;
    const defaultOutputLabel = sharedDef?.handles?.outputs?.[0]?.label;
    const defaultOutputId = sharedDef?.handles?.outputs?.[0]?.id || 'output';

    const handleDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        // Standard React Flow deletion - bubbles up to onNodesDelete in SharedWorkflowEditor
        deleteElements({ nodes: [{ id }] });
    };

    const handleDuplicate = (e: React.MouseEvent) => {
        e.stopPropagation();
        // Dismiss the action toolbar right away — see toolbarDismissed above.
        setIsHovered(false);
        setIsHoveredDuringWireDrag(false);
        setToolbarDismissed(true);
        // Read from Zustand (the source of truth), not from React Flow's internal
        // store — RF's getNode() can return a node whose zIndex/position has been
        // mutated by drag interactions, and addNodes() goes through a sync round-
        // trip that strips zIndex on some platforms. Going directly to onNodesChange
        // gives us deterministic placement.
        const wf = useAppStore.getState().currentWorkflow;
        const sourceNode = wf?.nodes.find((n) => n.id === id);
        if (!wf || !sourceNode) return;

        const maxZ = Math.max(0, ...wf.nodes.map((n) => n.zIndex || 0));
        const offset = 40;

        const newNode: any = {
            id: `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: sourceNode.type,
            position: {
                x: sourceNode.position.x + offset,
                y: sourceNode.position.y + offset,
            },
            zIndex: maxZ + 1,
            selected: false,
            // Deep-clone data so config edits on the duplicate don't mutate the source.
            data: {
                ...JSON.parse(JSON.stringify(sourceNode.data || {})),
                label: `${sourceNode.data?.label || displayLabel} (Copy)`,
            },
            // Preserve grouping membership if the source is inside a group.
            ...((sourceNode as any).parentNode ? { parentNode: (sourceNode as any).parentNode } : {}),
            ...((sourceNode as any).extent ? { extent: (sourceNode as any).extent } : {}),
            ...(sourceNode.width ? { width: sourceNode.width } : {}),
            ...(sourceNode.height ? { height: sourceNode.height } : {}),
        };

        useAppStore.getState().onNodesChange([{ type: 'add', item: newNode } as any]);
    };


    const inputsToRender = customInputs || sharedDef?.handles?.inputs;

    return (
        <motion.div
            ref={ref as any}
            initial={isNew ? { scale: 0.8, opacity: 0 } : false}
            animate={ANIMATE_TARGET}
            onAnimationComplete={() => {
                if (isNew) updateNodeInternals(id);
            }}
            onPointerEnter={() => {
                setIsHovered(true);
                setToolbarDismissed(false);
                if (wireDrag) setIsHoveredDuringWireDrag(true);
            }}
            onPointerLeave={() => {
                setIsHovered(false);
                setIsHoveredDuringWireDrag(false);
            }}
            transition={isDragging ? DRAG_TRANSITION : SHARED_TRANSITION}
            className={cn(
                // CSS transitions on border/shadow/background are kept enabled
                // unconditionally — `transform` is not in this property list, so
                // it never affects drag motion. Toggling the class on drag-flip
                // forced a synchronous style invalidation right when the user
                // started moving the cursor.
                // Selection ring is instant: `border-color` is intentionally NOT
                // in the transition list (it animated over 500ms before). Keeping
                // the backdrop blur — profiling showed it isn't the bottleneck.
                "rounded-2xl border backdrop-blur-xl relative group bg-bg-primary/40 transition-[background-color] duration-500 ease-out",
                selected ? "border-accent-primary shadow-xl outline-none" : "border-stroke-subtle shadow-xl",
                // Hover affects ONLY borders + a barely-perceptible bg tint.
                // Shadow stays constant on hover/drag/click — only the border
                // is allowed to indicate interaction state.
                "hover:border-stroke-strong hover:bg-surface-elevated/20",
                effectiveDragRole === 'incompatible' && "opacity-30 grayscale-[0.6] transition-[border-color,background-color,opacity,filter] duration-150",
                // Resizable cards lay their content out as a flex column so the
                // content area can flex-fill the resized frame. The natural
                // Tailwind width class is dropped once an explicit size exists.
                resizable && "flex flex-col",
                !hasExplicitSize && !liveResize && typeof width === 'string' ? width : '',
                className
            )}
            style={{
                width: typeof width === 'number' ? width : undefined,
                borderWidth: `${selected ? selBorderWidth : b1}px`,
                // Constant-width selection ring using outline (which follows border-radius in modern browsers)
                ...(selected && {
                    outline: `${selBorderWidth}px solid rgb(var(--accent-primary) / 0.2)`,
                    outlineOffset: '0'
                }),
                // No `willChange: 'transform'` here on purpose: that hint made
                // Chromium pre-rasterize each card's composited layer at the
                // viewport scale that was current AT MOUNT TIME, and never
                // refresh it when react-flow's pan/zoom transform changed
                // later. After page refresh, hydrated nodes were stuck at the
                // initial-mount scale and rendered text/icons blurry; newly
                // added nodes mounted post-zoom and looked crisp. Dropping the
                // hint lets Chromium re-rasterize on zoom changes. The
                // .react-flow__node wrapper already has its own transform (and
                // thus its own composited layer) for positioning, so drag
                // performance doesn't regress.
                ...propsStyle,
                // Post-resize: fill the wrapper NodeResizer is now sizing. Last
                // in the object so it wins over any width/height in propsStyle
                // (e.g. media_input's initial max-content style).
                ...(hasExplicitSize ? { width: '100%', height: '100%' } : {}),
                // During (and after) a resize, the live size from onResize takes
                // precedence so the card grows in real time, not just on drop.
                ...(liveResize ? { width: liveResize.width, height: liveResize.height } : {}),
                // Counter-zoom factor consumed by the .react-flow__resize-control
                // CSS so the handles + connecting border keep a constant on-screen
                // size regardless of canvas zoom.
                ...(resizable ? { ['--rfz' as any]: 1 / zoom } : {}),
            }}
            {...props}
        >
            {/* Aspect-ratio-locked resize handles (opt-in via `resizable`).
                Visible only while selected. NodeResizer renders the four
                corner handles plus the connecting border lines (the border
                stays draggable, but only the corners show a grab square).
                keepAspectRatio locks to the node's measured size at grab, so
                every handle drives width and height together. */}
            {resizable && (
                <NodeResizer
                    isVisible={!!selected}
                    keepAspectRatio
                    minWidth={minWidth}
                    minHeight={minHeight}
                    maxWidth={maxWidth}
                    maxHeight={maxHeight}
                    onResizeStart={() => {
                        takeSnapshot();
                        setLiveResize(null);
                        setIsResizing(true);
                    }}
                    onResize={(_evt, params) => {
                        setLiveResize({ width: params.width, height: params.height });
                    }}
                    onResizeEnd={(_evt, params) => {
                        setIsResizing(false);
                        commitNodesChange([
                            { id, type: 'position', position: { x: params.x, y: params.y } },
                            {
                                id,
                                type: 'dimensions',
                                updateStyle: true,
                                resizing: false,
                                dimensions: { width: params.width, height: params.height },
                            },
                        ] as any);
                    }}
                />
            )}

            {/* Edge (border) drag strips — invisible hit areas over each edge,
                inset from the corners so they don't cover the corner handles.
                The visible border is the (now non-interactive) NodeResizer
                lines; these strips own the drag and run the centered,
                opposite-edge-anchored resize in beginEdgeResize. Sizes are in
                screen px (divided by zoom) so the grab area is constant. */}
            {resizable && selected && (() => {
                const t = 14 / zoom;      // strip thickness
                const inset = 20 / zoom;  // clearance from the corner handles
                const base: React.CSSProperties = { position: 'absolute', zIndex: 21 };
                return (
                    <>
                        <div className="nodrag nopan" onPointerDown={beginEdgeResize('top')}
                            style={{ ...base, top: 0, left: inset, right: inset, height: t, transform: 'translateY(-50%)', cursor: 'ns-resize' }} />
                        <div className="nodrag nopan" onPointerDown={beginEdgeResize('bottom')}
                            style={{ ...base, bottom: 0, left: inset, right: inset, height: t, transform: 'translateY(50%)', cursor: 'ns-resize' }} />
                        <div className="nodrag nopan" onPointerDown={beginEdgeResize('left')}
                            style={{ ...base, left: 0, top: inset, bottom: inset, width: t, transform: 'translateX(-50%)', cursor: 'ew-resize' }} />
                        <div className="nodrag nopan" onPointerDown={beginEdgeResize('right')}
                            style={{ ...base, right: 0, top: inset, bottom: inset, width: t, transform: 'translateX(50%)', cursor: 'ew-resize' }} />
                    </>
                );
            })()}
            {/* Cycle-rejection toast. Rendered via NodeToolbar so it sits
                OUTSIDE this card's DOM tree and is unaffected by the
                opacity-30 dim applied to incompatible targets. Only visible
                while the user's cursor is on this node during an in-flight
                wire drag that would close a cycle. */}
            <NodeToolbar
                nodeId={id}
                isVisible={!!wireDrag && isCycleTarget && isHoveredDuringWireDrag}
                position={Position.Top}
                align="start"
            >
                <div className="px-2 py-1 rounded-md bg-bg-primary/90 border border-accent-error/50
                                text-[10px] font-medium text-accent-error whitespace-nowrap shadow-lg
                                pointer-events-none">
                    Circular connections are not allowed
                </div>
            </NodeToolbar>

            {/* Action Buttons — rendered via NodeToolbar so they render in a
                portal at constant screen size (do NOT scale with canvas zoom),
                matching the multi-select and single-group toolbars. Suppressed
                in multi-select mode where the floating selection toolbar
                handles bulk actions. */}
            <NodeToolbar
                nodeId={id}
                isVisible={!isResizing && !isReadOnlyCanvas && !isMultiSelectActive && !toolbarDismissed && (isHovered || !!selected)}
                position={Position.Top}
                align="end"
            >
                {/* Hover-bridge wrapper: the pill is the only visible element,
                    but a transparent strip directly below it covers the gap
                    between the toolbar and the node top. Pointer-enter/leave
                    are tracked on the wrapper, so React fires them only when
                    the cursor truly leaves both the pill AND the bridge —
                    letting the user travel from node → bridge → pill without
                    the toolbar flickering away mid-reach. The bridge can't
                    appear on its own because it only mounts when the toolbar
                    does, which already requires the node to be hovered. */}
                <div
                    className="nopan"
                    style={{ position: 'relative', pointerEvents: 'auto' }}
                    onPointerEnter={() => setIsHovered(true)}
                    onPointerLeave={() => setIsHovered(false)}
                >
                    <div
                        className="nowheel flex items-center gap-0.5 p-0.5 rounded-md bg-surface-elevated/95 backdrop-blur-md border border-stroke-subtle shadow-lg"
                        style={{ zIndex: 50 }}
                        onMouseDown={(e) => e.stopPropagation()}
                    >
                        {customActions}
                        <Tooltip content="Duplicate node" position="top" delay={600}>
                            <button
                                type="button"
                                onClick={handleDuplicate}
                                onMouseDown={(e) => e.stopPropagation()}
                                className="w-6 h-6 rounded flex items-center justify-center text-content-primary hover:bg-white/10 hover:text-accent-primary transition-all"
                            >
                                <Copy className="w-3 h-3 pointer-events-none" />
                            </button>
                        </Tooltip>
                        <Tooltip content="Delete node" position="top" delay={600}>
                            <button
                                type="button"
                                onClick={handleDelete}
                                onMouseDown={(e) => e.stopPropagation()}
                                className="w-6 h-6 rounded flex items-center justify-center text-accent-error hover:bg-accent-error/20 transition-all"
                            >
                                <Trash2 className="w-3 h-3 pointer-events-none" />
                            </button>
                        </Tooltip>
                    </div>
                    <div
                        aria-hidden
                        style={{
                            position: 'absolute',
                            top: '100%',
                            left: 0,
                            right: 0,
                            height: 12,
                            pointerEvents: 'auto',
                        }}
                    />
                </div>
            </NodeToolbar>

            {/* Run-status indicator now lives in the floating header's icon box
                (see NodeHeader) — the old top-left corner badge was removed when
                the header moved outside the frame, to avoid the collision. */}

            {/* Validation Badge — pre-flight wiring errors */}
            {validationErrors.length > 0 && (
                <Tooltip
                    position="top"
                    content={validationErrors.map(formatValidationError).join(' · ')}
                    className="absolute -top-1.5 -right-1.5 z-20 w-5 h-5 rounded-full bg-accent-error border-2 border-surface-elevated shadow-md cursor-help"
                    popupClassName="whitespace-normal max-w-xs leading-snug normal-case tracking-normal font-semibold"
                >
                    <AlertCircle className="w-3 h-3 text-white" strokeWidth={2.5} aria-label={`${validationErrors.length} validation error(s)`} />
                </Tooltip>
            )}

            {/* Input Handles */}
            {renderInputs && (
                inputsToRender && inputsToRender.length > 0 ? (
                    inputsToRender.map((input, index) => {
                        const totalHandles = inputsToRender.length;
                        const spacing = 36;
                        const totalHeight = (totalHandles - 1) * spacing;
                        const offset = (index * spacing) - (totalHeight / 2);
                        const isMissing = (input as any).isMandatory && !connectedTargetHandles.has(input.id);

                        return (
                            <React.Fragment key={input.id}>
                                <Handle
                                    type="target"
                                    position={Position.Left}
                                    id={input.id}
                                    // transition allowlist excludes `top` on purpose: dynamic-handle nodes
                                    // (ai_generator) shift `top` when the handle count changes, and
                                    // transitioning it makes React Flow's updateNodeInternals measure the
                                    // handle mid-animation — the wrong bounds get cached and never refresh.
                                    className={cn(
                                        "w-2.5 h-2.5 !border-surface-primary hover:!scale-125 transition-[transform,box-shadow,background-color] duration-200 z-50 translate-y-[-50%] origin-center",
                                        "before:content-[''] before:absolute before:w-10 before:h-10 before:left-1/2 before:top-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full before:z-[60]",
                                        isMissing && "animate-pulse shadow-[0_0_8px_rgba(255,255,255,0.4)]"
                                    )}
                                    style={{
                                        borderWidth: `${b2}px`,
                                        borderStyle: 'solid',
                                        background: input.color || nodeColor,
                                        boxShadow: isMissing
                                            ? `0 0 12px ${input.color || nodeColor}80`
                                            : `0 0 10px ${input.color || nodeColor}40`,
                                        left: -5,
                                        top: `calc(50% + ${offset}px)`,
                                    }}
                                >
                                    {input.label && (() => {
                                        const isErrorState = !hideStatus && status === 'error' && isMissing;
                                        const forced = isHandleLabelForced('target', input.id);

                                        return (
                                            <div className={cn(
                                                "absolute bottom-full right-1/2 mb-1 mr-1 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider pointer-events-none transition-all duration-300 drop-shadow-md z-[70]",
                                                forced ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                                                isErrorState ? "text-accent-error font-extrabold" : "text-content-primary"
                                            )} style={!isErrorState ? { color: input.color || nodeColor } : undefined}>
                                                {input.label}{(input as any).isMandatory ? ' *' : ''}
                                            </div>
                                        );
                                    })()}
                                </Handle>
                            </React.Fragment>
                        );
                    })
                ) : (
                    <Handle
                        type="target"
                        position={Position.Left}
                        className="w-2.5 h-2.5 !border-surface-primary hover:!scale-125 transition-[transform,box-shadow,background-color] duration-200 z-50 translate-y-[-50%] origin-center
                                  before:content-[''] before:absolute before:w-10 before:h-10 before:left-1/2 before:top-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full before:z-[60]"
                        style={{
                            borderWidth: `${b2}px`,
                            borderStyle: 'solid',
                            background: nodeColor,
                            boxShadow: `0 0 10px ${nodeColor}40`,
                            left: -5,
                        }}
                    >
                        {defaultInputLabel && (() => {
                            const defaultInput = sharedDef?.handles?.inputs?.[0];
                            const isMissing = defaultInput?.isMandatory && !(
                                (defaultInput.id && connectedTargetHandles.has(defaultInput.id)) ||
                                connectedTargetHandles.has('__default__')
                            );
                            const isErrorState = !hideStatus && status === 'error' && isMissing;
                            const forced = isHandleLabelForced('target', defaultInput?.id ?? '');

                            return (
                                <div className={cn(
                                    "absolute bottom-full right-1/2 mb-1 mr-1 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider pointer-events-none transition-all duration-300 drop-shadow-md z-[70]",
                                    forced ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                                    isErrorState ? "text-accent-error font-extrabold" : "text-content-primary"
                                )} style={!isErrorState ? { color: nodeColor } : undefined}>
                                    {defaultInputLabel}{defaultInput?.isMandatory ? ' *' : ''}
                                </div>
                            );
                        })()}
                    </Handle>
                )
            )}

            {/* Header lifted OUT of the frame: rendered absolutely just above
                the top-left of the card (the motion.div is position:relative
                with no overflow-hidden, so it escapes cleanly). This minimizes
                the frame — content now starts at the very top edge. z-10 keeps
                it above the border but below the status badge (z-20) and
                handles (z-50), so a running/error badge still wins the corner. */}
            <NodeHeader
                className="absolute bottom-full left-0 mb-2 z-10"
                icon={icon || metadata?.icon || 'Box'}
                label={displayLabel}
                color={nodeColor}
                badgeCount={badgeCount}
                // The header icon box now doubles as the run-status indicator
                // (replaces the old top-left corner badge), so it must know the
                // resolved status + any server error message + the hide flag.
                status={status}
                statusError={nodeError}
                hideStatus={hideStatus}
                onLabelChange={(nextLabel) => {
                    touchInteraction();
                    updateNodeLabel(id, nextLabel);
                }}
                onLabelDraft={(draft) => {
                    setNodeLabelDraft(draft === null ? null : { nodeId: id, label: draft });
                }}
            />

            {/* Content Area. When resizable, flex-fill the column so the
                node's content stretches into the resized frame. */}
            <div className={cn(contentClassName, resizable && "flex-1 min-h-0")}>
                {children}
            </div>

            {/* Output Handles */}
            {renderOutput && (
                customOutputs && customOutputs.length > 0 ? (
                    customOutputs.map((output, index) => {
                        const totalHandles = customOutputs.length;
                        const spacing = 36;
                        const totalHeight = (totalHandles - 1) * spacing;
                        const offset = (index * spacing) - (totalHeight / 2);

                        return (
                            <Handle
                                key={output.id}
                                type="source"
                                position={Position.Right}
                                id={output.id}
                                className="w-2.5 h-2.5 !border-surface-primary hover:!scale-125 transition-[transform,box-shadow,background-color] duration-200 z-50 translate-y-[-50%] origin-center
                                          before:content-[''] before:absolute before:w-10 before:h-10 before:left-1/2 before:top-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full before:z-[60]"
                                style={{
                                    borderWidth: `${b2}px`,
                                    borderStyle: 'solid',
                                    background: output.color || nodeColor,
                                    boxShadow: `0 0 10px ${output.color || nodeColor}40`,
                                    right: -5,
                                    top: `calc(50% + ${offset}px)`
                                }}
                            >
                                {(() => {
                                    const forced = isHandleLabelForced('source', output.id);
                                    return (
                                        <div className={cn(
                                            "absolute bottom-full left-1/2 mb-1 ml-1 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider pointer-events-none transition-all duration-300 text-content-primary drop-shadow-md z-[70]",
                                            forced ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                                        )} style={{ color: output.color || nodeColor }}>
                                            {output.label}
                                        </div>
                                    );
                                })()}
                            </Handle>
                        );
                    })
                ) : (
                    <Handle
                        type="source"
                        position={Position.Right}
                        id={defaultOutputId}
                        className="w-2.5 h-2.5 !border-surface-primary hover:!scale-125 transition-[transform,box-shadow,background-color] duration-200 z-50 translate-y-[-50%] origin-center
                                  before:content-[''] before:absolute before:w-10 before:h-10 before:left-1/2 before:top-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full before:z-[60]"
                        style={{
                            borderWidth: `${b2}px`,
                            borderStyle: 'solid',
                            background: nodeColor,
                            boxShadow: `0 0 10px ${nodeColor}40`,
                            right: -5,
                        }}
                    >
                        {defaultOutputLabel && (() => {
                            const forced = isHandleLabelForced('source', defaultOutputId);
                            return (
                                <div className={cn(
                                    "absolute bottom-full left-1/2 mb-1 ml-1 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider pointer-events-none transition-all duration-300 text-content-primary drop-shadow-md z-[70]",
                                    forced ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                                )} style={{ color: nodeColor }}>
                                    {defaultOutputLabel}
                                </div>
                            );
                        })()}
                    </Handle>
                )
            )}
        </motion.div>
    );
});

BaseNode.displayName = 'BaseNode';

export default memo(BaseNode);
