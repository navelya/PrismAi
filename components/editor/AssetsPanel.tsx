'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Image as ImageIcon, Sparkles, RefreshCw, X, Filter, Play, Upload } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import ImageLightbox from '@/components/ui/ImageLightbox';
import { PillTabs } from '@/components/ui/PillTabs';
import { Skeleton } from '@/components/ui/Skeleton';
import { clientRegistry } from '@/lib/nodes/core/client-registry';
import { useAppStore } from '@/lib/store/app-store';
import { AssetTypeFilter } from '@/components/assets/AssetTypeFilter';
import { unpackAssets, unpackUploads, type AssetItem, type TypeFilter, type UploadRow } from '@/lib/assets/unpack';
import { toThumbnailUrl, bakedThumbUrl } from '@/lib/utils/supabase-image';

type AssetScope = 'current' | 'all' | 'uploads';

interface AssetsPanelProps {
    sessionId?: string | null;
    onClose: () => void;
}

export function AssetsPanel({ sessionId, onClose }: AssetsPanelProps) {
    const [assets, setAssets] = useState<AssetItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [scope, setScope] = useState<AssetScope>('current');
    const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
    const supabase = React.useMemo(() => createClient(), []);

    // Set of node_ids that are ephemeral in the active workflow. Ephemeral nodes
    // (blur, levels, compositor, ...) write to node_results during a run so the
    // orchestrator can dispatch downstream nodes, but their outputs are
    // intermediate transforms — they shouldn't show up here. Cleanup in
    // `updateExecutionFinalStatus` removes the rows once the run finalizes;
    // this lookup hides them in the live window before that happens.
    const workflowNodes = useAppStore((state) => state.currentWorkflow?.nodes);
    const ephemeralNodeIds = React.useMemo(() => {
        if (!workflowNodes) return null;
        const ids = new Set<string>();
        for (const node of workflowNodes) {
            if (clientRegistry[node.type]?.meta?.ephemeral === true) {
                ids.add(node.id);
            }
        }
        return ids;
    }, [workflowNodes]);

    const fetchAssets = useCallback(async () => {
        if (scope === 'current' && !sessionId) {
            setIsLoading(false);
            setAssets([]);
            return;
        }

        // Uploads come from the `uploads` index (user file-uploads), not
        // node_results. RLS scopes to the current user; newest first.
        if (scope === 'uploads') {
            setIsLoading(true);
            const { data, error } = await supabase
                .from('uploads')
                .select('id, url, storage_path, media_type, created_at')
                .order('created_at', { ascending: false })
                .limit(200);
            if (!error && data) setAssets(unpackUploads(data as UploadRow[]));
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        let query = supabase
            .from('node_results')
            .select('id, node_id, result_type, result_data, created_at, execution_id, session_id')
            .eq('status', 'completed')
            .in('result_type', ['image', 'video', 'audio', '3d'])
            // Hide `character` rows (reference images re-published for downstream
            // generators, not deliverable assets). NULL-safe so untagged/legacy
            // rows still show. See migration 20260524_node_results_node_type.
            .or('node_type.is.null,node_type.neq.character')
            .order('created_at', { ascending: false });

        if (scope === 'current' && sessionId) {
            query = query.eq('session_id', sessionId);
        } else {
            // 'all' scope: rely on RLS to scope to the current user's sessions.
            query = query.limit(200);
        }

        const { data, error } = await query;

        if (!error && data) {
            const validAssets = unpackAssets(data);
            setAssets(validAssets);
        }
        setIsLoading(false);
    }, [sessionId, supabase, scope]);

    useEffect(() => {
        fetchAssets();
    }, [fetchAssets]);

    // Real-time: new results pop in as executions finish (only when viewing the current session)
    useEffect(() => {
        if (scope !== 'current' || !sessionId) return;

        const channel = supabase
            .channel(`assets-panel-${sessionId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'node_results',
                    filter: `session_id=eq.${sessionId}`,
                },
                (payload: any) => {
                    const row = payload.new;
                    // Mirror the fetch query's character exclusion for live inserts.
                    if (row?.node_type === 'character') return;
                    if (row?.status === 'completed' && ['image', 'video', 'audio', '3d'].includes(row?.result_type)) {
                        const nextItems = unpackAssets([row]);
                        if (nextItems.length === 0) return;

                        setAssets((prev) => {
                            const existingUrls = new Set(prev.map((a) => a.result_url));
                            const incoming = nextItems.filter((item) => !existingUrls.has(item.result_url));
                            if (incoming.length === 0) return prev;
                            return [...incoming, ...prev];
                        });
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [sessionId, supabase, scope]);

    const handleDragStart = (e: React.DragEvent, asset: AssetItem) => {
        const payload = JSON.stringify({
            type: 'media_input',
            // initialConfig is merged over the node factory defaults.
            // media_input.config.images is an array; we seed it with the asset URL.
            initialConfig: { images: [asset.result_url] },
        });
        e.dataTransfer.setData('application/reactflow', payload);
        e.dataTransfer.effectAllowed = 'copy';
    };


    const visibleAssets = React.useMemo(() => {
        let list = assets;
        if (ephemeralNodeIds && ephemeralNodeIds.size > 0) {
            list = list.filter((a) => !ephemeralNodeIds.has(a.node_id));
        }
        if (typeFilter !== 'all') {
            list = list.filter((a) => a.result_type === typeFilter);
        }
        return list;
    }, [assets, typeFilter, ephemeralNodeIds]);

    return (
        <div className="relative w-full h-full bg-surface-elevated/80 backdrop-blur-md border border-stroke-subtle rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            {/* Compact header */}
            <div className="flex items-center justify-between gap-2 px-2 py-2 border-b border-stroke-subtle/60">
                <PillTabs<AssetScope>
                    items={[
                        { value: 'current', label: 'Last runs', icon: RefreshCw },
                        { value: 'all', label: 'All assets', icon: ImageIcon },
                        { value: 'uploads', label: 'Uploads', icon: Upload },
                    ]}
                    value={scope}
                    onChange={setScope}
                />

                <div className="flex items-center gap-0.5">
                    <AssetTypeFilter
                        typeFilter={typeFilter}
                        onChange={setTypeFilter}
                    />
                    <button
                        onClick={fetchAssets}
                        className="p-1 hover:bg-white/10 rounded-md transition-colors group"
                        title="Refresh assets"
                    >
                        <RefreshCw className="w-3.5 h-3.5 text-content-tertiary group-hover:text-content-primary transition-colors" />
                    </button>
                    <button
                        onClick={onClose}
                        className="p-1 hover:bg-white/10 rounded-md transition-colors group"
                        title="Close"
                    >
                        <X className="w-3.5 h-3.5 text-content-tertiary group-hover:text-content-primary" />
                    </button>
                </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto">
                {isLoading ? (
                    <div className="p-3">
                        <div className="grid grid-cols-2 gap-2">
                            {Array.from({ length: 6 }).map((_, i) => (
                                <Skeleton
                                    key={i}
                                    className="aspect-square rounded-xl border border-stroke-subtle"
                                />
                            ))}
                        </div>
                    </div>
                ) : visibleAssets.length === 0 ? (
                    <EmptyState filtered={assets.length > 0 && visibleAssets.length === 0} />
                ) : (
                    <div className="p-3">
                        <div className="grid grid-cols-2 gap-2">
                            <AnimatePresence initial={false}>
                                {visibleAssets.map((asset, i) => (
                                    <AssetCard
                                        key={asset.id}
                                        asset={asset}
                                        index={i}
                                        onDragStart={handleDragStart}
                                    />
                                ))}
                            </AnimatePresence>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function AssetCard({
    asset,
    index,
    onDragStart,
}: {
    asset: AssetItem;
    index: number;
    onDragStart: (e: React.DragEvent, asset: AssetItem) => void;
}) {
    const [loaded, setLoaded] = useState(false);
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const videoRef = React.useRef<HTMLVideoElement | null>(null);

    const mediaType = asset.result_type === 'audio' ? 'any' : (asset.result_type === '3d' ? 'any' : asset.result_type);
    const showSkeleton = !loaded && (asset.result_type === 'image' || asset.result_type === 'video');

    const handleMouseEnter = () => {
        if (asset.result_type !== 'video') return;
        const v = videoRef.current;
        if (!v) return;
        v.currentTime = 0;
        const result = v.play();
        if (result && typeof result.catch === 'function') result.catch(() => {});
    };

    const handleMouseLeave = () => {
        if (asset.result_type !== 'video') return;
        const v = videoRef.current;
        if (!v) return;
        v.pause();
        v.currentTime = 0;
    };

    return (
        <>
            <motion.div
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.2, delay: index * 0.03 }}
                draggable
                onDragStart={(e) => onDragStart(e as unknown as React.DragEvent, asset)}
                onClick={() => setLightboxOpen(true)}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                className="relative aspect-square rounded-xl overflow-hidden border border-stroke-subtle bg-surface-primary cursor-pointer group hover:border-accent-primary/50 transition-all duration-200 shadow-sm hover:shadow-lg"
                title="Click to preview · Drag to canvas"
            >
                {showSkeleton && (
                    <div className="absolute inset-0 bg-surface-secondary animate-pulse" />
                )}

                {asset.result_type === 'video' ? (
                    <>
                        <video
                            ref={videoRef}
                            src={asset.result_url}
                            className="w-full h-full object-cover"
                            // preload="auto" + onLoadedMetadata reveal: with
                            // preload="metadata" + onLoadedData, the card stays
                            // invisible forever for any mp4 whose moov atom is
                            // at the END of the file (Replicate outputs aren't
                            // muxed with +faststart). The browser stops after
                            // the head, never finds the index, and neither
                            // event fires. preload="auto" keeps fetching until
                            // the index is found; onLoadedMetadata fires as
                            // soon as it does. We also drop the opacity gate
                            // entirely so the user at least sees a black tile
                            // (with the Play badge overlay below) while bytes
                            // are still arriving — never a phantom blank card.
                            onLoadedMetadata={() => setLoaded(true)}
                            muted
                            loop
                            playsInline
                            preload="auto"
                        />
                        <div className="absolute top-1.5 left-1.5 z-[1] flex items-center justify-center w-5 h-5 rounded-full bg-black/60 backdrop-blur-sm border border-white/15 shadow-sm pointer-events-none">
                            <Play className="w-2.5 h-2.5 text-white fill-white" />
                        </div>
                    </>
                ) : asset.result_type === 'audio' ? (
                    <div className="w-full h-full flex flex-col items-center justify-center bg-black/40 text-white/80 p-2">
                        <span className="text-[9px] font-semibold uppercase tracking-wider mb-2">Audio</span>
                        <audio src={asset.result_url} controls className="w-full" onLoadedData={() => setLoaded(true)} />
                    </div>
                ) : asset.result_type === '3d' ? (
                    <div className="w-full h-full flex items-center justify-center bg-black/40 text-white/80 p-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wider">3D Model</span>
                    </div>
                ) : (
                    <img
                        // Preview only — the drag payload (onDragStart) still
                        // carries the full-resolution asset, so what lands on
                        // the canvas is unaffected.
                        src={toThumbnailUrl(asset.result_url, { width: 512 }) ?? asset.result_url}
                        alt="Generated asset"
                        className={`w-full h-full object-cover transition-all duration-500 ${loaded ? 'opacity-100 blur-0' : 'opacity-0 blur-sm'}`}
                        onLoad={() => setLoaded(true)}
                        onError={(e) => {
                            const img = e.currentTarget;
                            if (!img.dataset.fellBack && img.src !== asset.result_url) {
                                img.dataset.fellBack = '1';
                                img.src = asset.result_url;
                            }
                        }}
                    />
                )}

                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all duration-200 flex items-center justify-center">
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-black/60 rounded-lg px-2 py-1">
                        <span className="text-[9px] font-bold text-white uppercase tracking-wider">View / Drag</span>
                    </div>
                </div>
            </motion.div>

            {lightboxOpen && (
                <ImageLightbox
                    media={asset.result_url}
                    type={mediaType as any}
                    initialIndex={0}
                    onClose={() => setLightboxOpen(false)}
                />
            )}
        </>
    );
}

function EmptyState({ filtered = false }: { filtered?: boolean }) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center h-full gap-5 p-8 text-center"
        >
            <div className="relative w-16 h-16">
                <div className="absolute inset-0 rounded-2xl bg-accent-primary/5 border border-accent-primary/10" />
                <div className="absolute inset-0 flex items-center justify-center">
                    {filtered ? (
                        <Filter className="w-7 h-7 text-content-tertiary/50" />
                    ) : (
                        <ImageIcon className="w-7 h-7 text-content-tertiary/50" />
                    )}
                </div>
                <div className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-surface-elevated border border-stroke-subtle flex items-center justify-center">
                    <Sparkles className="w-2.5 h-2.5 text-accent-primary/60" />
                </div>
            </div>

            <div className="space-y-2">
                <p className="text-sm font-semibold text-content-secondary">
                    {filtered ? 'No matches' : 'Nothing here yet'}
                </p>
                <p className="text-xs text-content-tertiary leading-relaxed max-w-[180px]">
                    {filtered
                        ? 'No assets match the current filter. Try enabling more types.'
                        : 'Run your workflow and every output will land here — ready to drag right back onto the canvas.'}
                </p>
            </div>
        </motion.div>
    );
}
