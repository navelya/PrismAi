'use client';

import React, { memo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, NodeProps, useReactFlow } from 'reactflow';
import { nodeMetadata } from '@/lib/nodes/metadata';
import * as Icons from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store/app-store';
import ImageLightbox from '@/components/ui/ImageLightbox';

interface CustomNodeData {
    label: string;
    config: any;
}

function CustomNode({ data, type, id }: NodeProps<CustomNodeData>) {
    const metadata = nodeMetadata[type as keyof typeof nodeMetadata];
    const IconComponent = metadata?.icon
        ? (Icons[metadata.icon as keyof typeof Icons] as React.ComponentType<any>)
        : Icons.Box;

    const deleteNode = useAppStore((state) => state.deleteNode); // Potentially unused now
    const currentWorkflow = useAppStore((state) => state.currentWorkflow); // Potentially unused now
    const triggerRunFromNode = useAppStore((state) => state.triggerRunFromNode);
    const status = useAppStore((state) => state.nodeStatuses[id] || 'idle');

    // Use React Flow hook for direct graph manipulation (bypassing global store split-brain)
    const { deleteElements, addNodes, getNode } = useReactFlow();

    // Subscribe to specific output for this node
    const output = useAppStore((state) => state.nodeOutputs[id]);

    // Lightbox state
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const [lightboxIndex, setLightboxIndex] = useState(0);

    const openLightbox = (index: number) => {
        setLightboxIndex(index);
        setLightboxOpen(true);
    };

    const handleDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        deleteElements({ nodes: [{ id }] });
    };

    // Duplicate node immediately (copy + paste in one action)
    const handleDuplicate = (e: React.MouseEvent) => {
        e.stopPropagation();
        const currentNode = getNode(id); // Get from React Flow internal state

        if (currentNode) {
            const newNode = {
                ...JSON.parse(JSON.stringify(currentNode)),
                id: `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                position: {
                    x: currentNode.position.x + 50,
                    y: currentNode.position.y + 50,
                },
                selected: false, // Ensure copy isn't immediately selected if that causes issues
                data: {
                    ...currentNode.data,
                    label: `${currentNode.data.label} (Copy)`,
                }
            };

            addNodes(newNode);
        }
    };

    const handleRunFromHere = (e: React.MouseEvent) => {
        e.stopPropagation();
        triggerRunFromNode(id);
    };

    // Use node metadata color or fallback to accent
    const nodeColor = metadata?.color || 'rgb(var(--accent-primary))';

    return (
        <div
            className={cn(
                "px-6 py-4 rounded-xl shadow-lg border-2 backdrop-blur-sm relative group",
                "transition-all duration-300 hover:scale-105 hover:shadow-2xl",
                "min-w-[200px] bg-canvas-node"
            )}
            style={{
                background: `linear-gradient(135deg, ${nodeColor}20 0%, ${nodeColor}40 100%)`,
                borderColor: nodeColor,
            }}
        >
            {/* Node Action Buttons - appear on hover */}
            <div className="absolute -top-2 -right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200 z-10">
                {/* Run from here */}
                <button
                    onClick={handleRunFromHere}
                    className="w-6 h-6 rounded-full
                               bg-emerald-500/90 hover:bg-emerald-600 backdrop-blur-sm
                               flex items-center justify-center
                               shadow-lg hover:scale-110 transition-all duration-200"
                    title="Run from here"
                >
                    <Icons.Play className="w-3 h-3 text-content-inverted fill-current" />
                </button>
                {/* Duplicate Button */}
                <button
                    onClick={handleDuplicate}
                    className="w-6 h-6 rounded-full
                               bg-blue-500/90 hover:bg-blue-600 backdrop-blur-sm
                               flex items-center justify-center
                               shadow-lg hover:scale-110 transition-all duration-200"
                    title="Duplicate node"
                >
                    <Icons.Copy className="w-3 h-3 text-content-inverted" />
                </button>
                {/* Delete Button */}
                <button
                    onClick={handleDelete}
                    className="w-6 h-6 rounded-full
                               bg-accent-error/90 hover:bg-accent-error backdrop-blur-sm
                               flex items-center justify-center
                               shadow-lg hover:scale-110 transition-all duration-200"
                    title="Delete node"
                >
                    <Icons.X className="w-3.5 h-3.5 text-content-inverted" />
                </button>
            </div>

            {/* Status Badge - shows execution state */}
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
                    {status === 'running' && <Icons.Loader2 className="w-4 h-4 animate-spin text-content-inverted" />}
                    {status === 'success' && <Icons.Check className="w-4 h-4 text-content-inverted" />}
                    {status === 'error' && <Icons.X className="w-4 h-4 text-content-inverted" />}
                    {status === 'pending' && <Icons.Circle className="w-2 h-2 text-content-inverted" />}
                </div>
            )}

            {/* Input Handle(s) - rendered from metadata.inputs or default single handle */}
            {metadata?.inputs && metadata.inputs.length > 0 ? (
                // Multiple input handles - spaced vertically, standard styling
                <>
                    {metadata.inputs.map((input, index) => {
                        // Calculate vertical offset: spread handles evenly with more separation
                        const totalHandles = metadata.inputs!.length;
                        const spacing = 36; // pixels between handles - enough to prevent overlap
                        const totalHeight = (totalHandles - 1) * spacing;
                        const offset = (index * spacing) - (totalHeight / 2);

                        return (
                            <React.Fragment key={input.id}>
                                {/* Handle with hitbox extending inward into node */}
                                <Handle
                                    type="target"
                                    position={Position.Left}
                                    id={input.id}
                                    className="w-6 h-6 !border-2 !border-surface-primary hover:!brightness-110 transition-colors
                                              before:content-[''] before:absolute before:inset-0 before:origin-left before:scale-x-[5] before:scale-y-[3] before:rounded-full"
                                    style={{
                                        background: nodeColor,
                                        left: -6,
                                        top: `calc(50% + ${offset}px)`,
                                        width: '10px',
                                        height: '10px',
                                    }}
                                />
                                {/* Small label next to handle */}
                                <div
                                    className="absolute text-[8px] font-semibold pointer-events-none select-none text-canvas-subtext"
                                    style={{
                                        left: 10,
                                        top: `calc(50% + ${offset}px - 5px)`,
                                    }}
                                >
                                    {input.label}
                                </div>
                            </React.Fragment>
                        );
                    })}
                </>
            ) : (
                /* DEFAULT: Single Input Handle for standard nodes */
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
                />
            )}

            <div className="flex items-center gap-3">
                <div
                    className="p-2 rounded-lg"
                    style={{ backgroundColor: `${nodeColor}30` }}
                >
                    <IconComponent
                        className="w-5 h-5"
                        style={{ color: nodeColor }}
                    />
                </div>

                <div className="flex-1">
                    <div className="font-semibold text-sm text-canvas-text">
                        {metadata?.label || data.label}
                    </div>
                    <div className="text-xs text-canvas-subtext mt-0.5">
                        {metadata?.description}
                    </div>
                </div>
            </div>

            {/* In-Node Results Gallery */}
            {
                output && (
                    <div className="mt-3 pt-3 border-t border-stroke-subtle/50">
                        {Array.isArray(output) && output.length > 0 ? (
                            <div className="flex gap-1.5 flex-wrap">
                                {output.slice(0, 4).map((item: any, idx: number) => (
                                    <button
                                        key={idx}
                                        onClick={(e) => { e.stopPropagation(); openLightbox(idx); }}
                                        className="relative w-10 h-10 rounded-md overflow-hidden border border-stroke-subtle hover:border-accent-primary transition-colors group/thumb"
                                    >
                                        {item.url || item.base64 ? (
                                            <img
                                                src={item.url || item.base64}
                                                alt={`Result ${idx + 1}`}
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            <div className="w-full h-full bg-surface-tertiary flex items-center justify-center text-[10px] text-content-tertiary">
                                                ?
                                            </div>
                                        )}
                                    </button>
                                ))}
                                {output.length > 4 && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); openLightbox(4); }}
                                        className="w-10 h-10 rounded-md bg-surface-tertiary border border-stroke-subtle flex items-center justify-center text-xs text-content-secondary hover:bg-surface-secondary transition-colors"
                                    >
                                        +{output.length - 4}
                                    </button>
                                )}
                            </div>
                        ) : typeof output === 'object' ? (
                            <div className="text-xs text-content-secondary bg-surface-tertiary/50 p-2 rounded max-h-20 overflow-y-auto">
                                <pre className="whitespace-pre-wrap font-mono text-[10px] leading-tight">
                                    {JSON.stringify(output, null, 2)}
                                </pre>
                            </div>
                        ) : null}
                    </div>
                )
            }

            {/* Lightbox Portal */}
            {
                lightboxOpen && output && Array.isArray(output) && createPortal(
                    <ImageLightbox
                        images={output}
                        initialIndex={lightboxIndex}
                        onClose={() => setLightboxOpen(false)}
                    />,
                    document.body
                )
            }

            {/* Output Handle - hitbox extends inward into node */}
            <Handle
                type="source"
                position={Position.Right}
                className="w-4 h-4 !border-2 !border-surface-primary hover:!brightness-110 transition-colors
                          before:content-[''] before:absolute before:inset-0 before:origin-right before:scale-x-[5] before:scale-y-[3] before:rounded-full"
                style={{
                    background: nodeColor,
                    right: -6,
                    width: '10px',
                    height: '10px',
                }}
            />
        </div >
    );
}

export default memo(CustomNode);
