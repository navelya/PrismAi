'use client';

import React, { useState } from 'react';
import { NodeType } from '@/lib/nodes/types';
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';
import * as Icons from 'lucide-react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Tooltip } from '@/components/ui/Tooltip';

interface NodePaletteProps {
    onDragStart: (type: NodeType) => void;
}

const nodeTypes = Object.keys(sharedRegistry) as NodeType[];

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
            {/* Toggle Button - Stable structure for animation */}
            <Tooltip
                content={isCollapsed ? "Expand nodes panel" : ""}
                position="right"
                className="absolute top-4 z-50 transition-all duration-500 ease-in-out"
                style={{ left: isCollapsed ? '0.5rem' : '13.25rem' }}
            >
                <button
                    onClick={() => setIsCollapsed(!isCollapsed)}
                    className={`flex items-center justify-center transition-all duration-500 ease-in-out
                        ${isCollapsed
                            ? 'p-2.5 rounded-full shadow-lg border border-stroke-subtle bg-surface-primary hover:bg-surface-secondary text-content-primary transform hover:scale-105'
                            : 'p-1.5 rounded-lg hover:bg-surface-secondary text-content-secondary hover:text-content-primary'
                        }`}
                >
                    {isCollapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-4 h-4" />}
                </button>
            </Tooltip>

            {/* Clipping Container - Handles the "Wipe" animation (Width 0 -> 64) */}
            <div className={`h-full bg-surface-primary border-r border-stroke-subtle overflow-hidden transition-all duration-500 ease-in-out ${isCollapsed ? 'w-0' : 'w-64'}`}>

                {/* Fixed Width Content - Stays stable (w-64) while parent clips it */}
                <div className="w-64 h-full flex flex-col">

                    {/* Header */}
                    <div className="h-14 flex items-center px-4 border-b border-stroke-subtle flex-shrink-0">
                        <h3 className="text-sm font-semibold text-content-secondary uppercase tracking-wide">Nodes</h3>
                    </div>

                    {/* Content */}
                    <div className="flex-1 p-4 space-y-3 overflow-y-auto">
                        <div className="space-y-2">
                            <p className="text-xs text-content-tertiary">Drag nodes to the canvas</p>
                        </div>

                        <div className="space-y-2">
                            {nodeTypes.map((type) => {
                                const metadata = sharedRegistry[type]?.meta;
                                const IconComponent = metadata?.icon
                                    ? (Icons[metadata.icon as keyof typeof Icons] as React.ComponentType<any>)
                                    : Icons.Box;

                                return (
                                    <div
                                        key={type}
                                        draggable
                                        onDragStart={(e) => handleDragStart(e, type)}
                                        className="flex items-center gap-3 p-3 border border-stroke-subtle rounded-lg cursor-move hover:border-accent-primary hover:bg-accent-primary/5 transition-all bg-surface-primary"
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
                                            <div className="font-medium text-sm text-content-primary">{metadata?.label}</div>
                                            <div className="text-xs text-content-secondary truncate">{metadata?.description}</div>
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
