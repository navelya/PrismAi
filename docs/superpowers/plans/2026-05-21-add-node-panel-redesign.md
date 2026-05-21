# Add Node Panel Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the slide-based Add Node panel in `WorkspaceLayout.tsx` with a master + hover-flyout layout per [docs/superpowers/specs/2026-05-21-add-node-panel-redesign-design.md](../specs/2026-05-21-add-node-panel-redesign-design.md): real header strip with assets-style X, search input, curated 6-tile Basics section, 1-column Categories/Providers lists, and a sibling flyout panel that opens on hover.

**Architecture:** Three new files under `components/editor/`: a shared row/tile module, a stateless `NodeLibraryFlyout`, and a stateful `NodeLibraryPanel` that owns search state and hover timers. `WorkspaceLayout.tsx` is reduced to mounting these inside its existing `AnimatePresence` block; the surrounding tool-rail, assets, templates and chat layout is untouched.

**Tech Stack:** React 18, TypeScript, Next.js 14, Tailwind (existing design tokens: `surface-*`, `content-*`, `stroke-*`, `accent-*`), `lucide-react` icons, Framer Motion (already imported in `WorkspaceLayout`), the existing Zustand store (`useAppStore`).

**Verification:** This repo has no test runner. The reliable type-check command per project memory is `npx tsc --noEmit`. Manual checks happen at the end via `npm run dev` (port 3000).

---

## File Structure

| Path | Responsibility | Status |
|---|---|---|
| `components/editor/node-library/rows.tsx` | Pure presentational row/tile components shared by master, flyout, and search-results views. Exports `BasicsTile`, `CategoryRow`, `ProviderRow`, `NodeItemRow`, `ModelItemRow`. | Create |
| `components/editor/NodeLibraryFlyout.tsx` | Stateless secondary panel rendering items for a hovered Category or Provider. | Create |
| `components/editor/NodeLibraryPanel.tsx` | Stateful master panel: header, search input, sections, hover-flyout coordination, Esc handler, `node_type_id` resolution for Generate X tiles. | Create |
| `components/layout/WorkspaceLayout.tsx` | Mount the new `NodeLibraryPanel` inside the existing `AnimatePresence` block at lines 147–305; delete the inline JSX. | Modify |

---

## Task 1: Shared row/tile primitives

**Files:**
- Create: `components/editor/node-library/rows.tsx`

- [ ] **Step 1: Create `rows.tsx` with the five row components**

```tsx
'use client';
import React from 'react';
import { ChevronRight, Building2 } from 'lucide-react';
import * as Icons from 'lucide-react';
import { NodeTypeRecord, Category, AiModel } from '@/lib/nodes/types';

type DragPayload = Record<string, unknown>;

function startDrag(e: React.DragEvent, payload: DragPayload, onAfterStart?: () => void) {
    e.dataTransfer.setData('application/reactflow', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
    if (onAfterStart) onAfterStart();
}

export interface BasicsTileProps {
    name: string;
    desc: string;
    icon: React.ComponentType<{ className?: string }>;
    payload: DragPayload;
    onDragStart?: () => void;
}

export function BasicsTile({ name, desc, icon: Icon, payload, onDragStart }: BasicsTileProps) {
    return (
        <div
            draggable
            onDragStart={e => startDrag(e, payload, onDragStart)}
            className="flex items-center gap-3 p-2.5 rounded-xl border border-stroke-subtle bg-surface-primary hover:border-accent-primary hover:bg-accent-primary/5 transition-all cursor-move group shadow-sm"
        >
            <div className="w-8 h-8 rounded-lg bg-surface-secondary flex items-center justify-center flex-shrink-0 group-hover:bg-accent-primary/10 transition-colors">
                <Icon className="w-4 h-4 text-content-secondary group-hover:text-accent-primary transition-colors" />
            </div>
            <div className="flex-1 min-w-0">
                <div className="font-semibold text-[11px] text-content-primary truncate">{name}</div>
                <div className="text-[9px] text-content-tertiary truncate">{desc}</div>
            </div>
        </div>
    );
}

export interface CategoryRowProps {
    category: Category;
    active: boolean;
    onMouseEnter: () => void;
    onFocus?: () => void;
}

export function CategoryRow({ category, active, onMouseEnter, onFocus }: CategoryRowProps) {
    const IconComponent = (Icons[category.icon_reference as keyof typeof Icons] as React.ComponentType<{ className?: string }>) || Icons.Folder;
    return (
        <button
            data-active={active}
            onMouseEnter={onMouseEnter}
            onFocus={onFocus}
            className="w-full flex items-center justify-between gap-3 p-2.5 rounded-xl border border-stroke-subtle bg-surface-primary hover:border-accent-primary hover:bg-accent-primary/5 transition-all group shadow-sm text-left data-[active=true]:border-accent-primary/30 data-[active=true]:bg-accent-primary/5"
        >
            <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-surface-secondary flex items-center justify-center flex-shrink-0 group-hover:bg-accent-primary/10 transition-colors">
                    <IconComponent className="w-4 h-4 text-content-primary group-hover:text-accent-primary transition-colors" />
                </div>
                <span className="text-[11px] font-semibold text-content-primary truncate">{category.display_name}</span>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-content-tertiary flex-shrink-0" />
        </button>
    );
}

export interface ProviderRowProps {
    provider: { id: string; name: string; logo_url: string | null };
    active: boolean;
    onMouseEnter: () => void;
    onFocus?: () => void;
}

export function ProviderRow({ provider, active, onMouseEnter, onFocus }: ProviderRowProps) {
    return (
        <button
            data-active={active}
            onMouseEnter={onMouseEnter}
            onFocus={onFocus}
            className="w-full flex items-center justify-between gap-3 p-2.5 rounded-xl border border-stroke-subtle bg-surface-primary hover:border-accent-primary hover:bg-accent-primary/5 transition-all group shadow-sm text-left data-[active=true]:border-accent-primary/30 data-[active=true]:bg-accent-primary/5"
        >
            <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-surface-secondary flex items-center justify-center flex-shrink-0 group-hover:bg-accent-primary/10 transition-colors overflow-hidden p-1.5">
                    {provider.logo_url
                        ? <img src={provider.logo_url} alt={provider.name} className="w-full h-full object-contain" />
                        : <Building2 className="w-4 h-4 text-content-primary group-hover:text-accent-primary transition-colors" />}
                </div>
                <span className="text-[11px] font-semibold text-content-primary truncate">{provider.name}</span>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-content-tertiary flex-shrink-0" />
        </button>
    );
}

export interface NodeItemRowProps {
    nodeType: NodeTypeRecord;
    onDragStart?: () => void;
}

export function NodeItemRow({ nodeType, onDragStart }: NodeItemRowProps) {
    const IconComp = (Icons[nodeType.icon_reference as keyof typeof Icons] as React.ComponentType<{ className?: string }>) || Icons.Zap;
    return (
        <div
            draggable
            onDragStart={e => startDrag(e, { type: 'ai_generator', node_type_id: nodeType.id, archetype_id: nodeType.archetype_id }, onDragStart)}
            className="flex items-center gap-3 p-3 border border-stroke-subtle rounded-xl cursor-move hover:border-accent-primary hover:bg-accent-primary/5 transition-all bg-surface-primary group shadow-sm"
        >
            <div className="w-10 h-10 rounded-lg bg-surface-secondary flex items-center justify-center flex-shrink-0 group-hover:bg-accent-primary/10 transition-colors">
                <IconComp className="w-5 h-5 text-content-secondary group-hover:text-accent-primary transition-colors" />
            </div>
            <div className="flex-1 min-w-0">
                <div className="font-bold text-sm text-content-primary truncate">{nodeType.display_name}</div>
                <div className="text-[10px] text-content-tertiary uppercase tracking-wider">Dynamic node</div>
            </div>
        </div>
    );
}

export interface ModelItemRowProps {
    model: AiModel;
    provider?: { name: string; logo_url: string | null } | null;
    onDragStart?: () => void;
}

export function ModelItemRow({ model, provider, onDragStart }: ModelItemRowProps) {
    return (
        <div
            draggable
            onDragStart={e => startDrag(e, { type: 'ai_generator', node_type_id: model.node_type_id, model_id: model.id }, onDragStart)}
            className="flex items-center gap-3 p-3 border border-stroke-subtle rounded-xl cursor-move hover:border-accent-primary hover:bg-accent-primary/5 transition-all bg-surface-primary group shadow-sm"
        >
            <div className="w-10 h-10 rounded-lg bg-surface-secondary flex items-center justify-center flex-shrink-0 group-hover:bg-accent-primary/10 transition-colors overflow-hidden p-1.5">
                {provider?.logo_url
                    ? <img src={provider.logo_url} alt={provider.name} className="w-full h-full object-contain" />
                    : <Icons.Box className="w-5 h-5 text-content-secondary group-hover:text-accent-primary transition-colors" />}
            </div>
            <div className="flex-1 min-w-0">
                <div className="font-bold text-sm text-content-primary truncate">{model.display_name}</div>
                <div className="text-[10px] text-content-tertiary uppercase tracking-wider">{model.replicate_model_id.split(':')[0]}</div>
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no errors). If errors mention `lucide-react` icon types, narrow `Icons[...]` to `React.ComponentType<{ className?: string }>` casts (already shown above).

- [ ] **Step 3: Commit**

```bash
git add components/editor/node-library/rows.tsx
git commit -m "feat(node-library): shared row/tile primitives

Pure presentational components reused by the new master panel,
hover-flyout, and search-results views.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: NodeLibraryFlyout component

**Files:**
- Create: `components/editor/NodeLibraryFlyout.tsx`

- [ ] **Step 1: Create the flyout component**

```tsx
'use client';
import React from 'react';
import * as Icons from 'lucide-react';
import { NodeTypeRecord, AiModel } from '@/lib/nodes/types';
import { NodeItemRow, ModelItemRow } from './node-library/rows';

export type FlyoutMode =
    | { kind: 'category'; categoryName: string; items: NodeTypeRecord[] }
    | { kind: 'provider'; providerName: string; items: AiModel[]; providers: { id: string; name: string; logo_url: string | null }[] };

export interface NodeLibraryFlyoutProps {
    mode: FlyoutMode;
    /** Viewport-relative left offset of the flyout in px. */
    left: number;
    /** Viewport-relative top offset in px, already clamped by the parent. */
    top: number;
    /** Height of the flyout in px. */
    height: number;
    /** Called when the cursor enters the flyout — cancels the parent's pending close. */
    onMouseEnter: () => void;
    /** Called when the cursor leaves the flyout — schedules a close in the parent. */
    onMouseLeave: () => void;
    /** Called from row drag-start to dismiss the entire panel stack. */
    onDragStartClose: () => void;
}

export default function NodeLibraryFlyout({ mode, left, top, height, onMouseEnter, onMouseLeave, onDragStartClose }: NodeLibraryFlyoutProps) {
    const isCategory = mode.kind === 'category';
    const eyebrow = isCategory ? 'Nodes' : `Models from ${mode.providerName}`;
    const title = isCategory ? mode.categoryName : mode.providerName;
    const isEmpty = mode.items.length === 0;

    return (
        <div
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            className="absolute pointer-events-auto bg-surface-elevated/80 backdrop-blur-md border border-stroke-subtle rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            style={{ left, top, height, width: 280 }}
        >
            <div className="px-3 pt-3 pb-2 border-b border-stroke-subtle/60">
                <p className="text-[10px] font-bold uppercase tracking-widest text-content-tertiary">{eyebrow}</p>
                <h4 className="text-sm font-bold text-content-primary truncate">{title}</h4>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {isEmpty ? (
                    <div className="flex flex-col items-center justify-center py-12 text-content-tertiary">
                        <Icons.Inbox className="w-8 h-8 mb-2 opacity-20" />
                        <span className="text-xs">No items found</span>
                    </div>
                ) : mode.kind === 'category' ? (
                    mode.items.map(nt => (
                        <NodeItemRow key={nt.id} nodeType={nt} onDragStart={onDragStartClose} />
                    ))
                ) : (
                    mode.items.map(model => {
                        const provider = mode.providers.find(p => p.id === String(model.provider_id));
                        return <ModelItemRow key={model.id} model={model} provider={provider} onDragStart={onDragStartClose} />;
                    })
                )}
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS. If `model.provider_id` is `number` in `AiModel`, the `String(model.provider_id)` cast above handles the comparison; if it's already a string, the cast is a no-op.

- [ ] **Step 3: Commit**

```bash
git add components/editor/NodeLibraryFlyout.tsx
git commit -m "feat(node-library): hover-flyout panel

Stateless secondary panel rendering either the node types in a
hovered category or the models from a hovered provider. Forwards
mouseenter/leave to the parent so it can coordinate close timing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: NodeLibraryPanel component (master)

**Files:**
- Create: `components/editor/NodeLibraryPanel.tsx`

- [ ] **Step 1: Determine the resolved store shape**

Read `lib/store/types.ts` and `lib/store/slices/ui-slice.ts` to confirm the exact names exposed by `useAppStore`. Expected selectors (from the existing `WorkspaceLayout.tsx`):
- `categories: Category[]`
- `nodeTypes: NodeTypeRecord[]`
- `providers: { id: string; name: string; logo_url: string | null }[]`
- `models: AiModel[]`

If any name differs (e.g. `aiModels` instead of `models`), substitute throughout this task.

- [ ] **Step 2: Create the master panel**

```tsx
'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Icons from 'lucide-react';
import { Search, X, ChevronRight } from 'lucide-react';
import { useAppStore } from '@/lib/store/app-store';
import type { NodeTypeRecord, AiModel, Category } from '@/lib/nodes/types';
import { BasicsTile, CategoryRow, ProviderRow, NodeItemRow, ModelItemRow } from './node-library/rows';
import NodeLibraryFlyout, { FlyoutMode } from './NodeLibraryFlyout';

const HOVER_OPEN_MS = 80;
const HOVER_CLOSE_MS = 150;
const FLYOUT_WIDTH = 280;
const FLYOUT_GAP = 12;

interface Tile {
    name: string;
    desc: string;
    icon: React.ComponentType<{ className?: string }>;
    /** If set, this tile is hidden when no nodeType matches any candidate id. */
    nodeTypeCandidates?: string[];
    /** Static payload used when nodeTypeCandidates is not set. */
    payload?: Record<string, unknown>;
}

const BASICS_TILES: Tile[] = [
    { name: 'Text prompt', desc: 'Plain text input', icon: Icons.Type, payload: { type: 'prompt' } },
    { name: 'Upload image', desc: 'Image / video', icon: Icons.Image, payload: { type: 'media_input' } },
    { name: 'Generate text', desc: 'AI text output', icon: Icons.Type, nodeTypeCandidates: ['text_generation', 'generate_text', 'generate-text'] },
    { name: 'Generate image', desc: 'AI image output', icon: Icons.Image, nodeTypeCandidates: ['image_generation', 'generate_image', 'generate-image'] },
    { name: 'Generate video', desc: 'AI video output', icon: Icons.Video, nodeTypeCandidates: ['video_generation', 'generate_video', 'generate-video'] },
    { name: 'Compositor', desc: 'Combine layers', icon: Icons.Layers, payload: { type: 'compositor' } },
];

export interface NodeLibraryPanelProps {
    onClose: () => void;
}

export default function NodeLibraryPanel({ onClose }: NodeLibraryPanelProps) {
    const categories = useAppStore(s => s.categories) as Category[];
    const nodeTypes = useAppStore(s => s.nodeTypes) as NodeTypeRecord[];
    const providers = useAppStore(s => s.providers) as { id: string; name: string; logo_url: string | null }[];
    const models = useAppStore(s => s.models) as AiModel[];

    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [hoveredKind, setHoveredKind] = useState<null | 'category' | 'provider'>(null);
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const [flyoutTop, setFlyoutTop] = useState(0);
    const [flyoutHeight, setFlyoutHeight] = useState(0);

    const containerRef = useRef<HTMLDivElement | null>(null);
    const openTimer = useRef<number | null>(null);
    const closeTimer = useRef<number | null>(null);

    // Debounced search
    useEffect(() => {
        const t = window.setTimeout(() => setDebouncedQuery(query), 80);
        return () => window.clearTimeout(t);
    }, [query]);

    // Esc closes the entire panel.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    // Resolve Basics tiles against loaded nodeTypes.
    const resolvedBasics = useMemo(() => {
        return BASICS_TILES.map(t => {
            if (t.payload) return { tile: t, payload: t.payload as Record<string, unknown> };
            const match = nodeTypes.find(nt => t.nodeTypeCandidates!.includes(nt.id));
            if (!match) return null;
            return { tile: t, payload: { type: 'ai_generator', node_type_id: match.id, archetype_id: match.archetype_id } };
        }).filter((x): x is { tile: Tile; payload: Record<string, unknown> } => x !== null);
    }, [nodeTypes]);

    const clearTimers = useCallback(() => {
        if (openTimer.current) { window.clearTimeout(openTimer.current); openTimer.current = null; }
        if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
    }, []);

    const scheduleOpen = useCallback((kind: 'category' | 'provider', id: string, rowEl: HTMLElement) => {
        clearTimers();
        // Compute top position immediately so a row→row swap is instant.
        if (hoveredKind && hoveredId) {
            // Swap — apply immediately, recompute top
            const rect = rowEl.getBoundingClientRect();
            const container = containerRef.current?.getBoundingClientRect();
            const maxBottom = (container?.bottom ?? window.innerHeight) - 8;
            const desiredHeight = Math.min(420, maxBottom - rect.top);
            setHoveredKind(kind);
            setHoveredId(id);
            setFlyoutTop(rect.top);
            setFlyoutHeight(desiredHeight);
            return;
        }
        openTimer.current = window.setTimeout(() => {
            const rect = rowEl.getBoundingClientRect();
            const container = containerRef.current?.getBoundingClientRect();
            const maxBottom = (container?.bottom ?? window.innerHeight) - 8;
            const desiredHeight = Math.min(420, maxBottom - rect.top);
            setHoveredKind(kind);
            setHoveredId(id);
            setFlyoutTop(rect.top);
            setFlyoutHeight(desiredHeight);
        }, HOVER_OPEN_MS);
    }, [hoveredKind, hoveredId, clearTimers]);

    const scheduleClose = useCallback(() => {
        if (openTimer.current) { window.clearTimeout(openTimer.current); openTimer.current = null; }
        if (closeTimer.current) window.clearTimeout(closeTimer.current);
        closeTimer.current = window.setTimeout(() => {
            setHoveredKind(null);
            setHoveredId(null);
        }, HOVER_CLOSE_MS);
    }, []);

    const cancelClose = useCallback(() => {
        if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
    }, []);

    useEffect(() => () => clearTimers(), [clearTimers]);

    // Close flyout when searching.
    useEffect(() => {
        if (debouncedQuery) {
            clearTimers();
            setHoveredKind(null);
            setHoveredId(null);
        }
    }, [debouncedQuery, clearTimers]);

    // ── Search results ────────────────────────────────────────────────────
    const q = debouncedQuery.trim().toLowerCase();
    const basicsHits = q
        ? resolvedBasics.filter(({ tile }) => tile.name.toLowerCase().includes(q) || tile.desc.toLowerCase().includes(q))
        : [];
    const nodeHits = q
        ? nodeTypes.filter(nt => nt.display_name.toLowerCase().includes(q))
        : [];
    const modelHits = q
        ? models.filter(m => m.display_name.toLowerCase().includes(q) || m.replicate_model_id.toLowerCase().includes(q))
        : [];
    const noHits = q && basicsHits.length === 0 && nodeHits.length === 0 && modelHits.length === 0;

    // ── Flyout content ────────────────────────────────────────────────────
    const flyoutMode: FlyoutMode | null = useMemo(() => {
        if (!hoveredKind || !hoveredId) return null;
        if (hoveredKind === 'category') {
            const category = categories.find(c => c.id === hoveredId);
            if (!category) return null;
            const items = nodeTypes.filter(nt => nt.parent_categories?.includes(hoveredId));
            return { kind: 'category', categoryName: category.display_name, items };
        }
        const provider = providers.find(p => p.id === hoveredId);
        if (!provider) return null;
        const items = models.filter(m => String(m.provider_id) === hoveredId);
        return { kind: 'provider', providerName: provider.name, items, providers };
    }, [hoveredKind, hoveredId, categories, nodeTypes, providers, models]);

    const handleDragStartClose = useCallback(() => onClose(), [onClose]);

    // Position the flyout immediately to the right of the master panel,
    // skipping the ~44 px occupied by the floating tool rail.
    const flyoutLeft = useMemo(() => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return 0;
        return rect.right + FLYOUT_GAP + 44 + FLYOUT_GAP;
    }, [hoveredKind, hoveredId]);

    return (
        <div ref={containerRef} className="relative w-full h-full bg-surface-elevated/80 backdrop-blur-md border border-stroke-subtle rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-stroke-subtle/60">
                <span className="text-[13px] font-semibold text-content-primary">Add node</span>
                <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-md transition-colors group" title="Close">
                    <X className="w-3.5 h-3.5 text-content-tertiary group-hover:text-content-primary" />
                </button>
            </div>

            {/* Search */}
            <div className="px-3 pt-2 pb-2">
                <div className="relative" onMouseEnter={scheduleClose}>
                    <Search className="w-3.5 h-3.5 text-content-tertiary absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Search nodes or models"
                        className="w-full bg-surface-secondary border border-stroke-subtle rounded-lg pl-7 pr-7 py-1.5 text-[12px] text-content-primary placeholder:text-content-tertiary focus:border-accent-primary focus:outline-none"
                    />
                    {query && (
                        <button
                            type="button"
                            onClick={() => setQuery('')}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-white/10 transition-colors"
                            title="Clear"
                        >
                            <X className="w-3 h-3 text-content-tertiary" />
                        </button>
                    )}
                </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden">
                {q ? (
                    /* Flat search results */
                    <div className="p-3 space-y-4">
                        {basicsHits.length > 0 && (
                            <section>
                                <SectionLabel icon={Icons.Sparkles}>Basics</SectionLabel>
                                <div className="grid grid-cols-2 gap-2">
                                    {basicsHits.map(({ tile, payload }) => (
                                        <BasicsTile key={tile.name} name={tile.name} desc={tile.desc} icon={tile.icon} payload={payload} onDragStart={handleDragStartClose} />
                                    ))}
                                </div>
                            </section>
                        )}
                        {nodeHits.length > 0 && (
                            <section>
                                <SectionLabel icon={Icons.Grid}>Nodes</SectionLabel>
                                <div className="space-y-2">
                                    {nodeHits.map(nt => <NodeItemRow key={nt.id} nodeType={nt} onDragStart={handleDragStartClose} />)}
                                </div>
                            </section>
                        )}
                        {modelHits.length > 0 && (
                            <section>
                                <SectionLabel icon={Icons.Server}>Models</SectionLabel>
                                <div className="space-y-2">
                                    {modelHits.map(m => {
                                        const provider = providers.find(p => p.id === String(m.provider_id));
                                        return <ModelItemRow key={m.id} model={m} provider={provider} onDragStart={handleDragStartClose} />;
                                    })}
                                </div>
                            </section>
                        )}
                        {noHits && (
                            <div className="flex flex-col items-center justify-center py-12 text-content-tertiary">
                                <Icons.Inbox className="w-8 h-8 mb-2 opacity-20" />
                                <span className="text-xs">No nodes or models match &ldquo;{query}&rdquo;</span>
                            </div>
                        )}
                    </div>
                ) : (
                    /* Default sectioned view */
                    <div className="p-3 space-y-6 pb-6">
                        <section>
                            <SectionLabel icon={Icons.Sparkles}>Basics</SectionLabel>
                            <div className="grid grid-cols-2 gap-2">
                                {resolvedBasics.map(({ tile, payload }) => (
                                    <BasicsTile key={tile.name} name={tile.name} desc={tile.desc} icon={tile.icon} payload={payload} onDragStart={handleDragStartClose} />
                                ))}
                            </div>
                        </section>

                        <section onMouseLeave={scheduleClose}>
                            <SectionLabel icon={Icons.Grid}>Categories</SectionLabel>
                            <div className="space-y-2">
                                {categories.map(cat => (
                                    <CategoryRow
                                        key={cat.id}
                                        category={cat}
                                        active={hoveredKind === 'category' && hoveredId === cat.id}
                                        onMouseEnter={() => {
                                            cancelClose();
                                            const el = document.getElementById(`nl-cat-${cat.id}`);
                                            if (el) scheduleOpen('category', cat.id, el);
                                        }}
                                    />
                                ))}
                            </div>
                        </section>

                        <section onMouseLeave={scheduleClose}>
                            <SectionLabel icon={Icons.Server}>Providers</SectionLabel>
                            <div className="space-y-2">
                                {providers.map(p => (
                                    <ProviderRow
                                        key={p.id}
                                        provider={p}
                                        active={hoveredKind === 'provider' && hoveredId === p.id}
                                        onMouseEnter={() => {
                                            cancelClose();
                                            const el = document.getElementById(`nl-prv-${p.id}`);
                                            if (el) scheduleOpen('provider', p.id, el);
                                        }}
                                    />
                                ))}
                            </div>
                        </section>
                    </div>
                )}
            </div>

            {flyoutMode && (
                <NodeLibraryFlyout
                    mode={flyoutMode}
                    left={flyoutLeft}
                    top={flyoutTop}
                    height={flyoutHeight}
                    onMouseEnter={cancelClose}
                    onMouseLeave={scheduleClose}
                    onDragStartClose={handleDragStartClose}
                />
            )}
        </div>
    );
}

function SectionLabel({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
    return (
        <div className="flex items-center gap-2 mb-2">
            <div className="w-4 h-4 rounded-md bg-accent-primary/10 flex items-center justify-center">
                <Icon className="w-2.5 h-2.5 text-accent-primary" />
            </div>
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-content-tertiary">{children}</h4>
        </div>
    );
}
```

Two corrections to apply while writing the code above:

1. **Row id wiring.** The `onMouseEnter` handler resolves the row element via `document.getElementById('nl-cat-...')` / `nl-prv-...`. Update the `CategoryRow` and `ProviderRow` components in `rows.tsx` so the rendered `<button>` carries an `id` prop. Open `components/editor/node-library/rows.tsx`, add an optional `id?: string` field to both `CategoryRowProps` and `ProviderRowProps`, and pass `id={id}` to the `<button>`. Then in this panel, pass `id={`nl-cat-${cat.id}`}` and `id={`nl-prv-${p.id}`}` to the rows instead of looking them up via `document.getElementById`. Replace the two `onMouseEnter` arrow functions with: `onMouseEnter={e => { cancelClose(); scheduleOpen('category', cat.id, e.currentTarget); }}` (using `e.currentTarget` via `onMouseEnter: (e) => void` — change the `onMouseEnter` type in `rows.tsx` from `() => void` to `(e: React.MouseEvent<HTMLButtonElement>) => void`).
2. **Flyout left recompute.** `flyoutLeft` reads `containerRef.current?.getBoundingClientRect()` inside a `useMemo`; the memo's deps don't include the ref so React won't re-run it on first mount. Replace the `useMemo` with a `useState` initialized to `0` and a `useEffect` (deps: `[hoveredKind, hoveredId]`) that reads the bounding rect and `setFlyoutLeft(...)`.

- [ ] **Step 3: Update `rows.tsx` per correction #1**

Edit `components/editor/node-library/rows.tsx`:

```tsx
export interface CategoryRowProps {
    id?: string;
    category: Category;
    active: boolean;
    onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => void;
    onFocus?: () => void;
}

export function CategoryRow({ id, category, active, onMouseEnter, onFocus }: CategoryRowProps) {
    const IconComponent = (Icons[category.icon_reference as keyof typeof Icons] as React.ComponentType<{ className?: string }>) || Icons.Folder;
    return (
        <button
            id={id}
            data-active={active}
            onMouseEnter={onMouseEnter}
            onFocus={onFocus}
            className="..."
        >
            ...
        </button>
    );
}
```

Apply the same `id?: string` + `onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => void` change to `ProviderRowProps` / `ProviderRow`.

- [ ] **Step 4: Apply correction #2 to `NodeLibraryPanel.tsx`**

Replace the `flyoutLeft` `useMemo` with:

```tsx
const [flyoutLeft, setFlyoutLeft] = useState(0);
useEffect(() => {
    if (!hoveredKind || !hoveredId) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setFlyoutLeft(rect.right + FLYOUT_GAP + 44 + FLYOUT_GAP);
}, [hoveredKind, hoveredId]);
```

And replace the two `onMouseEnter` arrow handlers on `CategoryRow` / `ProviderRow` mounts with:

```tsx
onMouseEnter={e => { cancelClose(); scheduleOpen('category', cat.id, e.currentTarget); }}
```
```tsx
onMouseEnter={e => { cancelClose(); scheduleOpen('provider', p.id, e.currentTarget); }}
```

(and pass `id={`nl-cat-${cat.id}`}` / `id={`nl-prv-${p.id}`}` for completeness — they are no longer used for lookup but are useful for testing/devtools).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS. Likely fixes if errors appear:
- `useAppStore` selector returns `unknown` → confirm store slice exports and add `as` casts at the selector site.
- `AiModel.provider_id` is `number` but compared to `string` → already handled with `String(...)`.

- [ ] **Step 6: Commit**

```bash
git add components/editor/NodeLibraryPanel.tsx components/editor/node-library/rows.tsx
git commit -m "feat(node-library): master panel with search and hover-flyout coordination

Header strip with assets-style X, debounced search, 6-tile Basics
grid, 1-col Categories and Providers lists. Owns hover open/close
timers and Esc handler; mounts NodeLibraryFlyout for the currently
hovered row.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Wire NodeLibraryPanel into WorkspaceLayout

**Files:**
- Modify: `components/layout/WorkspaceLayout.tsx` (lines 147–305, plus its import block)

- [ ] **Step 1: Read the current panel block**

Open `components/layout/WorkspaceLayout.tsx` and confirm the inline Node Library JSX runs from line 147 (the `{/* ── LAYER 3a · Node Library Panel ─────── */}` comment) through line 305 (the closing `</AnimatePresence>` for `key="node-library"`). All of that block is being replaced.

- [ ] **Step 2: Add the import**

At the top of `components/layout/WorkspaceLayout.tsx`, near the other `components/editor/...` imports (e.g. the `AssetsPanel` import), add:

```tsx
import NodeLibraryPanel from '@/components/editor/NodeLibraryPanel';
```

- [ ] **Step 3: Replace the inline block**

Replace lines 147–305 with:

```tsx
{/* ── LAYER 3a · Node Library Panel ─────────────────────────────── */}
<AnimatePresence>
    {isCanvasMode && isNodeLibraryOpen && (
        <motion.div
            key="node-library"
            className="absolute left-4 bottom-4 z-[55] pointer-events-auto"
            style={{ width: `${PANEL_W}px`, top: `${TOP_BAR_OFFSET}px` }}
            initial={{ opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
        >
            <NodeLibraryPanel onClose={() => setActivePanel(null)} />
        </motion.div>
    )}
</AnimatePresence>
```

- [ ] **Step 4: Remove now-unused state**

The replaced block referenced `selectedCategoryId` / `selectedProviderId` / `setSelectedCategoryId` / `setSelectedProviderId` setters. Search the file for those identifiers; if they're declared as `useState` in `WorkspaceLayout` itself (look at the top of the component body, around line 40–60), delete those `useState` lines too. If they're still used elsewhere in the file (unlikely after the replacement), leave them.

Also remove any imports that became unused as a result: `ArrowLeft`, `Building2`, `Folder`, `Box`, `Zap`, `cn` (if cn is only used by the deleted block — keep it if used elsewhere). Run a quick search for each identifier within the file; delete the imports only if no usages remain.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS. Likely fixes:
- "Cannot find name 'selectedCategoryId'" — remove additional dangling references.
- "Unused import" — only matters if the project has `noUnusedLocals` on; if so, drop the imports.

- [ ] **Step 6: Commit**

```bash
git add components/layout/WorkspaceLayout.tsx
git commit -m "refactor(workspace): mount NodeLibraryPanel, drop inline node library JSX

The Add Node panel's content is now owned by components/editor/
NodeLibraryPanel; WorkspaceLayout only positions the AnimatePresence
wrapper and provides the onClose callback.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Manual verification

**Files:** none

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: server boots on http://localhost:3000 (port may differ; check console).

- [ ] **Step 2: Open the canvas and toggle the Add Node panel**

In the browser: open any canvas session, click the `+` (Add Node) button on the tool rail. Confirm:
- Panel slides in from the left, same geometry as before.
- Header reads "Add node" with a small X on the right that matches the Assets panel X.
- Search input visible below the header with a left-aligned search icon.
- Three sections visible: BASICS (2-col tiles), CATEGORIES (1-col rows with chevrons), PROVIDERS (1-col rows with chevrons).

- [ ] **Step 3: Test hover-flyout**

- Hover a Category row → after a brief delay a second glass card appears to the right of the tool rail, aligned with the hovered row's top, listing that category's node types.
- Move the cursor between Category rows → flyout swaps content with no flash.
- Move the cursor off the row and into the flyout → flyout stays open.
- Move the cursor away from both → flyout closes after ~150 ms.
- Confirm the tool rail does not shift position when the flyout opens.
- Repeat for Providers.

- [ ] **Step 4: Test drag**

- Drag a Basics tile (Text prompt, Upload image, Compositor) onto the canvas → node drops, panel closes.
- Drag a "Generate X" tile (if data has the matching node_type_id) → ai_generator node drops, panel closes.
- Drag a row out of the Category flyout → ai_generator node drops, panel closes.
- Drag a row out of the Provider flyout → ai_generator node drops, panel closes.

- [ ] **Step 5: Test search**

- Type into the search box → sections disappear, flat results appear grouped by Basics / Nodes / Models.
- Type a string with no matches → empty state "No nodes or models match ..." appears.
- Click the small X inside the search input → input clears, sections return.
- Hover-flyout should not open while search is active.

- [ ] **Step 6: Test Esc and close button**

- Open the panel, press Esc → panel closes.
- Open the panel, click the header X → panel closes.
- Open the panel, click the canvas behind → panel closes (existing outside-click behavior).

- [ ] **Step 7: Commit any small fixes**

If anything misbehaves, fix it and commit as `fix(node-library): <one-line description>` with the same Co-Authored-By footer. If everything passes, no commit needed.

---

## Self-Review Notes

- **Spec coverage:** ✓ header X (Task 3), ✓ search box + behavior (Task 3), ✓ 6 Basics tiles with node_type_id fallback (Task 3), ✓ Categories/Providers as 1-col with chevron (Tasks 1, 3), ✓ hover flyout with timings (Task 3), ✓ tool rail stationary (Task 4 — left unchanged), ✓ Esc closes both (Task 3), ✓ flat search results layout (Task 3), ✓ component split per spec (Tasks 1–3).
- **Placeholders:** none — every step contains the actual code or commands.
- **Type consistency:** `BasicsTile` / `CategoryRow` / `ProviderRow` / `NodeItemRow` / `ModelItemRow` props are defined in Task 1 and consumed unchanged in Tasks 2–3. `FlyoutMode` is defined in Task 2 and constructed in Task 3. `useAppStore` selectors use names confirmed in Task 3 Step 1.
- **Risks:** the corrections in Task 3 Steps 3–4 deliberately undo and rewrite parts of the initial Step 2 listing — the engineer must apply Step 2 first, then the corrections. If the engineer cherry-picks code from Step 2 alone, the panel will use `document.getElementById` lookups instead of `e.currentTarget` (functional but less clean) and the first flyout open will read a stale `flyoutLeft` of `0` (bug). Run Steps 2–4 in order.
