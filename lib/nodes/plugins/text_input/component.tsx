'use client';

import React, { memo } from 'react';
import { Handle, Position, NodeProps, useReactFlow } from 'reactflow';
import * as Icons from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store/app-store';
import { textInputSharedDef } from './index';
import { NodeClientDef } from '../../core/types';

interface TextInputNodeData {
    label: string;
    config: {
        text: string;
    };
}

function TextInputNode({ data, id }: NodeProps<TextInputNodeData>) {
    const IconComponent = textInputSharedDef.meta.icon
        ? (Icons[textInputSharedDef.meta.icon as keyof typeof Icons] as React.ComponentType<any>)
        : Icons.Box;

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

    const nodeColor = textInputSharedDef.meta.color;

    return (
        <div
            className={cn(
                "px-6 py-4 rounded-xl shadow-lg border-2 backdrop-blur-sm relative group",
                "transition-all duration-300 hover:scale-105 hover:shadow-2xl",
                "min-w-[280px] bg-canvas-node"
            )}
            style={{
                background: `linear-gradient(135deg, ${nodeColor}20 0%, ${nodeColor}40 100%)`,
                borderColor: nodeColor,
            }}
        >
            {/* Node Action Buttons - appear on hover */}
            <div className="absolute -top-2 -right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200 z-10">
                <button
                    onClick={handleRunFromHere}
                    className="w-6 h-6 rounded-full bg-emerald-500/90 hover:bg-emerald-600 backdrop-blur-sm flex items-center justify-center shadow-lg hover:scale-110 transition-all duration-200"
                    title="Run from here"
                >
                    <Icons.Play className="w-3 h-3 text-content-inverted fill-current" />
                </button>
                <button
                    onClick={handleDuplicate}
                    className="w-6 h-6 rounded-full bg-blue-500/90 hover:bg-blue-600 backdrop-blur-sm flex items-center justify-center shadow-lg hover:scale-110 transition-all duration-200"
                    title="Duplicate node"
                >
                    <Icons.Copy className="w-3 h-3 text-content-inverted" />
                </button>
                <button
                    onClick={handleDelete}
                    className="w-6 h-6 rounded-full bg-accent-error/90 hover:bg-accent-error backdrop-blur-sm flex items-center justify-center shadow-lg hover:scale-110 transition-all duration-200"
                    title="Delete node"
                >
                    <Icons.X className="w-3.5 h-3.5 text-content-inverted" />
                </button>
            </div>

            {/* Status Badge */}
            {status !== 'idle' && (
                <div
                    className={cn(
                        "absolute -top-2 -left-2 w-7 h-7 rounded-full flex items-center justify-center shadow-lg border-2 border-surface-primary transition-all duration-300",
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

            {/* Header */}
            <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-surface-primary/50 text-content-primary">
                    <IconComponent className="w-5 h-5" />
                </div>
                <div>
                    <h3 className="font-bold text-content-primary">{data.label}</h3>
                    <p className="text-xs text-content-tertiary">{textInputSharedDef.meta.description}</p>
                </div>
            </div>

            {/* Embedded Text Area */}
            <div className="mt-2">
                <textarea
                    className="nodrag nowheel w-full h-24 px-3 py-2 text-sm bg-surface-secondary/80 border border-stroke-subtle rounded-md text-content-primary focus:outline-none focus:ring-2 focus:ring-accent-primary resize-none backdrop-blur-sm transition-shadow"
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

            <Handle
                type="source"
                position={Position.Right}
                id="text_out"
                className="w-4 h-4 !bg-accent-primary border-2 border-surface-primary"
            />
        </div>
    );
}

export const textInputClientDef: NodeClientDef = {
    ...textInputSharedDef,
    component: memo(TextInputNode),
};
