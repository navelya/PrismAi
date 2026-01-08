'use client';

import React, { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { nodeMetadata } from '@/lib/nodes/registry';
import * as Icons from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store/app-store';

interface CustomNodeData {
    label: string;
    config: any;
}

function CustomNode({ data, type, id }: NodeProps<CustomNodeData>) {
    const metadata = nodeMetadata[type as keyof typeof nodeMetadata];
    const IconComponent = metadata?.icon
        ? (Icons[metadata.icon as keyof typeof Icons] as React.ComponentType<any>)
        : Icons.Box;

    const deleteNode = useAppStore((state) => state.deleteNode);
    const status = useAppStore((state) => state.nodeStatuses[id] || 'idle');

    const handleDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        deleteNode(id);
    };

    return (
        <div
            className={cn(
                "px-6 py-4 rounded-xl shadow-lg border-2 backdrop-blur-sm relative group",
                "transition-all duration-300 hover:scale-105 hover:shadow-2xl",
                "min-w-[200px]"
            )}
            style={{
                background: `linear-gradient(135deg, ${metadata?.color}20 0%, ${metadata?.color}40 100%)`,
                borderColor: metadata?.color || '#667eea',
            }}
        >
            {/* Delete Button - appears on hover */}
            <button
                onClick={handleDelete}
                className="absolute -top-2 -right-2 w-6 h-6 rounded-full
                           bg-red-500/90 hover:bg-red-600 backdrop-blur-sm
                           flex items-center justify-center
                           opacity-0 group-hover:opacity-100
                           transition-all duration-200 shadow-lg
                           hover:scale-110 z-10"
                title="Delete node"
            >
                <Icons.X className="w-3.5 h-3.5 text-white" />
            </button>

            {/* Status Badge - shows execution state */}
            {status !== 'idle' && (
                <div
                    className={cn(
                        "absolute -top-2 -left-2 w-7 h-7 rounded-full flex items-center justify-center",
                        "shadow-lg border-2 border-white transition-all duration-300",
                        status === 'pending' && "bg-gray-400",
                        status === 'running' && "bg-blue-500 animate-pulse",
                        status === 'success' && "bg-green-500",
                        status === 'error' && "bg-red-500"
                    )}
                >
                    {status === 'running' && <Icons.Loader2 className="w-4 h-4 animate-spin text-white" />}
                    {status === 'success' && <Icons.Check className="w-4 h-4 text-white" />}
                    {status === 'error' && <Icons.X className="w-4 h-4 text-white" />}
                    {status === 'pending' && <Icons.Circle className="w-2 h-2 text-white" />}
                </div>
            )}

            {/* Input Handle(s) - rendered from metadata.inputs or default single handle */}
            {metadata?.inputs && metadata.inputs.length > 0 ? (
                // GENERIC: Render multiple input handles from configuration
                <>
                    {metadata.inputs.map((input, index) => {
                        // Calculate vertical position: distribute handles evenly with more spacing
                        const totalHandles = metadata.inputs!.length;
                        // For 2 handles: positions at 25% and 75% (from center)
                        // For 3 handles: positions at 20%, 50%, 80% etc.
                        const offset = totalHandles === 2
                            ? (index === 0 ? -18 : 18) // Fixed pixel offset for 2 handles
                            : ((index - (totalHandles - 1) / 2) * 24); // Spread for 3+ handles

                        return (
                            <React.Fragment key={input.id}>
                                <Handle
                                    type="target"
                                    position={Position.Left}
                                    id={input.id}
                                    className="!w-4 !h-4 !border-2 !border-white hover:!scale-125 transition-transform cursor-crosshair"
                                    style={{
                                        background: input.color,
                                        left: -8,
                                        top: `calc(50% + ${offset}px)`,
                                        transform: 'translateY(-50%)',
                                    }}
                                    title={`${input.label} Input`}
                                />
                                {/* Handle label */}
                                <div
                                    className="absolute text-[9px] font-bold tracking-wide pointer-events-none"
                                    style={{
                                        left: 8,
                                        top: `calc(50% + ${offset}px)`,
                                        transform: 'translateY(-50%)',
                                        color: input.color,
                                        textShadow: '0 0 2px white',
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
                    className="w-3 h-3 !bg-purple-500 !border-2 !border-white hover:!bg-purple-600 transition-colors
                              before:content-[''] before:absolute before:inset-0 before:scale-x-[10] before:scale-y-[20] before:rounded-full"
                    style={{
                        background: metadata?.color || '#667eea',
                        left: -6
                    }}
                />
            )}

            <div className="flex items-center gap-3">
                <div
                    className="p-2 rounded-lg"
                    style={{ backgroundColor: `${metadata?.color}30` }}
                >
                    <IconComponent
                        className="w-5 h-5"
                        style={{ color: metadata?.color }}
                    />
                </div>

                <div className="flex-1">
                    <div className="font-semibold text-sm text-gray-800">
                        {metadata?.label || data.label}
                    </div>
                    <div className="text-xs text-gray-600 mt-0.5">
                        {metadata?.description}
                    </div>
                </div>
            </div>

            {/* Output Handle - Small visual but HUGE hitbox */}
            <Handle
                type="source"
                position={Position.Right}
                className="w-3 h-3 !bg-blue-500 !border-2 !border-white hover:!bg-blue-600 transition-colors
                          before:content-[''] before:absolute before:inset-0 before:scale-x-[10] before:scale-y-[20] before:rounded-full"
                style={{
                    background: metadata?.color || '#667eea',
                    right: -6
                }}
            />
        </div>
    );
}

export default memo(CustomNode);
