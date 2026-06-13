'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Image as ImageIcon, RefreshCw, Filter, Play, LayoutGrid, Trash2, Upload } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import ImageLightbox from '@/components/ui/ImageLightbox';
import { Skeleton } from '@/components/ui/Skeleton';
import { Slider } from '@/components/ui/Slider';
import { AssetTypeFilter } from '@/components/assets/AssetTypeFilter';
import { ConfirmationModal } from '@/components/ui/ConfirmationModal';
import { unpackUploads, type AssetItem, type TypeFilter, type UploadRow } from '@/lib/assets/unpack';
import { uploadApi } from '@/lib/api/client';
import { toThumbnailUrl, bakedThumbUrl } from '@/lib/utils/supabase-image';

/**
 * Full-page browse view of the user's uploaded media (drops on canvas / the
 * media_input picker), sourced from the `uploads` index — NOT node_results.
 * Drag a tile back onto the canvas, preview in a lightbox, or hard-delete it
 * (removes the storage object + index row, since uploads are the user's own
 * files rather than derived generations).
 */

const MIN_COLUMNS = 3;
const MAX_COLUMNS = 10;
const DEFAULT_COLUMNS = 4;
const COLUMNS_KEY = 'assets:gridColumns';

function loadColumns(): number {
    if (typeof window === 'undefined') return DEFAULT_COLUMNS;
    try {
        const raw = window.localStorage.getItem(COLUMNS_KEY);
        const n = raw ? parseInt(raw, 10) : NaN;
        if (Number.isFinite(n) && n >= MIN_COLUMNS && n <= MAX_COLUMNS) return n;
    } catch { /* ignore */ }
    return DEFAULT_COLUMNS;
}

export default function UploadsGallery() {
    const [assets, setAssets] = useState<AssetItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
    const [columns, setColumns] = useState<number>(loadColumns);
    const [lightboxAsset, setLightboxAsset] = useState<AssetItem | null>(null);
    const [pendingDelete, setPendingDelete] = useState<AssetItem | null>(null);
    const [deleting, setDeleting] = useState(false);

    const supabase = React.useMemo(() => createClient(), []);

    const fetchUploads = useCallback(async () => {
        setIsLoading(true);
        // RLS scopes `uploads` to the current user across all sessions.
        const { data, error } = await supabase
            .from('uploads')
            .select('id, url, storage_path, media_type, created_at')
            .order('created_at', { ascending: false })
            .limit(200);
        if (!error && data) setAssets(unpackUploads(data as UploadRow[]));
        setIsLoading(false);
    }, [supabase]);

    useEffect(() => { fetchUploads(); }, [fetchUploads]);

    useEffect(() => {
        try { window.localStorage.setItem(COLUMNS_KEY, String(columns)); } catch { /* ignore */ }
    }, [columns]);

    const visibleAssets = React.useMemo(() => {
        if (typeFilter === 'all') return assets;
        return assets.filter((a) => a.result_type === typeFilter);
    }, [assets, typeFilter]);

    const handleDragStart = (e: React.DragEvent, asset: AssetItem) => {
        const payload = JSON.stringify({
            type: 'media_input',
            initialConfig: { images: [asset.result_url] },
        });
        e.dataTransfer.setData('application/reactflow', payload);
        e.dataTransfer.effectAllowed = 'copy';
    };

    // Hard delete: remove the storage object (DELETE /api/upload also drops the
    // index row). Optimistic; restore on failure.
    const handleDelete = useCallback(async () => {
        const asset = pendingDelete;
        if (!asset?.storage_path) { setPendingDelete(null); return; }
        setDeleting(true);
        setAssets((prev) => prev.filter((a) => a.id !== asset.id));
        try {
            await uploadApi.delete(asset.storage_path);
        } catch {
            // Restore on failure (keep newest-first ordering).
            setAssets((prev) => [asset, ...prev].sort((a, b) => b.created_at.localeCompare(a.created_at)));
        } finally {
            setDeleting(false);
            setPendingDelete(null);
        }
    }, [pendingDelete]);

    const gridTemplate = { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` };

    return (
        <div className="space-y-5">
            <div className="flex items-center justify-between gap-4">
                <p className="text-sm text-content-tertiary whitespace-nowrap">
                    {isLoading ? 'Loading…' : `${visibleAssets.length} ${visibleAssets.length === 1 ? 'upload' : 'uploads'}`}
                </p>
                <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-content-tertiary" title="Uploads per row">
                        <LayoutGrid className="w-4 h-4" />
                        <Slider
                            value={columns}
                            onChange={(v) => setColumns(Math.round(v))}
                            min={MIN_COLUMNS}
                            max={MAX_COLUMNS}
                            step={1}
                            ariaLabel="Uploads per row"
                            className="w-24"
                        />
                    </label>
                    <AssetTypeFilter typeFilter={typeFilter} onChange={setTypeFilter} />
                    <button
                        onClick={fetchUploads}
                        className="p-2 rounded-lg hover:bg-interactive-hover transition-colors group"
                        title="Refresh"
                    >
                        <RefreshCw className="w-4 h-4 text-content-tertiary group-hover:text-content-primary transition-colors" />
                    </button>
                </div>
            </div>

            {isLoading ? (
                <div className="grid gap-5" style={gridTemplate}>
                    {Array.from({ length: 8 }).map((_, i) => (
                        <Skeleton key={i} className="aspect-square rounded-xl border border-stroke-subtle" />
                    ))}
                </div>
            ) : visibleAssets.length === 0 ? (
                <EmptyState filtered={assets.length > 0 && visibleAssets.length === 0} />
            ) : (
                <div className="grid gap-5" style={gridTemplate}>
                    <AnimatePresence initial={false}>
                        {visibleAssets.map((asset, i) => (
                            <UploadCard
                                key={asset.id}
                                asset={asset}
                                index={i}
                                onOpen={() => setLightboxAsset(asset)}
                                onDelete={() => setPendingDelete(asset)}
                                onDragStart={handleDragStart}
                            />
                        ))}
                    </AnimatePresence>
                </div>
            )}

            {lightboxAsset && (
                <ImageLightbox
                    media={lightboxAsset.result_url}
                    type={(lightboxAsset.result_type === 'audio' || lightboxAsset.result_type === '3d' ? 'any' : lightboxAsset.result_type) as any}
                    initialIndex={0}
                    onClose={() => setLightboxAsset(null)}
                />
            )}

            <ConfirmationModal
                isOpen={!!pendingDelete}
                onClose={() => { if (!deleting) setPendingDelete(null); }}
                onConfirm={handleDelete}
                title="Delete upload?"
                message="This permanently removes the uploaded file from your storage. Nodes that already reference it will lose the file. This can't be undone."
                confirmText="Delete"
                variant="danger"
            />
        </div>
    );
}

interface UploadCardProps {
    asset: AssetItem;
    index: number;
    onOpen: () => void;
    onDelete: () => void;
    onDragStart: (e: React.DragEvent, asset: AssetItem) => void;
}

function UploadCard({ asset, index, onOpen, onDelete, onDragStart }: UploadCardProps) {
    const [loaded, setLoaded] = useState(false);
    const videoRef = React.useRef<HTMLVideoElement | null>(null);
    const cardElRef = React.useRef<HTMLDivElement | null>(null);

    const [shouldLoadVideo, setShouldLoadVideo] = useState(false);
    useEffect(() => {
        if (asset.result_type !== 'video' || shouldLoadVideo) return;
        const el = cardElRef.current;
        if (!el) return;
        const io = new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting)) {
                    setShouldLoadVideo(true);
                    io.disconnect();
                }
            },
            { rootMargin: '200px' },
        );
        io.observe(el);
        return () => io.disconnect();
    }, [asset.result_type, shouldLoadVideo]);

    const showSkeleton = !loaded && asset.result_type === 'image';

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
        <motion.div
            ref={cardElRef}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2, delay: Math.min(index, 12) * 0.03 }}
            draggable
            onDragStart={(e) => onDragStart(e as unknown as React.DragEvent, asset)}
            onClick={onOpen}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            className="relative aspect-square rounded-xl overflow-hidden border border-stroke-subtle bg-surface-primary cursor-pointer group hover:border-accent-primary/50 transition-all duration-200 shadow-sm hover:shadow-lg"
            title="Click to preview · Drag to canvas"
        >
            {showSkeleton && <div className="absolute inset-0 bg-surface-secondary animate-pulse" />}

            {asset.result_type === 'video' ? (
                <>
                    <video
                        ref={videoRef}
                        src={asset.result_url}
                        poster={bakedThumbUrl(asset.result_url) ?? undefined}
                        className="w-full h-full object-cover"
                        onLoadedMetadata={() => setLoaded(true)}
                        muted
                        loop
                        playsInline
                        preload={shouldLoadVideo ? 'auto' : 'none'}
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
            ) : (
                <img
                    src={bakedThumbUrl(asset.result_url) ?? asset.result_url}
                    alt="Uploaded asset"
                    className={`w-full h-full object-cover transition-all duration-500 ${loaded ? 'opacity-100 blur-0' : 'opacity-0 blur-sm'}`}
                    onLoad={() => setLoaded(true)}
                    onError={(e) => {
                        const img = e.currentTarget;
                        const step = img.dataset.fbStep;
                        if (!step) {
                            img.dataset.fbStep = 'render';
                            img.src = toThumbnailUrl(asset.result_url, { width: 640 }) ?? asset.result_url;
                        } else if (step === 'render') {
                            img.dataset.fbStep = 'orig';
                            if (img.src !== asset.result_url) img.src = asset.result_url;
                        }
                    }}
                />
            )}

            {/* Hard-delete — visible on hover. */}
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                className="absolute top-1.5 right-1.5 z-[2] w-7 h-7 rounded-md border border-white/30 bg-black/45 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-red-500 hover:border-red-500 transition-all"
                aria-label="Delete upload"
                title="Delete upload"
            >
                <Trash2 className="w-3.5 h-3.5" />
            </button>

            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all duration-200 flex items-center justify-center pointer-events-none">
                <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-black/60 rounded-lg px-2 py-1">
                    <span className="text-[9px] font-bold text-white uppercase tracking-wider">View / Drag</span>
                </div>
            </div>
        </motion.div>
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
                        <Upload className="w-7 h-7 text-content-tertiary/50" />
                    )}
                </div>
                <div className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-surface-elevated border border-stroke-subtle flex items-center justify-center">
                    <ImageIcon className="w-2.5 h-2.5 text-accent-primary/60" />
                </div>
            </div>

            <div className="space-y-2">
                <p className="text-sm font-semibold text-content-secondary">
                    {filtered ? 'No matches' : 'No uploads yet'}
                </p>
                <p className="text-xs text-content-tertiary leading-relaxed max-w-[220px]">
                    {filtered
                        ? 'No uploads match the current filter. Try a different type.'
                        : 'Drop an image, video, or audio file onto the canvas — or use a Media Input node — and it will collect here.'}
                </p>
            </div>
        </motion.div>
    );
}
