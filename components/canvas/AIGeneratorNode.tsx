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
// MODULE-LEVEL SINGLETON — models fetched once for entire app session
// =============================================================================
let cachedModels: AiModel[] | null = null;
let fetchPromise: Promise<AiModel[]> | null = null;

async function fetchModels(): Promise<AiModel[]> {
    if (cachedModels) return cachedModels;
    if (fetchPromise) return fetchPromise;

    fetchPromise = fetch('/api/models/list')
        .then(r => r.json())
        .then(data => {
            cachedModels = data.models || [];
            return cachedModels!;
        })
        .catch(err => {
            console.error('[AIGeneratorNode] Failed to fetch models:', err);
            fetchPromise = null;
            return [];
        });

    return fetchPromise;
}

// =============================================================================
// TYPES
// =============================================================================

interface AiModel {
    id: number;
    replicate_model_id: string;
    display_name: string;
    credit_cost: number;
    is_active: boolean;
    category_id: string;
    inputs_schema: InputsSchema | null;
    outputs_schema: OutputsSchema | null;
}

interface InputHandle {
    name: string;
    api_mapping_key: string;
    type: string;
    is_array: boolean;
    is_mandatory: boolean;
}

interface OutputHandle {
    name: string;
    api_mapping_key: string;
    type: string;
    is_array: boolean;
}

interface InputsSchema {
    handles?: InputHandle[];
    controls?: any[];
}

interface OutputsSchema {
    handles?: OutputHandle[];
}

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

    const [models, setModels] = useState<AiModel[]>([]);
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

    // Initial load for caching/lookup
    useEffect(() => {
        fetchModels().then(m => {
            setModels(m);
            // If no model selected, pick the first active one automatically
            if (!data.config?.model_id && m.length > 0) {
                const firstActive = m.find(mod => mod.is_active) || m[0];
                setNodes(prev => prev.map(n => n.id === id
                    ? { ...n, data: { ...n.data, config: { ...n.data.config, model_id: firstActive.id, control_values: {} } } }
                    : n
                ));
            }
        });
    }, [id, data.config?.model_id, setNodes]);

    const selectedModel = models.find(m => m.id === data.config?.model_id) || null;
    const inputHandles = selectedModel?.inputs_schema?.handles || [];
    const outputHandles = selectedModel?.outputs_schema?.handles || [];

    const customInputs = inputHandles.map(h => ({
        id: h.api_mapping_key,
        label: h.name,
        color: WIRE_TYPE_COLORS[h.type] || WIRE_TYPE_COLORS.any,
        type: h.type,
        isArray: h.is_array,
        isMandatory: h.is_mandatory
    }));

    const customOutputs = outputHandles.map(h => ({
        id: h.api_mapping_key || 'output',
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
            label={selectedModel?.display_name || 'AI Generator'}
            selected={selected}
            customInputs={customInputs}
            customOutputs={customOutputs}
            width={320}
        >
            <motion.div
                layout
                className={cn(
                    "relative w-full rounded-xl overflow-hidden border border-white/10 bg-white/5 shadow-inner group/node",
                    "transition-all duration-500 min-h-[180px]"
                )}
            >
                {/* Frosty Placeholder background */}
                <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />

                {/* Empty State / Connection Placeholder */}
                {!output && (
                    <div 
                        className="absolute inset-0 flex flex-col items-center justify-center gap-3 opacity-30 group-hover/node:opacity-50 transition-opacity duration-500 cursor-pointer"
                        onMouseDown={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                    >
                        <div className="p-4 rounded-2xl bg-white/5 shadow-xl">
                            <Zap className="w-10 h-10 text-white/40" />
                        </div>
                        <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-white/30 text-center px-4">
                            {selectedModel ? `Ready to Run ${selectedModel.display_name}` : 'Select a Model to Start'}
                        </span>
                    </div>
                )}

                {/* Loading State */}
                {status === 'running' && <GlassyLoader />}

                {/* Content Preview (Matching CustomNode Logic) */}
                {previewOutput && (
                    <div className="p-1">
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
                    </div>
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
                <div className="mt-1 px-2.5 py-2 flex items-center justify-between border-t border-white/5 opacity-90 group-hover:opacity-100 transition-opacity bg-white/[0.02]">
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
            return <video src={url} controls className="w-full rounded-lg" />;
        }
        return (
            <div 
                className="w-full relative group/img cursor-zoom-in" 
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => onPreviewClick(e)}
            >
                <img
                    src={url}
                    alt="Output"
                    className="w-full rounded-lg object-contain bg-black/20 animate-in fade-in zoom-in-95 duration-500 transition-transform group-hover/img:scale-[1.02]"
                    style={{ maxHeight: 300 }}
                />
            </div>
        );
    }

    // Grid View
    return (
        <div className="grid grid-cols-3 gap-1.5 max-h-[240px] overflow-y-auto custom-scrollbar p-1">
            {urls.map((url: string, i: number) => (
                <button
                    key={i}
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => onImageClick(i, e)}
                    className={cn(
                        "aspect-square rounded-md overflow-hidden border-2 transition-all bg-white/5",
                        activeImageIndex === i ? "border-accent-primary scale-[0.95]" : "border-transparent"
                    )}
                >
                    <img src={url} alt="" className="w-full h-full object-cover" />
                </button>
            ))}
        </div>
    );
}

export default memo(AIGeneratorNode);
