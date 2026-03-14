'use client';

import React, { useState, useEffect, memo } from 'react';
import { useReactFlow } from 'reactflow';
import { Zap, Check, Square, LayoutGrid, MoreHorizontal, Play } from 'lucide-react';
import { motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store/app-store';
import BaseNode from '@/components/canvas/BaseNode';
import GlassyLoader from '@/components/ui/GlassyLoader';
import ImageLightbox from '@/components/ui/ImageLightbox';

// =============================================================================
// TYPES - MOVED TO lib/nodes/types.ts
// =============================================================================
import { AiModel, InputHandle, OutputHandle, InputsSchema, OutputsSchema } from '@/lib/nodes/types';

const WIRE_TYPE_COLORS: Record<string, string> = {
    image: 'rgb(59, 130, 246)',
    video: 'rgb(139, 92, 246)',
    audio: 'rgb(236, 72, 153)',
    text: 'rgb(34, 197, 94)',
    any: 'rgb(var(--accent-primary))',
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

function AIGeneratorNode({ id, data, selected }: any) {
    const { setNodes } = useReactFlow();
    const liveOutput = useAppStore(state => state.nodeOutputs[id]);
    const status = useAppStore(state => state.nodeStatuses[id] || 'idle');

    // Fallback to saved output for hydration/reloads
    const output = liveOutput || data.output || data.config?.last_output;

    const models = useAppStore(state => state.models);
    const nodeTypes = useAppStore(state => state.nodeTypes);
    const [previewMode, setPreviewMode] = useState<'single' | 'grid'>('single');
    const [activeImageIndex, setActiveImageIndex] = useState(0);

    // Lightbox state
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const [lightboxIndex, setLightboxIndex] = useState(0);

    const triggerRunFromNode = useAppStore(state => state.triggerRunFromNode);

    const openLightbox = (index: number) => {
        setLightboxIndex(index);
        setLightboxOpen(true);
    };

    const nodeTypeId = data.config?.node_type_id;
    const filteredModels = nodeTypeId 
        ? models.filter(m => m.node_type_id === nodeTypeId)
        : models;

    const selectedModel = filteredModels.find(m => m.id === data.config?.model_id) || null;
    const selectedNodeType = nodeTypes.find(nt => nt.id === nodeTypeId) || null;

    // Initial load for auto-selecting if empty
    useEffect(() => {
        // If we have a model_id in data.config (from drag), use it
        if (data.config?.model_id && !selectedModel) {
            // Wait for models to load or resolve from state
            return;
        }

        if (!data.config?.model_id && filteredModels.length > 0) {
            const firstActive = filteredModels.find(mod => mod.is_active) || filteredModels[0];
            setNodes(prev => prev.map(n => n.id === id
                ? { ...n, data: { ...n.data, config: { ...n.data.config, model_id: firstActive.id, control_values: {} } } }
                : n
            ));
        }
    }, [id, filteredModels, data.config?.model_id, setNodes, selectedModel]);

    // ⭐ React Flow Edge Validation — Clean up dangling edges when model/handles change
    const { getEdges, setEdges } = useReactFlow();
    useEffect(() => {
        if (!selectedModel) return;

        const currentEdges = getEdges();
        const validInputHandles = new Set(selectedModel.inputs_schema?.handles?.map(h => h.api_mapping_key) || []);
        const validOutputHandles = new Set(selectedModel.outputs_schema?.handles?.map(h => h.api_mapping_key || 'output') || []);

        const invalidEdges = currentEdges.filter(edge => {
            // If this node is the target, check if targetHandle is still valid
            if (edge.target === id) {
                if (!edge.targetHandle) return false; // Default handle is always valid
                return !validInputHandles.has(edge.targetHandle);
            }
            // If this node is the source, check if sourceHandle is still valid
            if (edge.source === id) {
                if (!edge.sourceHandle || edge.sourceHandle === 'output') return false; 
                return !validOutputHandles.has(edge.sourceHandle);
            }
            return false;
        });

        if (invalidEdges.length > 0) {
            console.warn(`[AIGeneratorNode] Cleaning up ${invalidEdges.length} dangling edges after model switch`);
            const invalidIds = new Set(invalidEdges.map(e => e.id));
            setEdges(eds => eds.filter(e => !invalidIds.has(e.id)));
        }
    }, [id, selectedModel, getEdges, setEdges]);
    const inputHandles = selectedModel?.inputs_schema?.handles || [];
    const outputHandles = selectedModel?.outputs_schema?.handles || [];

    const customInputs = inputHandles.map(h => ({
        id: h.api_mapping_key || h.name,
        label: h.name,
        color: WIRE_TYPE_COLORS[h.type] || WIRE_TYPE_COLORS.any,
        type: h.type,
        isArray: h.is_array,
        isMandatory: h.is_mandatory
    }));

    const customOutputs = outputHandles.map(h => ({
        id: h.api_mapping_key || h.name || 'output',
        label: h.name,
        color: WIRE_TYPE_COLORS[h.type] || WIRE_TYPE_COLORS.any,
        type: h.type,
        isArray: h.is_array
    }));

    // Find the first valid output to preview (if multiple)
    let previewOutput = output;
    if (output && typeof output === 'object' && !Array.isArray(output) && !output.url && !output.text) {
        // It's a multi-handle output object. Pick the first one that has an image or text
        const firstKey = Object.keys(output)[0];
        if (firstKey) previewOutput = output[firstKey];
    }

    return (
        <BaseNode
            id={id}
            type="ai_generator"
            label={selectedNodeType ? selectedNodeType.display_name : (data.config?.model_id ? 'AI Model' : 'AI Generator')}
            icon={selectedNodeType?.icon_reference}
            selected={selected}
            providerLogo={selectedModel?.providers?.logo_url || undefined}
            customInputs={customInputs}
            customOutputs={customOutputs}
            width={320}
        >
            <motion.div
                layout
                className={cn(
                    "relative w-full rounded-xl overflow-hidden border border-white/10 bg-white/5 shadow-inner group/node",
                    "transition-all duration-500"
                )}
            >
                {/* Frosty Placeholder background */}
                <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />

                {/* Empty State / Connection Placeholder */}
                {!output && (
                    <div 
                        className="w-full min-h-[200px] flex flex-col items-center justify-center gap-3 opacity-30 group-hover/node:opacity-50 transition-opacity duration-500 cursor-pointer"
                        onMouseDown={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                    >
                        <div className="p-4 rounded-2xl bg-white/5 shadow-xl">
                            <Zap className="w-10 h-10 text-white/40" />
                        </div>
                        <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-white/30 text-center px-4">
                            {!data.config?.model_id ? 'Select a Model to Start' : (selectedModel ? `Ready to Run ${selectedModel.display_name}` : 'Model not found in catalog')}
                        </span>
                    </div>
                )}

                {/* Loading State */}
                {status === 'running' && <GlassyLoader />}

                {/* Content Preview (Matching CustomNode Logic) */}
                {previewOutput && (
                    <OutputPreview
                        output={previewOutput}
                        type={outputHandles[0]?.type || 'any'}
                        previewMode={previewMode}
                        activeImageIndex={activeImageIndex}
                        onImageClick={(idx: number, e: React.MouseEvent) => {
                            e.stopPropagation();
                            setActiveImageIndex(idx);
                            if (previewMode === 'single') openLightbox(idx);
                        }}
                        onPreviewClick={(e: React.MouseEvent) => {
                            e.stopPropagation();
                            openLightbox(activeImageIndex);
                        }}
                    />
                )}

                {/* View Toggles (Matching CustomNode) */}
                {Array.isArray(previewOutput) && previewOutput.length > 1 && (
                    <div className="absolute bottom-3 right-3 flex bg-black/60 backdrop-blur-xl rounded-xl p-1 border border-white/10 z-20 shadow-2xl opacity-0 group-hover/node:opacity-100 transition-opacity">
                        <button
                            onClick={(e) => { e.stopPropagation(); setPreviewMode('single'); }}
                            className={cn("p-1.5 rounded-lg transition-all", previewMode === 'single' ? "bg-accent-primary text-white" : "text-white/40 hover:text-white")}
                            title="Single View"
                        >
                            <Square className="w-4 h-4" />
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); setPreviewMode('grid'); }}
                            className={cn("p-1.5 rounded-lg transition-all", previewMode === 'grid' ? "bg-accent-primary text-white" : "text-white/40 hover:text-white")}
                            title="Grid View"
                        >
                            <LayoutGrid className="w-4 h-4" />
                        </button>
                    </div>
                )}
            </motion.div>

            {/* Model Info Footer (Refined) */}
            {selectedModel && (
                <div className="mt-1 px-2.5 py-2 flex items-center justify-between opacity-90 group-hover:opacity-100 transition-opacity">
                    <div 
                        className="flex items-center gap-2 min-w-0 cursor-pointer"
                        onClick={(e) => {
                            // Let it bubble to open properties
                        }}
                    >
                        <span className="text-xs font-bold text-white/80 truncate">{selectedModel.display_name}</span>
                        <MoreHorizontal className="w-4 h-4 text-white/20 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                    </div>
                    
                    <button
                        onMouseDown={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                            e.stopPropagation();
                            triggerRunFromNode(id, 'solo');
                        }}
                        className={cn(
                            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all shadow-lg",
                            "bg-accent-primary/10 text-accent-primary border border-accent-primary/20 hover:bg-accent-primary hover:text-white hover:scale-[1.02] active:scale-[0.98]",
                            status === 'running' && "opacity-50 pointer-events-none"
                        )}
                    >
                        <Play className={cn("w-3 h-3", status !== 'running' && "fill-current")} />
                        {status === 'running' ? 'Running' : 'Run'}
                    </button>
                </div>
            )}

            {/* Lightbox Portal */}
            {lightboxOpen && previewOutput && createPortal(
                <ImageLightbox
                    images={Array.isArray(previewOutput) ? previewOutput : [previewOutput]}
                    initialIndex={lightboxIndex}
                    onClose={() => setLightboxOpen(false)}
                />,
                document.body
            )}
        </BaseNode>
    );
}

// =============================================================================
// OUTPUT PREVIEW (Parity with CustomNode)
// =============================================================================

function OutputPreview({ output, type, previewMode, activeImageIndex, onImageClick, onPreviewClick }: any) {
    const items = Array.isArray(output) ? output : [output];
    const urls = items.map((o: any) => (typeof o === 'string' ? o : o?.url)).filter(Boolean);

    const [isTransitioning, setIsTransitioning] = useState(false);
    const lastUrlRef = React.useRef<string | null>(null);

    const MAX_HEIGHT = 800;

    // Track URL changes to trigger blur transition
    React.useEffect(() => {
        const url = urls[activeImageIndex] || urls[0];
        if (url && url !== lastUrlRef.current) {
            setIsTransitioning(true);
            lastUrlRef.current = url;
        }
    }, [urls, activeImageIndex]);

    if (urls.length === 0) {
        return (
            <div className="p-4 bg-white/5 rounded-xl border border-white/10 text-[10px] text-white/40 italic break-all line-clamp-4">
                {JSON.stringify(output)}
            </div>
        );
    }

    if (previewMode === 'single') {
        const url = urls[activeImageIndex] || urls[0];
        if (type === 'video') {
            return <video src={url} controls className="w-full" />;
        }
        return (
            <div 
                className="w-full h-full relative group/preview cursor-zoom-in" 
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => onPreviewClick(e)}
            >
                <motion.img
                    initial={false}
                    animate={{ 
                        opacity: isTransitioning ? 0.4 : 1,
                        filter: isTransitioning ? 'blur(20px)' : 'blur(0px)',
                        scale: isTransitioning ? 0.95 : 1
                    }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                    src={url}
                    alt="Output"
                    className="w-full h-auto block object-contain transition-transform duration-700 group-hover/preview:scale-[1.03]"
                    onLoad={() => setIsTransitioning(false)}
                    style={{ maxHeight: MAX_HEIGHT }}
                />
            </div>
        );
    }

    // Grid View
    return (
        <div className="w-full h-full p-2 overflow-y-auto custom-scrollbar">
            <div className="grid grid-cols-3 gap-2">
                {urls.map((url: string, i: number) => {
                    const isActive = activeImageIndex === i;
                    return (
                        <button
                            key={i}
                            onMouseDown={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => onImageClick(i, e)}
                            className={cn(
                                "relative aspect-square rounded-md overflow-hidden bg-white/5 border-2 transition-all",
                                isActive ? "border-accent-primary ring-2 ring-accent-primary/20 scale-[0.98]" : "border-white/5 hover:border-white/20"
                            )}
                        >
                            <img src={url} alt="" className="w-full h-full object-cover" />
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
    );
}

export default memo(AIGeneratorNode);
