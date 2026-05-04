'use client';

import React, { memo } from 'react';
import { Handle, Position, useReactFlow, useEdges, useStore, ReactFlowState, useUpdateNodeInternals } from 'reactflow';
import { Copy, X, Loader2, Check, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store/app-store';
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';
import { NodeHeader } from './NodeHeader';
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
    const status = useAppStore((state) => state.nodeStatuses[id] || 'idle');
    const updateNodeLabel = useAppStore((state) => state.updateNodeLabel);
    const touchInteraction = useAppStore((state) => state.touchInteraction);
    const { addNodes, getNode, getNodes, deleteElements } = useReactFlow();
    const updateNodeInternals = useUpdateNodeInternals();
    const edges = useEdges();

    // Get the current zoom level to compensate border-widths
    const zoom = useStore((s: ReactFlowState) => s.transform[2]);
    const b1 = 1 / zoom;
    const b2 = 2 / zoom;

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
        const currentNode = getNode(id);

        if (currentNode) {
            const nodes = getNodes();
            const maxZ = Math.max(0, ...nodes.map(n => n.zIndex || 0));

            const newNode = {
                ...JSON.parse(JSON.stringify(currentNode)),
                id: `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                zIndex: maxZ + 1,
                position: {
                    x: currentNode.position.x + 50,
                    y: currentNode.position.y + 50,
                },
                selected: false,
                data: {
                    ...currentNode.data,
                    label: `${currentNode.data.label || displayLabel} (Copy)`,
                }
            };
            addNodes(newNode);
        }
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
            {/* Action Buttons */}
            <div className="absolute -top-2 -right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200 z-10">
                {/* Input nodes don't have manual triggers anymore. Utility nodes compute reactively. */}
                {customActions}
                <button
                    onClick={handleDuplicate}
                    className="w-6 h-6 rounded-lg bg-white/5 border backdrop-blur-md
                                flex items-center justify-center shadow-lg hover:scale-110 hover:bg-white/10 transition-all duration-200"
                    style={{ borderWidth: `${b1}px`, borderColor: 'rgba(255,255,255,0.1)' }}
                    title="Duplicate node"
                >
                    <Copy className="w-3 h-3 text-content-primary" />
                </button>
                <button
                    onClick={handleDelete}
                    className="w-6 h-6 rounded-lg bg-white/5 border backdrop-blur-md
                                flex items-center justify-center shadow-lg hover:scale-110 hover:bg-accent-error hover:text-content-inverted transition-all duration-200 group/del"
                    style={{ borderWidth: `${b1}px`, borderColor: 'rgba(255,255,255,0.1)' }}
                    title="Delete node"
                >
                    <X className="w-3.5 h-3.5 text-accent-error group-hover/del:text-content-inverted" />
                </button>
            </div>

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

            {/* Input Handles */}
            {renderInputs && (
                inputsToRender && inputsToRender.length > 0 ? (
                    inputsToRender.map((input, index) => {
                        const totalHandles = inputsToRender.length;
                        const spacing = 36;
                        const totalHeight = (totalHandles - 1) * spacing;
                        const offset = (index * spacing) - (totalHeight / 2);

                        return (
                            <React.Fragment key={input.id}>
                                <Handle
                                    type="target"
                                    position={Position.Left}
                                    id={input.id}
                                    className={cn(
                                        "w-2.5 h-2.5 !border-surface-primary hover:!scale-125 transition-all duration-200 z-50 translate-y-[-50%] origin-center",
                                        "before:content-[''] before:absolute before:w-10 before:h-10 before:left-1/2 before:top-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full before:z-[60]",
                                        (input as any).isMandatory && !edges.some(e => e.target === id && e.targetHandle === input.id) && "animate-pulse shadow-[0_0_8px_rgba(255,255,255,0.4)]"
                                    )}
                                    style={{
                                        borderWidth: `${b2}px`,
                                        borderStyle: 'solid',
                                        background: input.color || nodeColor,
                                        boxShadow: (input as any).isMandatory && !edges.some(e => e.target === id && e.targetHandle === input.id)
                                            ? `0 0 12px ${input.color || nodeColor}80`
                                            : `0 0 10px ${input.color || nodeColor}40`,
                                        left: -5,
                                        top: `calc(50% + ${offset}px)`,
                                    }}
                                >
                                    {input.label && (() => {
                                        const isMissing = (input as any).isMandatory && !edges.some(e => e.target === id && e.targetHandle === input.id);
                                        const isErrorState = !hideStatus && status === 'error' && isMissing;

                                        return (
                                            <div className={cn(
                                                "absolute bottom-full right-1/2 mb-1 mr-1 opacity-0 group-hover:opacity-100 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider pointer-events-none transition-all duration-300 drop-shadow-md z-[70]",
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
                        className="w-2.5 h-2.5 !border-surface-primary hover:!scale-125 transition-all duration-200 z-50 translate-y-[-50%] origin-center
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
                            const isMissing = defaultInput?.isMandatory && !edges.some(e => e.target === id && (!e.targetHandle || e.targetHandle === defaultInput.id));
                            const isErrorState = !hideStatus && status === 'error' && isMissing;

                            return (
                                <div className={cn(
                                    "absolute bottom-full right-1/2 mb-1 mr-1 opacity-0 group-hover:opacity-100 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider pointer-events-none transition-all duration-300 drop-shadow-md z-[70]",
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
                                className="w-2.5 h-2.5 !border-surface-primary hover:!scale-125 transition-all duration-200 z-50 translate-y-[-50%] origin-center
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
                                <div className="absolute bottom-full left-1/2 mb-1 ml-1 opacity-0 group-hover:opacity-100 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider pointer-events-none transition-all duration-300 text-content-primary drop-shadow-md z-[70]" style={{ color: output.color || nodeColor }}>
                                    {output.label}
                                </div>
                            </Handle>
                        );
                    })
                ) : (
                    <Handle
                        type="source"
                        position={Position.Right}
                        id={defaultOutputId}
                        className="w-2.5 h-2.5 !border-surface-primary hover:!scale-125 transition-all duration-200 z-50 translate-y-[-50%] origin-center
                                  before:content-[''] before:absolute before:w-10 before:h-10 before:left-1/2 before:top-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full before:z-[60]"
                        style={{
                            borderWidth: `${b2}px`,
                            borderStyle: 'solid',
                            background: nodeColor,
                            boxShadow: `0 0 10px ${nodeColor}40`,
                            right: -5,
                        }}
                    >
                        {defaultOutputLabel && (
                            <div className="absolute bottom-full left-1/2 mb-1 ml-1 opacity-0 group-hover:opacity-100 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider pointer-events-none transition-all duration-300 text-content-primary drop-shadow-md z-[70]" style={{ color: nodeColor }}>
                                {defaultOutputLabel}
                            </div>
                        )}
                    </Handle>
                )
            )}
        </motion.div>
    );
});

BaseNode.displayName = 'BaseNode';

export default memo(BaseNode);
