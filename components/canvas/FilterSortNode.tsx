'use client';

import React, { memo, useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { NodeProps } from 'reactflow';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store/app-store';
import BaseNode from './BaseNode';
import ImageLightbox from '@/components/ui/ImageLightbox';
import { LayoutGrid, Square, Check, Image as ImageIcon, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { FilterSortConfig } from '@/lib/nodes/types';

interface FilterSortNodeData {
    label: string;
    config: FilterSortConfig;
}

function FilterSortNode({ data, type, id, selected }: NodeProps<FilterSortNodeData>) {
    const currentWorkflow = useAppStore((state) => state.currentWorkflow);
    const nodeOutputs = useAppStore((state) => state.nodeOutputs);
    const setNodeOutput = useAppStore((state) => state.setNodeOutput);

    // Track original data for Live sorting safely without infinite loops
    // We only want to trigger a re-sort if the ACTUAL input edges or data changes.
    const sourceDataInfo = useMemo(() => {
        if (!currentWorkflow) return null;
        const edge = currentWorkflow.edges?.find(e => e.target === id);
        if (!edge) return null;

        const sourceOutput = nodeOutputs[edge.source];
        if (!sourceOutput) return null;

        return {
            sourceId: edge.source,
            output: sourceOutput
        };
    }, [currentWorkflow?.edges, id, nodeOutputs]);

    // Use a stringified hash to prevent object-reference infinite loops in useEffect
    const sourceHash = useMemo(() => {
        return sourceDataInfo ? JSON.stringify(sourceDataInfo.output) : null;
    }, [sourceDataInfo]);

    // Perform sorting instantly entirely in React
    useEffect(() => {
        if (!sourceDataInfo || !sourceDataInfo.output) {
            // Unplugged or no data - wipe clean instantly!
            setNodeOutput(id, null);
            return;
        }

        let images: any[] = [];
        const { output: srcOut } = sourceDataInfo;

        if (Array.isArray(srcOut)) {
            images = [...srcOut];
        } else if (srcOut?.images && Array.isArray(srcOut.images)) {
            images = [...srcOut.images];
        } else if (srcOut?.url) {
            images = [srcOut];
        }

        if (images.length === 0) {
            setNodeOutput(id, null);
            return;
        }

        const criteria = data.config?.criteria || 'resolution';
        const order = data.config?.order || 'asc';
        const limit = data.config?.limit;

        let sorted = [...images].sort((a, b) => {
            let compareValue = 0;
            switch (criteria) {
                case 'resolution':
                    const aRes = (a.resolution?.width || 0) * (a.resolution?.height || 0);
                    const bRes = (b.resolution?.width || 0) * (b.resolution?.height || 0);
                    compareValue = aRes - bRes;
                    break;
                case 'size':
                    compareValue = (a.metadata?.size || 0) - (b.metadata?.size || 0);
                    break;
                case 'format':
                    compareValue = (a.metadata?.format || '').localeCompare(b.metadata?.format || '');
                    break;
            }
            return order === 'asc' ? compareValue : -compareValue;
        });

        if (limit && limit > 0) {
            sorted = sorted.slice(0, limit);
        }

        // Push to global store immediately so the node visually updates and downstream nodes receive it
        setNodeOutput(id, sorted);

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sourceHash, data.config?.criteria, data.config?.order, data.config?.limit, id]); // Intentionally omitting setNodeOutput to be safe, relying on primitives

    // Live output is populated by our useEffect!
    const output = nodeOutputs[id];

    const [previewMode, setPreviewMode] = useState<'single' | 'grid'>('grid'); // Default to grid for filter/sort array
    const [activeImageIndex, setActiveImageIndex] = useState(0);
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const [lightboxIndex, setLightboxIndex] = useState(0);
    const [aspectRatio, setAspectRatio] = useState<number | null>(null);

    const openLightbox = (index: number) => {
        setLightboxIndex(index);
        setLightboxOpen(true);
    };

    return (
        <BaseNode
            id={id}
            type={type}
            label={data.label}
            selected={selected}
            badgeCount={Array.isArray(output) ? output.length : undefined}
            className="transition-all duration-500 ease-in-out"
            width={output && aspectRatio ? Math.min(400, 320 * aspectRatio) : 320}
        >
            <motion.div
                layout
                className={cn(
                    "relative w-full rounded-xl overflow-hidden border border-white/10 bg-white/5 shadow-inner group/node",
                    "transition-all duration-500"
                )}
                style={{
                    minHeight: 180,
                    height: output && aspectRatio ? 'auto' : 180,
                }}
            >
                {/* Frosty Placeholder background */}
                <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />

                {!output && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 opacity-30 group-hover/node:opacity-50 transition-opacity duration-500">
                        <div className="p-4 rounded-2xl bg-white/5 shadow-xl">
                            <ImageIcon className="w-10 h-10 text-white/40" />
                        </div>
                        <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-white/30">Connect Source</span>
                    </div>
                )}

                {output && previewMode === 'single' && (
                    <div className="w-full h-full group/preview cursor-zoom-in" onClick={() => openLightbox(activeImageIndex)}>
                        {(() => {
                            const currentItem = Array.isArray(output) ? output[activeImageIndex] : output;
                            const imageUrl = currentItem?.url || currentItem?.base64 || (typeof currentItem === 'string' ? currentItem : null);

                            return imageUrl ? (
                                <motion.img
                                    initial={{ opacity: 0, scale: 0.95 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    src={imageUrl}
                                    alt="Preview"
                                    className="w-full h-full object-contain transition-transform duration-700 group-hover/preview:scale-[1.03]"
                                    onLoad={(e) => {
                                        const img = e.target as HTMLImageElement;
                                        setAspectRatio(img.naturalWidth / img.naturalHeight);
                                    }}
                                    style={{ maxHeight: 450 }}
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-[10px] text-white/40">
                                    Invalid Image Data
                                </div>
                            );
                        })()}
                    </div>
                )}

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

                {Array.isArray(output) && output.length > 1 && (
                    <div className="absolute bottom-3 right-3 flex bg-black/60 backdrop-blur-xl rounded-xl p-1 border border-white/10 z-20 shadow-2xl opacity-0 group-hover/node:opacity-100 transition-opacity">
                        <button
                            onClick={(e) => { e.stopPropagation(); setPreviewMode('single'); }}
                            className={cn(
                                "p-1.5 rounded-lg transition-all",
                                previewMode === 'single' ? "bg-accent-primary text-white" : "text-white/40 hover:text-white"
                            )}
                            title="Single View"
                        >
                            <Square className="w-4 h-4" />
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); setPreviewMode('grid'); }}
                            className={cn(
                                "p-1.5 rounded-lg transition-all",
                                previewMode === 'grid' ? "bg-accent-primary text-white" : "text-white/40 hover:text-white"
                            )}
                            title="Grid View"
                        >
                            <LayoutGrid className="w-4 h-4" />
                        </button>
                    </div>
                )}
            </motion.div>

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
        </BaseNode>
    );
}

export default memo(FilterSortNode);
