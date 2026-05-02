'use client';

import React, { memo, useState, useMemo, useCallback, useEffect } from 'react';
import { NodeProps, useEdges, useNodes } from 'reactflow';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import BaseNode from '@/components/canvas/BaseNode';
import { BlurConfig } from '@/lib/nodes/plugins/blur/types';
import ImageLightbox from '@/components/ui/ImageLightbox';
import { useAppStore } from '@/lib/store/app-store';
import { ImageObject } from '@/lib/nodes/types';
import { Select } from '@/components/ui/Select';
import { NumberInput } from '@/components/ui/NumberInput';

interface BlurNodeData {
    label: string;
    config: BlurConfig & { type?: 'gaussian' | 'box' | 'stack' };
}

const defaultConfig: BlurConfig & { type?: 'gaussian' | 'box' | 'stack' } = {
    radius: 5,
    type: 'gaussian'
};

const blurTypeOptions = [
    { id: 'gaussian', display_name: 'Gaussian' },
    { id: 'box', display_name: 'Box' },
    { id: 'stack', display_name: 'Stack' },
];

function BlurNode({ data, id, selected }: NodeProps<BlurNodeData>) {
    const edges = useEdges();
    const nodes = useNodes();
    const nodeOutputs = useAppStore(state => state.nodeOutputs);
    const updateNodeConfig = useAppStore(state => state.updateNodeConfig);
    const isDragging = useAppStore((state) => state.isDragging);
    const [lightboxOpen, setLightboxOpen] = useState(false);

    // Get current config with defaults
    const config = useMemo(() => ({
        ...defaultConfig,
        ...data.config,
    }), [data.config]);

    // Local state for immediate slider feedback without global re-renders
    const [localRadius, setLocalRadius] = useState(config.radius);

    // Keep local state in sync with global config (for undo/redo/external changes)
    useEffect(() => {
        setLocalRadius(config.radius);
    }, [config.radius]);

    // Find connected input
    const connectedInputId = useMemo(() => {
        const inputEdge = edges.find(e => e.target === id && e.targetHandle === 'image');
        return inputEdge?.source || null;
    }, [edges, id]);

    // Get the actual source node from the nodes list
    const sourceNode = useMemo(() => {
        if (!connectedInputId) return null;
        return nodes.find(n => n.id === connectedInputId);
    }, [connectedInputId, nodes]);

    // Extract output data
    const sourceOutput = useMemo(() => {
        if (!connectedInputId) return null;
        if (nodeOutputs[connectedInputId]) return nodeOutputs[connectedInputId];
        if (sourceNode?.data) {
            if (sourceNode.data.output) return sourceNode.data.output;
            if (sourceNode.data.config?.images) return sourceNode.data.config.images;
            if (sourceNode.data.config?.last_output) return sourceNode.data.config.last_output;
        }
        return null;
    }, [connectedInputId, nodeOutputs, sourceNode]);

    // Extract image URL
    const imageUrl = useMemo(() => {
        if (!sourceOutput) return null;
        let imageInput = Array.isArray(sourceOutput) ? sourceOutput[0] : sourceOutput;
        if (imageInput && typeof imageInput === 'object') {
            imageInput = (imageInput as any).url || (Array.isArray((imageInput as any).data) ? (imageInput as any).data[0] : imageInput);
        }
        if (!imageInput) return null;
        return typeof imageInput === 'string' ? imageInput : (imageInput as any)?.url || (imageInput as any)?.previewUrl;
    }, [sourceOutput]);

    // Sync to global state
    const handleSync = useCallback((updates: Partial<typeof config>) => {
        updateNodeConfig(id, {
            ...config,
            ...updates,
        });
    }, [id, config, updateNodeConfig]);

    const nodeWidth = 320;
    const MAX_VISUAL_BLUR = 20; // 100% slider = 20px blur

    // Derived blur style based on type
    const blurStyle = useMemo(() => {
        const pxValue = (localRadius / 100) * MAX_VISUAL_BLUR;
        const base = `blur(${pxValue}px)`;
        if (config.type === 'box') {
            // Box blur approximation: rougher, higher contrast
            return `${base} contrast(1.15) brightness(1.05) saturate(1.1)`;
        }
        if (config.type === 'stack') {
            // Stack blur approximation: softer, slightly desaturated
            return `${base} saturate(0.8) opacity(0.9)`;
        }
        return base;
    }, [localRadius, config.type]);

    return (
        <BaseNode
            id={id}
            type="blur"
            label={data.label}
            selected={selected}
            isNew={(data as any).isNew}
            hideStatus={true}
            width={nodeWidth}
        >
            <motion.div
                layout={!isDragging && !!imageUrl ? "position" : false}
                className={cn(
                    "relative w-full rounded-xl overflow-hidden shadow-inner group/node border border-white/10 bg-white/5",
                    !isDragging && "transition-all duration-500",
                    !imageUrl ? "min-h-[200px]" : "min-h-0"
                )}
            >
                <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />

                <div className="relative w-full flex items-center justify-center">
                    {imageUrl ? (
                        <div className="relative w-full h-full overflow-hidden cursor-zoom-in group/preview">
                            <img
                                src={imageUrl}
                                alt="Blur preview"
                                className={cn(
                                    "w-full h-auto block object-contain transition-transform duration-700 group-hover/preview:scale-[1.05]",
                                    !isDragging && "transition-all duration-300"
                                )}
                                style={{ 
                                    filter: blurStyle,
                                    transform: `scale(1.1)`
                                }}
                                onClick={() => setLightboxOpen(true)}
                            />
                        </div>
                    ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 opacity-30 group-hover/node:opacity-50 transition-opacity duration-500">
                            <div className="text-xs font-medium px-4 text-center">
                                {connectedInputId ? (
                                    <span className="animate-pulse">Waiting for image...</span>
                                ) : (
                                    'Connect image'
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </motion.div>

            {/* Blur Controls */}
            <div className="mt-3 px-1 pb-1 flex flex-col gap-2">
                <div className="flex items-center gap-2 h-8">
                    {/* Blur Type Selector */}
                    <div className="w-[100px] shrink-0">
                        <Select 
                            options={blurTypeOptions}
                            value={config.type || 'gaussian'}
                            onChange={(e) => handleSync({ type: e.target.value as any })}
                            className="h-7 !px-2 !py-0 !rounded-lg text-[9px] !bg-white/5 !border-none font-bold uppercase tracking-wider"
                        />
                    </div>

                    <div className="flex-1 flex items-center group/slider relative h-full px-1">
                        <input
                            type="range"
                            min={0}
                            max={100}
                            step={0.1}
                            value={localRadius}
                            onMouseDown={() => useAppStore.getState().takeSnapshot()}
                            onChange={(e) => setLocalRadius(parseFloat(e.target.value))}
                            onMouseUp={() => handleSync({ radius: localRadius })}
                            onTouchEnd={() => handleSync({ radius: localRadius })}
                            className="nodrag w-full h-full bg-transparent appearance-none cursor-pointer accent-accent-primary z-10"
                            style={{ WebkitAppearance: 'none' }}
                        />
                        {/* Custom Track - Minimalist Line */}
                        <div className="absolute left-0 right-0 h-[1px] bg-white/10 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <div 
                            className="absolute left-0 h-[1px] bg-accent-primary top-1/2 -translate-y-1/2 pointer-events-none"
                            style={{ width: `${(localRadius / 100) * 100}%` }}
                        />
                    </div>

                    {/* Custom Number Input */}
                    <div className="w-[38px] shrink-0">
                        <NumberInput 
                            min={0}
                            max={100}
                            value={Math.round(localRadius)}
                            hideArrows={true}
                            onChange={(e) => {
                                const val = Math.max(0, Math.min(100, parseInt(e.target.value) || 0));
                                setLocalRadius(val);
                                handleSync({ radius: val });
                            }}
                            className="space-y-0 nodrag"
                            inputClassName="h-7 !px-1.5 !text-[10px] !bg-white/5 !border border-white/5 !rounded-lg text-center font-mono font-bold text-accent-primary focus:border-accent-primary/30 transition-all"
                        />
                    </div>
                </div>
            </div>

            {/* Image Lightbox */}
            {lightboxOpen && imageUrl && (
                <ImageLightbox
                    media={imageUrl}
                    type="image"
                    initialIndex={0}
                    onClose={() => setLightboxOpen(false)}
                />
            )}
        </BaseNode>
    );
}

export default memo(BlurNode);
