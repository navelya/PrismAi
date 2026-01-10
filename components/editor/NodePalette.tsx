'use client';

import React, { useState } from 'react';
import { NodeType } from '@/lib/nodes/types';
import { nodeMetadata } from '@/lib/nodes/registry';
import * as Icons from 'lucide-react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface NodePaletteProps {
    onDragStart: (type: NodeType) => void;
}

const nodeTypes: NodeType[] = ['media_input', 'scrape_images', 'remove_background', 'filter_sort', 'ai_generate_image', 'upscale_image', 'merge_image'];

export default function NodePalette({ onDragStart }: NodePaletteProps) {
    const [isCollapsed, setIsCollapsed] = useState(false);

    const handleDragStart = (event: React.DragEvent, nodeType: NodeType) => {
        event.dataTransfer.setData('application/reactflow', nodeType);
        event.dataTransfer.effectAllowed = 'move';
        onDragStart(nodeType);
    };

    return (
        <div className={`relative h-full transition-all duration-300 z-40 ${isCollapsed ? 'w-0' : 'w-64'}`}>

            {/* Toggle Button - Outside clipping container to remain visible */}
            <button
                onClick={() => setIsCollapsed(!isCollapsed)}
                className={`transition-all duration-300 z-50 flex items-center justify-center
                    ${isCollapsed
                        ? 'absolute top-16 -right-10 p-2.5 rounded-full shadow-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transform hover:scale-105'
                        : 'absolute top-3 right-3 p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700'
                    }`}
                title={isCollapsed ? 'Expand nodes panel' : 'Collapse nodes panel'}
            >
                {isCollapsed ? (
                    <ChevronRight className="w-5 h-5" />
                ) : (
                    <ChevronLeft className="w-4 h-4" />
                )}
            </button>

            {/* Clipping Container - Handles the "Wipe" animation (Width 0 -> 64) */}
            <div className={`h-full bg-white border-r border-gray-200 overflow-hidden transition-all duration-500 ease-in-out ${isCollapsed ? 'w-0' : 'w-64'}`}>

                {/* Fixed Width Content - Stays stable (w-64) while parent clips it */}
                <div className="w-64 h-full flex flex-col">

                    {/* Header */}
                    <div className="h-14 flex items-center px-4 border-b border-gray-200 flex-shrink-0">
                        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Nodes</h3>
                    </div>

                    {/* Content */}
                    <div className="flex-1 p-4 space-y-3 overflow-y-auto">
                        <div className="space-y-2">
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
                                        className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg cursor-move hover:border-purple-300 hover:bg-purple-50 transition-all bg-white"
                                        style={{ borderLeftColor: metadata?.color, borderLeftWidth: '3px' }}
                                    >
                                        <div
                                            className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
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
                </div>
            </div>
        </div>
    );
}
