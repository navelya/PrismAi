'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Image as ImageIcon, Sparkles, RefreshCw, Filter, Play } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import ImageLightbox from '@/components/ui/ImageLightbox';
import { Skeleton } from '@/components/ui/Skeleton';
import { AssetTypeFilter } from '@/components/assets/AssetTypeFilter';
import { unpackAssets, type AssetItem, type TypeFilter } from '@/lib/assets/unpack';

/**
 * Full-page browse view of every result the user has generated, across all
 * sessions. Mirrors the in-workflow AssetsPanel's "all" scope query and type
 * filter, but renders a wide responsive grid and is preview-only (no
 * drag-to-canvas — there is no canvas on this page).
 */
export default function AssetsGallery() {
    const [assets, setAssets] = useState<AssetItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
    const supabase = React.useMemo(() => createClient(), []);

    const fetchAssets = useCallback(async () => {
        setIsLoading(true);
        // No session filter — RLS scopes node_results to the current user's
        // sessions, so this returns the user's results across every session.
        //
        // Exclude `character` rows: a character node re-publishes its reference
        // images into node_results so downstream generators can read them, but
        // those are inputs, not deliverable assets. The `.or` keeps NULL-typed
        // rows visible (rows predating the node_type column / not yet backfilled)
        // so nothing legitimate disappears — only confirmed character rows hide.
        const { data, error } = await supabase
            .from('node_results')
            .select('id, node_id, result_type, result_data, created_at, execution_id, session_id')
            .eq('status', 'completed')
            .in('result_type', ['image', 'video', 'audio', '3d'])
            .or('node_type.is.null,node_type.neq.character')
            .order('created_at', { ascending: false })
            .limit(200);

        if (!error && data) {
            setAssets(unpackAssets(data));
        }
        setIsLoading(false);
    }, [supabase]);

    useEffect(() => {
        fetchAssets();
    }, [fetchAssets]);

    const visibleAssets = React.useMemo(() => {
        if (typeFilter === 'all') return assets;
        return assets.filter((a) => a.result_type === typeFilter);
    }, [assets, typeFilter]);

    return (
        <div className="space-y-5">
            <div className="flex items-center justify-between">
                <p className="text-sm text-content-tertiary">
                    {isLoading ? 'Loading…' : `${visibleAssets.length} ${visibleAssets.length === 1 ? 'result' : 'results'}`}
                </p>
                <div className="flex items-center gap-1">
                    <AssetTypeFilter typeFilter={typeFilter} onChange={setTypeFilter} />
                    <button
                        onClick={fetchAssets}
                        className="p-2 rounded-lg hover:bg-interactive-hover transition-colors group"
                        title="Refresh"
                    >
                        <RefreshCw className="w-4 h-4 text-content-tertiary group-hover:text-content-primary transition-colors" />
                    </button>
                </div>
            </div>

            {isLoading ? (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
                    {Array.from({ length: 8 }).map((_, i) => (
                        <Skeleton key={i} className="aspect-square rounded-xl border border-stroke-subtle" />
                    ))}
                </div>
            ) : visibleAssets.length === 0 ? (
                <EmptyState filtered={assets.length > 0 && visibleAssets.length === 0} />
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
                    <AnimatePresence initial={false}>
                        {visibleAssets.map((asset, i) => (
                            <AssetCard key={asset.id} asset={asset} index={i} />
                        ))}
                    </AnimatePresence>
                </div>
            )}
        </div>
    );
}

function AssetCard({ asset, index }: { asset: AssetItem; index: number }) {
    const [loaded, setLoaded] = useState(false);
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const videoRef = React.useRef<HTMLVideoElement | null>(null);

    const mediaType = asset.result_type === 'audio' || asset.result_type === '3d' ? 'any' : asset.result_type;
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
                transition={{ duration: 0.2, delay: Math.min(index, 12) * 0.03 }}
                onClick={() => setLightboxOpen(true)}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                className="relative aspect-square rounded-xl overflow-hidden border border-stroke-subtle bg-surface-primary cursor-pointer group hover:border-accent-primary/50 transition-all duration-200 shadow-sm hover:shadow-lg"
                title="Click to preview"
            >
                {showSkeleton && <div className="absolute inset-0 bg-surface-secondary animate-pulse" />}

                {asset.result_type === 'video' ? (
                    <>
                        <video
                            ref={videoRef}
                            src={asset.result_url}
                            className="w-full h-full object-cover"
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
                        <audio src={asset.result_url} controls className="w-full" onLoadedData={() => setLoaded(true)} onClick={(e) => e.stopPropagation()} />
                    </div>
                ) : asset.result_type === '3d' ? (
                    <div className="w-full h-full flex items-center justify-center bg-black/40 text-white/80 p-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wider">3D Model</span>
                    </div>
                ) : (
                    <img
                        src={asset.result_url}
                        alt="Generated asset"
                        className={`w-full h-full object-cover transition-all duration-500 ${loaded ? 'opacity-100 blur-0' : 'opacity-0 blur-sm'}`}
                        onLoad={() => setLoaded(true)}
                    />
                )}

                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all duration-200 flex items-center justify-center">
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-black/60 rounded-lg px-2 py-1">
                        <span className="text-[9px] font-bold text-white uppercase tracking-wider">View</span>
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
            className="flex flex-col items-center justify-center gap-5 py-20 text-center"
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
                <p className="text-xs text-content-tertiary leading-relaxed max-w-[220px]">
                    {filtered
                        ? 'No assets match the current filter. Try a different type.'
                        : 'Run a workflow and every result you generate will collect here, across all your sessions.'}
                </p>
            </div>
        </motion.div>
    );
}
