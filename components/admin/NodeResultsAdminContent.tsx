'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowLeft,
    Images,
    LayoutGrid,
    RefreshCw,
    Loader2,
    AlertCircle,
    Search,
    Play,
    User as UserIcon,
} from 'lucide-react';
import ImageLightbox from '@/components/ui/ImageLightbox';
import { Skeleton } from '@/components/ui/Skeleton';
import { Slider } from '@/components/ui/Slider';
import { AssetTypeFilter } from '@/components/assets/AssetTypeFilter';
import type { TypeFilter } from '@/lib/assets/unpack';
import { adminNodeResultsApi, type AdminNodeResultItem } from '@/lib/api/admin-node-results';
import { toThumbnailUrl, bakedThumbUrl } from '@/lib/utils/supabase-image';

interface Props {
    onMobileBack: () => void;
}

const MIN_COLUMNS = 3;
const MAX_COLUMNS = 10;
const DEFAULT_COLUMNS = 5;
const COLUMNS_KEY = 'admin:nodeResults:gridColumns';
// Larger pages = fewer round trips (and the per-request user-directory join is
// amortized over more rows), so fast scrolling rarely outruns the buffer. 100
// is the sweet spot under the route's 200 cap — big batches that still return
// quickly. Paired with a deep prefetch margin below.
const PAGE_SIZE = 100;

function loadColumns(): number {
    if (typeof window === 'undefined') return DEFAULT_COLUMNS;
    try {
        const raw = window.localStorage.getItem(COLUMNS_KEY);
        const n = raw ? parseInt(raw, 10) : NaN;
        if (Number.isFinite(n) && n >= MIN_COLUMNS && n <= MAX_COLUMNS) return n;
    } catch { /* ignore */ }
    return DEFAULT_COLUMNS;
}

function formatDate(iso: string): string {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return '';
    return new Date(t).toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
}

/**
 * Admin browser of every media result any user has generated. Mirrors the
 * user-facing assets gallery (density slider + type filter) but each card is
 * stamped with the owning user's identity, and search filters by user.
 */
export function NodeResultsAdminContent({ onMobileBack }: Props) {
    const [items, setItems] = useState<AdminNodeResultItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [page, setPage] = useState(0);
    const [hasMore, setHasMore] = useState(false);

    const [columns, setColumns] = useState<number>(loadColumns);
    const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');

    const [lightbox, setLightbox] = useState<AdminNodeResultItem | null>(null);

    // Tracks the latest request so a slow earlier fetch can't overwrite results.
    const reqIdRef = useRef(0);
    // Infinite-scroll sentinel — auto-loads the next page as it nears view.
    const sentinelRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        try { window.localStorage.setItem(COLUMNS_KEY, String(columns)); } catch { /* ignore */ }
    }, [columns]);

    // Debounce the user search box.
    useEffect(() => {
        const h = setTimeout(() => setDebouncedSearch(search.trim()), 300);
        return () => clearTimeout(h);
    }, [search]);

    const fetchPage = useCallback(async (nextPage: number, mode: 'replace' | 'append') => {
        const reqId = ++reqIdRef.current;
        if (mode === 'replace') setLoading(true); else setLoadingMore(true);
        setError(null);
        try {
            const res = await adminNodeResultsApi.list({
                page: nextPage,
                pageSize: PAGE_SIZE,
                type: typeFilter,
                q: debouncedSearch || undefined,
            });
            if (reqId !== reqIdRef.current) return; // a newer request superseded us
            setItems((prev) => (mode === 'append' ? [...prev, ...res.rows] : res.rows));
            setPage(res.page);
            setHasMore(res.hasMore);
        } catch (err: any) {
            if (reqId !== reqIdRef.current) return;
            setError(err.message || 'Failed to load node results');
        } finally {
            if (reqId === reqIdRef.current) {
                setLoading(false);
                setLoadingMore(false);
            }
        }
    }, [typeFilter, debouncedSearch]);

    // (Re)load from the first page whenever the filters change.
    useEffect(() => { fetchPage(0, 'replace'); }, [fetchPage]);

    // Infinite scroll: when the bottom sentinel nears the viewport, pull the
    // next page (one in-flight at a time). rootMargin prefetches before the
    // user actually reaches the end so scrolling stays smooth. Re-runs as `page`
    // advances so it keeps loading until `hasMore` is false (or the sentinel
    // scrolls out of view). Mirrors the per-tile lazy loading on the assets page.
    useEffect(() => {
        if (!hasMore || loading) return;
        const el = sentinelRef.current;
        if (!el) return;
        const io = new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting) && !loadingMore) {
                    fetchPage(page + 1, 'append');
                }
            },
            // Deep prefetch: fire ~2.5 screens before the sentinel is actually
            // reached so the next page is already loading while the user is still
            // scrolling through the current one — nothing holds them back.
            { rootMargin: '2500px' },
        );
        io.observe(el);
        return () => io.disconnect();
    }, [hasMore, loading, loadingMore, page, fetchPage]);

    const gridTemplate = useMemo(
        () => ({ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }),
        [columns],
    );

    return (
        <div className="min-h-full flex flex-col">
            {/* Mobile back */}
            <div className="md:hidden px-8 pt-6">
                <button
                    onClick={onMobileBack}
                    className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-content-tertiary hover:text-content-primary transition-all"
                >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Return to Admin</span>
                </button>
            </div>

            {/* Header */}
            <header className="sticky top-0 z-30 bg-surface-primary/60 backdrop-blur-xl border-b border-white/5 px-8 py-5 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-2xl">
                <div className="flex items-center gap-5">
                    <div className="w-8 h-8 rounded-xl bg-accent-primary/10 flex items-center justify-center border border-accent-primary/20 shadow-inner">
                        <Images className="w-4 h-4 text-accent-primary" />
                    </div>
                    <div>
                        <h1 className="text-xl font-black text-content-primary uppercase tracking-tighter">Node Results</h1>
                        <p className="text-[10px] font-bold text-content-tertiary uppercase tracking-widest mt-0.5 opacity-60">
                            Every result · all users
                        </p>
                    </div>
                </div>
                <button
                    onClick={() => fetchPage(0, 'replace')}
                    disabled={loading}
                    className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-content-tertiary hover:text-content-primary text-[10px] font-bold uppercase tracking-widest rounded-xl transition-all disabled:opacity-40 shrink-0"
                >
                    {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    Refresh
                </button>
            </header>

            <main className="flex-1 max-w-7xl mx-auto w-full p-8 md:p-12 space-y-6">
                {/* Controls */}
                <div className="flex flex-col md:flex-row md:items-center gap-4">
                    <div className="relative flex-1">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-content-tertiary" />
                        <input
                            type="text"
                            placeholder="Search by user email, username, or id…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full pl-11 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-xs font-medium focus:outline-none focus:border-accent-primary/50 transition-all"
                        />
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                        <span className="text-xs text-content-tertiary whitespace-nowrap tabular-nums">
                            {loading ? 'Loading…' : `${items.length}${hasMore ? '+' : ''} result${items.length === 1 ? '' : 's'}`}
                        </span>
                        <label className="flex items-center gap-2 text-content-tertiary" title="Results per row">
                            <LayoutGrid className="w-4 h-4" />
                            <Slider
                                value={columns}
                                onChange={(v) => setColumns(Math.round(v))}
                                min={MIN_COLUMNS}
                                max={MAX_COLUMNS}
                                step={1}
                                ariaLabel="Results per row"
                                className="w-24"
                            />
                        </label>
                        <AssetTypeFilter typeFilter={typeFilter} onChange={setTypeFilter} />
                    </div>
                </div>

                {error && (
                    <div className="p-4 rounded-2xl bg-red-500/5 border border-red-500/20 text-red-400 flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                        <p className="text-sm font-medium">{error}</p>
                    </div>
                )}

                {loading ? (
                    <div className="grid gap-4" style={gridTemplate}>
                        {Array.from({ length: 10 }).map((_, i) => (
                            <Skeleton key={i} className="aspect-square rounded-xl border border-stroke-subtle" />
                        ))}
                    </div>
                ) : items.length === 0 ? (
                    <EmptyState filtered={!!debouncedSearch || typeFilter !== 'all'} />
                ) : (
                    <>
                        <div className="grid gap-4" style={gridTemplate}>
                            {items.map((item) => (
                                <ResultCard
                                    key={item.id}
                                    item={item}
                                    onOpen={() => setLightbox(item)}
                                    onPickUser={() => setSearch(item.user_email || item.user_id || '')}
                                />
                            ))}
                        </div>

                        {hasMore && (
                            // Auto-load sentinel — the observer above fires when
                            // this nears the viewport. The button is a manual
                            // fallback for the rare case the observer doesn't fire.
                            <div ref={sentinelRef} className="flex justify-center pt-2 min-h-[44px] items-center">
                                {loadingMore ? (
                                    <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-content-tertiary">
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
                                    </span>
                                ) : (
                                    <button
                                        onClick={() => fetchPage(page + 1, 'append')}
                                        className="px-6 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-content-secondary hover:text-content-primary text-[10px] font-black uppercase tracking-widest rounded-xl transition-all"
                                    >
                                        Load more
                                    </button>
                                )}
                            </div>
                        )}
                    </>
                )}
            </main>

            {lightbox && (
                <ImageLightbox
                    media={lightbox.result_url}
                    type={(lightbox.result_type === 'audio' || lightbox.result_type === '3d' ? 'any' : lightbox.result_type) as any}
                    initialIndex={0}
                    onClose={() => setLightbox(null)}
                />
            )}
        </div>
    );
}

interface ResultCardProps {
    item: AdminNodeResultItem;
    onOpen: () => void;
    onPickUser: () => void;
}

function ResultCard({ item, onOpen, onPickUser }: ResultCardProps) {
    const [loaded, setLoaded] = useState(false);
    const videoRef = useRef<HTMLVideoElement | null>(null);

    const handleMouseEnter = () => {
        if (item.result_type !== 'video') return;
        const v = videoRef.current;
        if (!v) return;
        v.currentTime = 0;
        const r = v.play();
        if (r && typeof r.catch === 'function') r.catch(() => {});
    };
    const handleMouseLeave = () => {
        if (item.result_type !== 'video') return;
        const v = videoRef.current;
        if (!v) return;
        v.pause();
        v.currentTime = 0;
    };

    const primary = item.user_email || item.user_name || 'Unknown user';
    const secondary = item.user_email && item.user_name ? item.user_name : (item.user_id ?? '');
    // The baked poster covers video tiles, so only images need the skeleton.
    const showSkeleton = !loaded && item.result_type === 'image';

    return (
        <div className="group flex flex-col rounded-xl overflow-hidden border border-stroke-subtle bg-surface-primary shadow-sm hover:shadow-lg hover:border-accent-primary/40 transition-all">
            {/* Media */}
            <button
                type="button"
                onClick={onOpen}
                className="relative aspect-square w-full overflow-hidden cursor-pointer"
                title="Click to preview"
            >
                {showSkeleton && <div className="absolute inset-0 bg-surface-secondary animate-pulse" />}

                {item.result_type === 'video' ? (
                    <>
                        <video
                            ref={videoRef}
                            src={item.result_url}
                            poster={bakedThumbUrl(item.result_url) ?? undefined}
                            className="w-full h-full object-cover"
                            onLoadedMetadata={() => setLoaded(true)}
                            onMouseEnter={handleMouseEnter}
                            onMouseLeave={handleMouseLeave}
                            muted
                            loop
                            playsInline
                            preload="metadata"
                        />
                        <div className="absolute top-1.5 left-1.5 z-[1] flex items-center justify-center w-5 h-5 rounded-full bg-black/60 backdrop-blur-sm border border-white/15 shadow-sm pointer-events-none">
                            <Play className="w-2.5 h-2.5 text-white fill-white" />
                        </div>
                    </>
                ) : item.result_type === 'audio' ? (
                    <div className="w-full h-full flex flex-col items-center justify-center bg-black/40 text-white/80 p-2">
                        <span className="text-[9px] font-semibold uppercase tracking-wider mb-2">Audio</span>
                        <audio src={item.result_url} controls className="w-full" onLoadedData={() => setLoaded(true)} onClick={(e) => e.stopPropagation()} />
                    </div>
                ) : item.result_type === '3d' ? (
                    <div className="w-full h-full flex items-center justify-center bg-black/40 text-white/80 p-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wider">3D Model</span>
                    </div>
                ) : (
                    <img
                        // Baked thumb → Supabase render thumb → full-res original
                        // (stepped via a dataset flag so it can't loop).
                        src={bakedThumbUrl(item.result_url) ?? item.result_url}
                        alt="Generated result"
                        className={`w-full h-full object-cover transition-all duration-500 ${loaded ? 'opacity-100 blur-0' : 'opacity-0 blur-sm'}`}
                        onLoad={() => setLoaded(true)}
                        onError={(e) => {
                            const img = e.currentTarget;
                            const step = img.dataset.fbStep;
                            if (!step) {
                                img.dataset.fbStep = 'render';
                                img.src = toThumbnailUrl(item.result_url, { width: 640 }) ?? item.result_url;
                            } else if (step === 'render') {
                                img.dataset.fbStep = 'orig';
                                if (img.src !== item.result_url) img.src = item.result_url;
                            }
                        }}
                    />
                )}

                {/* Type / node-type badges */}
                <div className="absolute bottom-1.5 left-1.5 z-[1] flex items-center gap-1 pointer-events-none">
                    <span className="px-1.5 py-0.5 rounded-md bg-black/60 backdrop-blur-sm border border-white/15 text-[8px] font-black uppercase tracking-widest text-white/90">
                        {item.result_type}
                    </span>
                    {item.node_type && (
                        <span className="px-1.5 py-0.5 rounded-md bg-black/55 backdrop-blur-sm border border-white/15 text-[8px] font-bold uppercase tracking-wider text-white/70">
                            {item.node_type}
                        </span>
                    )}
                </div>
            </button>

            {/* Owner footer */}
            <div
                className="flex items-center gap-2 p-2.5 border-t border-stroke-subtle/60"
                title={[
                    item.user_email ? `Email: ${item.user_email}` : null,
                    item.user_name ? `Username: ${item.user_name}` : null,
                    item.user_id ? `User ID: ${item.user_id}` : null,
                    `Node: ${item.node_id}`,
                    item.execution_id ? `Execution: ${item.execution_id}` : null,
                    item.session_id ? `Session: ${item.session_id}` : null,
                    `Created: ${formatDate(item.created_at)}`,
                ].filter(Boolean).join('\n')}
            >
                <button
                    type="button"
                    onClick={onPickUser}
                    className="w-7 h-7 shrink-0 rounded-full overflow-hidden bg-white/5 border border-white/10 flex items-center justify-center hover:border-accent-primary/50 transition-colors"
                    title="Filter to this user"
                >
                    {item.user_avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.user_avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                        <UserIcon className="w-3.5 h-3.5 text-content-tertiary" />
                    )}
                </button>
                <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold text-content-primary truncate">{primary}</p>
                    <p className="text-[10px] text-content-tertiary truncate">
                        {secondary ? <span className="opacity-80">{secondary} · </span> : null}
                        {formatDate(item.created_at)}
                    </p>
                </div>
            </div>
        </div>
    );
}

function EmptyState({ filtered }: { filtered: boolean }) {
    return (
        <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
            <div className="w-14 h-14 rounded-2xl bg-accent-primary/5 border border-accent-primary/10 flex items-center justify-center">
                <Images className="w-6 h-6 text-content-tertiary/50" />
            </div>
            <div className="space-y-1.5">
                <p className="text-sm font-semibold text-content-secondary">
                    {filtered ? 'No matches' : 'No results yet'}
                </p>
                <p className="text-xs text-content-tertiary max-w-[260px] leading-relaxed">
                    {filtered
                        ? 'No node results match the current filter. Try a different user or type.'
                        : 'Once users run workflows, every media result they generate will show up here.'}
                </p>
            </div>
        </div>
    );
}
