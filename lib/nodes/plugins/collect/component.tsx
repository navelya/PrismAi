'use client';

import React, { memo, useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { NodeProps, useUpdateNodeInternals } from 'reactflow';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store/app-store';
import BaseNode from '@/lib/nodes/core/canvas/BaseNode';
import BlurryImage from '@/components/ui/BlurryImage';
import BlurryVideo from '@/components/ui/BlurryVideo';
import ImageLightbox from '@/components/ui/ImageLightbox';
import { Switch } from '@/components/ui/Switch';
import { useNodeAutoCompute } from '@/lib/hooks/use-node-auto-compute';
import { useGridViewHeightLock } from '@/lib/hooks/use-grid-view-height-lock';
import { detectMediaTypeFromUrl, NodeResultType } from '@/lib/workflow/result-format';
import { LayoutGrid, Square, Check, Play, Combine, FileText, Music, Box } from 'lucide-react';
import { NodeClientDef, NodeDataType } from '../../core/types';
import { collectSharedDef, CollectConfig } from './definition';
import { collectClientExecutor } from './executor.client';

interface CollectNodeData {
    label: string;
    config: CollectConfig;
}

// Wire-dot colors per data type — keeps the handle visually communicating the
// locked type, matching the palette other nodes use.
const TYPE_COLORS: Record<string, string> = {
    image: 'rgb(59, 130, 246)',
    image_array: 'rgb(59, 130, 246)',
    video: 'rgb(139, 92, 246)',
    audio: 'rgb(34, 197, 94)',
    text: 'rgb(245, 158, 11)',
    prompt: 'rgb(245, 158, 11)',
    json: 'rgb(148, 163, 184)',
    '3d': 'rgb(236, 72, 153)',
    any: '#f8fafc',
};

function firstType(t: NodeDataType | NodeDataType[] | undefined): string {
    if (!t) return 'any';
    return Array.isArray(t) ? (t[0] || 'any') : t;
}

function typeLabel(t: NodeDataType | NodeDataType[] | undefined): string {
    const v = firstType(t);
    if (v === 'any') return 'Items';
    if (v === 'image_array') return 'Images';
    if (v === '3d') return '3D';
    return v.charAt(0).toUpperCase() + v.slice(1);
}

function getItemUrl(item: any): string | null {
    if (!item) return null;
    if (typeof item === 'string') return item;
    if (typeof item === 'object') {
        if (typeof item.url === 'string') return item.url;
        if (typeof item.previewUrl === 'string') return item.previewUrl;
    }
    return null;
}

function getItemKind(item: any, locked: string): NodeResultType {
    const url = getItemUrl(item);
    if (url) {
        if (url.startsWith('data:video/')) return 'video';
        if (url.startsWith('data:image/')) return 'image';
        if (url.startsWith('data:audio/')) return 'audio';
        const d = detectMediaTypeFromUrl(url);
        if (d) return d;
    }
    if (locked === 'image' || locked === 'video' || locked === 'audio' || locked === '3d') {
        return locked as NodeResultType;
    }
    if (typeof item === 'string') return 'text';
    if (url) return 'image';
    return 'json';
}

function getItemText(item: any): string {
    if (item == null) return '';
    if (typeof item === 'string') return item;
    if (typeof item === 'object') {
        if (typeof item.text === 'string') return item.text;
        try {
            return JSON.stringify(item);
        } catch {
            return String(item);
        }
    }
    return String(item);
}

function CollectNode({ data, id, selected, dragging = false }: NodeProps<CollectNodeData>) {
    const updateNodeConfig = useAppStore((state) => state.updateNodeConfig);
    const updateNodeInternals = useUpdateNodeInternals();

    const [previewMode, setPreviewMode] = useState<'single' | 'grid'>('single');
    const [activeIndex, setActiveIndex] = useState(0);
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);
    // Freeze the preview height when switching to grid so the node doesn't
    // resize on view toggle (parity with media_input).
    const { ref: previewRef, lockStyle: previewLockStyle } = useGridViewHeightLock(previewMode);

    const config = useMemo<CollectConfig>(
        () => ({ takeOnlyActive: false, ...((data.config as Partial<CollectConfig>) || {}) }),
        [data.config],
    );
    const lockedType = config.lockedType;
    const locked = firstType(lockedType);

    // Drive live preview: collects the upstream values into nodeOutputs[id].
    useNodeAutoCompute(id);

    // Whether anything is wired in (so the empty state is accurate even before
    // the executor produces an envelope).
    const hasInputs = useAppStore(
        useShallow((state) => {
            const wf = state.currentWorkflow;
            if (!wf) return false;
            return wf.edges.some((e) => e.target === id && (e.targetHandle === 'values' || !e.targetHandle));
        }),
    );

    // The collected output envelope this node produced.
    const liveOutput = useAppStore((state) => state.nodeOutputs[id]);
    const items = useMemo<any[]>(() => {
        const env = liveOutput;
        if (!env) return [];
        if (Array.isArray(env)) return env;
        if (env && typeof env === 'object' && Array.isArray((env as any).data)) return (env as any).data;
        return [];
    }, [liveOutput]);

    // Keep the active index in range as the collection changes.
    useEffect(() => {
        if (activeIndex > items.length - 1) setActiveIndex(items.length > 0 ? items.length - 1 : 0);
    }, [items.length, activeIndex]);

    const handleToggleActive = useCallback(
        (checked: boolean) => {
            updateNodeConfig(id, { ...data.config, takeOnlyActive: checked });
        },
        [id, data.config, updateNodeConfig],
    );

    // Dynamic, type-locked handles (color + label reflect the locked type).
    const handleColor = TYPE_COLORS[locked] ?? TYPE_COLORS.any;
    const customInputs = useMemo(
        () => [{ id: 'values', label: typeLabel(lockedType), color: handleColor, type: lockedType ?? 'any' }],
        [lockedType, handleColor],
    );
    const customOutputs = useMemo(
        () => [{ id: 'output', label: 'Array', color: handleColor, type: lockedType ?? 'any' }],
        [lockedType, handleColor],
    );

    // Re-measure handles + prune now-incompatible downstream edges when the
    // locked type changes (e.g. all inputs cleared then a different type wired).
    useEffect(() => {
        updateNodeInternals(id);
    }, [id, locked, updateNodeInternals]);
    useEffect(() => {
        if (!lockedType || locked === 'any') return;
        useAppStore.getState().pruneIncompatibleOutgoingEdges(id, locked);
    }, [id, locked, lockedType]);

    const activeItem = items[activeIndex];
    const activeUrl = getItemUrl(activeItem);
    const activeKind = activeItem != null ? getItemKind(activeItem, locked) : null;
    const mediaUrls = useMemo(() => items.map(getItemUrl).filter((u): u is string => !!u), [items]);

    const renderTile = (item: any, mode: 'single' | 'grid') => {
        const url = getItemUrl(item);
        const kind = getItemKind(item, locked);
        const fit = mode === 'grid' ? 'object-cover' : 'object-contain';

        if (kind === 'image' && url) {
            return <BlurryImage src={url} alt="" className={cn('w-full h-full max-w-none max-h-none', fit)} />;
        }
        if (kind === 'video' && url) {
            return (
                <BlurryVideo
                    ref={mode === 'single' ? videoRef : undefined}
                    src={url}
                    className={cn('w-full h-full max-w-none max-h-none', fit)}
                    muted
                    loop
                    playsInline
                />
            );
        }
        if (kind === 'audio') {
            return (
                <div className="w-full h-full flex flex-col items-center justify-center gap-2 p-2 text-content-tertiary">
                    <Music className="w-5 h-5" />
                    {mode === 'single' && url && (
                        <audio src={url} controls className="w-full nodrag" />
                    )}
                </div>
            );
        }
        if (kind === 'text') {
            const text = getItemText(item);
            return (
                <div className={cn('w-full h-full p-2 text-[10px] leading-snug text-content-secondary overflow-hidden', mode === 'single' ? 'whitespace-pre-wrap overflow-y-auto custom-scrollbar' : 'line-clamp-4')}>
                    {text || 'Empty'}
                </div>
            );
        }
        // 3d / json / unknown
        return (
            <div className="w-full h-full flex flex-col items-center justify-center gap-1 p-2 text-content-tertiary">
                {kind === '3d' ? <Box className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
                <span className="text-[9px] truncate max-w-full">{url ? url.split('/').pop() : kind}</span>
            </div>
        );
    };

    const showMediaLightbox = lightboxOpen && mediaUrls.length > 0 && (activeKind === 'image' || activeKind === 'video');

    return (
        <BaseNode
            id={id}
            type="collect"
            label={data.label}
            selected={selected}
            dragging={dragging}
            nodeData={data}
            customInputs={customInputs}
            customOutputs={customOutputs}
            isNew={(data as any).isNew}
            hideStatus={true}
            resizable
            minWidth={240}
            width=""
            style={{ width: 320 }}
        >
            <div
                ref={previewRef}
                style={previewLockStyle}
                className="relative w-full h-full min-h-[160px] rounded-xl overflow-hidden border border-white/10 bg-white/5 group/node"
            >
                {/* Locked-type + count chip */}
                {(lockedType || items.length > 0) && (
                    <div className="absolute top-2 left-2 z-20 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/55 backdrop-blur-md border border-white/10 text-[9px] font-bold uppercase tracking-wider text-white/80 pointer-events-none">
                        <Combine className="w-3 h-3" style={{ color: handleColor }} />
                        <span>{typeLabel(lockedType)}</span>
                        <span className="text-white/40">·</span>
                        <span>{items.length}</span>
                    </div>
                )}

                {items.length === 0 ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-content-tertiary">
                        <div className="w-10 h-10 rounded-full bg-surface-primary flex items-center justify-center shadow-sm">
                            <Combine className="w-5 h-5" />
                        </div>
                        <span className="text-xs font-medium">
                            {hasInputs ? 'Waiting for inputs…' : 'Connect inputs to collect into an array'}
                        </span>
                    </div>
                ) : previewMode === 'single' ? (
                    <div
                        className="w-full h-full group/preview relative cursor-zoom-in flex items-center justify-center"
                        onMouseEnter={() => videoRef.current?.play().catch(() => {})}
                        onMouseLeave={() => {
                            if (videoRef.current) {
                                videoRef.current.pause();
                                videoRef.current.currentTime = 0;
                            }
                        }}
                        onClick={() => {
                            if (activeKind === 'image' || activeKind === 'video') setLightboxOpen(true);
                        }}
                    >
                        {renderTile(activeItem, 'single')}
                        {activeKind === 'video' && getItemUrl(activeItem) && (
                            <div className="absolute inset-0 bg-black/20 opacity-0 group-hover/preview:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                                <Play className="w-10 h-10 text-white fill-current" />
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="w-full h-full p-2 pt-7 overflow-y-auto custom-scrollbar">
                        <div className="grid grid-cols-3 gap-1.5">
                            {items.map((item, index) => (
                                <button
                                    key={index}
                                    type="button"
                                    onClick={() => setActiveIndex(index)}
                                    className={cn(
                                        'relative aspect-square rounded overflow-hidden border transition-all',
                                        activeIndex === index
                                            ? 'border-accent-primary ring-2 ring-accent-primary/20'
                                            : 'border-white/5 hover:border-white/20',
                                    )}
                                >
                                    {renderTile(item, 'grid')}
                                    {activeIndex === index && (
                                        <div className="absolute inset-0 bg-accent-primary/20 flex items-center justify-center pointer-events-none">
                                            <Check className="w-3 h-3 text-white" />
                                        </div>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* View toggle (matches media_input) */}
                {items.length > 1 && (
                    <div className="absolute bottom-2 right-2 flex bg-black/60 backdrop-blur-md rounded-lg p-0.5 border border-white/10 z-20 shadow-xl opacity-0 group-hover/node:opacity-100 transition-opacity">
                        <button
                            type="button"
                            onClick={() => setPreviewMode('single')}
                            className={cn('p-1.5 rounded-md', previewMode === 'single' ? 'bg-accent-primary text-white' : 'text-white/40')}
                        >
                            <Square className="w-3.5 h-3.5" />
                        </button>
                        <button
                            type="button"
                            onClick={() => setPreviewMode('grid')}
                            className={cn('p-1.5 rounded-md', previewMode === 'grid' ? 'bg-accent-primary text-white' : 'text-white/40')}
                        >
                            <LayoutGrid className="w-3.5 h-3.5" />
                        </button>
                    </div>
                )}
            </div>

            {/* "Take only active" switch */}
            <div className="mt-2 px-1 pb-1 flex items-center justify-between gap-2">
                <Switch
                    size="sm"
                    checked={!!config.takeOnlyActive}
                    onCheckedChange={handleToggleActive}
                    label="Active only"
                />
                <span className="text-[9px] text-content-tertiary text-right leading-tight max-w-[150px]">
                    {config.takeOnlyActive ? 'One item per input' : 'Flatten all items'}
                </span>
            </div>

            {showMediaLightbox && (
                <ImageLightbox
                    media={mediaUrls}
                    type="any"
                    initialIndex={Math.min(activeIndex, mediaUrls.length - 1)}
                    onClose={() => setLightboxOpen(false)}
                />
            )}
        </BaseNode>
    );
}

export default memo(CollectNode);

export const collectClientDef: NodeClientDef = {
    ...collectSharedDef,
    component: memo((props: any) => <CollectNode {...props} type="collect" />),
    clientExecutor: collectClientExecutor,
};
