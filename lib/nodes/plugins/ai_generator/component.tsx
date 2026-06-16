'use client';

import React, { useState, useEffect, useRef, memo } from 'react';
import { useUpdateNodeInternals } from 'reactflow';
import { Check, Square, LayoutGrid, MoreHorizontal, Play, Coins, ChevronLeft, ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store/app-store';
import BaseNode from '@/lib/nodes/core/canvas/BaseNode';
import GlassyLoader from '@/components/ui/GlassyLoader';
import ImageLightbox from '@/components/ui/ImageLightbox';
import BlurryImage from '@/components/ui/BlurryImage';
import BlurryVideo from '@/components/ui/BlurryVideo';
import AudioPlayer from '@/components/ui/AudioPlayer';
import { CardDownloadButton } from '@/components/editor/CardDownloadButton';
import { useCardDownload } from '@/lib/hooks/use-card-download';
import { isMediaResultType, inferResultTypeFromValue, extractTextValues } from '@/lib/workflow/result-format';
import { bakedThumbUrl } from '@/lib/utils/supabase-image';
import { computeAiNodeCost, formatCredits, clampIterations } from '@/lib/billing/cost';
import { clampSelectedIndex, selectedValue, activeItemEnvelope, isActiveOnly, type GeneratedOutput } from './outputs';
import { useNodeRunValidation } from '@/lib/hooks/use-node-run-validation';
import { useGridViewHeightLock } from '@/lib/hooks/use-grid-view-height-lock';
import { formatValidationError } from '@/lib/workflow/validate-execution-messages';
import { Tooltip } from '@/components/ui/Tooltip';

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

// Text/prompt preview box — kept byte-for-byte identical to the prompt node's
// container (lib/nodes/plugins/prompt/component.tsx) so the AI node's prompt
// preview reads as the same surface, not a brighter variant.
const PROMPT_BOX = "bg-white/5 border border-white/10 rounded-xl shadow-inner transition-all duration-300 p-2.5";

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
    // Ephemeral index for the live (not-yet-persisted) output; once a node has a
    // persisted outputs collection, selection is driven by config.selected_output_index.
    const [activeImageIndex, setActiveImageIndex] = useState(0);
    const [imageLoaded, setImageLoaded] = useState(false);
    // Natural dimensions of every output image we've seen, keyed by URL. The
    // node width hugs the ACTIVE image's aspect ratio (see previewWidth below),
    // and caching by URL means switching the carousel to an already-loaded image
    // recomputes the width instantly — its <img> won't re-fire onLoad from cache,
    // so a per-index recompute that relied on onLoad would leave the node stuck
    // at the previous (often wider) image's width, the dead band on the right.
    const [dimsByUrl, setDimsByUrl] = useState<Record<string, { w: number; h: number }>>({});
    // Last resolved width, so the brief window before a fresh image loads keeps
    // the prior width instead of jumping to `max-content` — which, for a
    // multi-output carousel, measures the whole slide track (clamped to 420) and
    // reserves empty space beside the single visible image.
    const lastWidthRef = useRef<number | null>(null);

    // Lightbox state
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const [lightboxIndex, setLightboxIndex] = useState(0);

    const triggerRunFromNode = useAppStore(state => state.triggerRunFromNode);
    const updateNodeConfig = useAppStore(state => state.updateNodeConfig);
    const setNodeOutput = useAppStore(state => state.setNodeOutput);
    // View-only (collaboration viewer): the run button is grayed + disabled.
    const isViewer = useAppStore(state => state.collabRole) === 'viewer';
    // Pre-flight wiring validation for a solo run of THIS node — same
    // validateExecution the multi-select toolbar uses. Non-empty → the node
    // can't run, so the Run button is disabled and explains why on hover.
    const runErrors = useNodeRunValidation(id);
    const cannotRun = runErrors.length > 0;
    const runErrorText = cannotRun ? runErrors.map(formatValidationError).join(' · ') : '';

    // The persisted, newest-first collection. Backward-compat: a node saved
    // before this feature has only last_output — surface it as a single-item
    // collection. last_output may be a raw URL/text string, an envelope
    // ({ type, data: [...] }), or a { url } object, so unwrap it to a plain
    // value the preview's URL/text extractor understands.
    const legacyLast = data.config?.last_output;
    const legacyValue =
        legacyLast == null ? null
        : typeof legacyLast === 'string' ? legacyLast
        : Array.isArray(legacyLast?.data) ? legacyLast.data[0]
        : typeof legacyLast?.url === 'string' ? legacyLast.url
        : typeof legacyLast?.text === 'string' ? legacyLast.text
        : legacyLast;

    const persistedOutputs: GeneratedOutput[] = Array.isArray(data.config?.outputs)
        ? data.config.outputs
        : (legacyValue != null
            ? [{ type: (inferResultTypeFromValue(legacyLast) ?? 'image') as any, value: legacyValue }]
            : []);

    const selectedIndex = clampSelectedIndex(data.config?.selected_output_index, persistedOutputs.length);

    const selectOutputIndex = (i: number) => {
        if (persistedOutputs.length === 0) return;
        const clamped = clampSelectedIndex(i, persistedOutputs.length);
        updateNodeConfig(id, {
            ...(data.config || {}),
            selected_output_index: clamped,
            last_output: selectedValue(persistedOutputs, clamped),
        });
        // nodeOutputs is republished as just this item by the effect below.
    };

    const openLightbox = (index: number) => {
        setLightboxIndex(index);
        setLightboxOpen(true);
    };

    // Commit an edited text/prompt output. When a persisted collection exists it
    // is the source of truth the preview reads from (effectiveOutput prefers
    // collectionUrls), so writing only to the live store via setNodeOutput would
    // be immediately shadowed and the edit would never appear — the long-standing
    // "can't edit the prompt preview" bug. Write back to the selected collection
    // item (and keep last_output in sync) so the edit survives the re-derive.
    const commitEditedText = (value: string) => {
        if (persistedOutputs.length > 0) {
            const idx = selectedIndex;
            const next = persistedOutputs.map((o, i) => (i === idx ? { ...o, value } : o));
            updateNodeConfig(id, {
                ...(data.config || {}),
                outputs: next,
                selected_output_index: idx,
                last_output: value,
            });
        } else {
            setNodeOutput(id, { type: 'text', data: [value] });
        }
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

    // Reset image loaded state when output changes to a new one. Width is NOT
    // reset here — it's derived from the active image's cached dims (below), so
    // it stays pinned to the prior image until the new one loads, then updates.
    useEffect(() => {
        if (output) {
            setImageLoaded(false);
        }
    }, [output]);

    // Also reset blur-replay state if we start running.
    useEffect(() => {
        if (status === 'running') {
            setImageLoaded(false);
        }
    }, [status]);

    // Publish ONLY the active (carousel-front) output into nodeOutputs. Every
    // downstream consumer reads nodeOutputs[sourceId] — the Compositor, Blur and
    // Levels read it DIRECTLY, client executors via useNodeAutoCompute — so
    // narrowing it here is the single place that makes the selected image (and
    // only it) flow downstream, with no per-consumer logic. Reacting to both
    // `activeOutputVal` (a manual carousel change) and `liveOutput` (a fresh run,
    // or a reload that wrote the full/stale generation) keeps nodeOutputs in
    // lock-step with the front image — fixing the case where the node showed one
    // image but downstream nodes kept rendering a previous generation. The
    // isActiveOnly guard makes the write converge: once narrowed, the effect
    // re-runs and no-ops.
    const activeOutputVal = persistedOutputs.length > 0 ? selectedValue(persistedOutputs, selectedIndex) : undefined;
    const activeOutputType = persistedOutputs.length > 0 ? (persistedOutputs[selectedIndex]?.type ?? 'image') : 'image';
    useEffect(() => {
        if (activeOutputVal == null) return;
        if (isActiveOnly(liveOutput, activeOutputVal)) return;
        setNodeOutput(id, activeItemEnvelope(liveOutput, activeOutputVal, activeOutputType));
    }, [id, liveOutput, activeOutputVal, activeOutputType, setNodeOutput]);

    // Cache the loaded image's natural dimensions, keyed by URL. The node width
    // is derived from the ACTIVE image's cached dims (see previewWidth below) so
    // the box hugs the image (no gray band beside portrait outputs). Only
    // meaningful in single-preview mode; the grid wants full width.
    // `url` is the slide's OWN url — every slide (not just the active one)
    // reports its dims so the cache is warm before the user navigates to it.
    // An off-screen slide that already finished loading won't re-fire onLoad
    // when it later becomes active, so keying on the active url alone would
    // leave every non-first image uncached and the node stuck at the wrong width.
    const handleImageLoad = (
        dims?: { naturalWidth: number; naturalHeight: number },
        url?: string
    ) => {
        setImageLoaded(true);
        if (previewMode !== 'single') return;
        if (!dims || dims.naturalWidth <= 0 || dims.naturalHeight <= 0) return;
        const key = url ?? activeUrl;
        if (!key) return;
        setDimsByUrl((prev) =>
            prev[key] ? prev : { ...prev, [key]: { w: dims.naturalWidth, h: dims.naturalHeight } }
        );
    };

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


    const customInputs = inputHandles
        .filter(h => h.is_visible !== false)
        .map(h => ({
            id: h.api_mapping_key || h.name,
            label: h.name,
            color: WIRE_TYPE_COLORS[h.type] || WIRE_TYPE_COLORS.any,
            type: h.type,
            is_array: h.is_array,
            isMandatory: h.is_mandatory,
            description: h.description
        }));

    const customOutputs = outputHandles
        .filter(h => h.is_visible !== false)
        .map(h => ({
            id: h.api_mapping_key || h.name || 'output',
            label: h.name,
            color: WIRE_TYPE_COLORS[h.type] || WIRE_TYPE_COLORS.any,
            type: h.type,
            is_array: h.is_array,
            description: h.description
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

    // When a persisted collection exists, it is the source of truth for the
    // preview: single view shows the selected item; grid shows all.
    let collectionUrls: any[] | null = null;
    let collectionType: string = activeType;
    if (persistedOutputs.length > 0) {
        collectionUrls = persistedOutputs.map((o) => o.value);
        const selType = persistedOutputs[selectedIndex]?.type;
        collectionType = (selType as any) || activeType;
    }
    const effectiveOutput = collectionUrls ?? previewOutput;
    const rawEffectiveType = collectionUrls ? collectionType : activeType;
    const effectiveIndex = collectionUrls ? selectedIndex : activeImageIndex;

    // The media URL currently shown — what handleImageLoad caches dims against
    // and what the node width is derived from. Mirrors OutputPreview's own URL
    // filtering so the index lines up.
    const effectiveMediaUrls = (Array.isArray(effectiveOutput) ? effectiveOutput : [effectiveOutput])
        .map((o: any) => (typeof o === 'string' ? o : o?.url))
        .filter((v: any) => typeof v === 'string' && (v.startsWith('http') || v.startsWith('data:')));
    const activeUrl: string | undefined = effectiveMediaUrls[effectiveIndex] ?? effectiveMediaUrls[0];

    // Single source of truth for "is this a text/prompt preview?", derived from
    // the EFFECTIVE output actually being rendered — using the same content check
    // OutputPreview uses internally (no displayable urls + extractable text). The
    // card chrome (framed media wrapper vs. flat) and OutputPreview MUST agree:
    // when they disagreed, the parent drew the framed media box + frosty gradient
    // *behind* the text box, producing the bright "second background". We compute
    // it once here and force the child's type to 'text' so they can't diverge.
    const effectiveTextValues = effectiveOutput != null ? extractTextValues(effectiveOutput) : [];
    const effectiveUrlCount = (Array.isArray(effectiveOutput) ? effectiveOutput : [effectiveOutput])
        .map((o: any) => (typeof o === 'string' ? o : o?.url))
        .filter((v: any) => typeof v === 'string' && (v.startsWith('http') || v.startsWith('data:')))
        .length;
    const isTextPreview =
        rawEffectiveType === 'text' ||
        rawEffectiveType === 'prompt' ||
        inferredType === 'text' ||
        (effectiveUrlCount === 0 && effectiveTextValues.length > 0);
    const effectiveType = isTextPreview ? 'text' : rawEffectiveType;
    // Audio has no intrinsic media dimensions — it's a fixed-size transport strip,
    // not a resizable image/video. The node renders it in a compact, fixed-height
    // card (see below) so an audio output never inflates to the 200px media frame.
    const isAudioPreview = effectiveType === 'audio';

    // Freeze the media frame's height when toggling to grid view so switching
    // single ⇄ grid never resizes the node. Only for image/video previews —
    // text/audio size themselves and have their own scroll containers.
    const { ref: mediaFrameRef, lockStyle: mediaFrameLockStyle } = useGridViewHeightLock(
        previewMode,
        !isTextPreview && !isAudioPreview,
    );

    // Sizing model:
    //   text / audio → fixed width (no intrinsic-width content to drive layout)
    //   image / video / other media → node sizes to the image's natural width,
    //   clamped between min and max. The image already grows the height via
    //   `h-auto`, so this is the symmetric horizontal version.
    // Empty-state placeholder uses the wider 320 minWidth so the node has a
    // proper landscape footprint. We only drop the floor to 200 once an image
    // has actually loaded (previewWidth set) so the node can hug smaller,
    // portrait outputs. Gating on `output` instead would shrink the node to 200
    // whenever a value merely *exists* but hasn't rendered — a dead/expired URL
    // that never fires onLoad, or a result that hasn't arrived yet after a
    // refresh — leaving a skinny box instead of the default landscape footprint.
    const isFixedWidth = isTextPreview || activeType === 'audio';
    const fixedWidth = activeType === 'audio' ? 280 : 320;

    // Width the active image fills, derived from its cached natural aspect ratio.
    // null until we've seen this image load at least once.
    const MAX_PREVIEW_W = 460;
    const activeDims = activeUrl ? dimsByUrl[activeUrl] : undefined;
    const previewWidth =
        previewMode === 'single' && activeDims && activeDims.w > 0 && activeDims.h > 0
            ? Math.max(
                  200,
                  Math.min(
                      MAX_PREVIEW_W,
                      activeDims.w >= activeDims.h
                          ? MAX_PREVIEW_W
                          : Math.round((MAX_PREVIEW_W * activeDims.w) / activeDims.h)
                  )
              )
            : null;
    if (previewWidth != null) lastWidthRef.current = previewWidth;

    // The width the node actually holds: the active image's fitted width, or —
    // while a fresh result is still mid-load — the last resolved width so the
    // node stays put instead of jumping. Only a truly first-ever load (nothing
    // cached) has neither.
    const resolvedWidth = previewWidth ?? lastWidthRef.current;

    const mediaStyle: React.CSSProperties = {
        // Pin to the resolved width. Falling back to `max-content` only when we
        // have no width at all avoids over-measuring a multi-output carousel's
        // slide track (empty space beside the single visible image).
        width: resolvedWidth ?? 'max-content',
        // Floor of 200 whenever we have ANY resolved width (clamped >=200, so it
        // never overrides a pinned portrait width). The wider 320 landscape
        // floor applies ONLY before the first image is known — otherwise a
        // re-run on a portrait node briefly snapped to 320 and flashed the
        // default background beside the image until the new image loaded.
        minWidth: resolvedWidth != null ? 200 : 320,
        maxWidth: MAX_PREVIEW_W,
    };
    const textMinHeightClass = "min-h-[140px]";

    const { state: downloadState, canDownload, handleDownload } = useCardDownload(nodeTitle, output);

    return (
        <BaseNode
            id={id}
            type="ai_generator"
            label={nodeTitle}
            icon={selectedNodeType?.icon_reference}
            selected={selected}
            dragging={dragging}
            nodeData={data}
            customInputs={customInputs}
            customOutputs={customOutputs}
            width={isFixedWidth ? fixedWidth : ""}
            style={isFixedWidth ? undefined : mediaStyle}
            isNew={(data as any).isNew}
            customActions={canDownload ? <CardDownloadButton state={downloadState} onClick={handleDownload} /> : undefined}
        >
            <div
                ref={mediaFrameRef}
                style={mediaFrameLockStyle}
                className={cn(
                    "relative w-full group/node",
                    // Media keeps the framed, min-height card. Text drops the frame,
                    // min-height and tinted bg entirely so the inner PROMPT_BOX is the
                    // only surface — matching the standalone prompt node exactly.
                    // Audio gets the frame but a FIXED compact height (just the
                    // transport strip) so it never grows to the media footprint.
                    isTextPreview
                        ? "bg-transparent border-none"
                        : isAudioPreview
                            ? "rounded-xl overflow-hidden shadow-inner h-[60px] border border-white/10 bg-white/5"
                            : "rounded-xl overflow-hidden shadow-inner min-h-[200px] border border-white/10 bg-white/5",
                    !isDragging && "transition-all duration-500"
                )}
            >
                {/* Frosty Placeholder background — media only. Over a text preview
                    its from-white/10 wash stacked on the PROMPT_BOX, making the box
                    read brighter than the prompt node; suppress it for text/audio. */}
                {!isTextPreview && !isAudioPreview && (
                    <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />
                )}

                {/* Empty State / Connection Placeholder */}
                {!output && (
                    <div
                        className="w-full h-full flex flex-col items-center justify-center gap-3 opacity-30 group-hover/node:opacity-50 transition-opacity duration-500 cursor-pointer"
                        onMouseDown={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                    >
                        {(previewType === 'text' || previewType === 'prompt') && (
                            <div className={cn("w-full", PROMPT_BOX)}>
                                <textarea
                                    className="nodrag block w-full h-[160px] text-sm bg-transparent border-none focus:outline-none focus:ring-0 text-white/50 resize-none p-0"
                                    readOnly
                                />
                            </div>
                        )}
                    </div>
                )}

                {/* Content Preview */}
                {effectiveOutput && (
                    <OutputPreview
                        nodeId={id}
                        output={effectiveOutput}
                        // Use effectiveType (derived from the persisted collection
                        // or from the actual data via inferResultTypeFromValue)
                        // instead of previewType (derived from the model's
                        // outputs_schema). When the store entry is a raw array —
                        // which use-session.ts still writes on initial hydration —
                        // isTypedOutput is false and previewType falls back to
                        // whatever the first output handle declares, often 'any'
                        // or 'image'. OutputPreview then routes a .mp4 URL into
                        // <img> and the preview renders empty. effectiveType reads
                        // the URL extension and always picks the right branch.
                        type={effectiveType}
                        previewMode={previewMode}
                        activeImageIndex={effectiveIndex}
                        itemCount={collectionUrls ? collectionUrls.length : (Array.isArray(previewOutput) ? previewOutput.length : 1)}
                        onImageLoad={handleImageLoad}
                        onSelectIndex={(i: number) => {
                            if (collectionUrls) selectOutputIndex(i);
                            else setActiveImageIndex(i);
                        }}
                        onImageClick={(idx: number, e: React.MouseEvent) => {
                            e.stopPropagation();
                            if (collectionUrls) selectOutputIndex(idx);
                            else setActiveImageIndex(idx);
                            if (previewMode === 'single') openLightbox(idx);
                        }}
                        onPreviewClick={(e: React.MouseEvent) => {
                            e.stopPropagation();
                            if (effectiveType === 'image' || effectiveType === 'video') {
                                openLightbox(effectiveIndex);
                            }
                        }}
                        onInteraction={(e: React.MouseEvent | React.PointerEvent) => e.stopPropagation()}
                        onEditText={commitEditedText}
                        isDragging={isDragging}
                    />
                )}

                {/* Loading State Overlay — frosts the previous result and shows
                    "Generating…". The travelling-light border lives on the node
                    card itself (BaseNode), not here. */}
                {status === 'running' && <GlassyLoader containerClassName="z-50" />}

                {/* View Toggles - Only show for media grids with multiple items */}
                {((isMediaResultType(effectiveType as any) || effectiveType === 'text') && Array.isArray(effectiveOutput) && effectiveOutput.length > 1) && (
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
            </div>

            {/* Model Info Footer (Refined) */}
            {selectedModel && (
                <div className="mt-0.5 px-1.5 py-1 flex items-center justify-between opacity-90 group-hover:opacity-100 transition-opacity">
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

                    {(() => {
                        const dynamicCost = computeAiNodeCost(data.config?.control_values, selectedModel) * clampIterations(data.config?.iterations);
                        const showCost = dynamicCost > 0;
                        return (
                            <Tooltip
                                content={runErrorText}
                                position="top"
                                popupClassName="whitespace-normal max-w-xs leading-snug normal-case tracking-normal font-semibold"
                            >
                            <button
                                // cannotRun is NOT wired to `disabled`: a disabled
                                // button swallows pointer events in Chromium, which
                                // would stop the hover tooltip from ever opening. We
                                // gray it, block the click below, and let the Tooltip
                                // wrapper surface the reason.
                                disabled={isViewer}
                                onMouseDown={(e) => e.stopPropagation()}
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (isViewer || cannotRun) return;
                                    triggerRunFromNode(id, 'solo');
                                }}
                                className={cn(
                                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all shadow-lg",
                                    "bg-accent-primary/10 text-accent-primary border border-accent-primary/20 hover:bg-accent-primary hover:text-white hover:scale-[1.02] active:scale-[0.98]",
                                    status === 'running' && "opacity-50 pointer-events-none",
                                    // Grayed + non-interactive for viewers (pointer-events-none
                                    // keeps the default cursor — no block/not-allowed cursor).
                                    isViewer && "opacity-50 pointer-events-none",
                                    // Can't run (missing/incompatible wiring): grayed + blocked.
                                    // pointer-events-none stays OFF the button so the Tooltip
                                    // wrapper still catches hover and surfaces the reason.
                                    cannotRun && "opacity-50 hover:bg-accent-primary/10 hover:text-accent-primary hover:scale-100"
                                )}
                            >
                                <div className={cn(
                                    "flex items-center gap-1.5",
                                    showCost && "border-r border-accent-primary/20 pr-1.5 mr-0.5"
                                )}>
                                    <Play className={cn("w-3 h-3", status !== 'running' && "fill-current")} />
                                    <span>{status === 'running' ? 'Running' : 'Run'}</span>
                                </div>
                                {showCost && (
                                    <div className="flex items-center gap-1 pl-0.5">
                                        <span className="opacity-80">{formatCredits(dynamicCost)}</span>
                                        <Coins className="w-3 h-3 opacity-60" />
                                    </div>
                                )}
                            </button>
                            </Tooltip>
                        );
                    })()}
                </div>
            )}

            {/* Image Lightbox */}
            {lightboxOpen && effectiveOutput && (
                <ImageLightbox
                    media={effectiveOutput}
                    // Same reason as OutputPreview above: use the data-derived
                    // effectiveType, not the schema-derived previewType. If we
                    // hand the lightbox 'image' for a .mp4 it forces the <img>
                    // branch and the lightbox renders blank.
                    type={effectiveType as any}
                    initialIndex={lightboxIndex}
                    onClose={() => setLightboxOpen(false)}
                />
            )}
        </BaseNode>
    );
}

// =============================================================================
// EDITABLE TEXT PREVIEW
// =============================================================================

/**
 * The text/prompt single-view preview. Mirrors the standalone prompt node:
 *   - same PROMPT_BOX surface (so backgrounds match exactly),
 *   - a local draft committed on a 350ms debounce + on blur, so the heavy
 *     persisted-collection write doesn't fire per keystroke and the caret never
 *     jumps when the committed value flows back in,
 *   - a FIXED height with an internal scrollbar on overflow (no auto-grow), per
 *     the requested behaviour.
 * Editing is always enabled when an onCommit writer is provided.
 */
function EditableTextPreview({
    value,
    onCommit,
    onInteraction,
    children,
}: {
    value: string;
    onCommit?: (value: string) => void;
    onInteraction?: (e: any) => void;
    children?: React.ReactNode;
}) {
    const ref = React.useRef<HTMLTextAreaElement>(null);
    const focusedRef = React.useRef(false);
    const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const [draft, setDraft] = useState(value ?? '');

    // Sync external value (new run, selection change) only while not focused, so
    // an in-flight edit isn't clobbered by its own debounced commit echoing back.
    useEffect(() => {
        if (focusedRef.current) return;
        if ((value ?? '') !== draft) setDraft(value ?? '');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    // Debounced commit while editing.
    useEffect(() => {
        if (!focusedRef.current) return;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => onCommit?.(draft), 350);
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [draft]);

    // Wheel capture so scrolling the text doesn't pan the canvas (parity with the
    // prompt node and the prior auto-resize effect).
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const handleWheelNative = (e: WheelEvent) => {
            if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
        };
        el.addEventListener('wheel', handleWheelNative, { passive: false });
        return () => el.removeEventListener('wheel', handleWheelNative);
    }, []);

    return (
        <div
            className={cn("relative group/preview", PROMPT_BOX)}
            onMouseDown={onInteraction}
            onPointerDown={onInteraction}
            onClick={onInteraction}
        >
            <textarea
                ref={ref}
                className="nodrag custom-scrollbar block w-full h-[160px] overflow-y-auto text-sm bg-transparent border-none focus:outline-none focus:ring-0 text-content-primary resize-none p-0"
                value={draft}
                readOnly={!onCommit}
                placeholder=""
                onFocus={() => { focusedRef.current = true; }}
                onBlur={() => { focusedRef.current = false; onCommit?.(draft); }}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Backspace' || e.key === 'Delete') e.stopPropagation();
                }}
            />
            {children}
        </div>
    );
}

// =============================================================================
// TEXT GRID VIEW
// =============================================================================

/**
 * Multi-view stacked list of every text output. Two behaviours that the inline
 * version lacked:
 *   - `nowheel` lets the mouse wheel scroll the list itself instead of panning
 *     the React Flow canvas (RF skips its wheel handler for `nowheel` elements).
 *   - on open it scrolls the currently-selected prompt into view rather than
 *     always starting at the top. Done by adjusting the container's own
 *     scrollTop (not scrollIntoView, which would also nudge the canvas).
 */
function TextGridView({
    items,
    activeIndex,
    onSelectIndex,
    onInteraction,
}: {
    items: string[];
    activeIndex: number;
    onSelectIndex?: (i: number) => void;
    onInteraction?: (e: any) => void;
}) {
    const containerRef = React.useRef<HTMLDivElement>(null);
    const activeRef = React.useRef<HTMLButtonElement>(null);

    useEffect(() => {
        const c = containerRef.current;
        const a = activeRef.current;
        if (!c || !a) return;
        const cRect = c.getBoundingClientRect();
        const aRect = a.getBoundingClientRect();
        // Bring the selected item to the top of the viewport (with a little
        // breathing room), clamped by the container's own scroll range.
        c.scrollTop += (aRect.top - cRect.top) - 8;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div
            ref={containerRef}
            className="nowheel w-full p-2 space-y-1.5 max-h-[320px] overflow-y-auto custom-scrollbar"
            onMouseDown={onInteraction}
            onPointerDown={onInteraction}
        >
            {items.map((t, i) => (
                <button
                    key={i}
                    ref={i === activeIndex ? activeRef : undefined}
                    onMouseDown={onInteraction}
                    onClick={(e) => { e.stopPropagation(); onSelectIndex?.(i); }}
                    className={cn(
                        "block w-full text-left rounded-lg border p-2 text-xs whitespace-pre-wrap transition-all",
                        activeIndex === i
                            ? "border-accent-primary ring-2 ring-accent-primary/20 bg-accent-primary/5 text-content-primary"
                            : "border-white/10 bg-white/5 text-content-secondary hover:border-white/20"
                    )}
                >
                    {t.length > 240 ? `${t.slice(0, 240)}…` : t}
                </button>
            ))}
        </div>
    );
}

// =============================================================================
// OUTPUT PREVIEW
// =============================================================================

function OutputPreview({ nodeId, output, type, previewMode, activeImageIndex, itemCount, onImageLoad, onSelectIndex, onImageClick, onPreviewClick, onInteraction, onEditText, isDragging }: any) {
    const items = Array.isArray(output) ? output : [output];
    const urls = items
        .map((o: any) => (typeof o === 'string' ? o : o?.url))
        .filter((value: any) => typeof value === 'string' && (value.startsWith('http') || value.startsWith('data:')));

    const extractedText = extractTextValues(output);
    const textContent = extractedText.length > 0 ? extractedText.join('') : null;

    const count = typeof itemCount === 'number' ? itemCount : urls.length;
    const canNavigate = count > 1 && previewMode === 'single';
    const go = (delta: number, e: React.MouseEvent) => {
        e.stopPropagation();
        const next = ((activeImageIndex ?? 0) + delta + count) % count;
        onSelectIndex?.(next);
    };
    const NavArrows = canNavigate ? (
        <>
            <button
                onMouseDown={onInteraction}
                onClick={(e) => go(-1, e)}
                className="absolute top-1/2 left-2 -translate-y-1/2 z-30 w-8 h-8 rounded-full bg-black/55 hover:bg-black/75 text-white flex items-center justify-center opacity-0 group-hover/preview:opacity-100 transition-opacity"
                title="Previous"
            >
                <ChevronLeft className="w-5 h-5" />
            </button>
            <button
                onMouseDown={onInteraction}
                onClick={(e) => go(1, e)}
                className="absolute top-1/2 right-2 -translate-y-1/2 z-30 w-8 h-8 rounded-full bg-black/55 hover:bg-black/75 text-white flex items-center justify-center opacity-0 group-hover/preview:opacity-100 transition-opacity"
                title="Next"
            >
                <ChevronRight className="w-5 h-5" />
            </button>
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 opacity-0 group-hover/preview:opacity-100 transition-opacity">
                {Array.from({ length: count }).map((_, i) => (
                    <button
                        key={i}
                        onMouseDown={onInteraction}
                        onClick={(e) => { e.stopPropagation(); onSelectIndex?.(i); }}
                        className={cn(
                            "h-1.5 rounded-full transition-all",
                            i === (activeImageIndex ?? 0) ? "w-3 bg-white" : "w-1.5 bg-white/40 hover:bg-white/70"
                        )}
                        title={`Output ${i + 1}`}
                    />
                ))}
            </div>
        </>
    ) : null;

    const videoRefs = React.useRef<(HTMLVideoElement | null)[]>([]);
    const dataTypes = useAppStore((state) => state.dataTypes);
    const inferredType = output !== undefined && output !== null ? inferResultTypeFromValue(output) : null;
    const isTextType =
        type === 'text' ||
        type === 'prompt' ||
        dataTypes.some(dt => dt.id === 'text' && dt.id === type) ||
        inferredType === 'text' ||
        (urls.length === 0 && textContent !== null);

    if (isTextType) {
        const textItems: string[] = Array.isArray(output)
            ? output.map((o: any) => (typeof o === 'string' ? o : (o?.text ?? o?.value ?? '')))
            : [textContent ?? ''];
        const idx = Math.min(Math.max(activeImageIndex ?? 0, 0), Math.max(textItems.length - 1, 0));
        const single = textItems[idx] ?? '';

        // Nothing generated (yet) → render nothing rather than an empty box with a
        // placeholder. An empty output is not a state worth drawing.
        if (textItems.every(t => !t || !t.trim())) return null;

        if (previewMode === 'grid') {
            // Stacked-list multi-view: every text output, click to select.
            return (
                <TextGridView
                    items={textItems}
                    activeIndex={idx}
                    onSelectIndex={onSelectIndex}
                    onInteraction={onInteraction}
                />
            );
        }

        return (
            // No remount key: switching outputs in a multi-item collection must NOT
            // unmount/remount this (that caused a visible blink on every arrow). The
            // new value flows in via props and EditableTextPreview's value-sync
            // effect updates its draft in place while unfocused.
            <EditableTextPreview
                value={single}
                onCommit={onEditText}
                onInteraction={onInteraction}
            >
                {NavArrows}
            </EditableTextPreview>
        );
    }

    if (type === 'audio' && (urls[0] || output?.url)) {
        const audioUrl = urls[0] || output?.url;
        // Custom dark player that blends into the node's framed card — no native
        // white audio chrome, no extra tinted box, icon, or label (per request).
        // Fills the parent's FIXED compact card (h-[60px]) as a single transport
        // strip; no min-height so an audio output never inflates the node.
        return (
            <div
                className="w-full h-full px-3 flex items-center"
                onMouseDown={onInteraction}
                onPointerDown={onInteraction}
            >
                <AudioPlayer src={audioUrl} />
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
        const activeIdx = activeImageIndex ?? 0;

        if (type === 'video') {
            return (
                <MediaCarousel
                    urls={urls}
                    activeIndex={activeIdx}
                    onSelectIndex={onSelectIndex}
                    isDragging={isDragging}
                    onInteraction={onInteraction}
                    onPreviewClick={onPreviewClick}
                    outerProps={{
                        onMouseEnter: () => videoRefs.current[activeIdx]?.play().catch(() => {}),
                        onMouseLeave: () => {
                            const v = videoRefs.current[activeIdx];
                            if (v) {
                                v.pause();
                                v.currentTime = 0;
                            }
                        },
                    }}
                    overlay={
                        <div className="absolute inset-0 bg-black/20 opacity-0 group-hover/preview:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                            <Play className="w-10 h-10 text-white fill-current" />
                        </div>
                    }
                    renderSlide={(u: string, realIndex: number, isActive: boolean, isClone: boolean) => (
                        <BlurryVideo
                            ref={(el: HTMLVideoElement | null) => { if (!isClone) videoRefs.current[realIndex] = el; }}
                            src={u}
                            poster={bakedThumbUrl(u) ?? undefined}
                            muted
                            loop
                            playsInline
                            // Active slide preloads fully (Replicate outputs often
                            // place the moov atom at the end, so a head-only fetch
                            // never resolves the first frame); off-screen slides stay
                            // light with metadata only.
                            preload={isActive ? 'auto' : 'metadata'}
                            width={320}
                            containerClassName="h-auto"
                            // Size the node to each video's aspect ratio (parity
                            // with the image path); keyed by the slide's own url so
                            // the cache is warm before the user navigates to it.
                            onLoadedMetadata={(e: any) => onImageLoad?.({ naturalWidth: e.currentTarget.videoWidth, naturalHeight: e.currentTarget.videoHeight }, u)}
                            className={cn(
                                "w-full h-auto object-contain max-w-none max-h-[460px] min-h-[200px] bg-black/40",
                                !isDragging && "transition-transform duration-700 group-hover/preview:scale-[1.03]"
                            )}
                        />
                    )}
                />
            );
        }

        return (
            <MediaCarousel
                urls={urls}
                activeIndex={activeIdx}
                onSelectIndex={onSelectIndex}
                isDragging={isDragging}
                onInteraction={onInteraction}
                onPreviewClick={onPreviewClick}
                renderSlide={(u: string, realIndex: number, isActive: boolean) => (
                    <BlurryImage
                        src={bakedThumbUrl(u) ?? u}
                        fallbackSrc={u}
                        alt="Output"
                        // Every slide reports its own dims (keyed by its url) so
                        // the width cache is warm before the user navigates.
                        onLoad={(dims) => onImageLoad?.(dims, u)}
                        // h-auto so the wrapper hugs the image height instead of
                        // BlurryImage's default h-full (which collapses to 0 inside
                        // the flex track and clips the image).
                        containerClassName="h-auto"
                        className={cn(
                            "relative z-10",
                            !isDragging && "transition-transform duration-700 group-hover/preview:scale-[1.03]"
                        )}
                    />
                )}
            />
        );
    }

    // Grid View
    return (
        <div className="nowheel w-full h-full p-2 overflow-y-auto custom-scrollbar">
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
                                <BlurryVideo src={url} poster={bakedThumbUrl(url) ?? undefined} muted loop playsInline preload="metadata" className="w-full h-full object-cover" containerClassName="w-full h-full" />
                            ) : (
                                <BlurryImage src={bakedThumbUrl(url) ?? url} fallbackSrc={url} alt="" onLoad={onImageLoad} className="w-full h-full object-cover" />
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

// =============================================================================
// MEDIA CAROUSEL (single-view image/video navigation)
// =============================================================================

/**
 * Horizontal carousel for the single-view media preview. Renders every output in
 * a sliding flex track so:
 *   - moving between outputs is a pure transform slide (no blur replay),
 *   - a fresh result still blur-reveals on first load (its slide is keyed by url
 *     and mounts new),
 *   - wrapping past either end keeps sliding in the SAME direction as the arrow
 *     (an infinite loop), via clones of the first/last item that the track snaps
 *     onto without animation once the slide finishes.
 * Selection is the persisted `activeIndex` (config); arrows/dots both drive it.
 */
function MediaCarousel({
    urls,
    activeIndex,
    onSelectIndex,
    isDragging,
    onInteraction,
    onPreviewClick,
    outerProps,
    overlay,
    renderSlide,
}: {
    urls: string[];
    activeIndex: number;
    onSelectIndex?: (i: number) => void;
    isDragging?: boolean;
    onInteraction?: (e: any) => void;
    onPreviewClick?: (e: any) => void;
    outerProps?: Record<string, any>;
    overlay?: React.ReactNode;
    renderSlide: (url: string, realIndex: number, isActive: boolean, isClone: boolean) => React.ReactNode;
}) {
    const count = urls.length;
    // `step` is the rendered track position. Real slides occupy positions 1..count;
    // position 0 is a clone of the last item and position count+1 a clone of the
    // first, so wrapping past an end slides forward onto the clone, then snaps
    // (no animation) onto its real twin.
    const [step, setStep] = useState(activeIndex + 1);
    const [animate, setAnimate] = useState(true);

    // External selection changes (grid/dot click, a new run) snap the track to the
    // selected item without animation. Arrow navigation keeps step and activeIndex
    // in sync already, so this is a no-op for those.
    useEffect(() => {
        if (count === 0) return;
        const real = ((step - 1) % count + count) % count;
        if (real !== activeIndex) {
            setAnimate(false);
            setStep(activeIndex + 1);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeIndex, count]);

    const outerClassName = "w-full h-full relative group/preview cursor-zoom-in overflow-hidden";

    if (count === 0) return null;

    if (count === 1) {
        return (
            <div className={outerClassName} {...outerProps} onMouseDown={onInteraction} onPointerDown={onInteraction} onClick={onPreviewClick}>
                {renderSlide(urls[0], 0, true, false)}
                {overlay}
            </div>
        );
    }

    const go = (delta: number) => {
        // Settle any pending clone overshoot before advancing. The wrap relies on
        // onRest (onAnimationComplete) to snap a clone position back to its real
        // twin, but framer-motion does NOT fire that callback when an animation is
        // interrupted by a new target. When clicks outrun the 0.35s slide, those
        // intermediate snaps never run and `step` marches past the rendered
        // [0, count+1] track onto empty space — the preview goes blank until a
        // refresh rebuilds `step` from activeIndex. Clamping the clone extremes to
        // their real twin here keeps `step` provably in range (base ∈ [1, count],
        // delta ∈ ±1 ⇒ newStep ∈ [0, count+1]) regardless of click speed.
        const base = step === count + 1 ? 1 : step === 0 ? count : step;
        const newStep = base + delta;
        const real = ((newStep - 1) % count + count) % count;
        setAnimate(true);
        setStep(newStep);
        onSelectIndex?.(real);
    };

    const onRest = () => {
        if (step === count + 1) { setAnimate(false); setStep(1); }
        else if (step === 0) { setAnimate(false); setStep(count); }
    };

    // [clone(last), ...reals, clone(first)]
    const slides = [urls[count - 1], ...urls, urls[0]];

    return (
        <div className={outerClassName} {...outerProps} onMouseDown={onInteraction} onPointerDown={onInteraction} onClick={onPreviewClick}>
            <motion.div
                className="flex w-full"
                animate={{ x: `-${step * 100}%` }}
                transition={animate && !isDragging ? { type: 'tween', ease: [0.4, 0, 0.2, 1], duration: 0.35 } : { duration: 0 }}
                onAnimationComplete={onRest}
            >
                {slides.map((u, pos) => {
                    const isClone = pos === 0 || pos === count + 1;
                    const realIndex = pos === 0 ? count - 1 : pos === count + 1 ? 0 : pos - 1;
                    const isActive = !isClone && realIndex === activeIndex;
                    return (
                        <div key={isClone ? `clone-${pos}` : u} className="w-full shrink-0 basis-full flex items-center justify-center">
                            {renderSlide(u, realIndex, isActive, isClone)}
                        </div>
                    );
                })}
            </motion.div>

            {overlay}

            <button
                onMouseDown={onInteraction}
                onClick={(e) => { e.stopPropagation(); go(-1); }}
                className="absolute top-1/2 left-2 -translate-y-1/2 z-30 w-8 h-8 rounded-full bg-black/55 hover:bg-black/75 text-white flex items-center justify-center opacity-0 group-hover/preview:opacity-100 transition-opacity"
                title="Previous"
            >
                <ChevronLeft className="w-5 h-5" />
            </button>
            <button
                onMouseDown={onInteraction}
                onClick={(e) => { e.stopPropagation(); go(1); }}
                className="absolute top-1/2 right-2 -translate-y-1/2 z-30 w-8 h-8 rounded-full bg-black/55 hover:bg-black/75 text-white flex items-center justify-center opacity-0 group-hover/preview:opacity-100 transition-opacity"
                title="Next"
            >
                <ChevronRight className="w-5 h-5" />
            </button>

            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 opacity-0 group-hover/preview:opacity-100 transition-opacity">
                {urls.map((_, i) => (
                    <button
                        key={i}
                        onMouseDown={onInteraction}
                        onClick={(e) => { e.stopPropagation(); onSelectIndex?.(i); }}
                        className={cn(
                            "h-1.5 rounded-full transition-all",
                            i === activeIndex ? "w-3 bg-white" : "w-1.5 bg-white/40 hover:bg-white/70"
                        )}
                        title={`Output ${i + 1}`}
                    />
                ))}
            </div>
        </div>
    );
}

export default memo(AIGeneratorNode);

import { NodeClientDef } from '../../core/types';
import { aiGeneratorSharedDef } from './definition';
import AIGeneratorPropertiesImport from './properties';

export const aiGeneratorClientDef: NodeClientDef = {
    ...aiGeneratorSharedDef,
    component: memo((props: any) => <AIGeneratorNode {...props} type="ai_generator" />),
    propertyPanel: AIGeneratorPropertiesImport,
} as any;
