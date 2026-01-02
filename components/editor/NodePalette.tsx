'use client';

import React from 'react';
import { NodeType } from '@/lib/nodes/types';
import { nodeMetadata } from '@/lib/nodes/registry';
import * as Icons from 'lucide-react';

interface NodePaletteProps {
    onDragStart: (type: NodeType) => void;
}

const nodeTypes: NodeType[] = ['scrape_images', 'remove_background', 'filter_sort', 'ai_generate_image'];

export default function NodePalette({ onDragStart }: NodePaletteProps) {
    const handleDragStart = (event: React.DragEvent, nodeType: NodeType) => {
        event.dataTransfer.setData('application/reactflow', nodeType);
        event.dataTransfer.effectAllowed = 'move';
        onDragStart(nodeType);
    };

    return (
        <div className="w-64 bg-white border-r border-gray-200 p-4 space-y-3 overflow-y-auto">
            <div className="space-y-2">
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Available Nodes</h3>
                <p className="text-xs text-gray-500">Drag nodes to the canvas</p>
            </div>

            <div className="space-y-2">
                {nodeTypes.map((type) => {
                    const metadata = nodeMetadata[type];
                    const IconComponent = metadata?.icon
                        ? (Icons[metadata.icon as keyof typeof Icons] as React.ComponentType<any>)
                        : Icons.Box;

                    return (
                        <div
                            key={type}
                            draggable
                            onDragStart={(e) => handleDragStart(e, type)}
                            className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg cursor-move hover:border-purple-300 hover:bg-purple-50 transition-all"
                            style={{ borderLeftColor: metadata?.color, borderLeftWidth: '3px' }}
                        >
                            <div
                                className="w-10 h-10 rounded-lg flex items-center justify-center"
                                style={{ backgroundColor: `${metadata?.color}20` }}
                            >
                                <IconComponent
                                    className="w-5 h-5"
                                    style={{ color: metadata?.color }}
                                />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm text-gray-900">{metadata?.label}</div>
                                <div className="text-xs text-gray-500 truncate">{metadata?.description}</div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
