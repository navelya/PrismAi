'use client';

import React, { useState } from 'react';
import { NodeType } from '@/lib/nodes/types';
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';
import * as Icons from 'lucide-react';
import { ChevronLeft, ChevronRight, Zap } from 'lucide-react';
import { Tooltip } from '@/components/ui/Tooltip';

interface NodePaletteProps {
    onDragStart: (type: NodeType) => void;
    isCollapsed: boolean;
    setIsCollapsed: (v: boolean) => void;
}

const nodeTypes = Object.keys(sharedRegistry) as NodeType[];

export default function NodePalette({ onDragStart, isCollapsed, setIsCollapsed }: NodePaletteProps) {

    const handleDragStart = (event: React.DragEvent, nodeType: NodeType) => {
        event.dataTransfer.setData('application/reactflow', nodeType);
        event.dataTransfer.effectAllowed = 'move';
        onDragStart(nodeType);
    };

    return (
        <div className={`relative h-full transition-all duration-300 z-40 ${isCollapsed ? 'w-0' : 'w-64'}`}>

            {/* Toggle Button - Outside clipping container to remain visible */}
            {/* Toggle Button - Stable structure for animation */}
            <div
                className="absolute top-4 z-50 transition-all duration-500 ease-in-out"
                style={{ left: isCollapsed ? '0.5rem' : '13.25rem' }}
            >
                <Tooltip
                    content={isCollapsed ? "Expand nodes panel" : ""}
                    position="right"
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
            </div>

            {/* Clipping Container - Handles the "Wipe" animation (Width 0 -> 64) */}
            <div className={`h-full bg-surface-elevated/80 backdrop-blur-md border-r border-stroke-subtle overflow-hidden transition-all duration-500 ease-in-out ${isCollapsed ? 'w-0' : 'w-64'}`}>

                {/* Fixed Width Content - Stays stable (w-64) while parent clips it */}
                <div className="w-64 h-full flex flex-col">

                    {/* Header */}
                    <div className="h-16 flex items-center px-6 flex-shrink-0">
                        <h3 className="text-xs font-bold text-content-tertiary uppercase tracking-widest flex items-center gap-2">
                            <Icons.Box className="w-3.5 h-3.5" />
                            Node Library
                        </h3>
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

                        {/* AI Generator — Dynamic Node */}
                        <div className="pt-3 border-t border-stroke-subtle">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-content-tertiary mb-2">Dynamic Nodes</p>
                            <div
                                draggable
                                onDragStart={(e) => {
                                    e.dataTransfer.setData('application/reactflow', 'ai_generator');
                                    e.dataTransfer.effectAllowed = 'move';
                                }}
                                className="flex items-center gap-3 p-3 border border-accent-primary/30 rounded-lg cursor-move hover:border-accent-primary hover:bg-accent-primary/5 transition-all bg-accent-primary/5"
                                style={{ borderLeftColor: 'rgb(var(--accent-primary))', borderLeftWidth: '3px' }}
                            >
                                <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-accent-primary/10">
                                    <Zap className="w-5 h-5 text-accent-primary" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="font-medium text-sm text-content-primary">AI Generator</div>
                                    <div className="text-xs text-content-secondary truncate">Dynamic model node</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
