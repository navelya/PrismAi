'use client';

import React, { memo } from 'react';
import { Handle, Position, useReactFlow } from 'reactflow';
import { Play, Copy, X, Loader2, Check, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store/app-store';
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';
import { NodeHeader } from './NodeHeader';

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
    customInputs?: Array<{ id: string; label: string; color: string }>;
    // Additional styling
    contentClassName?: string;
    badgeCount?: number;
    // Custom header actions
    customActions?: React.ReactNode;
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
    contentClassName = 'p-1',
    className,
    badgeCount,
    customActions,
    ...props
}, ref) => {
    const sharedDef = sharedRegistry[type as keyof typeof sharedRegistry];
    const metadata = sharedDef?.meta;

    // Status and Store Actions
    const status = useAppStore((state) => state.nodeStatuses[id] || 'idle');
    const deleteNode = useAppStore((state) => state.deleteNode);
    const triggerRunFromNode = useAppStore((state) => state.triggerRunFromNode);
    const { deleteElements, addNodes, getNode } = useReactFlow();

    // Node Color
    const nodeColor = metadata?.color || 'rgb(var(--accent-primary))';
    const displayLabel = metadata?.label || label || 'Node';

    // Labels
    const defaultInputLabel = sharedDef?.handles?.inputs?.[0]?.label;
    const defaultOutputLabel = sharedDef?.handles?.outputs?.[0]?.label;
    const defaultOutputId = sharedDef?.handles?.outputs?.[0]?.id || 'output';

    const handleDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        deleteElements({ nodes: [{ id }] });
    };

    const handleDuplicate = (e: React.MouseEvent) => {
        e.stopPropagation();
        const currentNode = getNode(id);

        if (currentNode) {
            const newNode = {
                ...JSON.parse(JSON.stringify(currentNode)),
                id: `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
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

    const handleRunFromHere = (e: React.MouseEvent) => {
        e.stopPropagation();
        triggerRunFromNode(id);
    };

    // Determine inputs to render
    const inputsToRender = customInputs || sharedDef?.handles?.inputs;

    return (
        <div
            ref={ref}
            className={cn(
                "rounded-xl shadow-lg border-2 backdrop-blur-sm relative group bg-canvas-node",
                "transition-all duration-300 hover:shadow-2xl",
                typeof width === 'string' ? width : '',
                className
            )}
            style={{
                width: typeof width === 'number' ? width : undefined,
                background: `linear-gradient(135deg, ${nodeColor}15 0%, ${nodeColor}30 100%)`, // slightly more transparent for lighter feel
                borderColor: nodeColor,
                ...props.style
            }}
            {...props}
        >
            {/* Action Buttons */}
            <div className="absolute -top-2 -right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200 z-10">
                <button
                    onClick={handleRunFromHere}
                    className="w-6 h-6 rounded-full bg-emerald-500/90 hover:bg-emerald-600 backdrop-blur-sm
                               flex items-center justify-center shadow-lg hover:scale-110 transition-all duration-200"
                    title="Run from here"
                >
                    <Play className="w-3 h-3 text-content-inverted fill-current" />
                </button>
                {customActions}
                <button
                    onClick={handleDuplicate}
                    className="w-6 h-6 rounded-full bg-blue-500/90 hover:bg-blue-600 backdrop-blur-sm
                               flex items-center justify-center shadow-lg hover:scale-110 transition-all duration-200"
                    title="Duplicate node"
                >
                    <Copy className="w-3 h-3 text-content-inverted" />
                </button>
                <button
                    onClick={handleDelete}
                    className="w-6 h-6 rounded-full bg-accent-error/90 hover:bg-accent-error backdrop-blur-sm
                               flex items-center justify-center shadow-lg hover:scale-110 transition-all duration-200"
                    title="Delete node"
                >
                    <X className="w-3.5 h-3.5 text-content-inverted" />
                </button>
            </div>

            {/* Status Badge */}
            {status !== 'idle' && (
                <div
                    className={cn(
                        "absolute -top-2 -left-2 w-7 h-7 rounded-full flex items-center justify-center",
                        "shadow-lg border-2 border-surface-primary transition-all duration-300",
                        status === 'pending' && "bg-content-tertiary",
                        status === 'running' && "bg-blue-500 animate-pulse",
                        status === 'success' && "bg-accent-success",
                        status === 'error' && "bg-accent-error"
                    )}
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
                                    className="w-6 h-6 !border-2 !border-surface-primary hover:!brightness-110 transition-colors
                                              before:content-[''] before:absolute before:inset-0 before:origin-left before:scale-x-[5] before:scale-y-[3] before:rounded-full"
                                    style={{
                                        background: input.color || nodeColor,
                                        left: -6,
                                        top: `calc(50% + ${offset}px)`,
                                        width: '10px',
                                        height: '10px',
                                    }}
                                >
                                    {input.label && (
                                        <div className="absolute bottom-full right-1/2 mb-1 mr-1 opacity-0 group-hover:opacity-100 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider pointer-events-none transition-all duration-300 text-content-primary drop-shadow-md" style={{ color: input.color || nodeColor }}>
                                            {input.label}
                                        </div>
                                    )}
                                </Handle>
                            </React.Fragment>
                        );
                    })
                ) : (
                    <Handle
                        type="target"
                        position={Position.Left}
                        className="w-4 h-4 !border-2 !border-surface-primary hover:!brightness-110 transition-colors
                                  before:content-[''] before:absolute before:inset-0 before:origin-left before:scale-x-[5] before:scale-y-[3] before:rounded-full"
                        style={{
                            background: nodeColor,
                            left: -6,
                            width: '10px',
                            height: '10px',
                        }}
                    >
                        {defaultInputLabel && (
                            <div className="absolute bottom-full right-1/2 mb-1 mr-1 opacity-0 group-hover:opacity-100 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider pointer-events-none transition-all duration-300 text-content-primary drop-shadow-md" style={{ color: nodeColor }}>
                                {defaultInputLabel}
                            </div>
                        )}
                    </Handle>
                )
            )}

            <NodeHeader
                icon={metadata?.icon || 'Box'}
                label={displayLabel}
                color={nodeColor}
                badgeCount={badgeCount}
            />

            {/* Content Area */}
            <div className={contentClassName}>
                {children}
            </div>

            {/* Output Handle */}
            {renderOutput && (
                <Handle
                    type="source"
                    position={Position.Right}
                    id={defaultOutputId}
                    className="w-4 h-4 !border-2 !border-surface-primary hover:!brightness-110 transition-colors
                              before:content-[''] before:absolute before:inset-0 before:origin-right before:scale-x-[5] before:scale-y-[3] before:rounded-full"
                    style={{
                        background: nodeColor,
                        right: -6,
                        width: '10px',
                        height: '10px',
                    }}
                >
                    {defaultOutputLabel && (
                        <div className="absolute bottom-full left-1/2 mb-1 ml-1 opacity-0 group-hover:opacity-100 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider pointer-events-none transition-all duration-300 text-content-primary drop-shadow-md" style={{ color: nodeColor }}>
                            {defaultOutputLabel}
                        </div>
                    )}
                </Handle>
            )}
        </div>
    );
});

BaseNode.displayName = 'BaseNode';

export default memo(BaseNode);
