# Assets Multi-Select + Density Slider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-select (Ctrl/Cmd-click, Shift-range, checkbox, drag marquee), bulk Download-as-zip and Add-to-character actions, and a 3–10 column density slider to the full-page Assets gallery.

**Architecture:** All UI lives in the existing client component `components/assets/AssetsGallery.tsx`, which owns selection + column state. A new presentational `AssetSelectionToolbar` renders bulk actions. `CharacterModal` gains an optional `seedImages` prop so the gallery can pre-seed a new character from selected images. Download uses the already-installed `jszip`; add-to-character copies asset URLs into storage via `uploadApi.uploadUrl`. No DB changes (delete is deferred).

**Tech Stack:** Next.js (client component), React, framer-motion, Tailwind, lucide-react, jszip, Supabase browser client (RLS-scoped).

**Verification:** This repo has no test runner. Every task verifies with `npx tsc --noEmit` (project standard) plus the manual checks listed. Run all commands from the repo root `c:\Projects\Prisfol\PrismAi`.

---

## File Structure

- **Create** `components/assets/AssetSelectionToolbar.tsx` — presentational bulk-action bar (count, clear, download, add-to-character). No knowledge of gallery internals.
- **Modify** `components/assets/CharacterModal.tsx` — accept optional `seedImages?: CharacterRefImage[]`; initialize images from seeds in create mode.
- **Modify** `components/assets/AssetsGallery.tsx` — column slider + persistence, selection state, marquee, lifted lightbox, toolbar wiring, download + add-to-character handlers, extended `AssetCard`.

---

## Task 1: AssetSelectionToolbar component

**Files:**
- Create: `components/assets/AssetSelectionToolbar.tsx`

- [ ] **Step 1: Create the toolbar component**

Create `components/assets/AssetSelectionToolbar.tsx` with this exact content:

```tsx
'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { X, Download, UserPlus, Loader2 } from 'lucide-react';

interface AssetSelectionToolbarProps {
    count: number;
    imageCount: number;
    downloading: boolean;
    adding: boolean;
    error?: string | null;
    onClear: () => void;
    onDownload: () => void;
    onAddToCharacter: () => void;
}

/**
 * Presentational bulk-action bar for the Assets gallery. Rendered by
 * AssetsGallery only when a selection exists; holds no selection state itself.
 */
export default function AssetSelectionToolbar({
    count,
    imageCount,
    downloading,
    adding,
    error,
    onClear,
    onDownload,
    onAddToCharacter,
}: AssetSelectionToolbarProps) {
    const busy = downloading || adding;
    return (
        <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="sticky top-2 z-30 flex items-center gap-3 px-4 py-2.5 rounded-xl border border-stroke-subtle bg-surface-elevated shadow-lg"
        >
            <button
                onClick={onClear}
                className="p-1.5 rounded-lg hover:bg-interactive-hover transition-colors"
                title="Clear selection"
                aria-label="Clear selection"
            >
                <X className="w-4 h-4 text-content-secondary" />
            </button>

            <span className="text-sm font-medium text-content-primary">{count} selected</span>

            <div className="flex-1" />

            {error && <span className="text-xs text-red-400">{error}</span>}

            <button
                onClick={onDownload}
                disabled={busy}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-tertiary border border-stroke-subtle text-content-primary text-sm font-medium hover:bg-interactive-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                <span>Download zip</span>
            </button>

            <button
                onClick={onAddToCharacter}
                disabled={busy || imageCount === 0}
                title={imageCount === 0 ? 'Select at least one image' : imageCount > 6 ? 'Only the first 6 images will be used' : undefined}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent-primary/10 border border-accent-primary/20 text-accent-primary text-sm font-medium hover:bg-accent-primary/15 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                <span>Add to character</span>
            </button>
        </motion.div>
    );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS (no errors). The component is unused so far, which is fine.

- [ ] **Step 3: Commit**

```bash
git add components/assets/AssetSelectionToolbar.tsx
git commit -m "feat(assets): add AssetSelectionToolbar component"
```

---

## Task 2: CharacterModal accepts seed images

**Files:**
- Modify: `components/assets/CharacterModal.tsx`

- [ ] **Step 1: Add the `seedImages` prop to the interface**

In `components/assets/CharacterModal.tsx`, find the `CharacterModalProps` interface (around line 13) and add the `seedImages` line:

```tsx
interface CharacterModalProps {
    open: boolean;
    initial?: Character | null;
    /** Reference images to pre-seed a NEW character with (create mode only). */
    seedImages?: CharacterRefImage[];
    onClose: () => void;
    onSave: (input: CharacterInput, id?: string) => Promise<void>;
    /** Called when a NEW character is dismissed without Cancel (X/backdrop/Escape)
     *  and has >=1 image — persists it as a draft. */
    onSaveDraft?: (input: CharacterInput) => Promise<void>;
}
```

- [ ] **Step 2: Destructure the new prop**

Change the component signature (around line 25) from:

```tsx
export default function CharacterModal({ open, initial, onClose, onSave, onSaveDraft }: CharacterModalProps) {
```

to:

```tsx
export default function CharacterModal({ open, initial, seedImages, onClose, onSave, onSaveDraft }: CharacterModalProps) {
```

- [ ] **Step 3: Initialize images from seeds in the open effect**

Find the `useEffect` that runs on `open` (around line 47). Replace the `setImages(...)` line and the dependency array. The full effect becomes:

```tsx
    useEffect(() => {
        if (open) {
            setName(initial?.name ?? '');
            setDescription(initial?.description ?? '');
            setWeight(initial?.weight ?? 70);
            const seeded = Array.isArray(initial?.reference_images)
                ? initial!.reference_images
                : (Array.isArray(seedImages) ? seedImages.slice(0, MAX_IMAGES) : []);
            setImages(seeded);
            setErrorMsg(null);
            setGenSlots([]);
            setLightboxIndex(null);
            dismissingRef.current = false;
        }
    }, [open, initial, seedImages]);
```

(`CharacterRefImage` is already imported at the top of this file; no new import needed.)

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS. Existing callers omit `seedImages` (optional), so they still type-check.

- [ ] **Step 5: Commit**

```bash
git add components/assets/CharacterModal.tsx
git commit -m "feat(assets): CharacterModal accepts seedImages for create mode"
```

---

## Task 3: AssetsGallery — slider, selection, marquee, bulk actions

**Files:**
- Modify: `components/assets/AssetsGallery.tsx` (full rewrite)

- [ ] **Step 1: Replace the entire file**

Replace the full contents of `components/assets/AssetsGallery.tsx` with:

```tsx
'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Image as ImageIcon, Sparkles, RefreshCw, Filter, Play, LayoutGrid, Check } from 'lucide-react';
import JSZip from 'jszip';
import { createClient } from '@/lib/supabase/client';
import ImageLightbox from '@/components/ui/ImageLightbox';
import { Skeleton } from '@/components/ui/Skeleton';
import { AssetTypeFilter } from '@/components/assets/AssetTypeFilter';
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

    // Marquee: starts only when the pointer goes down on the grid background
    // (a gap between cards), never on a card itself. Hit-tests card rects on
    // each move and replaces the selection with the intersecting ids.
    const startMarquee = useCallback((e: React.PointerEvent) => {
        if (e.button !== 0 || e.target !== e.currentTarget) return;
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
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }, []);

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
        <div className="space-y-5">
            <div className="flex items-center justify-between gap-4">
                <p className="text-sm text-content-tertiary">
                    {isLoading ? 'Loading…' : `${visibleAssets.length} ${visibleAssets.length === 1 ? 'result' : 'results'}`}
                </p>
                <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-content-tertiary" title="Assets per row">
                        <LayoutGrid className="w-4 h-4" />
                        <input
                            type="range"
                            min={MIN_COLUMNS}
                            max={MAX_COLUMNS}
                            step={1}
                            value={columns}
                            onChange={(e) => setColumns(parseInt(e.target.value, 10))}
                            className="w-24 accent-accent-primary cursor-pointer"
                            aria-label="Assets per row"
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
                    onPointerDown={startMarquee}
                    className="grid gap-5 select-none"
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
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev`, open `http://localhost:3000/assets`, Assets tab. Verify:
- Dragging the slider from 3→10 makes cards smaller/more-per-row; reload the page and the column count persists.
- Plain click on a card opens the lightbox.
- Ctrl/Cmd-click toggles a card's selection (accent ring + checked checkbox); Shift-click selects a contiguous range; clicking the corner checkbox toggles without opening the lightbox.
- Dragging from an empty gap draws a selection rectangle and selects intersecting cards.
- The toolbar appears when ≥1 selected; Esc and the X button clear the selection.
- "Download zip" with several selected downloads one `.zip` containing the files.
- "Add to character" is disabled with no images selected; with ≥1 image selected it opens the Character modal pre-seeded with those reference images; saving creates the character and clears the selection.

- [ ] **Step 4: Commit**

```bash
git add components/assets/AssetsGallery.tsx
git commit -m "feat(assets): multi-select, density slider, bulk download + add-to-character"
```

---

## Self-Review Notes

- **Spec coverage:** Slider 3–10 + persistence (Task 3 Step 1, `loadColumns`/`COLUMNS_KEY`); Ctrl/Shift/checkbox/marquee selection (Task 3 `handleCardActivate`/`handleCheckboxToggle`/`startMarquee`); Download zip (Task 3 `handleDownload` + Task 1 toolbar); Add-to-character images-only cap 6 (Task 3 `handleAddToCharacter` + Task 2 `seedImages`); delete deferred (absent by design); no DB changes (none present).
- **Type consistency:** Toolbar prop `adding` matches gallery `adding={addingToCharacter}`; `error` prop optional in both; `registerRef(id, el)` signature matches `registerCard`; `AssetType`/`AssetItem`/`TypeFilter` imported from `lib/assets/unpack`; `CharacterRefImage`/`uploadApi`/`charactersApi` imported from `lib/api/client`; `uploadApi.uploadUrl` returns `{ path, publicUrl }` (verified).
- **No placeholders:** every code step is complete file/edit content.
```
