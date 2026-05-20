'use client';

import React, { memo, useEffect, useMemo, useState } from 'react';
import { Handle, Position, NodeToolbar, useReactFlow, useEdges, useStore, ReactFlowState, useUpdateNodeInternals } from 'reactflow';
import { Copy, X, Loader2, Check, Circle, Trash2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store/app-store';
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';
import type { NodeStatus } from '@/lib/nodes/types';
import { useWireDrag } from '@/lib/editor/wire-drag-context';
import { findHandleForNode, findAllCompatibleHandlesForNode, wouldCreateCycle } from '@/lib/editor/handle-compatibility';
import { useExecutionValidation } from '@/lib/hooks/use-execution-validation';
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
    nodeData,
    onDrag,
    onDragStart,
    onDragEnd,
    onAnimationStart,
    onAnimationEnd,
    onTransitionEnd,
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
    const isLoadingSession = useAppStore((state) => state.isLoadingSession);
    const { errorsByNode } = useExecutionValidation();
    const validationErrors = errorsByNode[id] ?? [];
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

    // Get the current zoom level to compensate border-widths
    const zoom = useStore((s: ReactFlowState) => s.transform[2]);
    const b1 = 1 / zoom;
    const b2 = 2 / zoom;

    // Hide the per-node hover Copy/Delete buttons in multi-select mode (2+
    // selected). The floating multi-select toolbar handles the bulk action,
    // and per-node buttons would only act on this one node — confusing UX.
    const isMultiSelectActive = useStore(
        (s: ReactFlowState) => Array.from(s.nodeInternals.values()).filter(n => n.selected).length >= 2,
    );

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
                "rounded-2xl border backdrop-blur-xl relative group bg-bg-primary/40 transition-[border-color,background-color] duration-500 ease-out",
                selected ? "border-accent-primary shadow-[0_0_20px_rgb(var(--accent-primary)/0.15)] outline-none" : "border-stroke-subtle shadow-xl",
                // Hover affects ONLY borders + a barely-perceptible bg tint.
                // Shadow stays constant on hover/drag/click — only the border
                // is allowed to indicate interaction state.
                "hover:border-stroke-strong hover:bg-surface-elevated/20",
                effectiveDragRole === 'incompatible' && "opacity-30 grayscale-[0.6] transition-[border-color,background-color,opacity,filter] duration-150",
                typeof width === 'string' ? width : '',
                className
            )}
            style={{
                width: typeof width === 'number' ? width : undefined,
                borderWidth: `${b1}px`,
                // Constant-width selection ring using outline (which follows border-radius in modern browsers)
                ...(selected && {
                    outline: `${b1}px solid rgb(var(--accent-primary) / 0.2)`,
                    outlineOffset: '0'
                }),
                willChange: 'transform',
                ...props.style
            }}
            {...props}
        >
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
                isVisible={!isMultiSelectActive && (isHovered || !!selected)}
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

            {/* Status Badge */}
            {!hideStatus && status !== 'idle' && (
                <div
                    className={cn(
                        "absolute -top-2 -left-2 w-7 h-7 rounded-full flex items-center justify-center",
                        "shadow-lg border-surface-primary transition-all duration-300",
                        status === 'pending' && "bg-slate-500",
                        status === 'running' && "bg-accent-primary animate-pulse shadow-[0_0_10px_rgba(6,182,212,0.5)]",
                        status === 'success' && "bg-accent-secondary shadow-[0_0_10px_rgba(20,184,166,0.5)]",
                        status === 'error' && "bg-accent-error"
                    )}
                    style={{ borderWidth: `${b2}px` }}
                >
                    {status === 'running' && <Loader2 className="w-4 h-4 animate-spin text-content-inverted" />}
                    {status === 'success' && <Check className="w-4 h-4 text-content-inverted" />}
                    {status === 'error' && <X className="w-4 h-4 text-content-inverted" />}
                    {status === 'pending' && <Circle className="w-2 h-2 text-content-inverted fill-current" />}
                </div>
            )}

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

            <NodeHeader
                icon={icon || metadata?.icon || 'Box'}
                label={displayLabel}
                color={nodeColor}
                badgeCount={badgeCount}
                onLabelChange={(nextLabel) => {
                    touchInteraction();
                    updateNodeLabel(id, nextLabel);
                }}
                onLabelDraft={(draft) => {
                    setNodeLabelDraft(draft === null ? null : { nodeId: id, label: draft });
                }}
            />

            {/* Content Area */}
            <div className={contentClassName}>
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
