'use client';

import React, { memo, useCallback, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import BlurryImage from '@/components/ui/BlurryImage';
import BlurryVideo from '@/components/ui/BlurryVideo';
import { GraphDescription, graphDimensions, resolveGraphDuration } from '../../compositor/shared';
import { GraphRenderCache, paintGraphFrame } from '../../compositor/graph-renderer';

export interface ComparePaneItem {
    url: string | null;
    graph: GraphDescription | null;
    resolution: { width: number; height: number } | null;
    kind: 'image' | 'video' | null;
}

// Idle (not hovering) graph previews paint a short settle burst — long enough
// for the upstream video's first frame to decode — then stop. Same rationale as
// blur's preview loop: an idle preview is a static frame and shouldn't peg the
// GPU forever.
const IDLE_SETTLE_MS = 800;
const MAX_IDLE_WAIT_MS = 10000;

/**
 * Renders ONE side of the compare node — image, static-URL video, or a live
 * compositor/filter graph — full-bleed (object-cover) inside an absolutely-
 * positioned layer. The parent owns the clip-path wipe; this component only
 * draws its media. `playing` drives hover-to-play for video/graph sources.
 */
function ComparePaneImpl({
    item,
    playing,
    poolKey,
    dragging,
    onNativeSize,
}: {
    item: ComparePaneItem;
    playing: boolean;
    poolKey: string;
    dragging: boolean;
    onNativeSize?: (w: number, h: number) => void;
}) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const graphCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const graphCacheRef = useRef<GraphRenderCache | null>(null);
    if (!graphCacheRef.current) graphCacheRef.current = new GraphRenderCache(poolKey);

    useEffect(() => {
        return () => {
            graphCacheRef.current?.dispose();
            graphCacheRef.current = null;
        };
    }, []);

    // Hover-to-play for static-URL videos.
    useEffect(() => {
        const v = videoRef.current;
        if (!v) return;
        if (playing) {
            v.play().catch(() => { /* autoplay can be blocked pre-gesture; ignore */ });
        } else {
            try { v.pause(); } catch { /* noop */ }
            try { v.currentTime = 0; } catch { /* noop */ }
        }
    }, [playing]);

    const handleVideoMetadata = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
        const el = e.currentTarget;
        if (el.videoWidth) onNativeSize?.(el.videoWidth, el.videoHeight || 0);
    }, [onNativeSize]);

    // Live graph: paint onto our own canvas at our own playhead. Hover plays;
    // idle runs a short settle burst until the frame is COMPLETE then stops.
    useEffect(() => {
        const graph = item.graph;
        if (!graph) return;
        const canvas = graphCanvasRef.current;
        const cache = graphCacheRef.current;
        if (!canvas || !cache) return;

        const dims = graphDimensions(graph);
        if (canvas.width !== dims.width) canvas.width = Math.max(1, dims.width);
        if (canvas.height !== dims.height) canvas.height = Math.max(1, dims.height);
        onNativeSize?.(dims.width, dims.height);

        let stopped = false;
        let raf = 0;
        let playhead = 0;
        let last = performance.now();
        let startMs = -1;
        let completeAtMs = -1;

        const tick = (now: number) => {
            if (stopped) return;
            if (playing) {
                const dt = (now - last) / 1000;
                last = now;
                playhead += dt;
                const duration = resolveGraphDuration(graph, (u, layerId) => cache.getVideoDuration(u, layerId));
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
                complete = paintGraphFrame(graph, playhead, ctx, cache, playing);
            }

            if (!playing) {
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
    }, [item.graph, playing, onNativeSize]);

    // Measure image native size for the parent's aspect math.
    useEffect(() => {
        if (item.kind !== 'image' || !item.url || item.graph) return;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        const onLoad = () => {
            if (img.naturalWidth) onNativeSize?.(img.naturalWidth, img.naturalHeight || 0);
        };
        img.addEventListener('load', onLoad);
        img.src = item.url;
        return () => img.removeEventListener('load', onLoad);
    }, [item.kind, item.url, item.graph, onNativeSize]);

    const mediaClass = cn(
        'absolute inset-0 w-full h-full object-cover max-w-none max-h-none',
        !dragging && 'transition-transform duration-700',
    );

    if (item.graph) {
        return <canvas ref={graphCanvasRef} className={mediaClass} />;
    }
    if (item.kind === 'video' && item.url) {
        return (
            <BlurryVideo
                ref={videoRef}
                src={item.url}
                loop
                muted
                playsInline
                preload="metadata"
                onLoadedMetadata={handleVideoMetadata}
                className={mediaClass}
            />
        );
    }
    if (item.url) {
        return (
            <BlurryImage
                src={item.url}
                fallbackSrc={item.url}
                alt="Compare side"
                className={mediaClass}
            />
        );
    }
    return null;
}

export const ComparePane = memo(ComparePaneImpl);
export default ComparePane;
