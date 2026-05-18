'use client';

import React, { memo, useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { NodeProps, useUpdateNodeInternals } from 'reactflow';
import { motion } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import BaseNode from '@/lib/nodes/core/canvas/BaseNode';
import BlurryImage from '@/components/ui/BlurryImage';
import { BlurConfig } from './definition';
import ImageLightbox from '@/components/ui/ImageLightbox';
import { useAppStore } from '@/lib/store/app-store';
import { Select } from '@/components/ui/Select';
import { NumberInput } from '@/components/ui/NumberInput';
import { useNodeAutoCompute } from '@/lib/hooks/use-node-auto-compute';
import { NodeClientDef } from '../../core/types';
import { blurSharedDef } from './definition';
import { blurClientExecutor } from './executor.client';
import { detectMediaTypeFromUrl } from '@/lib/workflow/result-format';
import { radiusToSigma } from './shared';

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

    // Live-signal references published by upstream nodes (currently
    // Compositor). When present, we render the preview via
    // `<video srcObject={stream}>` instead of `<video src={url}>` — the CSS
    // filter stack composes the same way either way.
    const liveStream = useMemo<MediaStream | null>(() => {
        if (!upstreamItem || typeof upstreamItem !== 'object') return null;
        return (upstreamItem as any).stream ?? null;
    }, [upstreamItem]);

    const liveCanvas = useMemo<HTMLCanvasElement | null>(() => {
        if (!upstreamItem || typeof upstreamItem !== 'object') return null;
        return (upstreamItem as any).canvas ?? null;
    }, [upstreamItem]);

    // Upstream-provided resolution (preferred over loading the URL to
    // measure). Lets the preview-blur scaling math kick in immediately for
    // live sources where there's no <img> load event.
    const upstreamResolution = useMemo<{ width: number; height: number } | null>(() => {
        if (!upstreamItem || typeof upstreamItem !== 'object') return null;
        const r = (upstreamItem as any).resolution;
        if (r && typeof r.width === 'number' && typeof r.height === 'number') return r;
        return null;
    }, [upstreamItem]);

    const mediaKind = useMemo<'image' | 'video' | null>(() => {
        if (liveStream || liveCanvas) return 'video';
        if (!mediaUrl) return null;
        if (mediaUrl.startsWith('data:video/')) return 'video';
        if (mediaUrl.startsWith('data:image/')) return 'image';
        return (detectMediaTypeFromUrl(mediaUrl) as 'image' | 'video' | null) ?? 'image';
    }, [liveStream, liveCanvas, mediaUrl]);

    // If the upstream already carries a cssFilter (e.g. another Blur upstream),
    // grab it so we can compose our own filter on top in the visible preview.
    // The client executor handles the same composition for the propagated
    // envelope; we mirror it here so the in-card preview matches.
    const upstreamCssFilter = useMemo<string | null>(() => {
        if (!sourceOutput) return null;
        const visit = (v: any): string | null => {
            if (!v) return null;
            if (typeof v === 'string') return null;
            if (Array.isArray(v)) {
                for (const item of v) {
                    const found = visit(item);
                    if (found) return found;
                }
                return null;
            }
            if (typeof v === 'object') {
                if (typeof v.cssFilter === 'string') return v.cssFilter;
                if (v.data !== undefined) return visit(v.data);
            }
            return null;
        };
        return visit(sourceOutput);
    }, [sourceOutput]);

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

    // Bind the live MediaStream when upstream is a live source (Compositor).
    // `srcObject` can't be set declaratively in JSX, so the effect handles it.
    // We also flip the element back to `src`-mode if the upstream changes to a
    // static URL, so dropping the Compositor and wiring a regular MediaInput
    // video keeps working without remounting the node.
    useEffect(() => {
        const v = previewVideoRef.current;
        if (!v) return;
        if (liveStream) {
            if (v.srcObject !== liveStream) {
                v.srcObject = liveStream;
                v.play().catch(() => { /* autoplay may be blocked pre-gesture */ });
            }
        } else if (v.srcObject) {
            v.srcObject = null;
        }
    }, [liveStream]);

    // Derived blur style. Composes our own blur with any cssFilter the
    // upstream already declared, so a chained Blur → Blur card preview shows
    // the same cumulative effect that the propagated envelope describes.
    // Pixel values here are at NATIVE source resolution — they get scaled
    // for display by `previewBlurStyle` below.
    const blurStyle = useMemo(() => {
        const sigma = radiusToSigma(localRadius);
        const base = `blur(${sigma}px)`;
        const ownFilter =
            config.type === 'box'
                ? `${base} contrast(1.15) brightness(1.05) saturate(1.1)`
                : config.type === 'stack'
                ? `${base} saturate(0.8) opacity(0.9)`
                : base;
        return upstreamCssFilter ? `${upstreamCssFilter} ${ownFilter}` : ownFilter;
    }, [localRadius, config.type, upstreamCssFilter]);

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
    }, [mediaKind, mediaUrl, liveStream]);

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
        >
            <motion.div
                layout={!isDragging ? "size" : false}
                className={cn(
                    "relative w-full rounded-xl overflow-hidden shadow-inner group/node border border-white/10 bg-white/5 min-h-[200px]",
                    !isDragging && "transition-all duration-500"
                )}
            >
                <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />

                {(mediaUrl || liveStream) ? (
                    <div
                        ref={previewWrapperRef}
                        className="w-full h-full relative group/preview cursor-zoom-in overflow-hidden"
                        onClick={() => setLightboxOpen(true)}
                        onMouseEnter={mediaKind === 'video' && !liveStream ? handlePreviewEnter : undefined}
                        onMouseLeave={mediaKind === 'video' && !liveStream ? handlePreviewLeave : undefined}
                        style={{ filter: previewBlurStyle }}
                    >
                        {mediaKind === 'video' ? (
                            <video
                                ref={previewVideoRef}
                                {...(liveStream ? {} : { src: mediaUrl as string })}
                                loop
                                muted
                                playsInline
                                autoPlay={!!liveStream}
                                preload="metadata"
                                onLoadedMetadata={handleVideoMetadata}
                                className={cn(
                                    "relative z-10 w-full h-full object-cover",
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
            {lightboxOpen && mediaUrl && (
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
