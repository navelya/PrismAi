'use client';

import React, { memo, useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { NodeProps, useUpdateNodeInternals } from 'reactflow';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import BaseNode from '@/lib/nodes/core/canvas/BaseNode';
import { useAppStore } from '@/lib/store/app-store';
import { useNodeAutoCompute } from '@/lib/hooks/use-node-auto-compute';
import { detectMediaTypeFromUrl } from '@/lib/workflow/result-format';
import { NodeClientDef } from '../../core/types';
import { GraphDescription, graphDimensions } from '../compositor/shared';
import { compareSharedDef, CompareConfig } from './definition';
import { compareClientExecutor } from './executor.client';
import { ComparePane, ComparePaneItem } from './ui/ComparePane';

interface CompareNodeData {
    label: string;
    config: CompareConfig;
    isNew?: boolean;
}

const defaultConfig: CompareConfig = {
    dividerPosition: 50,
};

const VIDEO_COLOR = 'rgb(139, 92, 246)';
const IMAGE_COLOR = 'rgb(59, 130, 246)';
const NEUTRAL_COLOR = '#f8fafc';

/**
 * Resolve a raw upstream output value (string URL, ImageObject, or full
 * envelope possibly carrying a live `graph`) into a single ComparePaneItem.
 * Mirrors blur's extraction. Returns null when the side has no usable media.
 */
function extractPaneItem(raw: any): ComparePaneItem | null {
    if (raw === undefined || raw === null) return null;
    const candidate = Array.isArray(raw) ? raw[0] : raw;
    if (!candidate) return null;

    let item: any = candidate;
    if (typeof candidate === 'object') {
        const data = (candidate as any).data;
        if (Array.isArray(data) && data.length > 0) item = data[0];
    }

    let url: string | null = null;
    let graph: GraphDescription | null = null;
    let resolution: { width: number; height: number } | null = null;

    if (typeof item === 'string') {
        url = item;
    } else if (item && typeof item === 'object') {
        const u = (item as any).url || (item as any).previewUrl;
        if (typeof u === 'string' && u.length > 0) url = u;
        if ((item as any).graph) graph = (item as any).graph as GraphDescription;
        if ((item as any).resolution) resolution = (item as any).resolution;
    }

    if (!url && !graph) return null;

    if (graph && !resolution) resolution = graphDimensions(graph);

    const kind: 'image' | 'video' | null = graph
        ? 'video'
        : url
            ? (url.startsWith('data:video/')
                ? 'video'
                : url.startsWith('data:image/')
                    ? 'image'
                    : (detectMediaTypeFromUrl(url) as 'image' | 'video' | null) ?? 'image')
            : null;

    return { url, graph, resolution, kind };
}

function CompareNode({ data, id, selected, dragging = false }: NodeProps<CompareNodeData>) {
    const updateNodeConfig = useAppStore((s) => s.updateNodeConfig);
    const updateNodeInternals = useUpdateNodeInternals();
    const isDragging = dragging;

    useNodeAutoCompute(id);

    const config = useMemo(() => ({ ...defaultConfig, ...data.config }), [data.config]);

    // Which upstream node feeds each input handle, plus a saved-data fallback
    // (mirrors blur's selector — bails out via useShallow during canvas drags
    // since currentWorkflow stays stable then).
    const { aSourceId, bSourceId, aFallback, bFallback } = useAppStore(useShallow((state) => {
        const wf = state.currentWorkflow;
        const empty = { aSourceId: null as string | null, bSourceId: null as string | null, aFallback: null as any, bFallback: null as any };
        if (!wf) return empty;
        const pick = (handle: string) => {
            const edge = wf.edges.find((e) => e.target === id && e.targetHandle === handle);
            if (!edge) return { sourceId: null as string | null, fallback: null as any };
            const node = wf.nodes.find((n) => n.id === edge.source);
            const fallback = node?.data
                ? (node.data.output ?? (node.data.config as any)?.images ?? (node.data.config as any)?.last_output ?? null)
                : null;
            return { sourceId: edge.source, fallback };
        };
        const a = pick('input_a');
        const b = pick('input_b');
        return { aSourceId: a.sourceId, bSourceId: b.sourceId, aFallback: a.fallback, bFallback: b.fallback };
    }));

    const aLive = useAppStore((state) => (aSourceId ? state.nodeOutputs[aSourceId] : undefined));
    const bLive = useAppStore((state) => (bSourceId ? state.nodeOutputs[bSourceId] : undefined));

    const itemA = useMemo<ComparePaneItem | null>(
        () => (aSourceId ? extractPaneItem(aLive ?? aFallback ?? null) : null),
        [aSourceId, aLive, aFallback],
    );
    const itemB = useMemo<ComparePaneItem | null>(
        () => (bSourceId ? extractPaneItem(bLive ?? bFallback ?? null) : null),
        [bSourceId, bLive, bFallback],
    );

    const kindA = itemA?.kind ?? null;
    const kindB = itemB?.kind ?? null;

    const colorFor = (k: 'image' | 'video' | null) =>
        k === 'video' ? VIDEO_COLOR : k === 'image' ? IMAGE_COLOR : NEUTRAL_COLOR;

    const customInputs = useMemo(() => [
        { id: 'input_a', label: 'A', color: colorFor(kindA), type: kindA ?? ['image', 'video'] },
        { id: 'input_b', label: 'B', color: colorFor(kindB), type: kindB ?? ['image', 'video'] },
    ], [kindA, kindB]);

    const customOutputs = useMemo(() => [
        { id: 'output_a', label: 'A', color: colorFor(kindA), type: kindA ?? ['image', 'video'] },
        { id: 'output_b', label: 'B', color: colorFor(kindB), type: kindB ?? ['image', 'video'] },
    ], [kindA, kindB]);

    // Re-measure handles when their shape/color changes so wires stay aligned.
    useEffect(() => {
        updateNodeInternals(id);
    }, [id, kindA, kindB, updateNodeInternals]);

    // Prune outgoing edges per output handle when its narrowed kind changes.
    useEffect(() => {
        if (!kindA) return;
        useAppStore.getState().pruneIncompatibleOutgoingEdges(id, kindA, 'output_a');
    }, [id, kindA]);
    useEffect(() => {
        if (!kindB) return;
        useAppStore.getState().pruneIncompatibleOutgoingEdges(id, kindB, 'output_b');
    }, [id, kindB]);

    // The node sizes to the FIRST input (A if wired, else B). Seed the aspect
    // from the primary side's published resolution and refine via onNativeSize.
    const primaryItem = itemA ?? itemB;
    const [nativeSize, setNativeSize] = useState({ width: 0, height: 0 });
    useEffect(() => {
        if (primaryItem?.resolution?.width) {
            setNativeSize({ width: primaryItem.resolution.width, height: primaryItem.resolution.height || 0 });
        }
    }, [primaryItem?.resolution?.width, primaryItem?.resolution?.height]);
    const onPrimaryNativeSize = useCallback((w: number, h: number) => {
        if (w > 0) setNativeSize({ width: w, height: h });
    }, []);

    const aspectRatio = useMemo(() => {
        const w = nativeSize.width || 16;
        const h = nativeSize.height || 9;
        return `${w} / ${h}`;
    }, [nativeSize]);

    // Divider position — committed to config on release for persistence; tracked
    // locally during drag for instant feedback without global churn.
    const [localDivider, setLocalDivider] = useState(config.dividerPosition);
    useEffect(() => { setLocalDivider(config.dividerPosition); }, [config.dividerPosition]);

    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const draggingDividerRef = useRef(false);

    const setDividerFromClientX = useCallback((clientX: number) => {
        const el = wrapperRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0) return;
        const pct = ((clientX - rect.left) / rect.width) * 100;
        setLocalDivider(Math.max(0, Math.min(100, pct)));
    }, []);

    const handleDividerPointerDown = useCallback((e: React.PointerEvent) => {
        e.stopPropagation();
        e.preventDefault();
        useAppStore.getState().takeSnapshot();
        draggingDividerRef.current = true;

        const onMove = (ev: PointerEvent) => {
            if (!draggingDividerRef.current) return;
            setDividerFromClientX(ev.clientX);
        };
        const onUp = (ev: PointerEvent) => {
            if (!draggingDividerRef.current) return;
            draggingDividerRef.current = false;
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            const el = wrapperRef.current;
            if (el) {
                const rect = el.getBoundingClientRect();
                if (rect.width > 0) {
                    const pct = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
                    updateNodeConfig(id, { ...config, dividerPosition: pct });
                }
            }
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }, [config, id, setDividerFromClientX, updateNodeConfig]);

    // Hover-to-play both sides (panes ignore it for images).
    const [hovering, setHovering] = useState(false);

    const hasAnyMedia = !!(itemA || itemB);
    const showDivider = hasAnyMedia;

    return (
        <BaseNode
            id={id}
            type="compare"
            label={data.label}
            selected={selected}
            dragging={dragging}
            nodeData={data}
            customInputs={customInputs}
            customOutputs={customOutputs}
            isNew={data.isNew}
            hideStatus={true}
            width=""
            style={{ width: 'max-content', minWidth: 280, maxWidth: 360 }}
        >
            <div
                ref={wrapperRef}
                className={cn(
                    'relative w-full rounded-xl overflow-hidden shadow-inner group/node border border-white/10 bg-white/5',
                    !isDragging && 'transition-all duration-500',
                )}
                style={{ aspectRatio, maxHeight: 460 }}
                onMouseEnter={() => setHovering(true)}
                onMouseLeave={() => setHovering(false)}
            >
                <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none z-20" />

                {hasAnyMedia ? (
                    <>
                        {/* Side A — clipped to the LEFT of the divider. */}
                        <div
                            className="absolute inset-0 z-0"
                            style={{ clipPath: `inset(0 ${100 - localDivider}% 0 0)` }}
                        >
                            {itemA ? (
                                <ComparePane
                                    item={itemA}
                                    playing={hovering}
                                    poolKey={`${id}_a`}
                                    dragging={isDragging}
                                    onNativeSize={itemA ? onPrimaryNativeSize : undefined}
                                />
                            ) : (
                                <div className="absolute inset-0 bg-black/30" />
                            )}
                        </div>

                        {/* Side B — clipped to the RIGHT of the divider. */}
                        <div
                            className="absolute inset-0 z-10"
                            style={{ clipPath: `inset(0 0 0 ${localDivider}%)` }}
                        >
                            {itemB ? (
                                <ComparePane
                                    item={itemB}
                                    playing={hovering}
                                    poolKey={`${id}_b`}
                                    dragging={isDragging}
                                    onNativeSize={!itemA ? onPrimaryNativeSize : undefined}
                                />
                            ) : (
                                <div className="absolute inset-0 bg-black/30" />
                            )}
                        </div>

                        {/* Draggable divider. */}
                        {showDivider && (
                            <div
                                className="nodrag absolute top-0 bottom-0 z-30 flex items-center justify-center cursor-ew-resize"
                                style={{ left: `${localDivider}%`, width: 24, transform: 'translateX(-50%)' }}
                                onPointerDown={handleDividerPointerDown}
                            >
                                <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-[2px] bg-white/80 shadow-[0_0_8px_rgba(0,0,0,0.6)]" />
                                <div className="relative w-6 h-6 rounded-full bg-white/90 shadow-lg flex items-center justify-center text-black/70">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="15 18 9 12 15 6" />
                                        <polyline points="9 18 3 12 9 6" transform="translate(12 0)" />
                                    </svg>
                                </div>
                            </div>
                        )}

                        {/* Corner labels. */}
                        <div className="absolute top-2 left-2 z-30 px-1.5 py-0.5 rounded-md bg-black/50 text-[9px] font-bold uppercase tracking-wider text-white/80 pointer-events-none">A</div>
                        <div className="absolute top-2 right-2 z-30 px-1.5 py-0.5 rounded-md bg-black/50 text-[9px] font-bold uppercase tracking-wider text-white/80 pointer-events-none">B</div>
                    </>
                ) : (
                    <div className="absolute inset-0 flex items-center justify-center opacity-30 group-hover/node:opacity-50 transition-opacity">
                        <div className="text-xs font-medium px-4 text-center">Connect two images or videos to compare</div>
                    </div>
                )}
            </div>
        </BaseNode>
    );
}

export default memo(CompareNode);

export const compareClientDef: NodeClientDef = {
    ...compareSharedDef,
    component: memo((props: any) => <CompareNode {...props} type="compare" />),
    clientExecutor: compareClientExecutor,
};
