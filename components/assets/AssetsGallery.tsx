'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Image as ImageIcon, Sparkles, RefreshCw, Filter, Play, LayoutGrid, Check } from 'lucide-react';
import JSZip from 'jszip';
import { createClient } from '@/lib/supabase/client';
import ImageLightbox from '@/components/ui/ImageLightbox';
import { Skeleton } from '@/components/ui/Skeleton';
import { AssetTypeFilter } from '@/components/assets/AssetTypeFilter';
import { Slider } from '@/components/ui/Slider';
import AssetSelectionToolbar from '@/components/assets/AssetSelectionToolbar';
import CharacterModal from '@/components/assets/CharacterModal';
import { unpackAssets, type AssetItem, type AssetType, type TypeFilter } from '@/lib/assets/unpack';
import { uploadApi, charactersApi, type CharacterRefImage } from '@/lib/api/client';

/**
 * Full-page browse view of every result the user has generated, across all
 * sessions. Supports multi-select (Ctrl/Cmd-click, Shift-range, per-card
 * checkbox, drag marquee) with bulk Download-as-zip and Add-to-character, plus
 * a density slider that sets columns-per-row (persisted to localStorage).
 */

const MIN_COLUMNS = 3;
const MAX_COLUMNS = 10;
const DEFAULT_COLUMNS = 4;
const COLUMNS_KEY = 'assets:gridColumns';
const MAX_CHARACTER_IMAGES = 6;

function loadColumns(): number {
    if (typeof window === 'undefined') return DEFAULT_COLUMNS;
    try {
        const raw = window.localStorage.getItem(COLUMNS_KEY);
        const n = raw ? parseInt(raw, 10) : NaN;
        if (Number.isFinite(n) && n >= MIN_COLUMNS && n <= MAX_COLUMNS) return n;
    } catch { /* ignore */ }
    return DEFAULT_COLUMNS;
}

function extFromUrl(url: string): string | null {
    try {
        const path = new URL(url).pathname;
        const m = path.match(/\.([a-zA-Z0-9]{1,5})$/);
        return m ? m[1].toLowerCase() : null;
    } catch { return null; }
}

function extFromType(t: AssetType): string {
    switch (t) {
        case 'video': return 'mp4';
        case 'audio': return 'mp3';
        case '3d': return 'glb';
        default: return 'png';
    }
}

interface MarqueeRect { left: number; top: number; right: number; bottom: number; }

export default function AssetsGallery() {
    const [assets, setAssets] = useState<AssetItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
    const [columns, setColumns] = useState<number>(loadColumns);

    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [lastIndex, setLastIndex] = useState<number | null>(null);
    const [lightboxAsset, setLightboxAsset] = useState<AssetItem | null>(null);
    const [marquee, setMarquee] = useState<MarqueeRect | null>(null);

    const [downloading, setDownloading] = useState(false);
    const [addingToCharacter, setAddingToCharacter] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const [characterModalOpen, setCharacterModalOpen] = useState(false);
    const [seedImages, setSeedImages] = useState<CharacterRefImage[] | null>(null);

    const supabase = React.useMemo(() => createClient(), []);
    const gridRef = useRef<HTMLDivElement | null>(null);
    const cardRefs = useRef<Map<string, HTMLElement>>(new Map());

    const fetchAssets = useCallback(async () => {
        setIsLoading(true);
        // No session filter — RLS scopes node_results to the current user's
        // sessions. Exclude `character` rows (re-published reference images,
        // not deliverable assets); keep NULL-typed rows visible.
        const { data, error } = await supabase
            .from('node_results')
            .select('id, node_id, result_type, result_data, created_at, execution_id, session_id')
            .eq('status', 'completed')
            .in('result_type', ['image', 'video', 'audio', '3d'])
            .or('node_type.is.null,node_type.neq.character')
            .order('created_at', { ascending: false })
            .limit(200);

        if (!error && data) setAssets(unpackAssets(data));
        setIsLoading(false);
    }, [supabase]);

    useEffect(() => { fetchAssets(); }, [fetchAssets]);

    useEffect(() => {
        try { window.localStorage.setItem(COLUMNS_KEY, String(columns)); } catch { /* ignore */ }
    }, [columns]);

    const visibleAssets = React.useMemo(() => {
        if (typeFilter === 'all') return assets;
        return assets.filter((a) => a.result_type === typeFilter);
    }, [assets, typeFilter]);

    // Drop ids that are no longer visible (filter change / refresh) from the
    // selection so bulk actions never operate on hidden items.
    useEffect(() => {
        setSelectedIds((prev) => {
            if (prev.size === 0) return prev;
            const visibleIdSet = new Set(visibleAssets.map((a) => a.id));
            let changed = false;
            const next = new Set<string>();
            prev.forEach((id) => { if (visibleIdSet.has(id)) next.add(id); else changed = true; });
            return changed ? next : prev;
        });
    }, [visibleAssets]);

    const clearSelection = useCallback(() => { setSelectedIds(new Set()); setLastIndex(null); }, []);

    // Esc clears the current selection.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') clearSelection(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [clearSelection]);

    // Plain click opens the lightbox; Ctrl/Cmd toggles; Shift selects a range.
    const handleCardActivate = useCallback((index: number, e: React.MouseEvent) => {
        const asset = visibleAssets[index];
        if (!asset) return;
        if (e.shiftKey && lastIndex !== null) {
            const lo = Math.min(lastIndex, index);
            const hi = Math.max(lastIndex, index);
            const ids = visibleAssets.slice(lo, hi + 1).map((a) => a.id);
            setSelectedIds((prev) => { const next = new Set(prev); ids.forEach((id) => next.add(id)); return next; });
            setLastIndex(index);
            return;
        }
        if (e.ctrlKey || e.metaKey) {
            setSelectedIds((prev) => {
                const next = new Set(prev);
                if (next.has(asset.id)) next.delete(asset.id); else next.add(asset.id);
                return next;
            });
            setLastIndex(index);
            return;
        }
        setLightboxAsset(asset);
    }, [visibleAssets, lastIndex]);

    const handleCheckboxToggle = useCallback((index: number) => {
        const asset = visibleAssets[index];
        if (!asset) return;
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(asset.id)) next.delete(asset.id); else next.add(asset.id);
            return next;
        });
        setLastIndex(index);
    }, [visibleAssets]);

    const registerCard = useCallback((id: string, el: HTMLElement | null) => {
        if (el) cardRefs.current.set(id, el); else cardRefs.current.delete(id);
    }, []);

    // Marquee: starts on any empty area of the gallery (the gutters/space
    // around the grid as well as the gaps between cards), but never on a card
    // or an interactive control. Hit-tests card rects on each move and replaces
    // the selection with the intersecting ids. A click that never moves clears
    // the selection.
    const startMarquee = useCallback((e: React.PointerEvent) => {
        if (e.button !== 0) return;
        const target = e.target as HTMLElement;
        if (target.closest('[data-asset-card], button, input, a, label, audio, [role="menu"]')) return;
        const startX = e.clientX, startY = e.clientY;
        let moved = false;
        const onMove = (ev: PointerEvent) => {
            if (!moved && Math.abs(ev.clientX - startX) < 4 && Math.abs(ev.clientY - startY) < 4) return;
            moved = true;
            const box: MarqueeRect = {
                left: Math.min(startX, ev.clientX),
                top: Math.min(startY, ev.clientY),
                right: Math.max(startX, ev.clientX),
                bottom: Math.max(startY, ev.clientY),
            };
            setMarquee(box);
            const hit = new Set<string>();
            cardRefs.current.forEach((el, id) => {
                const r = el.getBoundingClientRect();
                if (r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top) hit.add(id);
            });
            setSelectedIds(hit);
        };
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            setMarquee(null);
            if (!moved) clearSelection();
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }, [clearSelection]);

    const selectedImageItems = React.useMemo(
        () => visibleAssets.filter((a) => selectedIds.has(a.id) && a.result_type === 'image'),
        [visibleAssets, selectedIds],
    );

    const handleDownload = useCallback(async () => {
        const items = visibleAssets.filter((a) => selectedIds.has(a.id));
        if (items.length === 0) return;
        setDownloading(true);
        setActionError(null);
        try {
            const zip = new JSZip();
            let fails = 0;
            await Promise.all(items.map(async (a, i) => {
                try {
                    const res = await fetch(a.result_url);
                    if (!res.ok) throw new Error('fetch failed');
                    const blob = await res.blob();
                    const ext = extFromUrl(a.result_url) ?? extFromType(a.result_type);
                    zip.file(`asset-${i + 1}.${ext}`, blob);
                } catch { fails++; }
            }));
            const blob = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `assets-${items.length}.zip`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
            if (fails > 0) setActionError(`${fails} file(s) failed to download`);
        } finally {
            setDownloading(false);
        }
    }, [visibleAssets, selectedIds]);

    const handleAddToCharacter = useCallback(async () => {
        const imgs = selectedImageItems.slice(0, MAX_CHARACTER_IMAGES);
        if (imgs.length === 0) return;
        setAddingToCharacter(true);
        setActionError(null);
        try {
            const uploaded = await Promise.all(imgs.map(async (a) => {
                try {
                    const r = await uploadApi.uploadUrl(a.result_url, { filename: `character-asset-${a.id.replace(/:/g, '-')}` });
                    return { url: r.publicUrl, path: r.path } as CharacterRefImage;
                } catch { return null; }
            }));
            const ok = uploaded.filter((x): x is CharacterRefImage => x !== null);
            if (ok.length === 0) { setActionError('Could not prepare images for the character'); return; }
            setSeedImages(ok);
            setCharacterModalOpen(true);
        } finally {
            setAddingToCharacter(false);
        }
    }, [selectedImageItems]);

    const gridTemplate = { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` };

    return (
        <div className="space-y-5 min-h-[calc(100vh-14rem)] select-none" onPointerDown={startMarquee}>
            <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-1">
                    <p className="text-sm text-content-tertiary whitespace-nowrap">
                        {isLoading ? 'Loading…' : `${visibleAssets.length} ${visibleAssets.length === 1 ? 'result' : 'results'}`}
                    </p>
                    {selectedIds.size > 0 && (
                        <AssetSelectionToolbar
                            count={selectedIds.size}
                            imageCount={selectedImageItems.length}
                            downloading={downloading}
                            adding={addingToCharacter}
                            error={actionError}
                            onClear={clearSelection}
                            onDownload={handleDownload}
                            onAddToCharacter={handleAddToCharacter}
                        />
                    )}
                </div>
                <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-content-tertiary" title="Assets per row">
                        <LayoutGrid className="w-4 h-4" />
                        <Slider
                            value={columns}
                            onChange={(v) => setColumns(Math.round(v))}
                            min={MIN_COLUMNS}
                            max={MAX_COLUMNS}
                            step={1}
                            ariaLabel="Assets per row"
                            className="w-24"
                        />
                    </label>
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
                <div className="grid gap-5" style={gridTemplate}>
                    {Array.from({ length: 8 }).map((_, i) => (
                        <Skeleton key={i} className="aspect-square rounded-xl border border-stroke-subtle" />
                    ))}
                </div>
            ) : visibleAssets.length === 0 ? (
                <EmptyState filtered={assets.length > 0 && visibleAssets.length === 0} />
            ) : (
                <div
                    ref={gridRef}
                    className="grid gap-5"
                    style={gridTemplate}
                >
                    <AnimatePresence initial={false}>
                        {visibleAssets.map((asset, i) => (
                            <AssetCard
                                key={asset.id}
                                asset={asset}
                                index={i}
                                selected={selectedIds.has(asset.id)}
                                selectionActive={selectedIds.size > 0}
                                onActivate={handleCardActivate}
                                onToggle={handleCheckboxToggle}
                                registerRef={registerCard}
                            />
                        ))}
                    </AnimatePresence>
                </div>
            )}

            {marquee && (
                <div
                    className="fixed z-50 border border-accent-primary bg-accent-primary/10 rounded-sm pointer-events-none"
                    style={{
                        left: marquee.left,
                        top: marquee.top,
                        width: marquee.right - marquee.left,
                        height: marquee.bottom - marquee.top,
                    }}
                />
            )}

            {lightboxAsset && (
                <ImageLightbox
                    media={lightboxAsset.result_url}
                    type={(lightboxAsset.result_type === 'audio' || lightboxAsset.result_type === '3d' ? 'any' : lightboxAsset.result_type) as any}
                    initialIndex={0}
                    onClose={() => setLightboxAsset(null)}
                />
            )}

            <CharacterModal
                open={characterModalOpen}
                initial={null}
                seedImages={seedImages ?? undefined}
                onClose={() => { setCharacterModalOpen(false); setSeedImages(null); }}
                onSave={async (input) => { await charactersApi.create(input); clearSelection(); }}
                onSaveDraft={async (input) => { await charactersApi.create(input, { draft: true }); }}
            />
        </div>
    );
}

interface AssetCardProps {
    asset: AssetItem;
    index: number;
    selected: boolean;
    selectionActive: boolean;
    onActivate: (index: number, e: React.MouseEvent) => void;
    onToggle: (index: number) => void;
    registerRef: (id: string, el: HTMLElement | null) => void;
}

function AssetCard({ asset, index, selected, selectionActive, onActivate, onToggle, registerRef }: AssetCardProps) {
    const [loaded, setLoaded] = useState(false);
    const videoRef = React.useRef<HTMLVideoElement | null>(null);

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
        <motion.div
            ref={(el) => registerRef(asset.id, el)}
            data-asset-card
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2, delay: Math.min(index, 12) * 0.03 }}
            onClick={(e) => onActivate(index, e)}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            className={`relative aspect-square rounded-xl overflow-hidden border bg-surface-primary cursor-pointer group transition-all duration-200 shadow-sm hover:shadow-lg ${
                selected ? 'border-accent-primary ring-2 ring-accent-primary' : 'border-stroke-subtle hover:border-accent-primary/50'
            }`}
            title="Click to preview · Ctrl/Shift-click to select"
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

            {/* Selection checkbox — visible on hover, or whenever anything is selected. */}
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onToggle(index); }}
                className={`absolute top-1.5 right-1.5 z-[2] w-5 h-5 rounded-md border flex items-center justify-center transition-opacity ${
                    selected
                        ? 'bg-accent-primary border-accent-primary opacity-100'
                        : `bg-black/40 border-white/40 ${selectionActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`
                }`}
                aria-label={selected ? 'Deselect' : 'Select'}
                aria-pressed={selected}
            >
                {selected && <Check className="w-3 h-3 text-white" />}
            </button>

            {!selectionActive && (
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all duration-200 flex items-center justify-center pointer-events-none">
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-black/60 rounded-lg px-2 py-1">
                        <span className="text-[9px] font-bold text-white uppercase tracking-wider">View</span>
                    </div>
                </div>
            )}
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
