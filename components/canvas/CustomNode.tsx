'use client';

import React, { memo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, NodeProps, useReactFlow } from 'reactflow';
import { nodeMetadata } from '@/lib/nodes/metadata';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store/app-store';
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';
import { NodeHeader } from './NodeHeader';
import ImageLightbox from '@/components/ui/ImageLightbox';
import { LayoutGrid, Square, Check, Layers, Image as ImageIcon, Play, Copy, X, Loader2, Circle } from 'lucide-react';

interface CustomNodeData {
    label: string;
    config: any;
}

function CustomNode({ data, type, id }: NodeProps<CustomNodeData>) {
    const metadata = nodeMetadata[type as keyof typeof nodeMetadata];
    const sharedDef = sharedRegistry[type as keyof typeof sharedRegistry];
    const defaultInputLabel = sharedDef?.handles?.inputs?.[0]?.label;
    const defaultOutputLabel = sharedDef?.handles?.outputs?.[0]?.label;

    // Subscribe to specific output for this node
    const output = useAppStore((state) => state.nodeOutputs[id]);

    // Preview Mode: 'single' or 'grid'
    const [previewMode, setPreviewMode] = useState<'single' | 'grid'>('single');
    // For Multi-image nodes, track which index is currently shown in 'single' view
    const [activeImageIndex, setActiveImageIndex] = useState(0);

    const deleteNode = useAppStore((state) => state.deleteNode);
    const triggerRunFromNode = useAppStore((state) => state.triggerRunFromNode);
    const status = useAppStore((state) => state.nodeStatuses[id] || 'idle');

    // Use React Flow hook for direct graph manipulation
    const { deleteElements, addNodes, getNode } = useReactFlow();

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
            {/* Node Action Buttons - appear on hover */}
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
                    {status === 'running' && <Loader2 className="w-4 h-4 animate-spin text-content-inverted" />}
                    {status === 'success' && <Check className="w-4 h-4 text-content-inverted" />}
                    {status === 'error' && <X className="w-4 h-4 text-content-inverted" />}
                    {status === 'pending' && <Circle className="w-2 h-2 text-content-inverted fill-current" />}
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
                                >
                                    {input.label && (
                                        <div className="absolute bottom-full right-1/2 mb-1 mr-1 opacity-0 group-hover:opacity-100 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider pointer-events-none transition-all duration-300 text-content-primary drop-shadow-md" style={{ color: nodeColor }}>
                                            {input.label}
                                        </div>
                                    )}
                                </Handle>
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
                >
                    {defaultInputLabel && (
                        <div className="absolute bottom-full right-1/2 mb-1 mr-1 opacity-0 group-hover:opacity-100 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider pointer-events-none transition-all duration-300 text-content-primary drop-shadow-md" style={{ color: nodeColor }}>
                            {defaultInputLabel}
                        </div>
                    )}
                </Handle>
            )}

            <NodeHeader
                icon={metadata?.icon || 'Box'}
                label={metadata?.label || data.label}
                color={nodeColor}
                badgeCount={Array.isArray(output) ? output.length : undefined}
            />

            {/* Main Preview Area */}
            <div className="p-1 px-1.5 pb-2">
                <div
                    className={cn(
                        "relative w-full h-[160px] rounded-lg overflow-hidden border border-white/10 bg-[#0a0a0a] shadow-inner",
                        "transition-all duration-300"
                    )}
                    style={{
                        backgroundImage: 'repeating-conic-gradient(#1a1a1a 0% 25%, #050505 0% 50%)',
                        backgroundSize: '16px 16px',
                    }}
                >
                    {/* Empty State / Connection Placeholder */}
                    {!output && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 opacity-20 group-hover:opacity-40 transition-opacity">
                            <ImageIcon className="w-8 h-8" />
                            <span className="text-[10px] font-medium tracking-widest uppercase">No Data</span>
                        </div>
                    )}

                    {/* Loading State? We could add a spinner here if status is 'running' */}
                    {status === 'running' && (
                        <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] z-10 flex items-center justify-center">
                            <Loader2 className="w-6 h-6 animate-spin text-accent-primary" />
                        </div>
                    )}

                    {/* Single Image View */}
                    {output && previewMode === 'single' && (
                        <div className="w-full h-full group/preview cursor-zoom-in" onClick={() => openLightbox(activeImageIndex)}>
                            {(() => {
                                const currentItem = Array.isArray(output) ? output[activeImageIndex] : output;
                                const imageUrl = currentItem?.url || currentItem?.base64 || (typeof currentItem === 'string' ? currentItem : null);

                                return imageUrl ? (
                                    <img
                                        src={imageUrl}
                                        alt="Preview"
                                        className="w-full h-full object-contain transition-transform duration-500 group-hover/preview:scale-[1.02]"
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-[10px] text-white/40">
                                        Invalid Image Data
                                    </div>
                                );
                            })()}
                        </div>
                    )}

                    {/* Grid View Logic */}
                    {output && Array.isArray(output) && previewMode === 'grid' && (
                        <div className="w-full h-full p-2 overflow-y-auto custom-scrollbar">
                            <div className="grid grid-cols-3 gap-2">
                                {output.map((item: any, idx: number) => {
                                    const imageUrl = item.url || item.base64 || (typeof item === 'string' ? item : null);
                                    const isActive = activeImageIndex === idx;

                                    return (
                                        <button
                                            key={idx}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setActiveImageIndex(idx);
                                            }}
                                            className={cn(
                                                "relative aspect-square rounded-md overflow-hidden bg-white/5 border-2 transition-all",
                                                isActive ? "border-accent-primary ring-2 ring-accent-primary/20 scale-[0.98]" : "border-white/5 hover:border-white/20"
                                            )}
                                        >
                                            {imageUrl ? (
                                                <img src={imageUrl} alt="" className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-[9px]">?</div>
                                            )}
                                            {isActive && (
                                                <div className="absolute inset-0 bg-accent-primary/10 flex items-center justify-center">
                                                    <Check className="w-4 h-4 text-white drop-shadow-md" />
                                                </div>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Mode Toggle Controls (Only if array output) */}
                    {Array.isArray(output) && output.length > 1 && (
                        <div className="absolute bottom-2 right-2 flex bg-black/60 backdrop-blur-md rounded-lg p-0.5 border border-white/10 z-20 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                                onClick={(e) => { e.stopPropagation(); setPreviewMode('single'); }}
                                className={cn(
                                    "p-1.5 rounded-md transition-all",
                                    previewMode === 'single' ? "bg-accent-primary text-white" : "text-white/40 hover:text-white"
                                )}
                                title="Single View"
                            >
                                <Square className="w-3.5 h-3.5" />
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); setPreviewMode('grid'); }}
                                className={cn(
                                    "p-1.5 rounded-md transition-all",
                                    previewMode === 'grid' ? "bg-accent-primary text-white" : "text-white/40 hover:text-white"
                                )}
                                title="Grid View"
                            >
                                <LayoutGrid className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    )}
                </div>
            </div>


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
            >
                {defaultOutputLabel && (
                    <div className="absolute bottom-full left-1/2 mb-1 ml-1 opacity-0 group-hover:opacity-100 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider pointer-events-none transition-all duration-300 text-content-primary drop-shadow-md" style={{ color: nodeColor }}>
                        {defaultOutputLabel}
                    </div>
                )}
            </Handle>
        </div >
    );
}

export default memo(CustomNode);
