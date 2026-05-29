'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CompositorLayer } from '../definition';
import { acquireVideo, releaseVideo, setMuted, setPlayState } from '../video-pool';
import { GraphRenderCache, paintGraphFrame } from '../graph-renderer';
import { GraphDescription, graphDimensions } from '../shared';
import { LayerSource } from './types';

export interface ResolvedLayerForWebGL {
    layer: CompositorLayer;
    source: LayerSource;
    sourceWidth: number;
    sourceHeight: number;
}

export function useVideoLayerSources(
    layers: { layer: CompositorLayer; url: string; isActive: boolean }[],
    poolKey: string,
    isPlaying: boolean,
    muted: boolean,
): Map<string, { el: HTMLVideoElement; consumerId: number; w: number; h: number; ready: boolean }> {
    const refsRef = useRef<Map<string, { url: string; el: HTMLVideoElement; consumerId: number }>>(new Map());
    const [tick, setTick] = useState(0);

    useEffect(() => {
        const refs = refsRef.current;
        for (const [id, entry] of Array.from(refs.entries())) {
            const layer = layers.find(l => l.layer.id === id);
            if (!layer || layer.url !== entry.url) {
                releaseVideo(entry.url, entry.consumerId, poolKey);
                refs.delete(id);
            }
        }
        for (const l of layers) {
            if (refs.has(l.layer.id)) continue;
            const { el, id: cid } = acquireVideo(l.url, poolKey);
            refs.set(l.layer.id, { url: l.url, el, consumerId: cid });
        }
        setTick(t => t + 1);
        return () => { /* unmount cleanup in next effect */ };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [layers.map(l => `${l.layer.id}:${l.url}`).join('|'), poolKey]);

    useEffect(() => () => {
        const refs = refsRef.current;
        for (const e of refs.values()) releaseVideo(e.url, e.consumerId, poolKey);
        refs.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [poolKey]);

    useEffect(() => {
        for (const l of layers) {
            const entry = refsRef.current.get(l.layer.id);
            if (!entry) continue;
            const wantsPlay = isPlaying && l.isActive;
            setPlayState(entry.url, entry.consumerId, wantsPlay, poolKey);
            setMuted(entry.url, entry.consumerId, muted || !l.isActive || !!l.layer.muted, poolKey);
        }
    }, [layers, isPlaying, muted, poolKey, tick]);

    return useMemo(() => {
        const out = new Map<string, { el: HTMLVideoElement; consumerId: number; w: number; h: number; ready: boolean }>();
        for (const l of layers) {
            const entry = refsRef.current.get(l.layer.id);
            if (!entry) continue;
            const el = entry.el;
            out.set(l.layer.id, {
                el,
                consumerId: entry.consumerId,
                w: el.videoWidth || 0,
                h: el.videoHeight || 0,
                ready: el.readyState >= 2 && el.videoWidth > 0,
            });
        }
        return out;
    }, [layers, tick]);
}

export function useImageLayerSources(
    layers: { layer: CompositorLayer; url: string }[],
): Map<string, { el: HTMLImageElement; w: number; h: number; ready: boolean }> {
    const cacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
    const [tick, setTick] = useState(0);
    useEffect(() => {
        const cache = cacheRef.current;
        for (const l of layers) {
            if (cache.has(l.url)) continue;
            const img = new Image();
            img.crossOrigin = 'anonymous';
            const safe = l.url.startsWith('data:')
                ? l.url
                : l.url + (l.url.includes('?') ? '&' : '?') + 'notaint=1';
            img.onload = () => setTick(t => t + 1);
            img.src = safe;
            cache.set(l.url, img);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [layers.map(l => l.url).join('|')]);
    return useMemo(() => {
        const out = new Map<string, { el: HTMLImageElement; w: number; h: number; ready: boolean }>();
        for (const l of layers) {
            const img = cacheRef.current.get(l.url);
            if (!img) continue;
            out.set(l.layer.id, {
                el: img,
                w: img.naturalWidth || 0,
                h: img.naturalHeight || 0,
                ready: img.complete && img.naturalWidth > 0,
            });
        }
        return out;
    }, [layers, tick]);
}

export function useTextLayerSources(
    layers: { layer: CompositorLayer; text: string }[],
): Map<string, { el: HTMLCanvasElement; w: number; h: number; ready: boolean; version: number }> {
    const cacheRef = useRef<Map<string, { canvas: HTMLCanvasElement; key: string; version: number }>>(new Map());
    return useMemo(() => {
        const cache = cacheRef.current;
        const wanted = new Set<string>();
        const out = new Map<string, { el: HTMLCanvasElement; w: number; h: number; ready: boolean; version: number }>();
        for (const l of layers) {
            wanted.add(l.layer.id);
            const t = l.layer.transform;
            const w = Math.max(1, Math.round(t.width || 100));
            const h = Math.max(1, Math.round(t.height || 100));
            const fontSize = t.fontSize || 48;
            const fontWeight = (t as any).fontWeight || 'bold';
            const fontStyle = t.fontStyle || 'normal';
            const fontFamily = t.fontFamily || 'Inter';
            const fillColor = t.fillColor || '#ffffff';
            const align = t.textAlign || 'center';
            const key = `${w}|${h}|${fontSize}|${fontWeight}|${fontStyle}|${fontFamily}|${fillColor}|${align}|${l.text}`;
            let entry = cache.get(l.layer.id);
            if (!entry) {
                entry = { canvas: document.createElement('canvas'), key: '', version: 0 };
                cache.set(l.layer.id, entry);
            }
            if (entry.key !== key) {
                entry.canvas.width = w;
                entry.canvas.height = h;
                const ctx = entry.canvas.getContext('2d');
                if (ctx) {
                    ctx.clearRect(0, 0, w, h);
                    ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
                    ctx.fillStyle = fillColor;
                    ctx.textAlign = align as CanvasTextAlign;
                    ctx.textBaseline = 'middle';
                    const x = align === 'left' ? 0 : align === 'right' ? w : w / 2;
                    ctx.fillText(l.text, x, h / 2);
                }
                entry.key = key;
                entry.version += 1;
            }
            out.set(l.layer.id, { el: entry.canvas, w, h, ready: true, version: entry.version });
        }
        for (const id of Array.from(cache.keys())) if (!wanted.has(id)) cache.delete(id);
        return out;
    }, [layers]);
}

export function useSubgraphLayerSources(
    layers: { layer: CompositorLayer; graph: GraphDescription }[],
    playhead: number,
    isPlaying: boolean,
    poolKey: string,
    muted: boolean,
): Map<string, { el: HTMLCanvasElement; w: number; h: number; ready: boolean; version: number }> {
    interface Entry { canvas: HTMLCanvasElement; cache: GraphRenderCache; version: number; }
    const entriesRef = useRef<Map<string, Entry>>(new Map());
    const [tick, setTick] = useState(0);

    useEffect(() => {
        const entries = entriesRef.current;
        const wanted = new Set(layers.map(l => l.layer.id));
        for (const [id, e] of Array.from(entries.entries())) {
            if (!wanted.has(id)) {
                e.cache.dispose();
                entries.delete(id);
            }
        }
        for (const l of layers) {
            if (entries.has(l.layer.id)) continue;
            entries.set(l.layer.id, {
                canvas: document.createElement('canvas'),
                cache: new GraphRenderCache(`${poolKey}:${l.layer.id}`),
                version: 0,
            });
        }
        setTick(t => t + 1);
        return () => { /* unmount cleanup below */ };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [layers.map(l => l.layer.id).join('|'), poolKey]);

    useEffect(() => () => {
        for (const e of entriesRef.current.values()) e.cache.dispose();
        entriesRef.current.clear();
    }, []);

    useEffect(() => {
        for (const l of layers) {
            const e = entriesRef.current.get(l.layer.id);
            if (!e) continue;
            const dims = graphDimensions(l.graph);
            if (e.canvas.width !== dims.width) e.canvas.width = Math.max(1, dims.width);
            if (e.canvas.height !== dims.height) e.canvas.height = Math.max(1, dims.height);
            const ctx = e.canvas.getContext('2d');
            if (!ctx) continue;
            e.cache.releaseAllScratch();
            paintGraphFrame(l.graph, playhead, ctx, e.cache, isPlaying, muted);
            e.version += 1;
        }
        setTick(t => t + 1);
    }, [layers, playhead, isPlaying, muted]);

    return useMemo(() => {
        const out = new Map<string, { el: HTMLCanvasElement; w: number; h: number; ready: boolean; version: number }>();
        for (const l of layers) {
            const e = entriesRef.current.get(l.layer.id);
            if (!e) continue;
            out.set(l.layer.id, {
                el: e.canvas,
                w: e.canvas.width,
                h: e.canvas.height,
                ready: e.canvas.width > 0 && e.canvas.height > 0,
                version: e.version,
            });
        }
        return out;
    }, [layers, tick]);
}
