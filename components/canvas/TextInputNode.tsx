'use client';

import React, { memo } from 'react';
import { Handle, Position, NodeProps, useReactFlow } from 'reactflow';
import { nodeMetadata } from '@/lib/nodes/metadata';
import { Play, Copy, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store/app-store';

import { NodeHeader } from './NodeHeader';

interface TextInputNodeData {
    label: string;
    config: {
        text: string;
    };
}

function TextInputNode({ data, type, id }: NodeProps<TextInputNodeData>) {
    const metadata = nodeMetadata[type as keyof typeof nodeMetadata];
    const triggerRunFromNode = useAppStore((state) => state.triggerRunFromNode);
    const status = useAppStore((state) => state.nodeStatuses[id] || 'idle');

    // Use React Flow hook for direct graph manipulation
    const { deleteElements, addNodes, getNode, setNodes } = useReactFlow();

    const handleDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        deleteElements({ nodes: [{ id }] });
    };

    // Duplicate node immediately
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

    const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setNodes((nds) =>
            nds.map((node) => {
                if (node.id === id) {
                    return {
                        ...node,
                        data: {
                            ...node.data,
                            config: {
                                ...node.data.config,
                                text: e.target.value,
                            },
                        },
                    };
                }
                return node;
            })
        );
    };

    // Use node metadata color or fallback to accent
    const nodeColor = metadata?.color || 'rgb(var(--accent-primary))';

    return (
        <div
            className={cn(
                "rounded-xl shadow-lg border-2 backdrop-blur-sm relative group bg-canvas-node",
                "transition-all duration-300 hover:shadow-2xl",
                "w-[280px]"
            )}
            style={{
                background: `linear-gradient(135deg, ${nodeColor}20 0%, ${nodeColor}40 100%)`,
                borderColor: nodeColor,
            }}
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

            <NodeHeader
                icon={metadata?.icon || 'Type'}
                label={metadata?.label || data.label}
                color={nodeColor}
            />

            {/* Embedded Text Area */}
            <div className="p-2">
                <textarea
                    className="nodrag nowheel w-full h-24 px-3 py-2 text-sm bg-surface-secondary/80 border border-stroke-subtle rounded-md text-content-primary focus:outline-none focus:ring-2 focus:ring-accent-primary shadow-inner resize-none backdrop-blur-sm transition-shadow"
                    placeholder="Enter prompt or text here..."
                    value={data.config?.text || ''}
                    onChange={handleTextChange}
                    onKeyDown={(e) => {
                        if (e.key === 'Backspace' || e.key === 'Delete') {
                            e.stopPropagation();
                        }
                    }}
                />
            </div>

            {/* Output Handle - ONLY ONE on the RIGHT */}
            <Handle
                type="source"
                position={Position.Right}
                id="text_out"
                className="w-4 h-4 !bg-accent-primary border-2 border-surface-primary"
            />
        </div>
    );
}

export default memo(TextInputNode);
