'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as Icons from 'lucide-react';
import { Search, X } from 'lucide-react';
import { useAppStore } from '@/lib/store/app-store';
import type { NodeTypeRecord, AiModel, Category } from '@/lib/nodes/types';
import { BasicsTile, CategoryRow, ProviderRow, NodeItemRow, ModelItemRow } from './node-library/rows';
import NodeLibraryFlyout, { FlyoutMode } from './NodeLibraryFlyout';

const HOVER_OPEN_MS = 60;
const HOVER_CLOSE_MS = 160;
// Horizontal distance from the master panel's right edge to the flyout's
// left edge. Small — the flyout sits immediately next to the master and
// renders on top of the tool rail (rail is z-1, flyout is z-55).
const FLYOUT_OFFSET_FROM_MASTER = 8;
const FLYOUT_MAX_HEIGHT = 480;

interface Tile {
    name: string;
    /** Search-only metadata; not displayed. */
    desc: string;
    icon: React.ComponentType<{ className?: string }>;
    /** If set, this tile is hidden when no nodeType matches any candidate id. */
    nodeTypeCandidates?: string[];
    /** Static payload used when nodeTypeCandidates is not set. */
    payload?: Record<string, unknown>;
}

const BASICS_TILES: Tile[] = [
    { name: 'Text prompt', desc: 'plain text input', icon: Icons.Type, payload: { type: 'prompt' } },
    { name: 'Upload image', desc: 'image video upload media', icon: Icons.Image, payload: { type: 'media_input' } },
    { name: 'Generate text', desc: 'ai text llm', icon: Icons.Type, nodeTypeCandidates: ['text_generation', 'generate_text', 'generate-text'] },
    { name: 'Generate image', desc: 'ai image picture', icon: Icons.Image, nodeTypeCandidates: ['image_generation', 'generate_image', 'generate-image'] },
    { name: 'Generate video', desc: 'ai video animation', icon: Icons.Video, nodeTypeCandidates: ['video_generation', 'generate_video', 'generate-video'] },
    { name: 'Compositor', desc: 'combine layers canvas', icon: Icons.Layers, payload: { type: 'compositor' } },
];

interface ProviderRec { id: string; name: string; logo_url: string | null }

export interface NodeLibraryPanelProps {
    onClose: () => void;
}

export default function NodeLibraryPanel({ onClose }: NodeLibraryPanelProps) {
    const categories = useAppStore(s => s.categories) as Category[];
    const nodeTypes = useAppStore(s => s.nodeTypes) as NodeTypeRecord[];
    const providers = useAppStore(s => s.providers) as ProviderRec[];
    const models = useAppStore(s => s.models) as AiModel[];
    const fetchCategories = useAppStore(s => s.fetchCategories);
    const fetchNodeTypes = useAppStore(s => s.fetchNodeTypes);
    const fetchProviders = useAppStore(s => s.fetchProviders);
    const fetchModels = useAppStore(s => s.fetchModels);

    useEffect(() => {
        fetchCategories();
        fetchNodeTypes();
        fetchProviders();
        fetchModels();
    }, [fetchCategories, fetchNodeTypes, fetchProviders, fetchModels]);

    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [hoveredKind, setHoveredKind] = useState<null | 'category' | 'provider'>(null);
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const [flyoutTop, setFlyoutTop] = useState(0);
    const [flyoutHeight, setFlyoutHeight] = useState(0);
    const [flyoutLeft, setFlyoutLeft] = useState(0);
    const [mounted, setMounted] = useState(false);

    useEffect(() => setMounted(true), []);

    const containerRef = useRef<HTMLDivElement | null>(null);
    const openTimer = useRef<number | null>(null);
    const closeTimer = useRef<number | null>(null);

    useEffect(() => {
        const t = window.setTimeout(() => setDebouncedQuery(query), 80);
        return () => window.clearTimeout(t);
    }, [query]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const resolvedBasics = useMemo(() => {
        return BASICS_TILES.map(t => {
            if (t.payload) return { tile: t, payload: t.payload as Record<string, unknown> };
            const match = nodeTypes.find(nt => t.nodeTypeCandidates!.includes(nt.id));
            if (!match) return null;
            return { tile: t, payload: { type: 'ai_generator', node_type_id: match.id, archetype_id: match.archetype_id } };
        }).filter((x): x is { tile: Tile; payload: Record<string, unknown> } => x !== null);
    }, [nodeTypes]);

    const scheduleOpen = useCallback((kind: 'category' | 'provider', id: string, rowEl: HTMLElement) => {
        if (openTimer.current) { window.clearTimeout(openTimer.current); openTimer.current = null; }
        if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }

        const applyPosition = () => {
            const rect = rowEl.getBoundingClientRect();
            const container = containerRef.current?.getBoundingClientRect();
            if (!container) return;
            const viewportBottom = window.innerHeight - 8;
            const maxBottom = Math.min(container.bottom, viewportBottom);
            const available = Math.max(120, maxBottom - rect.top);
            const desiredHeight = Math.min(FLYOUT_MAX_HEIGHT, available);
            const clampedTop = Math.min(rect.top, viewportBottom - desiredHeight);
            // All five state updates are batched in a single render (React 18
            // automatic batching), so the flyout never appears at the stale
            // left=0 position even for one frame.
            setFlyoutTop(clampedTop);
            setFlyoutHeight(desiredHeight);
            setFlyoutLeft(container.right + FLYOUT_OFFSET_FROM_MASTER);
            setHoveredKind(kind);
            setHoveredId(id);
        };

        if (hoveredKind && hoveredId) {
            applyPosition();
            return;
        }
        openTimer.current = window.setTimeout(applyPosition, HOVER_OPEN_MS);
    }, [hoveredKind, hoveredId]);

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

    useEffect(() => () => {
        if (openTimer.current) window.clearTimeout(openTimer.current);
        if (closeTimer.current) window.clearTimeout(closeTimer.current);
    }, []);

    useEffect(() => {
        if (debouncedQuery) {
            if (openTimer.current) { window.clearTimeout(openTimer.current); openTimer.current = null; }
            if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
            setHoveredKind(null);
            setHoveredId(null);
        }
    }, [debouncedQuery]);

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
    const noHits = !!q && basicsHits.length === 0 && nodeHits.length === 0 && modelHits.length === 0;

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

    return (
        <div
            ref={containerRef}
            onMouseLeave={scheduleClose}
            className="relative w-full h-full bg-surface-elevated/80 backdrop-blur-md border border-stroke-subtle rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        >
            {/* Search bar IS the header — close button sits next to it. */}
            <div className="flex items-center gap-2 px-2.5 py-2 border-b border-stroke-subtle/60" onMouseEnter={scheduleClose}>
                <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 text-content-tertiary absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Search nodes or models"
                        className="w-full bg-surface-secondary border border-stroke-subtle rounded-md pl-7 pr-7 py-1.5 text-[12px] text-content-primary placeholder:text-content-tertiary focus:border-accent-primary focus:outline-none"
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
                <button
                    onClick={onClose}
                    className="p-1 hover:bg-white/10 rounded-md transition-colors group"
                    title="Close"
                >
                    <X className="w-3.5 h-3.5 text-content-tertiary group-hover:text-content-primary" />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto overflow-x-hidden">
                {q ? (
                    <div className="p-2.5 space-y-4">
                        {basicsHits.length > 0 && (
                            <section>
                                <SectionLabel>Basics</SectionLabel>
                                <div className="grid grid-cols-2 gap-1">
                                    {basicsHits.map(({ tile, payload }) => (
                                        <BasicsTile key={tile.name} name={tile.name} icon={tile.icon} payload={payload} onDragStart={handleDragStartClose} />
                                    ))}
                                </div>
                            </section>
                        )}
                        {nodeHits.length > 0 && (
                            <section>
                                <SectionLabel>Nodes</SectionLabel>
                                <div className="space-y-0.5">
                                    {nodeHits.map(nt => <NodeItemRow key={nt.id} nodeType={nt} onDragStart={handleDragStartClose} />)}
                                </div>
                            </section>
                        )}
                        {modelHits.length > 0 && (
                            <section>
                                <SectionLabel>Models</SectionLabel>
                                <div className="space-y-0.5">
                                    {modelHits.map(m => {
                                        const provider = providers.find(p => p.id === String(m.provider_id));
                                        return <ModelItemRow key={m.id} model={m} provider={provider} onDragStart={handleDragStartClose} />;
                                    })}
                                </div>
                            </section>
                        )}
                        {noHits && (
                            <div className="flex flex-col items-center justify-center py-12 text-content-tertiary">
                                <Icons.Inbox className="w-7 h-7 mb-2 opacity-20" />
                                <span className="text-[11px]">No nodes or models match &ldquo;{query}&rdquo;</span>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="p-2.5 space-y-3 pb-4">
                        <section onMouseEnter={scheduleClose}>
                            <SectionLabel>Basics</SectionLabel>
                            <div className="grid grid-cols-2 gap-1">
                                {resolvedBasics.map(({ tile, payload }) => (
                                    <BasicsTile key={tile.name} name={tile.name} icon={tile.icon} payload={payload} onDragStart={handleDragStartClose} />
                                ))}
                            </div>
                        </section>

                        {categories.length > 0 && (
                            <section>
                                <SectionLabel>Categories</SectionLabel>
                                <div className="space-y-0.5">
                                    {categories.map(cat => (
                                        <CategoryRow
                                            key={cat.id}
                                            id={`nl-cat-${cat.id}`}
                                            category={cat}
                                            active={hoveredKind === 'category' && hoveredId === cat.id}
                                            onMouseEnter={e => { cancelClose(); scheduleOpen('category', cat.id, e.currentTarget); }}
                                        />
                                    ))}
                                </div>
                            </section>
                        )}

                        {providers.length > 0 && (
                            <section>
                                <SectionLabel>Providers</SectionLabel>
                                <div className="space-y-0.5">
                                    {providers.map(p => (
                                        <ProviderRow
                                            key={p.id}
                                            id={`nl-prv-${p.id}`}
                                            provider={p}
                                            active={hoveredKind === 'provider' && hoveredId === p.id}
                                            onMouseEnter={e => { cancelClose(); scheduleOpen('provider', p.id, e.currentTarget); }}
                                        />
                                    ))}
                                </div>
                            </section>
                        )}
                    </div>
                )}
            </div>

            {/* Portal the flyout to <body> so it escapes the panel's
                overflow-hidden and the framer-motion wrapper's transform
                (which would otherwise become the containing block for
                the flyout's position:fixed coordinates and clip it). */}
            {mounted && flyoutMode && createPortal(
                <NodeLibraryFlyout
                    mode={flyoutMode}
                    left={flyoutLeft}
                    top={flyoutTop}
                    height={flyoutHeight}
                    onMouseEnter={cancelClose}
                    onMouseLeave={scheduleClose}
                    onDragStartClose={handleDragStartClose}
                />,
                document.body,
            )}
        </div>
    );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <h4 className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-content-tertiary mb-1.5 px-1">{children}</h4>
    );
}
