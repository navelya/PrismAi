'use client';

import React, { memo, useState } from 'react';
import { createPortal } from 'react-dom';
import { NodeProps } from 'reactflow';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store/app-store';
import BaseNode from './BaseNode';
import ImageLightbox from '@/components/ui/ImageLightbox';
import { LayoutGrid, Square, Check, Image as ImageIcon, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface CustomNodeData {
    label: string;
    config: any;
}

function CustomNode({ data, type, id, selected }: NodeProps<CustomNodeData>) {
    // Subscribe to specific output for this node, or fallback to saved metadata (for page refreshes)
    const liveOutput = useAppStore((state) => state.nodeOutputs[id]);
    const output = liveOutput ||
        (data as any).output ||
        ((data as any).outputMetadata?.thumbnailUrls?.length ? (data as any).outputMetadata.thumbnailUrls.map((url: string) => ({ url })) : null);

    // Preview Mode: 'single' or 'grid'
    const [previewMode, setPreviewMode] = useState<'single' | 'grid'>('single');
    // For Multi-image nodes, track which index is currently shown in 'single' view
    const [activeImageIndex, setActiveImageIndex] = useState(0);

    const status = useAppStore((state) => state.nodeStatuses[id] || 'idle');

    // Lightbox state
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const [lightboxIndex, setLightboxIndex] = useState(0);

    // Dynamic sizing logic based on output
    const [aspectRatio, setAspectRatio] = useState<number | null>(null);
    const MAX_WIDTH = 400;
    const MIN_HEIGHT = 180;
    const MAX_HEIGHT = 450;

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
            width={output && aspectRatio ? Math.min(MAX_WIDTH, 320 * aspectRatio) : 320}
        >
            <motion.div
                layout
                className={cn(
                    "relative w-full rounded-xl overflow-hidden border border-white/10 bg-white/5 shadow-inner group/node",
                    "transition-all duration-500"
                )}
                style={{
                    minHeight: MIN_HEIGHT,
                    height: output && aspectRatio ? 'auto' : MIN_HEIGHT,
                }}
            >
                {/* Frosty Placeholder background */}
                <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />

                {/* Empty State / Connection Placeholder */}
                {!output && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 opacity-30 group-hover/node:opacity-50 transition-opacity duration-500">
                        <div className="p-4 rounded-2xl bg-white/5 shadow-xl">
                            <ImageIcon className="w-10 h-10 text-white/40" />
                        </div>
                        <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-white/30">Awaiting Generation</span>
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
                                    style={{
                                        maxHeight: MAX_HEIGHT,
                                    }}
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
                            onClick={(e) => { e.stopPropagation(); setPreviewMode('grid'); e.preventDefault(); }}
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
        </BaseNode >
    );
}

export default memo(CustomNode);
