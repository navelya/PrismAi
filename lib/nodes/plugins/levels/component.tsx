'use client';

import React, { memo, useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { NodeProps, useUpdateNodeInternals } from 'reactflow';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import BaseNode from '@/lib/nodes/core/canvas/BaseNode';
import { fitMediaWidth, MEDIA_FIT_MAX, MEDIA_FIT_CLASS } from '@/lib/nodes/core/canvas/media-fit';
import BlurryImage from '@/components/ui/BlurryImage';
import BlurryVideo from '@/components/ui/BlurryVideo';
import ImageLightbox from '@/components/ui/ImageLightbox';
import { NumberInput } from '@/components/ui/NumberInput';
import { CardDownloadButton } from '@/components/editor/CardDownloadButton';
import { useCardDownload } from '@/lib/hooks/use-card-download';
import { X } from 'lucide-react';
import { useAppStore } from '@/lib/store/app-store';
import { useNodeAutoCompute } from '@/lib/hooks/use-node-auto-compute';
import { detectMediaTypeFromUrl } from '@/lib/workflow/result-format';
import { NodeClientDef } from '../../core/types';
import { LevelsConfig, levelsSharedDef } from './definition';
import { levelsClientExecutor } from './executor.client';
import { GraphDescription, graphDimensions, resolveGraphDuration } from '../compositor/shared';
import { GraphRenderCache, paintGraphFrame } from '../compositor/graph-renderer';

interface LevelsNodeData {
    label: string;
    config: LevelsConfig;
}

const defaultConfig: LevelsConfig = {
    black_point: 0,
    white_point: 255,
    gamma: 1.0,
};

// Idle (not hovering) graph previews paint a short settle burst — long enough
// for the upstream video's first frame to decode in — then stop, instead of
// repainting forever. Mirrors blur's preview loop.
const IDLE_SETTLE_MS = 800;

interface SliderRowProps {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    decimals?: number;
    accent?: string;
    onLocalChange: (v: number) => void;
    onCommit: (v: number) => void;
}

const SliderRow = memo(function SliderRow({
    label,
    value,
    min,
    max,
    step,
    decimals = 0,
    accent = 'bg-accent-primary',
    onLocalChange,
    onCommit,
}: SliderRowProps) {
    const fillPct = ((value - min) / (max - min)) * 100;
    const display = decimals > 0 ? value.toFixed(decimals) : Math.round(value).toString();

    return (
        <div className="flex items-center gap-2 h-7">
            <div className="w-[34px] shrink-0 text-[10px] font-bold uppercase tracking-[0.1em] text-content-tertiary">
                {label}
            </div>
            <div className="flex-1 flex items-center group/slider relative h-full px-1">
                <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={value}
                    onMouseDown={() => useAppStore.getState().takeSnapshot()}
                    onTouchStart={() => useAppStore.getState().takeSnapshot()}
                    onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (Number.isNaN(v)) return;
                        onLocalChange(v);
                        onCommit(v);
                    }}
                    className="nodrag w-full h-full bg-transparent appearance-none cursor-pointer accent-accent-primary z-10"
                    style={{ WebkitAppearance: 'none' }}
                />
                <div className="absolute left-0 right-0 h-[1px] bg-white/10 top-1/2 -translate-y-1/2 pointer-events-none" />
                <div
                    className={cn('absolute left-0 h-[1px] top-1/2 -translate-y-1/2 pointer-events-none', accent)}
                    style={{ width: `${fillPct}%` }}
                />
            </div>
            <div className="w-[42px] shrink-0">
                <NumberInput
                    min={min}
                    max={max}
                    step={step}
                    value={display}
                    hideArrows={true}
                    onChange={(e) => {
                        const parsed = parseFloat(e.target.value);
                        if (Number.isNaN(parsed)) return;
                        const clamped = Math.max(min, Math.min(max, parsed));
                        onLocalChange(clamped);
                        onCommit(clamped);
                    }}
                    className="space-y-0 nodrag"
                    inputClassName="h-7 !px-1.5 !text-[10px] !bg-white/5 !border border-white/5 !rounded-lg text-center font-mono font-bold text-accent-primary focus:border-accent-primary/30 transition-all"
                />
            </div>
        </div>
    );
});

function LevelsNode({ data, id, selected, dragging = false }: NodeProps<LevelsNodeData>) {
    const updateNodeConfig = useAppStore((state) => state.updateNodeConfig);
    const updateNodeInternals = useUpdateNodeInternals();
    const isDragging = dragging;
    const [lightboxOpen, setLightboxOpen] = useState(false);

    const { connectedInputId, sourceFallbackOutput } = useAppStore(
        useShallow((state) => {
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
        }),
    );

    const liveSourceOutput = useAppStore((state) =>
        connectedInputId ? state.nodeOutputs[connectedInputId] : undefined,
    );

    useNodeAutoCompute(id);

    const config = useMemo(
        () => ({ ...defaultConfig, ...data.config }),
        [data.config],
    );

    const [localBlack, setLocalBlack] = useState(config.black_point);
    const [localWhite, setLocalWhite] = useState(config.white_point);
    const [localGamma, setLocalGamma] = useState(config.gamma);

    useEffect(() => setLocalBlack(config.black_point), [config.black_point]);
    useEffect(() => setLocalWhite(config.white_point), [config.white_point]);
    useEffect(() => setLocalGamma(config.gamma), [config.gamma]);

    const sourceOutput = useMemo(() => {
        if (!connectedInputId) return null;
        return liveSourceOutput ?? sourceFallbackOutput ?? null;
    }, [connectedInputId, liveSourceOutput, sourceFallbackOutput]);

    // Extract the first item from the upstream envelope. Three shapes flow in:
    // a raw string URL, a single object {url,...}, or an envelope {type, data}.
    const upstreamItem = useMemo<any>(() => {
        if (!sourceOutput) return null;
        const candidate = Array.isArray(sourceOutput) ? sourceOutput[0] : sourceOutput;
        if (!candidate) return null;
        if (typeof candidate === 'string') return candidate;
        if (typeof candidate === 'object') {
            const inner = (candidate as any).data;
            if (Array.isArray(inner) && inner.length > 0) return inner[0];
            return candidate;
        }
        return null;
    }, [sourceOutput]);

    // Static media URL (image or video). Empty for live-graph sources.
    const sourceImageUrl = useMemo<string | null>(() => {
        if (!upstreamItem) return null;
        if (typeof upstreamItem === 'string') return upstreamItem;
        const u = (upstreamItem as any).url || (upstreamItem as any).previewUrl;
        return typeof u === 'string' && u.length > 0 ? u : null;
    }, [upstreamItem]);

    // Pull-model live signal: upstream publishes a `graph` description (from a
    // Compositor, or another filter wrapping one). When present we paint the
    // preview onto our own offscreen canvas at our own playhead, then apply the
    // levels SVG filter on the wrapper (gamma works on the DOM canvas element).
    const upstreamGraph = useMemo<GraphDescription | null>(() => {
        if (!upstreamItem || typeof upstreamItem !== 'object') return null;
        return (upstreamItem as any).graph ?? null;
    }, [upstreamItem]);

    const upstreamResolution = useMemo<{ width: number; height: number } | null>(() => {
        if (upstreamGraph) return graphDimensions(upstreamGraph);
        if (!upstreamItem || typeof upstreamItem !== 'object') return null;
        const r = (upstreamItem as any).resolution;
        if (r && typeof r.width === 'number' && typeof r.height === 'number') return r;
        return null;
    }, [upstreamItem, upstreamGraph]);

    const mediaKind = useMemo<'image' | 'video' | null>(() => {
        if (upstreamGraph) return 'video';
        if (!sourceImageUrl) return null;
        if (sourceImageUrl.startsWith('data:video/')) return 'video';
        if (sourceImageUrl.startsWith('data:image/')) return 'image';
        return (detectMediaTypeFromUrl(sourceImageUrl) as 'image' | 'video' | null) ?? 'image';
    }, [upstreamGraph, sourceImageUrl]);

    // Narrow the polymorphic handle label/color to the flowing media kind.
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
        () => [{ id: 'image', label: handleLabel, color: handleColor, type: mediaKind ?? ['image', 'video'] }],
        [handleLabel, handleColor, mediaKind],
    );

    const customOutputs = useMemo(
        () => [{ id: 'image_out', label: handleLabel, color: handleColor, type: mediaKind ?? ['image', 'video'] }],
        [handleLabel, handleColor, mediaKind],
    );

    useEffect(() => {
        updateNodeInternals(id);
    }, [id, mediaKind, updateNodeInternals]);

    // When the output kind narrows, prune outgoing edges that no longer accept
    // the new type (e.g. swapping an image upstream for a video one).
    useEffect(() => {
        if (!mediaKind) return;
        useAppStore.getState().pruneIncompatibleOutgoingEdges(id, mediaKind);
    }, [id, mediaKind]);

    // Aspect-fitted node width so the whole frame shows (no crop / empty bars).
    const [nativeMediaSize, setNativeMediaSize] = useState({ width: 0, height: 0 });
    const fitWidth = fitMediaWidth(nativeMediaSize.width, nativeMediaSize.height);

    const handleVideoMetadata = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
        const el = e.currentTarget;
        if (el.videoWidth) setNativeMediaSize({ width: el.videoWidth, height: el.videoHeight || 0 });
    }, []);

    useEffect(() => {
        if (upstreamResolution?.width) {
            setNativeMediaSize({ width: upstreamResolution.width, height: upstreamResolution.height || 0 });
        }
    }, [upstreamResolution]);

    // SVG filter params derived from local slider state. Resolution-independent
    // (per-pixel tonal remap) — applied verbatim to whatever the wrapper holds:
    // an <img>, a <video>, or the graph <canvas>. The browser re-rasterizes on
    // the GPU as the user drags; no image reload, no JS per pixel.
    const filterId = useMemo(() => `levels-filter-${id}`, [id]);
    const { slope, intercept, gammaExp } = useMemo(() => {
        const b = Math.max(0, Math.min(255, localBlack)) / 255;
        const w = Math.max(0, Math.min(255, localWhite)) / 255;
        const range = Math.max(0.001, w - b);
        return {
            slope: 1 / range,
            intercept: -b / range,
            gammaExp: 1 / Math.max(0.01, localGamma),
        };
    }, [localBlack, localWhite, localGamma]);

    const handleSync = useCallback(
        (updates: Partial<LevelsConfig>) => {
            updateNodeConfig(id, { ...config, ...updates });
        },
        [id, config, updateNodeConfig],
    );

    // Hover-to-play for the static-URL <video> preview.
    const previewVideoRef = useRef<HTMLVideoElement | null>(null);
    const handlePreviewEnter = useCallback(() => {
        previewVideoRef.current?.play().catch(() => { /* autoplay can be blocked pre-gesture */ });
    }, []);
    const handlePreviewLeave = useCallback(() => {
        const v = previewVideoRef.current;
        if (!v) return;
        try { v.pause(); } catch { /* noop */ }
        try { v.currentTime = 0; } catch { /* noop */ }
    }, []);

    // Pull-model graph preview: paint the upstream graph into our own canvas at
    // our own looped playhead, independent of every other consumer. Mirrors blur.
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

    useEffect(() => {
        if (!upstreamGraph) return;
        const canvas = previewGraphCanvasRef.current;
        const cache = graphCacheRef.current;
        if (!canvas || !cache) return;

        const dims = graphDimensions(upstreamGraph);
        if (canvas.width !== dims.width) canvas.width = Math.max(1, dims.width);
        if (canvas.height !== dims.height) canvas.height = Math.max(1, dims.height);

        const hovering = isHoveringGraphPreview;
        const MAX_IDLE_WAIT_MS = 10000;
        let stopped = false;
        let raf = 0;
        let playhead = 0;
        let last = performance.now();
        let startMs = -1;
        let completeAtMs = -1;

        const tick = (now: number) => {
            if (stopped) return;
            if (hovering) {
                const dt = (now - last) / 1000;
                last = now;
                playhead += dt;
                const duration = resolveGraphDuration(
                    upstreamGraph,
                    (u, layerId) => cache.getVideoDuration(u, layerId),
                );
                if (duration > 0) { if (playhead >= duration) playhead = 0; }
                else if (playhead > 60) playhead = 0;
            } else {
                playhead = 0;
                last = now;
            }

            const ctx = canvas.getContext('2d');
            let complete = false;
            if (ctx) {
                cache.releaseAllScratch();
                complete = paintGraphFrame(upstreamGraph, playhead, ctx, cache, hovering);
            }

            if (!hovering) {
                if (startMs < 0) startMs = now;
                if (complete) {
                    if (completeAtMs < 0) completeAtMs = now;
                    if (now - completeAtMs >= IDLE_SETTLE_MS) { stopped = true; return; }
                }
                if (now - startMs >= MAX_IDLE_WAIT_MS) { stopped = true; return; }
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => { stopped = true; if (raf) cancelAnimationFrame(raf); };
    }, [upstreamGraph, isHoveringGraphPreview]);

    const ownOutput = useAppStore((s) => s.nodeOutputs[id]);
    const { state: cardDownloadState, canDownload, handleDownload } = useCardDownload(data.label, ownOutput);

    const hasPreview = !!(sourceImageUrl || upstreamGraph);

    return (
        <BaseNode
            id={id}
            type="levels"
            label={data.label}
            selected={selected}
            dragging={dragging}
            nodeData={data}
            customInputs={customInputs}
            customOutputs={customOutputs}
            isNew={(data as any).isNew}
            hideStatus={true}
            width=""
            style={{ width: fitWidth ?? 'max-content', minWidth: fitWidth != null ? 200 : 280, maxWidth: MEDIA_FIT_MAX }}
            customActions={canDownload ? <CardDownloadButton state={cardDownloadState} onClick={handleDownload} /> : undefined}
        >
            <div
                className={cn(
                    'relative w-full rounded-xl overflow-hidden shadow-inner group/node border border-white/10 bg-white/5 min-h-[200px] max-h-[460px]',
                    !isDragging && 'transition-all duration-500',
                )}
            >
                <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />

                {hasPreview ? (
                    <div
                        className="w-full relative group/preview cursor-zoom-in overflow-hidden"
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
                        style={{ filter: `url(#${filterId})` }}
                    >
                        {upstreamGraph ? (
                            <canvas
                                ref={previewGraphCanvasRef}
                                className={cn(
                                    'relative z-10',
                                    MEDIA_FIT_CLASS,
                                    !isDragging && 'transition-transform duration-700 group-hover/preview:scale-[1.03]',
                                )}
                            />
                        ) : mediaKind === 'video' ? (
                            <BlurryVideo
                                ref={previewVideoRef}
                                src={sourceImageUrl as string}
                                loop
                                muted
                                playsInline
                                preload="metadata"
                                onLoadedMetadata={handleVideoMetadata}
                                className={cn(
                                    'relative z-10',
                                    MEDIA_FIT_CLASS,
                                    !isDragging && 'transition-transform duration-700 group-hover/preview:scale-[1.03]',
                                )}
                            />
                        ) : (
                            <BlurryImage
                                src={sourceImageUrl ?? undefined}
                                fallbackSrc={sourceImageUrl ?? undefined}
                                alt="Levels preview"
                                containerClassName="h-auto"
                                onLoad={(dims) => { if (dims?.naturalWidth) setNativeMediaSize({ width: dims.naturalWidth, height: dims.naturalHeight || 0 }); }}
                                className={cn(
                                    'relative z-10',
                                    MEDIA_FIT_CLASS,
                                    !isDragging && 'transition-transform duration-700 group-hover/preview:scale-[1.03]',
                                )}
                            />
                        )}
                    </div>
                ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 opacity-30 group-hover/node:opacity-50 transition-opacity duration-500">
                        <div className="text-xs font-medium px-4 text-center text-content-tertiary">
                            Connect an image or video
                        </div>
                    </div>
                )}

                {/* GPU-accelerated levels filter. Re-renders smoothly on every
                    slider tick — no decode, no Canvas pixel loop. The filter is
                    resolution-independent (per-pixel tonal remap), so it applies
                    verbatim to the <img>/<video>/<canvas> above. The executors
                    still run (debounced) so the persisted output and any
                    downstream consumer see the real LUT'd result. */}
                <svg
                    aria-hidden
                    width="0"
                    height="0"
                    style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none' }}
                >
                    <defs>
                        <filter id={filterId} colorInterpolationFilters="sRGB">
                            <feComponentTransfer in="SourceGraphic" result="lvl">
                                <feFuncR type="linear" slope={slope} intercept={intercept} />
                                <feFuncG type="linear" slope={slope} intercept={intercept} />
                                <feFuncB type="linear" slope={slope} intercept={intercept} />
                            </feComponentTransfer>
                            <feComponentTransfer in="lvl">
                                <feFuncR type="gamma" amplitude={1} exponent={gammaExp} offset={0} />
                                <feFuncG type="gamma" amplitude={1} exponent={gammaExp} offset={0} />
                                <feFuncB type="gamma" amplitude={1} exponent={gammaExp} offset={0} />
                            </feComponentTransfer>
                        </filter>
                    </defs>
                </svg>
            </div>

            <div className="mt-3 px-1 pb-1 flex flex-col gap-1.5">
                <SliderRow
                    label="Blk"
                    value={localBlack}
                    min={0}
                    max={255}
                    step={1}
                    onLocalChange={setLocalBlack}
                    onCommit={(v) => handleSync({ black_point: v })}
                />
                <SliderRow
                    label="Gma"
                    value={localGamma}
                    min={0.1}
                    max={3.0}
                    step={0.01}
                    decimals={2}
                    onLocalChange={setLocalGamma}
                    onCommit={(v) => handleSync({ gamma: v })}
                />
                <SliderRow
                    label="Wht"
                    value={localWhite}
                    min={0}
                    max={255}
                    step={1}
                    onLocalChange={setLocalWhite}
                    onCommit={(v) => handleSync({ white_point: v })}
                />
            </div>

            {/* Fullscreen preview. For a live graph we paint the graph onto a
                canvas and apply the same levels SVG filter (id is document-global,
                so it resolves from the portal). For a static URL we hand the
                lightbox the url(#filter) reference as its cssFilter. */}
            {lightboxOpen && upstreamGraph && (
                <LevelsGraphLightbox
                    graph={upstreamGraph}
                    filterId={filterId}
                    poolKey={`${id}_lightbox`}
                    onClose={() => setLightboxOpen(false)}
                />
            )}
            {lightboxOpen && !upstreamGraph && sourceImageUrl && (
                <ImageLightbox
                    media={sourceImageUrl}
                    type={mediaKind === 'video' ? 'video' : 'image'}
                    initialIndex={0}
                    cssFilter={`url(#${filterId})`}
                    onClose={() => setLightboxOpen(false)}
                />
            )}
        </BaseNode>
    );
}

/**
 * Fullscreen graph preview with the levels SVG filter applied.
 *
 * Uses a separate poolKey so the lightbox decodes its own video instances
 * independent of the card preview. Auto-loops on the graph's total duration.
 * The levels filter def lives in the parent node's DOM; SVG filter ids are
 * document-global, so `url(#filterId)` resolves here even though this is
 * portaled to document.body.
 */
const LevelsGraphLightbox = memo(function LevelsGraphLightbox({
    graph,
    filterId,
    poolKey,
    onClose,
}: {
    graph: GraphDescription;
    filterId: string;
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

        let stopped = false;
        let raf = 0;
        let playhead = 0;
        let last = performance.now();

        const tick = (now: number) => {
            if (stopped) return;
            const dt = (now - last) / 1000;
            last = now;
            playhead += dt;
            const duration = resolveGraphDuration(graph, (u, layerId) => cache.getVideoDuration(u, layerId));
            if (duration > 0) { if (playhead >= duration) playhead = 0; }
            else if (playhead > 60) playhead = 0;
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
                style={{ aspectRatio: `${dims.width} / ${dims.height}`, filter: `url(#${filterId})` }}
            />
        </div>,
        document.body,
    );
});

export default memo(LevelsNode);

export const levelsClientDef: NodeClientDef = {
    ...levelsSharedDef,
    component: memo((props: any) => <LevelsNode {...props} type="levels" />),
    clientExecutor: levelsClientExecutor,
};
