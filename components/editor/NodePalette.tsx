'use client';

import React, { useState } from 'react';
import { NodeType, Category, NodeTypeRecord } from '@/lib/nodes/types';
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';
import { useAppStore } from '@/lib/store/app-store';
import * as Icons from 'lucide-react';
import { ChevronLeft, ChevronRight, Zap, Folder, ArrowLeft } from 'lucide-react';
import { Tooltip } from '@/components/ui/Tooltip';
import { cn } from '@/lib/utils';

interface NodePaletteProps {
    onDragStart: (type: NodeType) => void;
    isCollapsed: boolean;
    setIsCollapsed: (v: boolean) => void;
}

export default function NodePalette({ onDragStart, isCollapsed, setIsCollapsed }: NodePaletteProps) {
    const categories = useAppStore(state => state.categories);
    const nodeTypes = useAppStore(state => state.nodeTypes);
    
    const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);

    const handleDragStart = (event: React.DragEvent, type: NodeType, nodeTypeId?: string, archetypeId?: string) => {
        // Create a structured payload for the canvas
        const payload = JSON.stringify({
            type,
            node_type_id: nodeTypeId,
            archetype_id: archetypeId
        });
        
        event.dataTransfer.setData('application/reactflow', payload);
        event.dataTransfer.effectAllowed = 'move';
        onDragStart(type);
    };

    const activeCategory = categories.find(c => c.id === selectedCategoryId);
    const filteredNodeTypes = selectedCategoryId 
        ? nodeTypes.filter(nt => nt.parent_categories?.includes(selectedCategoryId))
        : [];

    return (
        <div className={cn("relative h-full transition-all duration-300 z-40", isCollapsed ? 'w-0' : 'w-64')}>

            {/* Toggle Button */}
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
                        className={cn(
                            "flex items-center justify-center transition-all duration-500 ease-in-out",
                            isCollapsed
                                ? 'p-2.5 rounded-full shadow-lg border border-stroke-subtle bg-surface-primary hover:bg-surface-secondary text-content-primary transform hover:scale-105'
                                : 'p-1.5 rounded-lg hover:bg-surface-secondary text-content-secondary hover:text-content-primary'
                        )}
                    >
                        {isCollapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-4 h-4" />}
                    </button>
                </Tooltip>
            </div>

            {/* Sliding Container */}
            <div className={cn(
                "h-full bg-surface-elevated/80 backdrop-blur-md border-r border-stroke-subtle overflow-hidden transition-all duration-500 ease-in-out",
                isCollapsed ? 'w-0' : 'w-64'
            )}>
                <div className="w-64 h-full flex flex-col">
                    
                    {/* Header */}
                    <div className="h-16 flex items-center px-6 border-b border-stroke-subtle flex-shrink-0">
                        {selectedCategoryId ? (
                            <button 
                                onClick={() => setSelectedCategoryId(null)}
                                className="flex items-center gap-2 text-content-primary hover:text-accent-primary transition-colors"
                            >
                                <ArrowLeft className="w-4 h-4" />
                                <span className="text-xs font-bold uppercase tracking-widest">Back</span>
                            </button>
                        ) : (
                            <h3 className="text-xs font-bold text-content-tertiary uppercase tracking-widest flex items-center gap-2">
                                <Icons.Box className="w-3.5 h-3.5" />
                                Node Library
                            </h3>
                        )}
                    </div>

                    {/* View Switcher */}
                    <div className="flex-1 overflow-y-auto overflow-x-hidden relative">
                        {/* Categories View (Level 1) */}
                        <div className={cn(
                            "absolute inset-0 p-4 space-y-4 transition-all duration-300",
                            selectedCategoryId ? "-translate-x-full opacity-0 pointer-events-none" : "translate-x-0 opacity-100"
                        )}>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-content-tertiary mb-2">Categories</p>
                            <div className="grid grid-cols-2 gap-3">
                                {categories.map((category) => {
                                    const IconComponent = (Icons[category.icon_reference as keyof typeof Icons] as React.ComponentType<any>) || Folder;
                                    return (
                                        <button
                                            key={category.id}
                                            onClick={() => setSelectedCategoryId(category.id)}
                                            className="flex flex-col items-center justify-center p-4 rounded-xl border border-stroke-subtle bg-surface-primary hover:border-accent-primary hover:bg-accent-primary/5 transition-all group"
                                        >
                                            <div className="w-10 h-10 rounded-lg bg-surface-secondary flex items-center justify-center mb-2 group-hover:bg-accent-primary/10 transition-colors">
                                                <IconComponent className="w-5 h-5 text-content-primary group-hover:text-accent-primary transition-colors" />
                                            </div>
                                            <span className="text-xs font-medium text-center line-clamp-1">{category.display_name}</span>
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Static/Utility Nodes */}
                            <div className="pt-4 border-t border-stroke-subtle space-y-3">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-content-tertiary">Quick Access</p>
                                {['media_input', 'prompt', 'compositor'].map(type => {
                                    const metadata = sharedRegistry[type]?.meta;
                                    const IconComp = (Icons[metadata?.icon as keyof typeof Icons] as React.ComponentType<any>) || Icons.Box;
                                    return (
                                        <div
                                            key={type}
                                            draggable
                                            onDragStart={(e) => handleDragStart(e, type as NodeType)}
                                            className="flex items-center gap-3 p-3 border border-stroke-subtle rounded-lg cursor-move hover:border-accent-primary hover:bg-accent-primary/5 transition-all bg-surface-primary shadow-sm"
                                        >
                                            <IconComp className="w-4 h-4 text-content-secondary" />
                                            <span className="text-xs font-medium">{metadata?.label}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Node Types View (Level 2) */}
                        <div className={cn(
                            "absolute inset-0 p-4 space-y-3 transition-all duration-300",
                            selectedCategoryId ? "translate-x-0 opacity-100" : "translate-x-full opacity-0 pointer-events-none"
                        )}>
                            <div className="mb-4">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-content-tertiary">Models for</p>
                                <h4 className="text-lg font-bold text-content-primary">{activeCategory?.display_name}</h4>
                            </div>
                            
                            <div className="space-y-2">
                                {filteredNodeTypes.map((nt) => {
                                    const IconComp = (Icons[nt.icon_reference as keyof typeof Icons] as React.ComponentType<any>) || Zap;
                                    return (
                                        <div
                                            key={nt.id}
                                            draggable
                                            onDragStart={(e) => handleDragStart(e, 'ai_generator', nt.id, nt.archetype_id)}
                                            className="flex items-center gap-3 p-3 border border-stroke-subtle rounded-xl cursor-move hover:border-accent-primary hover:bg-accent-primary/5 transition-all bg-surface-primary group"
                                        >
                                            <div className="w-10 h-10 rounded-lg bg-surface-secondary flex items-center justify-center flex-shrink-0 group-hover:bg-accent-primary/10 transition-colors">
                                                <IconComp className="w-5 h-5 text-content-secondary group-hover:text-accent-primary transition-colors" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="font-bold text-sm text-content-primary">{nt.display_name}</div>
                                                <div className="text-[10px] text-content-tertiary uppercase tracking-wider">Dynamic Node</div>
                                            </div>
                                        </div>
                                    );
                                })}
                                
                                {filteredNodeTypes.length === 0 && (
                                    <div className="flex flex-col items-center justify-center py-12 text-content-tertiary">
                                        <Icons.Inbox className="w-8 h-8 mb-2 opacity-20" />
                                        <span className="text-xs">No models found in this category</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
