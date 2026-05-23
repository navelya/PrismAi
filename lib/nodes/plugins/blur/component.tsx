'use client';

import React, { memo, useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { NodeProps, useUpdateNodeInternals } from 'reactflow';
import { motion } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import BaseNode from '@/lib/nodes/core/canvas/BaseNode';
import BlurryImage from '@/components/ui/BlurryImage';
import BlurryVideo from '@/components/ui/BlurryVideo';
import { BlurConfig } from './definition';
import ImageLightbox from '@/components/ui/ImageLightbox';
import { CardDownloadButton } from '@/components/editor/CardDownloadButton';
import { useCardDownload } from '@/lib/hooks/use-card-download';
import { X } from 'lucide-react';
import { useAppStore } from '@/lib/store/app-store';
import { Select } from '@/components/ui/Select';
import { NumberInput } from '@/components/ui/NumberInput';
import { useNodeAutoCompute } from '@/lib/hooks/use-node-auto-compute';
import { NodeClientDef } from '../../core/types';
import { blurSharedDef } from './definition';
import { blurClientExecutor } from './executor.client';
import { detectMediaTypeFromUrl } from '@/lib/workflow/result-format';
import { radiusToSigma } from './shared';
import { GraphDescription, graphDimensions, graphDuration } from '../compositor/shared';
import { GraphRenderCache, paintGraphFrame } from '../compositor/graph-renderer';

interface BlurNodeData {
    label: string;
    config: BlurConfig;
}

const defaultConfig: BlurConfig = {
    radius: 5,
    type: 'gaussian',
};

const blurTypeOptions = [
    { id: 'gaussian', display_name: 'Gaussian' },
    { id: 'box', display_name: 'Box' },
    { id: 'stack', display_name: 'Stack' },
];

// Idle (not hovering) blur previews paint a short settle burst — long enough for
// the upstream video's first frame to decode in — then stop, instead of
// repainting forever. See PAUSED_SETTLE_MS in the compositor Renderer for the
// same rationale: an idle preview is a static frame and shouldn't peg the GPU.
const IDLE_SETTLE_MS = 800;

function BlurNode({ data, id, selected, dragging = false }: NodeProps<BlurNodeData>) {
    const updateNodeConfig = useAppStore(state => state.updateNodeConfig);
    const updateNodeInternals = useUpdateNodeInternals();
    const isDragging = dragging;
    const [lightboxOpen, setLightboxOpen] = useState(false);

    // One narrow Zustand selector replaces the previous useNodes() + useEdges()
    // pair. RF's useNodes() fires on every drag tick because RF updates its
    // internal store with the dragged node's position; that made every BlurNode
    // re-render at 60fps during any drag. currentWorkflow, by contrast, stays
    // stable during drag (position changes are filtered at handleNodesChangeThrottled
    // and flow through liveNodePositions instead), so this selector bails out
    // via useShallow on every drag tick — no re-render at all.
    const { connectedInputId, sourceFallbackOutput } = useAppStore(useShallow((state) => {
        const wf = state.currentWorkflow;
        if (!wf) return { connectedInputId: null as string | null, sourceFallbackOutput: null as any };
        const inputEdge = wf.edges.find((e) => e.target === id && e.targetHandle === 'image');
        if (!inputEdge) return { connectedInputId: null, sourceFallbackOutput: null };
        const sourceId = inputEdge.source;
        const node = wf.nodes.find((n) => n.id === sourceId);
        const fallback = node?.data
            ? (node.data.output ?? (node.data.config as any)?.images ?? (node.data.config as any)?.last_output ?? null)
            : null;
        return { connectedInputId: sourceId, sourceFallbackOutput: fallback };
    }));

    // Subscribe narrowly to ONLY the upstream node's live output, not the whole
    // nodeOutputs object. That object's reference changes whenever any node
    // produces output, but this selector returns a primitive/value that React
    // can compare directly — no re-render unless this specific upstream changes.
    const liveSourceOutput = useAppStore((state) =>
        connectedInputId ? state.nodeOutputs[connectedInputId] : undefined
    );

    // Drive client-side blur compute. The hook watches this node's config
    // and its upstream value; when either changes it runs blurClientExecutor
    // (debounced) and writes the result into nodeOutputs[id]. The Compositor
    // and any other downstream consumer then re-render automatically.
    useNodeAutoCompute(id);

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

    // Extract output data: prefer live nodeOutputs entry, fall back to the
    // source node's saved data fields.
    const sourceOutput = useMemo(() => {
        if (!connectedInputId) return null;
        return liveSourceOutput ?? sourceFallbackOutput ?? null;
    }, [connectedInputId, liveSourceOutput, sourceFallbackOutput]);

    // Extract the first item from the upstream envelope. Three shapes flow
    // in here: a raw string URL, a single object {url,...}, or an envelope
    // {type, data: [...]}. The previous code peeled url-then-data-then-url
    // in one expression; splitting it into "first item" + "extract fields"
    // makes the live-stream branch tractable.
    const upstreamItem = useMemo<any>(() => {
        if (!sourceOutput) return null;
        const candidate = Array.isArray(sourceOutput) ? sourceOutput[0] : sourceOutput;
        if (!candidate) return null;
        if (typeof candidate === 'string') return candidate;
        if (typeof candidate === 'object') {
            // Envelope: {type, data: [first, ...]}
            const data = (candidate as any).data;
            if (Array.isArray(data) && data.length > 0) return data[0];
            // Already the inner item.
            return candidate;
        }
        return null;
    }, [sourceOutput]);

    // Extract media URL (image or video). May be empty when upstream is a
    // live-stream source (e.g. Compositor's live canvas).
    const mediaUrl = useMemo<string | null>(() => {
        if (!upstreamItem) return null;
        if (typeof upstreamItem === 'string') return upstreamItem;
        const u = (upstreamItem as any).url || (upstreamItem as any).previewUrl;
        return typeof u === 'string' && u.length > 0 ? u : null;
    }, [upstreamItem]);

    // Pull-model live signal: upstream publishes a `graph` description (from
    // a Compositor, or another filter wrapping one). When present, we render
    // the preview by painting the graph onto our own offscreen canvas at our
    // OWN playhead — independent of any other consumer of the same upstream.
    // That's the entire point of the pull model: each downstream node has
    // its own time cursor and decoder pool.
    const upstreamGraph = useMemo<GraphDescription | null>(() => {
        if (!upstreamItem || typeof upstreamItem !== 'object') return null;
        return (upstreamItem as any).graph ?? null;
    }, [upstreamItem]);

    // Upstream-provided resolution (preferred over loading the URL to
    // measure). Lets the preview-blur scaling math kick in immediately for
    // live sources where there's no <img> load event.
    const upstreamResolution = useMemo<{ width: number; height: number } | null>(() => {
        if (upstreamGraph) {
            return graphDimensions(upstreamGraph);
        }
        if (!upstreamItem || typeof upstreamItem !== 'object') return null;
        const r = (upstreamItem as any).resolution;
        if (r && typeof r.width === 'number' && typeof r.height === 'number') return r;
        return null;
    }, [upstreamItem, upstreamGraph]);

    const mediaKind = useMemo<'image' | 'video' | null>(() => {
        if (upstreamGraph) return 'video';
        if (!mediaUrl) return null;
        if (mediaUrl.startsWith('data:video/')) return 'video';
        if (mediaUrl.startsWith('data:image/')) return 'image';
        return (detectMediaTypeFromUrl(mediaUrl) as 'image' | 'video' | null) ?? 'image';
    }, [upstreamGraph, mediaUrl]);

    // Both input and output are single polymorphic handles. The static
    // dataType in definition.ts is the broad union (['image','video']); here
    // we narrow the user-visible LABEL and COLOR based on whatever media kind
    // is currently flowing into the node. Connection validation stays on the
    // broader registry def — the visible state communicates the runtime reality
    // without restricting wiring.
    const handleLabel = useMemo(() => {
        if (mediaKind === 'video') return 'Video';
        if (mediaKind === 'image') return 'Image';
        return 'Media';
    }, [mediaKind]);

    const handleColor = useMemo(() => {
        if (mediaKind === 'video') return 'rgb(139, 92, 246)';
        if (mediaKind === 'image') return 'rgb(59, 130, 246)';
        return '#f8fafc';
    }, [mediaKind]);

    const customInputs = useMemo(
        () => [{ id: 'image', label: handleLabel, color: handleColor }],
        [handleLabel, handleColor],
    );

    const customOutputs = useMemo(
        () => [{ id: 'image_out', label: handleLabel, color: handleColor }],
        [handleLabel, handleColor],
    );

    // Trigger a ReactFlow re-measure when handle shape/color changes — cheap
    // and ensures wires stay aligned in case the rendered handle position
    // shifts during a label transition.
    useEffect(() => {
        updateNodeInternals(id);
    }, [id, mediaKind, updateNodeInternals]);

    // When the effective output type narrows (image / video resolved from
    // the upstream), prune any outgoing edge whose downstream target
    // doesn't accept the new type. Without this, swapping the upstream
    // from image to video (or vice versa) leaves orphaned-but-still-rendered
    // edges; the connection validator already refuses NEW drops, but old
    // edges from before the swap would otherwise linger.
    useEffect(() => {
        if (!mediaKind) return; // broad polymorphic — nothing to prune
        useAppStore.getState().pruneIncompatibleOutgoingEdges(id, mediaKind);
    }, [id, mediaKind]);

    // Sync to global state
    const handleSync = useCallback((updates: Partial<typeof config>) => {
        updateNodeConfig(id, {
            ...config,
            ...updates,
        });
    }, [id, config, updateNodeConfig]);

    // Hover-to-play for the in-card video preview. We hold a ref on the
    // <video> element and toggle play/pause on mouse enter/leave. On leave
    // we also reset currentTime to 0 so each subsequent hover starts the
    // clip fresh — cleaner UX for short preview loops than "resume from
    // wherever you left off." Doesn't affect downstream consumers: the
    // compositor and other readers have their own <video> elements
    // attached to the same URL.
    const previewVideoRef = useRef<HTMLVideoElement | null>(null);
    const handlePreviewEnter = useCallback(() => {
        const v = previewVideoRef.current;
        if (!v) return;
        v.play().catch(() => { /* autoplay can be blocked pre-gesture; ignore */ });
    }, []);
    const handlePreviewLeave = useCallback(() => {
        const v = previewVideoRef.current;
        if (!v) return;
        try { v.pause(); } catch { /* noop */ }
        try { v.currentTime = 0; } catch { /* noop */ }
    }, []);

    // Pull-model preview: when upstream is a graph, paint it into our own
    // offscreen-style canvas. The canvas is mounted in the JSX below; this
    // effect drives its repaints. CSS filter (blur's own) is applied at the
    // wrapper element so the GPU path renders the same visual the downstream
    // consumer sees.
    //
    // Hover-to-play mirrors the static-URL `<video>` behavior: paused at
    // t=0 until the user hovers, then advances the playhead via rAF. The
    // cache owns this consumer's video decoder votes — independent from
    // every other surface that consumes the same upstream graph.
    const previewGraphCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const graphCacheRef = useRef<GraphRenderCache | null>(null);
    if (!graphCacheRef.current) {
        graphCacheRef.current = new GraphRenderCache(id);
    }
    const [isHoveringGraphPreview, setIsHoveringGraphPreview] = useState(false);
    const handleGraphPreviewEnter = useCallback(() => setIsHoveringGraphPreview(true), []);
    const handleGraphPreviewLeave = useCallback(() => setIsHoveringGraphPreview(false), []);

    useEffect(() => {
        return () => {
            graphCacheRef.current?.dispose();
            graphCacheRef.current = null;
        };
    }, []);

    // Hover state via ref so the rAF closure reads the current value without
    // restarting the loop on every hover toggle.
    const isHoveringRef = useRef(isHoveringGraphPreview);
    isHoveringRef.current = isHoveringGraphPreview;

    useEffect(() => {
        if (!upstreamGraph) return;
        const canvas = previewGraphCanvasRef.current;
        const cache = graphCacheRef.current;
        if (!canvas || !cache) return;

        const dims = graphDimensions(upstreamGraph);
        if (canvas.width !== dims.width) canvas.width = Math.max(1, dims.width);
        if (canvas.height !== dims.height) canvas.height = Math.max(1, dims.height);

        // While HOVERING, play the upstream preview continuously (advance the
        // playhead every frame). While NOT hovering the frame is static at
        // playhead 0, so we only run a short settle burst — long enough for an
        // async-decoding upstream video's first frame to land — then idle.
        // Repainting frame 0 every frame forever (the old behavior) is what made
        // a compositor-fed blur card peg the GPU and stutter the whole canvas.
        // Trade-off: if the browser evicts a paused video frame under memory
        // pressure while idle, it won't re-decode until the next hover/change.
        const hovering = isHoveringGraphPreview;
        const duration = graphDuration(upstreamGraph);
        let stopped = false;
        let raf = 0;
        let playhead = 0;
        let last = performance.now();

        const tick = (now: number) => {
            if (stopped) return;
            if (hovering) {
                const dt = (now - last) / 1000;
                last = now;
                playhead += dt;
                if (duration > 0 && playhead >= duration) playhead = 0;
            } else {
                playhead = 0;
                last = now;
            }

            const ctx = canvas.getContext('2d');
            if (ctx) {
                cache.releaseAllScratch();
                paintGraphFrame(upstreamGraph, playhead, ctx, cache, hovering);
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        if (hovering) {
            return () => { stopped = true; if (raf) cancelAnimationFrame(raf); };
        }
        const timer = setTimeout(() => { stopped = true; if (raf) cancelAnimationFrame(raf); }, IDLE_SETTLE_MS);
        return () => { stopped = true; clearTimeout(timer); if (raf) cancelAnimationFrame(raf); };
    }, [upstreamGraph, isHoveringGraphPreview]);

    // Derived blur style. Blur preview always applies its own filter; for
    // graph upstreams, the upstream filter chain is already rendered by
    // `paintGraphFrame` into the preview canvas, so we don't need to
    // re-compose CSS filters here. The visual result is the same.
    // Pixel values here are at NATIVE source resolution — they get scaled
    // for display by `previewBlurStyle` below.
    const blurStyle = useMemo(() => {
        const sigma = radiusToSigma(localRadius);
        const base = `blur(${sigma}px)`;
        return config.type === 'box'
            ? `${base} contrast(1.15) brightness(1.05) saturate(1.1)`
            : config.type === 'stack'
            ? `${base} saturate(0.8) opacity(0.9)`
            : base;
    }, [localRadius, config.type]);

    // The compositor's LayerVideo applies its filter on a canvas sized to the
    // source's native pixels, then Konva downscales for display — so visible
    // blur ∝ (displayWidth / nativeWidth). The server's sharp/ffmpeg pipeline
    // also operates at native resolution. We replicate that math here so the
    // in-card preview shows the same effective blur as both other surfaces.
    // Without this, a 1920px source previewed at ~380px in the card would
    // look ~5× more blurred than its final output.
    const previewWrapperRef = useRef<HTMLDivElement | null>(null);
    const [nativeMediaWidth, setNativeMediaWidth] = useState(0);
    const [displayWidth, setDisplayWidth] = useState(0);

    useEffect(() => {
        const wrapper = previewWrapperRef.current;
        if (!wrapper || typeof ResizeObserver === 'undefined') return;
        setDisplayWidth(wrapper.clientWidth);
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) setDisplayWidth(entry.contentRect.width);
        });
        observer.observe(wrapper);
        return () => observer.disconnect();
    }, [mediaKind, mediaUrl, upstreamGraph]);

    const handleVideoMetadata = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
        setNativeMediaWidth(e.currentTarget.videoWidth || 0);
    }, []);

    // Live sources can publish their native resolution up front (the
    // Compositor knows its canvas dimensions immediately). Seed
    // nativeMediaWidth from that so the preview-blur scaling math kicks in
    // before any onLoadedMetadata fires.
    useEffect(() => {
        if (upstreamResolution?.width) setNativeMediaWidth(upstreamResolution.width);
    }, [upstreamResolution]);

    // For images we don't get a direct onLoad event (BlurryImage doesn't
    // forward the DOM event), so we measure via a throwaway Image preload
    // whenever the image URL changes.
    useEffect(() => {
        if (mediaKind !== 'image' || !mediaUrl) return;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        const onLoad = () => setNativeMediaWidth(img.naturalWidth || 0);
        img.addEventListener('load', onLoad);
        img.src = mediaUrl;
        return () => img.removeEventListener('load', onLoad);
    }, [mediaKind, mediaUrl]);

    const previewBlurStyle = useMemo(() => {
        if (!displayWidth || !nativeMediaWidth) return blurStyle;
        const ratio = displayWidth / nativeMediaWidth;
        return blurStyle.replace(/blur\(([\d.]+)px\)/g, (_, n) => `blur(${parseFloat(n) * ratio}px)`);
    }, [blurStyle, displayWidth, nativeMediaWidth]);

    // Blur's own output (post-clientExecutor). For image upstream this is a
    // data URL — useCardDownload picks it up and exposes the Download button.
    // For video (graph) upstream the envelope has `url: ''` and no real URL
    // until Run completes; useCardDownload's canDownload is then false and
    // the button auto-hides. A future server-side blur ffmpeg endpoint will
    // let us register a custom handler for the chained-video case.
    const ownOutput = useAppStore((s) => s.nodeOutputs[id]);
    const { state: cardDownloadState, canDownload, handleDownload } = useCardDownload(data.label, ownOutput);

    return (
        <BaseNode
            id={id}
            type="blur"
            label={data.label}
            selected={selected}
            dragging={dragging}
            nodeData={data}
            customInputs={customInputs}
            customOutputs={customOutputs}
            isNew={(data as any).isNew}
            hideStatus={true}
            width=""
            style={{ width: 'max-content', minWidth: 320, maxWidth: 420 }}
            customActions={canDownload ? <CardDownloadButton state={cardDownloadState} onClick={handleDownload} /> : undefined}
        >
            <motion.div
                layout={!isDragging ? "size" : false}
                className={cn(
                    "relative w-full rounded-xl overflow-hidden shadow-inner group/node border border-white/10 bg-white/5 min-h-[200px]",
                    !isDragging && "transition-all duration-500"
                )}
            >
                <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />

                {(mediaUrl || upstreamGraph) ? (
                    <div
                        ref={previewWrapperRef}
                        className="w-full h-full relative group/preview cursor-zoom-in overflow-hidden"
                        onClick={() => setLightboxOpen(true)}
                        onMouseEnter={
                            mediaKind === 'video'
                                ? (upstreamGraph ? handleGraphPreviewEnter : handlePreviewEnter)
                                : undefined
                        }
                        onMouseLeave={
                            mediaKind === 'video'
                                ? (upstreamGraph ? handleGraphPreviewLeave : handlePreviewLeave)
                                : undefined
                        }
                        style={{ filter: previewBlurStyle }}
                    >
                        {upstreamGraph ? (
                            // Pull-model preview: locally painted at our own
                            // looped playhead. Independent of every other
                            // consumer of the same upstream graph.
                            <canvas
                                ref={previewGraphCanvasRef}
                                className={cn(
                                    "relative z-10 w-full h-full object-cover",
                                    !isDragging && "transition-transform duration-700 group-hover/preview:scale-[1.03]"
                                )}
                            />
                        ) : mediaKind === 'video' ? (
                            <BlurryVideo
                                ref={previewVideoRef}
                                src={mediaUrl as string}
                                loop
                                muted
                                playsInline
                                preload="metadata"
                                onLoadedMetadata={handleVideoMetadata}
                                className={cn(
                                    "relative z-10 w-full h-full object-cover max-w-none max-h-none",
                                    !isDragging && "transition-transform duration-700 group-hover/preview:scale-[1.03]"
                                )}
                            />
                        ) : (
                            <BlurryImage
                                src={mediaUrl ?? undefined}
                                fallbackSrc={mediaUrl ?? undefined}
                                alt="Blur preview"
                                className={cn(
                                    "relative z-10",
                                    !isDragging && "transition-transform duration-700 group-hover/preview:scale-[1.03]"
                                )}
                            />
                        )}
                    </div>
                ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 opacity-30 group-hover/node:opacity-50 transition-opacity duration-500">
                        <div className="text-xs font-medium px-4 text-center">

                        </div>
                    </div>
                )}
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

            {/* Media Lightbox — passes the blur filter at native-resolution
                pixel scale, plus the source's native width so the lightbox
                can apply the same displayWidth/nativeWidth scaling the card
                preview and the compositor use. Result: same effective blur
                strength on every surface. */}
            {lightboxOpen && upstreamGraph && (
                <BlurGraphLightbox
                    graph={upstreamGraph}
                    cssFilter={blurStyle}
                    poolKey={`${id}_lightbox`}
                    onClose={() => setLightboxOpen(false)}
                />
            )}
            {lightboxOpen && !upstreamGraph && mediaUrl && (
                <ImageLightbox
                    media={mediaUrl}
                    type={mediaKind === 'video' ? 'video' : 'image'}
                    initialIndex={0}
                    cssFilter={blurStyle}
                    nativeMediaWidth={nativeMediaWidth || undefined}
                    onClose={() => setLightboxOpen(false)}
                />
            )}
        </BaseNode>
    );
}

/**
 * Fullscreen graph preview with blur's CSS filter applied.
 *
 * Uses a separate poolKey (the blur node's id + "_lightbox") so the
 * lightbox decodes its own video instances independent of the card's
 * preview — opening the lightbox doesn't disturb the card's playhead.
 * Auto-loops on the graph's total duration; clicking outside the canvas
 * closes the modal.
 */
const BlurGraphLightbox = memo(function BlurGraphLightbox({
    graph,
    cssFilter,
    poolKey,
    onClose,
}: {
    graph: GraphDescription;
    cssFilter: string;
    poolKey: string;
    onClose: () => void;
}) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const cacheRef = useRef<GraphRenderCache | null>(null);
    if (!cacheRef.current) cacheRef.current = new GraphRenderCache(poolKey);

    useEffect(() => {
        return () => {
            cacheRef.current?.dispose();
            cacheRef.current = null;
        };
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        const cache = cacheRef.current;
        if (!canvas || !cache) return;

        const dims = graphDimensions(graph);
        if (canvas.width !== dims.width) canvas.width = Math.max(1, dims.width);
        if (canvas.height !== dims.height) canvas.height = Math.max(1, dims.height);

        const duration = graphDuration(graph);
        let stopped = false;
        let raf = 0;
        let playhead = 0;
        let last = performance.now();

        const tick = (now: number) => {
            if (stopped) return;
            const dt = (now - last) / 1000;
            last = now;
            playhead += dt;
            if (duration > 0 && playhead >= duration) playhead = 0;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                cache.releaseAllScratch();
                paintGraphFrame(graph, playhead, ctx, cache, true);
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => {
            stopped = true;
            if (raf) cancelAnimationFrame(raf);
        };
    }, [graph]);

    const dims = graphDimensions(graph);

    return createPortal(
        <div
            className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center"
            onClick={onClose}
        >
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onClose(); }}
                className="absolute top-4 right-4 w-9 h-9 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 text-white transition-colors backdrop-blur-md shadow-lg"
                aria-label="Close preview"
            >
                <X className="w-5 h-5" />
            </button>
            <canvas
                ref={canvasRef}
                onClick={(e) => e.stopPropagation()}
                className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl bg-black"
                style={{ aspectRatio: `${dims.width} / ${dims.height}`, filter: cssFilter }}
            />
        </div>,
        document.body,
    );
});

export default memo(BlurNode);

export const blurClientDef: NodeClientDef = {
    ...blurSharedDef,
    component: memo((props: any) => <BlurNode {...props} type="blur" />),
    // Live blur: useNodeAutoCompute picks this up and recomputes the blurred
    // image client-side whenever this node's config or its upstream value
    // changes, writing the result into nodeOutputs so downstream nodes
    // (e.g. Compositor) re-render automatically.
    clientExecutor: blurClientExecutor,
};
