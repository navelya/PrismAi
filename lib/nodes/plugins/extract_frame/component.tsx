'use client';

import React, { memo, useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { NodeProps, useUpdateNodeInternals } from 'reactflow';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import BaseNode from '@/lib/nodes/core/canvas/BaseNode';
import { fitMediaWidth, MEDIA_FIT_MAX, MEDIA_FIT_CLASS } from '@/lib/nodes/core/canvas/media-fit';
import BlurryImage from '@/components/ui/BlurryImage';
import ImageLightbox from '@/components/ui/ImageLightbox';
import { ExtractFrameConfig } from './definition';
import { CardDownloadButton } from '@/components/editor/CardDownloadButton';
import { useCardDownload } from '@/lib/hooks/use-card-download';
import { useAppStore } from '@/lib/store/app-store';
import { useNodeAutoCompute } from '@/lib/hooks/use-node-auto-compute';
import { NodeClientDef } from '../../core/types';
import { extractFrameSharedDef } from './definition';
import { extractFrameClientExecutor } from './executor.client';
import { detectMediaTypeFromUrl } from '@/lib/workflow/result-format';
import { GraphDescription, graphDimensions, graphDuration } from '../compositor/shared';
import { GraphRenderCache, paintGraphFrame } from '../compositor/graph-renderer';
import MiniTransport from '../compositor/ui/MiniTransport';

interface ExtractFrameNodeData {
    label: string;
    config: ExtractFrameConfig;
}

const defaultConfig: ExtractFrameConfig = {
    frameTime: 0,
};

// Push the scrubbed playhead to the store (→ executor bake) this long after the
// user stops moving — keeps undo history + the client bake from firing on every
// scrub tick. Pausing commits immediately.
const COMMIT_DEBOUNCE_MS = 250;
// React-state playhead refresh cadence during playback (10Hz; the <video> /
// canvas render themselves, so a 60Hz React commit would be wasted work).
const PLAYHEAD_THROTTLE_MS = 100;
// Settle-paint window for a paused graph preview — long enough for a pooled
// video frame to decode at the seeked time, then idle.
const GRAPH_SETTLE_MS = 800;

/** Frame rate of a (possibly filter-wrapped) graph. */
function graphFps(graph: GraphDescription): number {
    let g: GraphDescription = graph;
    while (g.kind === 'filter') g = g.upstream;
    return g.fps || 30;
}

function ExtractFrameNode({ data, id, selected, dragging = false }: NodeProps<ExtractFrameNodeData>) {
    const updateNodeConfig = useAppStore((state) => state.updateNodeConfig);
    const updateNodeInternals = useUpdateNodeInternals();
    const isDragging = dragging;
    const [lightboxOpen, setLightboxOpen] = useState(false);

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

    const liveSourceOutput = useAppStore((state) =>
        connectedInputId ? state.nodeOutputs[connectedInputId] : undefined
    );

    useNodeAutoCompute(id);

    const config = useMemo(() => ({ ...defaultConfig, ...data.config }), [data.config]);
    const configRef = useRef(config);
    configRef.current = config;

    const sourceOutput = useMemo(() => {
        if (!connectedInputId) return null;
        return liveSourceOutput ?? sourceFallbackOutput ?? null;
    }, [connectedInputId, liveSourceOutput, sourceFallbackOutput]);

    const upstreamItem = useMemo<any>(() => {
        if (!sourceOutput) return null;
        const candidate = Array.isArray(sourceOutput) ? sourceOutput[0] : sourceOutput;
        if (!candidate) return null;
        if (typeof candidate === 'string') return candidate;
        if (typeof candidate === 'object') {
            const d = (candidate as any).data;
            if (Array.isArray(d) && d.length > 0) return d[0];
            return candidate;
        }
        return null;
    }, [sourceOutput]);

    const mediaUrl = useMemo<string | null>(() => {
        if (!upstreamItem) return null;
        if (typeof upstreamItem === 'string') return upstreamItem;
        const u = (upstreamItem as any).url || (upstreamItem as any).previewUrl;
        return typeof u === 'string' && u.length > 0 ? u : null;
    }, [upstreamItem]);

    const upstreamGraph = useMemo<GraphDescription | null>(() => {
        if (!upstreamItem || typeof upstreamItem !== 'object') return null;
        return (upstreamItem as any).graph ?? null;
    }, [upstreamItem]);

    const mediaKind = useMemo<'image' | 'video' | null>(() => {
        if (upstreamGraph) return 'video';
        if (!mediaUrl) return null;
        if (mediaUrl.startsWith('data:video/')) return 'video';
        if (mediaUrl.startsWith('data:image/')) return 'image';
        return (detectMediaTypeFromUrl(mediaUrl) as 'image' | 'video' | null) ?? 'image';
    }, [upstreamGraph, mediaUrl]);

    const isPlayer = mediaKind === 'video';

    // ── Transport state ─────────────────────────────────────────────────────
    const [playhead, setPlayhead] = useState(config.frameTime);
    const [isPlaying, setIsPlaying] = useState(false);
    const [muted, setMuted] = useState(true);
    const [videoDuration, setVideoDuration] = useState(0);
    const [videoFps, setVideoFps] = useState(30);

    // Natural media size → aspect-fitted node width (shows the whole frame, no
    // crop), mirroring the ai_generator preview. Fed from the graph dims, video
    // metadata, or the loaded image below.
    const [nativeMediaSize, setNativeMediaSize] = useState({ width: 0, height: 0 });
    const fitWidth = fitMediaWidth(nativeMediaSize.width, nativeMediaSize.height);
    // Seed the size synchronously from the upstream graph dims or the item's
    // published resolution, so the node is correctly fitted BEFORE any media
    // decode event fires (a video's loadedmetadata can report videoWidth=0 on
    // some codecs, which would otherwise leave the node stuck at max-content).
    // The metadata / image onLoad handlers below refine it if needed.
    useEffect(() => {
        if (upstreamGraph) {
            const d = graphDimensions(upstreamGraph);
            if (d.width > 0) { setNativeMediaSize({ width: d.width, height: d.height || 0 }); return; }
        }
        const r = upstreamItem && typeof upstreamItem === 'object' ? (upstreamItem as any).resolution : null;
        if (r && typeof r.width === 'number' && r.width > 0) {
            setNativeMediaSize({ width: r.width, height: r.height || 0 });
        }
    }, [upstreamGraph, upstreamItem]);

    const playheadRef = useRef(playhead);
    playheadRef.current = playhead;
    const playingRef = useRef(isPlaying);
    playingRef.current = isPlaying;

    const totalDuration = useMemo(() => {
        if (upstreamGraph) return graphDuration(upstreamGraph);
        return Number.isFinite(videoDuration) ? videoDuration : 0;
    }, [upstreamGraph, videoDuration]);
    const fps = useMemo(() => (upstreamGraph ? graphFps(upstreamGraph) : videoFps), [upstreamGraph, videoFps]);

    const frameNumber = Math.round(Math.max(0, playhead) * fps);
    const totalFrames = totalDuration > 0 ? Math.round(totalDuration * fps) : 0;

    // ── Commit the chosen frame's timestamp to config (drives the bake) ──────
    const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const commitNow = useCallback((t: number) => {
        if (commitTimerRef.current) { clearTimeout(commitTimerRef.current); commitTimerRef.current = null; }
        if (Math.abs((configRef.current.frameTime ?? 0) - t) < 0.001) return;
        useAppStore.getState().takeSnapshot();
        updateNodeConfig(id, { ...configRef.current, frameTime: t });
    }, [id, updateNodeConfig]);
    const scheduleCommit = useCallback((t: number) => {
        if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
        commitTimerRef.current = setTimeout(() => { commitTimerRef.current = null; commitNow(t); }, COMMIT_DEBOUNCE_MS);
    }, [commitNow]);
    useEffect(() => () => { if (commitTimerRef.current) clearTimeout(commitTimerRef.current); }, []);

    // ── Static-URL video element ─────────────────────────────────────────────
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const seededRef = useRef(false);

    // Reset transport when the source changes.
    useEffect(() => {
        seededRef.current = false;
        setIsPlaying(false);
        setPlayhead(configRef.current.frameTime ?? 0);
    }, [mediaUrl, upstreamGraph]);

    const handleVideoMetadata = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
        const v = e.currentTarget;
        if (Number.isFinite(v.duration)) setVideoDuration(v.duration);
        if (v.videoWidth) setNativeMediaSize({ width: v.videoWidth, height: v.videoHeight || 0 });
        if (!seededRef.current) {
            seededRef.current = true;
            const t = Math.max(0, Math.min(configRef.current.frameTime ?? 0, Math.max(0, (v.duration || 0) - 0.05)));
            try { v.currentTime = t; } catch { /* not ready */ }
            setPlayhead(t);
        }
    }, []);

    // Apply mute state to the element.
    useEffect(() => {
        const v = videoRef.current;
        if (v) v.muted = muted;
    }, [muted, mediaUrl]);

    // Track the playhead from the playing <video> via requestVideoFrameCallback
    // (smooth, per-frame) and estimate the clip's fps from the frame cadence.
    useEffect(() => {
        if (!isPlayer || upstreamGraph || !isPlaying) return;
        const v = videoRef.current;
        if (!v) return;
        const hasRVFC = typeof (v as any).requestVideoFrameCallback === 'function';
        let cancelled = false;
        let lastPush = 0;
        let lastMediaTime = -1;

        if (hasRVFC) {
            let handle = 0;
            const onFrame = (now: number, metadata: any) => {
                if (cancelled) return;
                const mt = metadata?.mediaTime ?? v.currentTime;
                if (lastMediaTime >= 0) {
                    const dt = mt - lastMediaTime;
                    if (dt > 0.005 && dt < 0.2) {
                        const est = Math.round(1 / dt);
                        if (est >= 1 && est <= 120) setVideoFps((prev) => (prev === est ? prev : est));
                    }
                }
                lastMediaTime = mt;
                if (now - lastPush >= PLAYHEAD_THROTTLE_MS) { lastPush = now; setPlayhead(mt); }
                handle = (v as any).requestVideoFrameCallback(onFrame);
            };
            handle = (v as any).requestVideoFrameCallback(onFrame);
            return () => { cancelled = true; if (handle && (v as any).cancelVideoFrameCallback) (v as any).cancelVideoFrameCallback(handle); };
        }

        // Fallback: timeupdate fires ~4Hz — coarse but keeps the indicator live.
        const onTime = () => { if (!cancelled) setPlayhead(v.currentTime); };
        v.addEventListener('timeupdate', onTime);
        return () => { cancelled = true; v.removeEventListener('timeupdate', onTime); };
    }, [isPlayer, upstreamGraph, isPlaying]);

    // ── Live-graph preview canvas ────────────────────────────────────────────
    const graphCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const graphCacheRef = useRef<GraphRenderCache | null>(null);
    if (!graphCacheRef.current) graphCacheRef.current = new GraphRenderCache(id);
    useEffect(() => () => { graphCacheRef.current?.dispose(); graphCacheRef.current = null; }, []);

    // Playing graph: rAF advances the playhead and paints each frame.
    useEffect(() => {
        if (!upstreamGraph || !isPlaying) return;
        const canvas = graphCanvasRef.current;
        const cache = graphCacheRef.current;
        if (!canvas || !cache) return;
        const dims = graphDimensions(upstreamGraph);
        if (canvas.width !== dims.width) canvas.width = Math.max(1, dims.width);
        if (canvas.height !== dims.height) canvas.height = Math.max(1, dims.height);

        // Paint at 15fps. paintGraphFrame issues a main-thread
        // drawImage(video, ...) per video layer; at 60Hz that starves the
        // video decoder (prod-measured). The playhead still advances on
        // real elapsed time, so playback timing stays exact — we just
        // commit fewer paints per second.
        const dur = graphDuration(upstreamGraph);
        const FRAME_MS = 1000 / 15;
        let stopped = false;
        let raf = 0;
        let live = playheadRef.current;
        let last = performance.now();
        let lastPush = last;
        let lastPaint = 0;
        const tick = (now: number) => {
            if (stopped) return;
            const dt = (now - last) / 1000;
            last = now;
            live += dt;
            if (dur > 0 && live >= dur) live = 0;
            if (now - lastPaint >= FRAME_MS) {
                lastPaint = now;
                const ctx = canvas.getContext('2d');
                if (ctx) { cache.releaseAllScratch(); paintGraphFrame(upstreamGraph, live, ctx, cache, true); }
            }
            if (now - lastPush >= PLAYHEAD_THROTTLE_MS) { lastPush = now; setPlayhead(live); }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => { stopped = true; if (raf) cancelAnimationFrame(raf); setPlayhead(live); };
    }, [upstreamGraph, isPlaying]);

    // Paused graph: settle-paint at the fixed playhead so a seeked video frame
    // can decode in, then idle.
    useEffect(() => {
        if (!upstreamGraph || isPlaying) return;
        const canvas = graphCanvasRef.current;
        const cache = graphCacheRef.current;
        if (!canvas || !cache) return;
        const dims = graphDimensions(upstreamGraph);
        if (canvas.width !== dims.width) canvas.width = Math.max(1, dims.width);
        if (canvas.height !== dims.height) canvas.height = Math.max(1, dims.height);

        const t = Math.max(0, playhead);
        // Hard cap so a never-loading source can't keep the idle loop running
        // forever (which would peg the GPU). Normal media decodes well inside.
        const MAX_IDLE_WAIT_MS = 10000;
        let stopped = false;
        let raf = 0;
        let startMs = -1;
        let completeAtMs = -1;
        const tick = (now: number) => {
            if (stopped) return;
            if (startMs < 0) startMs = now;
            const ctx = canvas.getContext('2d');
            let complete = false;
            if (ctx) { cache.releaseAllScratch(); complete = paintGraphFrame(upstreamGraph, t, ctx, cache, false); }
            // A fixed GRAPH_SETTLE_MS burst raced the upstream graph's async
            // media load — on a cold load the frame painted empty before the
            // video/image decoded, then idled black. Keep painting until the
            // frame is COMPLETE (all media ready), then settle and idle.
            if (complete) {
                if (completeAtMs < 0) completeAtMs = now;
                if (now - completeAtMs >= GRAPH_SETTLE_MS) { stopped = true; return; }
            }
            if (now - startMs >= MAX_IDLE_WAIT_MS) { stopped = true; return; }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => { stopped = true; if (raf) cancelAnimationFrame(raf); };
    }, [upstreamGraph, isPlaying, playhead]);

    // ── Transport callbacks ──────────────────────────────────────────────────
    const handleTogglePlay = useCallback(() => {
        // Side effects (store mutation via commitNow, video play/pause, playhead
        // commit) must NOT run inside a setIsPlaying functional updater — React
        // executes that updater during the render phase, so commitNow's
        // takeSnapshot() set() would fire while ExtractFrameNode renders and
        // schedule an update on store subscribers (AppLayout) → "Cannot update a
        // component while rendering a different component". Do them here in the
        // event handler instead, deriving `next` from playingRef.
        const next = !playingRef.current;
        playingRef.current = next; // stay consistent across rapid re-clicks before re-render
        const v = videoRef.current;
        if (next) {
            if (commitTimerRef.current) { clearTimeout(commitTimerRef.current); commitTimerRef.current = null; }
            if (v && !upstreamGraph) { v.play().catch(() => { /* gesture/autoplay */ }); }
        } else {
            if (v && !upstreamGraph) { try { v.pause(); } catch { /* noop */ } }
            // Pausing commits the current frame as the output.
            commitNow(v && !upstreamGraph ? v.currentTime : playheadRef.current);
            if (v && !upstreamGraph) setPlayhead(v.currentTime);
        }
        setIsPlaying(next);
    }, [upstreamGraph, commitNow]);

    const handleSeek = useCallback((t: number) => {
        const clamped = Math.max(0, totalDuration > 0 ? Math.min(t, totalDuration) : t);
        setIsPlaying(false);
        const v = videoRef.current;
        if (v && !upstreamGraph) {
            try { v.pause(); } catch { /* noop */ }
            const target = Math.min(clamped, Math.max(0, (v.duration || 0) - 0.03));
            try { v.currentTime = target; } catch { /* not ready */ }
            setPlayhead(target);
            scheduleCommit(target);
        } else {
            setPlayhead(clamped);
            scheduleCommit(clamped);
        }
    }, [upstreamGraph, totalDuration, scheduleCommit]);

    // ── Handles ──────────────────────────────────────────────────────────────
    const handleColor = mediaKind === 'video' ? 'rgb(139, 92, 246)' : mediaKind === 'image' ? 'rgb(59, 130, 246)' : '#f8fafc';
    const customInputs = useMemo(
        () => [{ id: 'image', label: mediaKind === 'image' ? 'Image' : 'Video', color: handleColor, type: mediaKind ?? ['image', 'video'] }],
        [mediaKind, handleColor],
    );
    // The extracted frame is always a still image.
    const customOutputs = useMemo(() => [{ id: 'image_out', label: 'Frame', color: 'rgb(59, 130, 246)', type: 'image' }], []);
    useEffect(() => { updateNodeInternals(id); }, [id, mediaKind, updateNodeInternals]);

    // ── Baked output (the extracted frame) → download + lightbox ─────────────
    const ownOutput = useAppStore((s) => s.nodeOutputs[id]);
    const ownOutputUrl = useMemo<string | null>(() => {
        const candidate = Array.isArray(ownOutput) ? ownOutput[0] : ownOutput;
        const d = (candidate as any)?.data;
        const item = Array.isArray(d) && d.length > 0 ? d[0] : null;
        const u = item?.url ?? (candidate as any)?.url;
        return typeof u === 'string' && u.length > 0 ? u : null;
    }, [ownOutput]);
    const { state: cardDownloadState, canDownload, handleDownload } = useCardDownload(data.label, ownOutput);

    const hasPreview = !!(mediaUrl || upstreamGraph);
    const showTransport = (isPlayer) && totalDuration > 0;

    return (
        <BaseNode
            id={id}
            type="extract_frame"
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
                    <div className="w-full relative group/preview overflow-hidden">
                        <div
                            className={cn('w-full relative', !showTransport && 'cursor-zoom-in')}
                            onClick={() => { if (!showTransport) setLightboxOpen(true); }}
                        >
                            {upstreamGraph ? (
                                <canvas ref={graphCanvasRef} className={cn('relative z-10', MEDIA_FIT_CLASS)} />
                            ) : mediaKind === 'video' ? (
                                <video
                                    ref={videoRef}
                                    src={mediaUrl as string}
                                    crossOrigin="anonymous"
                                    muted={muted}
                                    playsInline
                                    loop
                                    preload="auto"
                                    onLoadedMetadata={handleVideoMetadata}
                                    onLoadedData={handleVideoMetadata}
                                    className={cn('relative z-10', MEDIA_FIT_CLASS)}
                                />
                            ) : (
                                <BlurryImage
                                    src={mediaUrl ?? undefined}
                                    fallbackSrc={mediaUrl ?? undefined}
                                    alt="Extract frame preview"
                                    containerClassName="h-auto"
                                    onLoad={(dims) => { if (dims?.naturalWidth) setNativeMediaSize({ width: dims.naturalWidth, height: dims.naturalHeight || 0 }); }}
                                    className={cn('relative z-10', MEDIA_FIT_CLASS)}
                                />
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 opacity-30 group-hover/node:opacity-50 transition-opacity duration-500">
                        <div className="text-xs font-medium px-4 text-center">Connect a video</div>
                    </div>
                )}
            </div>

            {/* Video-player transport with inline frame readout. The frame you
                pause on is the frame that gets extracted. */}
            {showTransport && (
                <div className="mt-2">
                    <MiniTransport
                        playhead={playhead}
                        totalDuration={totalDuration}
                        fps={fps}
                        frameNumber={frameNumber}
                        totalFrames={totalFrames}
                        isPlaying={isPlaying}
                        muted={muted}
                        onTogglePlay={handleTogglePlay}
                        onSeek={handleSeek}
                        onToggleMute={() => setMuted((m) => !m)}
                    />
                </div>
            )}

            {lightboxOpen && (ownOutputUrl || mediaUrl) && (
                <ImageLightbox
                    media={(ownOutputUrl ?? mediaUrl) as string}
                    type={ownOutputUrl ? 'image' : (mediaKind === 'video' ? 'video' : 'image')}
                    initialIndex={0}
                    onClose={() => setLightboxOpen(false)}
                />
            )}
        </BaseNode>
    );
}

export default memo(ExtractFrameNode);

export const extractFrameClientDef: NodeClientDef = {
    ...extractFrameSharedDef,
    component: memo((props: any) => <ExtractFrameNode {...props} type="extract_frame" />),
    clientExecutor: extractFrameClientExecutor,
};
