'use client';

import React, { memo, useState, useMemo, useEffect, useCallback } from 'react';
import { NodeProps, useReactFlow, useEdges } from 'reactflow';
import { cn } from '@/lib/utils';
import BaseNode from '@/components/canvas/BaseNode';
import { BlurConfig } from '@/lib/nodes/plugins/blur/types';
import { blurExecutor } from '@/lib/nodes/plugins/blur/executor';
import ImageLightbox from '@/components/ui/ImageLightbox';

interface BlurNodeData {
    label: string;
    config: BlurConfig;
}

const defaultConfig: BlurConfig = {
    radius: 5,
};

function BlurNode({ data, id, selected }: NodeProps<BlurNodeData>) {
    const { setNodes } = useReactFlow();
    const edges = useEdges();
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [lightboxOpen, setLightboxOpen] = useState(false);

    // Get current config with defaults
    const config = useMemo(() => ({
        ...defaultConfig,
        ...data.config,
    }), [data.config]);

    // Find connected input
    const connectedInput = useMemo(() => {
        const inputEdge = edges.find(e => e.target === id && e.targetHandle === 'image');
        if (!inputEdge) return null;

        // Get the source node data
        const sourceNode = edges.find(e => e.source === inputEdge.source);
        // In a real scenario, we'd get the actual output from the node
        // For now, we'll trigger based on edge connection
        return inputEdge.source;
    }, [edges, id]);

    // Update blur radius
    const updateRadius = useCallback((newRadius: number) => {
        setNodes((nds) =>
            nds.map((node) => {
                if (node.id === id) {
                    return {
                        ...node,
                        data: {
                            ...node.data,
                            config: {
                                ...node.data.config,
                                radius: newRadius,
                            },
                        },
                    };
                }
                return node;
            })
        );
    }, [id, setNodes]);

    // Generate live preview when config or input changes
    useEffect(() => {
        // We'll implement live preview in Phase 2
        // For now, just show a placeholder
    }, [config, connectedInput]);

    return (
        <BaseNode
            id={id}
            type="blur"
            label={data.label}
            selected={selected}
            isNew={(data as any).isNew}
            hideStatus={true}
        >
            {/* Preview Container */}
            <div className="relative group">
                {/* Preview Area */}
                <div className="relative w-full aspect-video bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                    {previewUrl ? (
                        <img
                            src={previewUrl}
                            alt="Blur preview"
                            className="w-full h-full object-contain cursor-pointer"
                            onClick={() => setLightboxOpen(true)}
                        />
                    ) : (
                        <div className="flex items-center justify-center h-full text-xs text-content-secondary">
                            {connectedInput ? (
                                isProcessing ? 'Processing...' : 'Connect image to preview'
                            ) : (
                                'No input connected'
                            )}
                        </div>
                    )}
                </div>

                {/* Blur Controls */}
                <div className="mt-3 space-y-3 p-3 bg-white/[0.02] rounded-xl border border-white/5">
                    {/* Radius Slider */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <label className="text-[10px] font-black uppercase tracking-wider text-content-secondary">
                                Blur Radius
                            </label>
                            <span className="text-[8px] font-mono text-accent-primary/60">
                                PIXELS
                            </span>
                        </div>
                        <div className="space-y-2">
                            <input
                                type="range"
                                min={0}
                                max={50}
                                step={0.1}
                                value={config.radius}
                                onChange={(e) => updateRadius(parseFloat(e.target.value))}
                                className="nodrag w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-accent-primary transition-all hover:scale-y-125"
                            />
                            <div className="flex justify-between items-center text-[10px]">
                                <span className="text-content-tertiary">0</span>
                                <div className="px-2 py-0.5 rounded bg-accent-primary/10 border border-accent-primary/20 text-accent-primary font-mono">
                                    {config.radius.toFixed(1)}
                                </div>
                                <span className="text-content-tertiary">50</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Image Lightbox */}
            {previewUrl && (
                <ImageLightbox
                    isOpen={lightboxOpen}
                    onClose={() => setLightboxOpen(false)}
                    imageUrl={previewUrl}
                    title="Blur Preview"
                />
            )}
        </BaseNode>
    );
}

export default memo(BlurNode);
