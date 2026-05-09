'use client';

import React, { useState, useEffect, memo } from 'react';
import { useUpdateNodeInternals } from 'reactflow';
import { Zap, Check, Square, LayoutGrid, MoreHorizontal, Play, Coins } from 'lucide-react';
import { motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store/app-store';
import BaseNode from '@/components/canvas/BaseNode';
import GlassyLoader from '@/components/ui/GlassyLoader';
import ImageLightbox from '@/components/ui/ImageLightbox';
import BlurryImage from '@/components/ui/BlurryImage';
import { isMediaResultType, inferResultTypeFromValue, extractTextValues } from '@/lib/workflow/result-format';
import { toThumbnailUrl } from '@/lib/utils/supabase-image';

// =============================================================================
// TYPES - MOVED TO lib/nodes/types.ts
// =============================================================================
import { AiModel, InputHandle, OutputHandle, InputsSchema, OutputsSchema } from '@/lib/nodes/types';

const WIRE_TYPE_COLORS: Record<string, string> = {
    image: 'rgb(59, 130, 246)',
    video: 'rgb(139, 92, 246)',
    audio: 'rgb(236, 72, 153)',
    '3d': 'rgb(245, 158, 11)',
    text: 'rgb(34, 197, 94)',
    json: 'rgb(148, 163, 184)',
    any: 'rgb(var(--accent-primary))',
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

function AIGeneratorNode({ id, data, selected, dragging = false }: any) {
    const updateNodeInternals = useUpdateNodeInternals();
    const liveOutput = useAppStore(state => state.nodeOutputs[id]);
    const status = useAppStore(state => state.nodeStatuses[id] || 'idle');
    const isDragging = dragging;

    // Fallback to saved output for hydration/reloads
    const output = liveOutput || data.output || data.config?.last_output;

    const models = useAppStore(state => state.models);
    const nodeTypes = useAppStore(state => state.nodeTypes);
    const [previewMode, setPreviewMode] = useState<'single' | 'grid'>('single');
    const [activeImageIndex, setActiveImageIndex] = useState(0);
    const [imageLoaded, setImageLoaded] = useState(false);

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
    const aiDefaultLabel = selectedNodeType ? selectedNodeType.display_name : (data.config?.model_id ? 'AI Model' : 'AI Generator');
    const persistedLabel = typeof data?.label === 'string' ? data.label.trim() : '';
    const isDefaultFactoryLabel = persistedLabel === '' || persistedLabel === 'Ai Generator' || persistedLabel === 'AI Generator' || persistedLabel === 'AI Model';
    const nodeTitle = isDefaultFactoryLabel ? aiDefaultLabel : data.label;

    // Reset image loaded state when output changes to a new one
    useEffect(() => {
        if (output) {
            setImageLoaded(false);
        }
    }, [output]);

    // Also reset if we start running
    useEffect(() => {
        if (status === 'running') {
            setImageLoaded(false);
        }
    }, [status]);

    const inputHandles = selectedModel?.inputs_schema?.handles || [];
    const outputHandles = selectedModel?.outputs_schema?.handles || [];

    // Tell ReactFlow to re-scan this node's handles whenever the visible handle
    // shape changes (ids, types, count, visibility). Watching only `model_id` is
    // not enough: `models` is fetched async, so `selectedModel.inputs_schema` can
    // arrive AFTER the node first rendered with a placeholder handle list, which
    // leaves ReactFlow's measured handle positions out of sync with the DOM. The
    // visible symptom is wires appearing to leave/enter a different handle than
    // the one the user grabbed; duplicating the node "fixes" it because the
    // duplicate measures fresh on mount.
    const inputHandlesSig = inputHandles
        .map(h => `${h.api_mapping_key || h.name}:${h.type}:${h.is_visible !== false ? 1 : 0}`)
        .join('|');
    const outputHandlesSig = outputHandles
        .map(h => `${h.api_mapping_key || h.name || 'output'}:${h.type}:${h.is_visible !== false ? 1 : 0}`)
        .join('|');
    useEffect(() => {
        updateNodeInternals(id);
    }, [id, inputHandlesSig, outputHandlesSig, updateNodeInternals]);


    // ✅ PHASE 1 FIX: Edge cleanup logic removed
    // ISSUE: Direct setEdges() manipulation bypassed editor state, causing sync mismatches
    // SOLUTION: Let ReactFlow handle invalid connections naturally through its validation
    // Edge validation should happen at the connection level, not post-hoc cleanup
    // If invalid edges become a problem, implement validation in onConnect handler instead

    // Original edge cleanup logic commented out to prevent wire disappearance issues:
    /*
    const { getEdges, setEdges } = useReactFlow();
    const lastModelIdRef = React.useRef(data.config?.model_id);

    useEffect(() => {
        if (!selectedModel || lastModelIdRef.current === data.config?.model_id) {
            return;
        }

        lastModelIdRef.current = data.config?.model_id;

        const currentEdges = getEdges();
        const validInputHandles = new Set(selectedModel.inputs_schema?.handles?.map(h => h.api_mapping_key) || []);
        const validOutputHandles = new Set(selectedModel.outputs_schema?.handles?.map(h => h.api_mapping_key || 'output') || []);

        const invalidEdges = currentEdges.filter(edge => {
            if (edge.target === id) {
                if (!edge.targetHandle) return false;
                return !validInputHandles.has(edge.targetHandle);
            }
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
    }, [id, selectedModel, getEdges, setEdges, data.config?.model_id]);
    */

    const customInputs = inputHandles
        .filter(h => h.is_visible !== false)
        .map(h => ({
            id: h.api_mapping_key || h.name,
            label: h.name,
            color: WIRE_TYPE_COLORS[h.type] || WIRE_TYPE_COLORS.any,
            type: h.type,
            is_array: h.is_array,
            isMandatory: h.is_mandatory
        }));

    const customOutputs = outputHandles
        .filter(h => h.is_visible !== false)
        .map(h => ({
            id: h.api_mapping_key || h.name || 'output',
            label: h.name,
            color: WIRE_TYPE_COLORS[h.type] || WIRE_TYPE_COLORS.any,
            type: h.type,
            is_array: h.is_array
        }));

    // Find the first valid output to preview (if multiple)
    let previewOutput = output;
    let previewType = outputHandles[0]?.type || 'any';

    const isTypedOutput =
        output &&
        typeof output === 'object' &&
        !Array.isArray(output) &&
        typeof output.type === 'string' &&
        Array.isArray(output.data);

    if (isTypedOutput) {
        previewType = output.type;
        previewOutput = output.data;
    } else if (output && typeof output === 'object' && !Array.isArray(output) && !output.url && !output.text) {
        // It's a multi-handle output object. Pick the first one that has an image or text
        const firstKey = Object.keys(output)[0];
        if (firstKey) {
            previewOutput = output[firstKey];
            const handle = outputHandles.find(h => h.api_mapping_key === firstKey);
            if (handle) previewType = handle.type;
        }
    }

    const dataTypes = useAppStore((state) => state.dataTypes);
    const inferredType = output !== undefined && output !== null ? inferResultTypeFromValue(output) : null;

    let activeType = previewType;
    if (inferredType === 'text' || previewType === 'prompt' || dataTypes.some(dt => dt.id === 'text' && dt.id === previewType)) {
        activeType = 'text';
    } else if (inferredType && isMediaResultType(inferredType as any)) {
        activeType = inferredType;
    }

    // Sizing model:
    //   text / audio → fixed width (no intrinsic-width content to drive layout)
    //   image / video / other media → node sizes to the image's natural width,
    //   clamped between min and max. The image already grows the height via
    //   `h-auto`, so this is the symmetric horizontal version.
    const isFixedWidth = activeType === 'text' || activeType === 'audio';
    const fixedWidth = activeType === 'audio' ? 280 : 320;
    const mediaStyle: React.CSSProperties = {
        width: 'max-content',
        minWidth: 320,
        maxWidth: 420,
    };
    const textMinHeightClass = "min-h-[140px]";

    return (
        <BaseNode
            id={id}
            type="ai_generator"
            label={nodeTitle}
            icon={selectedNodeType?.icon_reference}
            selected={selected}
            dragging={dragging}
            customInputs={customInputs}
            customOutputs={customOutputs}
            width={isFixedWidth ? fixedWidth : ""}
            style={isFixedWidth ? undefined : mediaStyle}
            isNew={(data as any).isNew}
        >
            <motion.div
                layout={!isDragging && activeType !== 'text' ? "size" : false}
                className={cn(
                    "relative w-full rounded-xl overflow-hidden shadow-inner group/node",
                    activeType === 'text' ? "bg-transparent border-none" : "border border-white/10 bg-white/5",
                    !isDragging && "transition-all duration-500",
                    activeType === 'text' ? textMinHeightClass : "min-h-[200px]"
                )}
            >
                {/* Frosty Placeholder background */}
                <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />

                {/* Empty State / Connection Placeholder */}
                {!output && (
                    <div
                        className="w-full h-full flex flex-col items-center justify-center gap-3 opacity-30 group-hover/node:opacity-50 transition-opacity duration-500 cursor-pointer"
                        onMouseDown={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                    >
                        {(previewType === 'text' || previewType === 'prompt') && (
                            <div className="w-full p-2.5">
                                <textarea
                                    className="nodrag block w-full min-h-[120px] text-[11px] bg-transparent border-none focus:outline-none focus:ring-0 text-white/50 resize-none p-0 font-mono"
                                    readOnly
                                />
                            </div>
                        )}
                    </div>
                )}

                {/* Content Preview */}
                {previewOutput && (
                    <OutputPreview
                        nodeId={id}
                        output={previewOutput}
                        type={previewType}
                        previewMode={previewMode}
                        activeImageIndex={activeImageIndex}
                        onImageLoad={() => setImageLoaded(true)}
                        onImageClick={(idx: number, e: React.MouseEvent) => {
                            e.stopPropagation();
                            setActiveImageIndex(idx);
                            if (previewMode === 'single') openLightbox(idx);
                        }}
                        onPreviewClick={(e: React.MouseEvent) => {
                            e.stopPropagation();
                            if (previewType === 'image' || previewType === 'video') {
                                openLightbox(activeImageIndex);
                            }
                        }}
                        onInteraction={(e: React.MouseEvent | React.PointerEvent) => e.stopPropagation()}
                        isDragging={isDragging}
                    />
                )}

                {/* Loading State Overlay (Always renders on top of Output if running) */}
                {status === 'running' && <GlassyLoader containerClassName="z-50 bg-black/40 backdrop-blur-md" />}

                {/* View Toggles - Only show for media grids with multiple items */}
                {isMediaResultType(previewType as any) && Array.isArray(previewOutput) && previewOutput.length > 1 && (
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
                        {selectedModel.providers?.logo_url && (
                            <div className="w-4 h-4 rounded-sm bg-white/10 p-0.5 shrink-0 overflow-hidden border border-white/5">
                                <img src={selectedModel.providers.logo_url} alt="" className="w-full h-full object-contain" />
                            </div>
                        )}
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
                        <div className="flex items-center gap-1.5 border-r border-accent-primary/20 pr-1.5 mr-0.5">
                            <Play className={cn("w-3 h-3", status !== 'running' && "fill-current")} />
                            <span>{status === 'running' ? 'Running' : 'Run'}</span>
                        </div>
                        {selectedModel.credit_cost > 0 && (
                            <div className="flex items-center gap-1 pl-0.5">
                                <span className="opacity-80">{selectedModel.credit_cost}</span>
                                <Coins className="w-3 h-3 opacity-60" />
                            </div>
                        )}
                    </button>
                </div>
            )}

            {/* Image Lightbox */}
            {lightboxOpen && previewOutput && (
                <ImageLightbox
                    media={previewOutput}
                    type={previewType as any}
                    initialIndex={lightboxIndex}
                    onClose={() => setLightboxOpen(false)}
                />
            )}
        </BaseNode>
    );
}

// =============================================================================
// OUTPUT PREVIEW (Parity with CustomNode)
// =============================================================================

// =============================================================================
// OUTPUT PREVIEW
// =============================================================================

function OutputPreview({ nodeId, output, type, previewMode, activeImageIndex, onImageLoad, onImageClick, onPreviewClick, onInteraction, isDragging }: any) {
    const items = Array.isArray(output) ? output : [output];
    const urls = items
        .map((o: any) => (typeof o === 'string' ? o : o?.url))
        .filter((value: any) => typeof value === 'string' && (value.startsWith('http') || value.startsWith('data:')));

    const extractedText = extractTextValues(output);
    const textContent = extractedText.length > 0 ? extractedText.join('') : null;

    const videoRef = React.useRef<HTMLVideoElement>(null);
    const textareaRef = React.useRef<HTMLTextAreaElement>(null);
    const setNodeOutput = useAppStore((state) => state.setNodeOutput);
    const dataTypes = useAppStore((state) => state.dataTypes);
    const inferredType = output !== undefined && output !== null ? inferResultTypeFromValue(output) : null;
    const isTextType =
        type === 'text' ||
        type === 'prompt' ||
        dataTypes.some(dt => dt.id === 'text' && dt.id === type) ||
        inferredType === 'text' ||
        (urls.length === 0 && textContent !== null);

    // Auto-resize for text area and wheel event capture
    useEffect(() => {
        if (isTextType && textareaRef.current) {
            const el = textareaRef.current;
            el.style.height = 'auto';
            el.style.height = `${el.scrollHeight}px`;

            // Wheel event capture to override React Flow's native behavior selectively
            const handleWheelNative = (e: WheelEvent) => {
                if (!e.ctrlKey && !e.metaKey) {
                    e.stopPropagation();
                }
            };

            el.addEventListener('wheel', handleWheelNative, { passive: false });
            return () => el.removeEventListener('wheel', handleWheelNative);
        }
    }, [textContent, isTextType]);

    if (isTextType) {
        return (
            <div
                className="w-full p-2.5 transition-all duration-300 bg-transparent"
                onMouseDown={onInteraction}
                onPointerDown={onInteraction}
                onClick={onInteraction}
            >
                <textarea
                    ref={textareaRef}
                    className="nodrag custom-scrollbar block w-full min-h-[140px] max-h-[300px] text-sm bg-transparent border-none focus:outline-none focus:ring-0 text-content-primary resize-none p-0"
                    value={textContent || ''}
                    placeholder="Empty output"
                    onChange={(e) => {
                        const val = e.target.value;
                        setNodeOutput(nodeId, { type: 'text', data: [val] });
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Backspace' || e.key === 'Delete') {
                            e.stopPropagation();
                        }
                    }}
                    onWheel={(e) => {
                        if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
                    }}
                />
            </div>
        );
    }

    if (type === 'audio' && (urls[0] || output?.url)) {
        const audioUrl = urls[0] || output?.url;
        return (
            <div
                className="w-full p-6 bg-accent-primary/5 flex flex-col items-center justify-center gap-4"
                onMouseDown={onInteraction}
                onPointerDown={onInteraction}
            >
                <div className="w-16 h-16 rounded-full bg-accent-primary/20 flex items-center justify-center border border-accent-primary/30">
                    <Zap className="w-8 h-8 text-accent-primary animate-pulse" />
                </div>
                <audio
                    src={audioUrl}
                    controls
                    className="w-full h-8 accent-accent-primary"
                    onMouseDown={(e) => e.stopPropagation()}
                />
                <span className="text-[9px] font-black uppercase tracking-widest text-accent-primary opacity-60">Audio Output</span>
            </div>
        );
    }

    if (type === '3d') {
        const modelUrl = urls[0];
        return (
            <div
                className="w-full p-4 bg-white/5 rounded-xl border border-white/10 text-[10px] text-white/80 break-all flex flex-col gap-2"
                onMouseDown={onInteraction}
                onPointerDown={onInteraction}
            >
                <span className="font-semibold text-white/70 uppercase tracking-widest text-[9px]">3D Output</span>
                {modelUrl ? (
                    <a className="text-accent-primary underline" href={modelUrl} target="_blank" rel="noreferrer">
                        Open model
                    </a>
                ) : (
                    <span className="text-white/40 italic">No model URL available</span>
                )}
            </div>
        );
    }

    if (urls.length === 0) {
        return (
            <div
                className="w-full p-2.5 bg-white/5 border border-white/10 rounded-xl shadow-inner backdrop-blur-md transition-all duration-300"
                onMouseDown={onInteraction}
                onPointerDown={onInteraction}
            >
                <textarea
                    className="nodrag custom-scrollbar block w-full min-h-[60px] max-h-[160px] text-sm bg-transparent border-none focus:outline-none focus:ring-0 text-content-primary resize-none p-0"
                    value={textContent || (output ? JSON.stringify(output) : 'No output data')}
                    readOnly
                />
            </div>
        );
    }

    if (previewMode === 'single') {
        const url = urls[activeImageIndex] || urls[0];

        if (type === 'video') {
            return (
                <div
                    className="w-full h-full relative group/preview cursor-zoom-in overflow-hidden"
                    onMouseEnter={() => videoRef.current?.play()}
                    onMouseLeave={() => {
                        if (videoRef.current) {
                            videoRef.current.pause();
                            videoRef.current.currentTime = 0;
                        }
                    }}
                    onMouseDown={onInteraction}
                    onPointerDown={onInteraction}
                    onClick={onPreviewClick}
                >
                    <video
                        ref={videoRef}
                        src={url}
                        muted
                        loop
                        playsInline
                        className={cn(
                            "block object-contain max-w-[420px] max-h-[420px]",
                            !isDragging && "transition-transform duration-700 group-hover/preview:scale-[1.03]"
                        )}
                    />
                    <div className="absolute inset-0 bg-black/20 opacity-0 group-hover/preview:opacity-100 transition-opacity flex items-center justify-center">
                        <Play className="w-10 h-10 text-white fill-current" />
                    </div>
                </div>
            );
        }

        return (
            <div
                className="w-full h-full relative group/preview cursor-zoom-in overflow-hidden"
                onMouseDown={onInteraction}
                onPointerDown={onInteraction}
                onClick={onPreviewClick}
            >
                <BlurryImage
                    src={toThumbnailUrl(url, { width: 768 }) ?? url}
                    fallbackSrc={url}
                    alt="Output"
                    onLoad={onImageLoad}
                    className={cn(
                        "relative z-10",
                        !isDragging && "transition-transform duration-700 group-hover/preview:scale-[1.03]"
                    )}
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
                            onMouseDown={onInteraction}
                            onPointerDown={onInteraction}
                            onClick={(e) => onImageClick(i, e)}
                            className={cn(
                                "relative aspect-square rounded-md overflow-hidden bg-white/5 border-2 transition-all",
                                isActive ? "border-accent-primary ring-2 ring-accent-primary/20 scale-[0.98]" : "border-white/5 hover:border-white/20"
                            )}
                        >
                            {type === 'video' ? (
                                <video src={url} className="w-full h-full object-cover" />
                            ) : (
                                <BlurryImage src={toThumbnailUrl(url, { width: 256 }) ?? url} fallbackSrc={url} alt="" onLoad={onImageLoad} className="w-full h-full object-cover" />
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
    );
}

export default memo(AIGeneratorNode);
