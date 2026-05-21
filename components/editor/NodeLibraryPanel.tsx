'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Icons from 'lucide-react';
import { Search, X } from 'lucide-react';
import { useAppStore } from '@/lib/store/app-store';
import type { NodeTypeRecord, AiModel, Category } from '@/lib/nodes/types';
import { BasicsTile, CategoryRow, ProviderRow, NodeItemRow, ModelItemRow } from './node-library/rows';
import NodeLibraryFlyout, { FlyoutMode } from './NodeLibraryFlyout';

const HOVER_OPEN_MS = 80;
const HOVER_CLOSE_MS = 150;
const TOOL_RAIL_GUTTER = 44;
const FLYOUT_GAP = 12;
const FLYOUT_MAX_HEIGHT = 480;

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

    // Fetch catalog data on mount. The store fetchers are no-ops if data is
    // already loaded, so this is safe to call every time the panel opens.
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

    const containerRef = useRef<HTMLDivElement | null>(null);
    const openTimer = useRef<number | null>(null);
    const closeTimer = useRef<number | null>(null);

    // Debounced search (80ms).
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

    // Resolve Basics tiles against loaded nodeTypes. Generate-X tiles are
    // dropped if no candidate id matches a loaded node type.
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

    // Compute and apply the flyout's top/height for a given row element.
    const positionFlyoutForRow = useCallback((rowEl: HTMLElement) => {
        const rect = rowEl.getBoundingClientRect();
        const container = containerRef.current?.getBoundingClientRect();
        const viewportBottom = window.innerHeight - 8;
        const containerBottom = container?.bottom ?? viewportBottom;
        const maxBottom = Math.min(containerBottom, viewportBottom);
        const available = Math.max(120, maxBottom - rect.top);
        const desiredHeight = Math.min(FLYOUT_MAX_HEIGHT, available);
        // Clamp top so the flyout fits if the row sits very low in the panel.
        const clampedTop = Math.min(rect.top, viewportBottom - desiredHeight);
        setFlyoutTop(clampedTop);
        setFlyoutHeight(desiredHeight);
    }, []);

    const scheduleOpen = useCallback((kind: 'category' | 'provider', id: string, rowEl: HTMLElement) => {
        // Cancel any pending open from a previous row.
        if (openTimer.current) { window.clearTimeout(openTimer.current); openTimer.current = null; }
        if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
        // If a flyout is already open, swap content immediately (no delay/flash).
        if (hoveredKind && hoveredId) {
            positionFlyoutForRow(rowEl);
            setHoveredKind(kind);
            setHoveredId(id);
            return;
        }
        openTimer.current = window.setTimeout(() => {
            positionFlyoutForRow(rowEl);
            setHoveredKind(kind);
            setHoveredId(id);
        }, HOVER_OPEN_MS);
    }, [hoveredKind, hoveredId, positionFlyoutForRow]);

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

    // Recompute flyout's viewport-relative left whenever it opens.
    useEffect(() => {
        if (!hoveredKind || !hoveredId) return;
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        setFlyoutLeft(rect.right + TOOL_RAIL_GUTTER + FLYOUT_GAP);
    }, [hoveredKind, hoveredId]);

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
    const noHits = !!q && basicsHits.length === 0 && nodeHits.length === 0 && modelHits.length === 0;

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
            <div className="px-3 pt-2 pb-2" onMouseEnter={scheduleClose}>
                <div className="relative">
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
                    <div className="p-3 space-y-6 pb-6">
                        <section>
                            <SectionLabel icon={Icons.Sparkles}>Basics</SectionLabel>
                            <div className="grid grid-cols-2 gap-2">
                                {resolvedBasics.map(({ tile, payload }) => (
                                    <BasicsTile key={tile.name} name={tile.name} desc={tile.desc} icon={tile.icon} payload={payload} onDragStart={handleDragStartClose} />
                                ))}
                            </div>
                        </section>

                        {categories.length > 0 && (
                            <section onMouseLeave={scheduleClose}>
                                <SectionLabel icon={Icons.Grid}>Categories</SectionLabel>
                                <div className="space-y-2">
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
                            <section onMouseLeave={scheduleClose}>
                                <SectionLabel icon={Icons.Server}>Providers</SectionLabel>
                                <div className="space-y-2">
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
