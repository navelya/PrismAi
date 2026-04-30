'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    X, Search, Sparkles, BookOpen, User, Plus, Loader2,
    Layers, Image as ImageIcon, GitBranch, Wand2, ChevronRight,
    CheckCircle2
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAppStore } from '@/lib/store/app-store';

// ─── Built-in template definitions ──────────────────────────────────────────

interface TemplateDefinition {
    id: string;
    name: string;
    description: string;
    icon: React.ComponentType<any>;
    nodeCount: number;
    tags: string[];
    // Nodes use 'any' because template stubs are intentionally minimal —
    // the canvas enriches them (label, status, etc.) when the workflow loads.
    workflow: { nodes: any[]; edges: any[] };
}

const BUILTIN_TEMPLATES: TemplateDefinition[] = [
    {
        id: 'tpl_basic_gen',
        name: 'Quick Generator',
        description: 'A single AI generator node ready for a prompt. The fastest way to start creating.',
        icon: Wand2,
        nodeCount: 2,
        tags: ['starter', 'simple'],
        workflow: {
            nodes: [
                {
                    id: 'n1', type: 'prompt',
                    position: { x: 120, y: 200 },
                    data: { config: { text: 'A cinematic shot of a futuristic city at dusk, neon reflections on wet streets, photorealistic' } }
                },
                {
                    id: 'n2', type: 'ai_generator',
                    position: { x: 440, y: 200 },
                    data: { config: {} }
                },
            ],
            edges: [
                { id: 'e1', source: 'n1', target: 'n2', type: 'default' }
            ],
        },
    },
    {
        id: 'tpl_image_to_image',
        name: 'Image to Image',
        description: 'Feed a source image through an AI model to transform its style, lighting, or composition.',
        icon: ImageIcon,
        nodeCount: 2,
        tags: ['image', 'transform'],
        workflow: {
            nodes: [
                {
                    id: 'n1', type: 'media_input',
                    position: { x: 80, y: 200 },
                    data: { config: { source_url: '' } }
                },
                {
                    id: 'n2', type: 'ai_generator',
                    position: { x: 380, y: 200 },
                    data: { config: {} }
                },
            ],
            edges: [
                { id: 'e1', source: 'n1', target: 'n2', type: 'default' }
            ],
        },
    },
    {
        id: 'tpl_ab_compare',
        name: 'A/B Style Test',
        description: 'Same source, two different AI models side by side — perfect for comparing styles or settings.',
        icon: GitBranch,
        nodeCount: 4,
        tags: ['compare', 'testing'],
        workflow: {
            nodes: [
                {
                    id: 'n1', type: 'media_input',
                    position: { x: 80, y: 260 },
                    data: { config: { source_url: '' } }
                },
                {
                    id: 'n2', type: 'prompt',
                    position: { x: 280, y: 100 },
                    data: { config: { text: 'Style A: painterly, warm tones' } }
                },
                {
                    id: 'n3', type: 'prompt',
                    position: { x: 280, y: 420 },
                    data: { config: { text: 'Style B: cinematic, cold tones' } }
                },
                {
                    id: 'n4', type: 'ai_generator',
                    position: { x: 540, y: 100 },
                    data: { config: {} }
                },
                {
                    id: 'n5', type: 'ai_generator',
                    position: { x: 540, y: 420 },
                    data: { config: {} }
                },
            ],
            edges: [
                { id: 'e1', source: 'n1', target: 'n4', type: 'default' },
                { id: 'e2', source: 'n1', target: 'n5', type: 'default' },
                { id: 'e3', source: 'n2', target: 'n4', type: 'default' },
                { id: 'e4', source: 'n3', target: 'n5', type: 'default' },
            ],
        },
    },
    {
        id: 'tpl_multi_pipeline',
        name: 'Multi-Style Pipeline',
        description: 'One image, three AI models running in parallel — explore a whole mood board in a single run.',
        icon: Layers,
        nodeCount: 4,
        tags: ['parallel', 'batch'],
        workflow: {
            nodes: [
                {
                    id: 'n1', type: 'media_input',
                    position: { x: 80, y: 330 },
                    data: { config: { source_url: '' } }
                },
                {
                    id: 'n2', type: 'ai_generator',
                    position: { x: 380, y: 80 },
                    data: { config: {} }
                },
                {
                    id: 'n3', type: 'ai_generator',
                    position: { x: 380, y: 300 },
                    data: { config: {} }
                },
                {
                    id: 'n4', type: 'ai_generator',
                    position: { x: 380, y: 520 },
                    data: { config: {} }
                },
            ],
            edges: [
                { id: 'e1', source: 'n1', target: 'n2', type: 'default' },
                { id: 'e2', source: 'n1', target: 'n3', type: 'default' },
                { id: 'e3', source: 'n1', target: 'n4', type: 'default' },
            ],
        },
    },
];

// ─── Component ───────────────────────────────────────────────────────────────

interface TemplatesModalProps {
    isOpen: boolean;
    onClose: () => void;
    onLoad: (workflow: { nodes: any[]; edges: any[] }) => void;
}

type TabId = 'builtin' | 'mine';

export function TemplatesModal({ isOpen, onClose, onLoad }: TemplatesModalProps) {
    const [tab, setTab] = useState<TabId>('builtin');
    const [search, setSearch] = useState('');
    const [myTemplates, setMyTemplates] = useState<any[]>([]);
    const [isLoadingMine, setIsLoadingMine] = useState(false);
    const [confirmId, setConfirmId] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const supabase = React.useMemo(() => createClient(), []);
    const currentWorkflow = useAppStore(s => s.currentWorkflow);

    const fetchMyTemplates = useCallback(async () => {
        setIsLoadingMine(true);
        const { data } = await supabase
            .from('workflow_templates')
            .select('id, name, description, workflow, created_at')
            .eq('template_type', 'user')
            .order('created_at', { ascending: false });
        setMyTemplates(data || []);
        setIsLoadingMine(false);
    }, [supabase]);

    useEffect(() => {
        if (isOpen && tab === 'mine') fetchMyTemplates();
    }, [isOpen, tab, fetchMyTemplates]);

    // Close on Escape
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        if (isOpen) document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [isOpen, onClose]);

    const handleSaveCurrent = async () => {
        if (!currentWorkflow) return;
        const name = prompt('Name this template:');
        if (!name?.trim()) return;
        setIsSaving(true);
        await supabase.from('workflow_templates').insert({
            name: name.trim(),
            template_type: 'user',
            workflow: {
                nodes: currentWorkflow.nodes,
                edges: currentWorkflow.edges,
            },
        });
        setIsSaving(false);
        if (tab === 'mine') fetchMyTemplates();
    };

    const filteredBuiltin = BUILTIN_TEMPLATES.filter(t =>
        !search || t.name.toLowerCase().includes(search.toLowerCase()) || t.tags.some(g => g.includes(search.toLowerCase()))
    );

    const filteredMine = myTemplates.filter(t =>
        !search || t.name.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        key="templates-backdrop"
                        className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                    />

                    {/* Modal */}
                    <motion.div
                        key="templates-modal"
                        className="fixed inset-0 z-[81] flex items-center justify-center p-6 pointer-events-none"
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
                    >
                        <div
                            className="relative w-full max-w-3xl max-h-[80vh] bg-surface-elevated border border-stroke-subtle rounded-2xl shadow-2xl flex flex-col overflow-hidden pointer-events-auto"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Modal header */}
                            <div className="flex items-center justify-between p-5 border-b border-stroke-subtle flex-shrink-0">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-accent-primary/10 border border-accent-primary/20 flex items-center justify-center">
                                        <BookOpen className="w-4 h-4 text-accent-primary" />
                                    </div>
                                    <div>
                                        <h2 className="font-bold text-content-primary text-base">Templates</h2>
                                        <p className="text-xs text-content-tertiary">Start from a proven workflow</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={handleSaveCurrent}
                                        disabled={isSaving || !currentWorkflow?.nodes?.length}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stroke-subtle text-xs font-medium text-content-secondary hover:text-content-primary hover:bg-surface-tertiary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                        title="Save current workflow as a template"
                                    >
                                        {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                                        Save current
                                    </button>
                                    <button
                                        onClick={onClose}
                                        className="p-2 hover:bg-surface-tertiary rounded-lg transition-colors"
                                    >
                                        <X className="w-4 h-4 text-content-tertiary" />
                                    </button>
                                </div>
                            </div>

                            {/* Search + Tabs */}
                            <div className="px-5 pt-4 pb-3 flex items-center gap-3 flex-shrink-0 border-b border-stroke-subtle/50">
                                <div className="flex-1 relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-content-tertiary" />
                                    <input
                                        type="text"
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        placeholder="Search templates…"
                                        className="w-full bg-surface-primary border border-stroke-subtle rounded-lg pl-9 pr-3 py-2 text-sm text-content-primary placeholder:text-content-tertiary focus:outline-none focus:border-accent-primary/50 transition-colors"
                                    />
                                </div>
                                <div className="flex items-center bg-surface-primary border border-stroke-subtle rounded-lg p-1 gap-1">
                                    {([
                                        { id: 'builtin', label: 'Built-in', icon: Sparkles },
                                        { id: 'mine', label: 'Mine', icon: User },
                                    ] as { id: TabId; label: string; icon: any }[]).map(({ id, label, icon: Icon }) => (
                                        <button
                                            key={id}
                                            onClick={() => setTab(id)}
                                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${tab === id
                                                ? 'bg-surface-elevated text-content-primary shadow-sm'
                                                : 'text-content-tertiary hover:text-content-secondary'
                                                }`}
                                        >
                                            <Icon className="w-3 h-3" />
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Template grid */}
                            <div className="flex-1 overflow-y-auto p-5">
                                {tab === 'builtin' ? (
                                    filteredBuiltin.length > 0 ? (
                                        <div className="grid grid-cols-2 gap-4">
                                            {filteredBuiltin.map((tpl) => (
                                                <TemplateCard
                                                    key={tpl.id}
                                                    id={tpl.id}
                                                    name={tpl.name}
                                                    description={tpl.description}
                                                    icon={tpl.icon}
                                                    nodeCount={tpl.nodeCount}
                                                    tags={tpl.tags}
                                                    isConfirming={confirmId === tpl.id}
                                                    onSelect={() => setConfirmId(tpl.id)}
                                                    onConfirm={() => {
                                                        onLoad(tpl.workflow);
                                                        onClose();
                                                    }}
                                                    onCancel={() => setConfirmId(null)}
                                                />
                                            ))}
                                        </div>
                                    ) : (
                                        <NoResults />
                                    )
                                ) : isLoadingMine ? (
                                    <div className="flex items-center justify-center h-40 gap-2 text-content-tertiary">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        <span className="text-sm">Loading your templates…</span>
                                    </div>
                                ) : filteredMine.length > 0 ? (
                                    <div className="grid grid-cols-2 gap-4">
                                        {filteredMine.map((tpl) => (
                                            <TemplateCard
                                                key={tpl.id}
                                                id={tpl.id}
                                                name={tpl.name}
                                                description={tpl.description || 'Custom workflow template'}
                                                icon={User}
                                                nodeCount={tpl.workflow?.nodes?.length || 0}
                                                tags={['custom']}
                                                isConfirming={confirmId === tpl.id}
                                                onSelect={() => setConfirmId(tpl.id)}
                                                onConfirm={() => {
                                                    onLoad(tpl.workflow);
                                                    onClose();
                                                }}
                                                onCancel={() => setConfirmId(null)}
                                            />
                                        ))}
                                    </div>
                                ) : (
                                    <MyTemplatesEmpty onSave={handleSaveCurrent} isSaving={isSaving} hasWorkflow={!!currentWorkflow?.nodes?.length} />
                                )}
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function TemplateCard({
    id, name, description, icon: Icon, nodeCount, tags,
    isConfirming, onSelect, onConfirm, onCancel,
}: {
    id: string;
    name: string;
    description: string;
    icon: React.ComponentType<any>;
    nodeCount: number;
    tags: string[];
    isConfirming: boolean;
    onSelect: () => void;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    return (
        <motion.div
            layout
            className={`relative p-4 rounded-xl border transition-all duration-200 cursor-pointer group overflow-hidden ${isConfirming
                ? 'border-accent-primary bg-accent-primary/5 shadow-md shadow-accent-primary/10'
                : 'border-stroke-subtle bg-surface-primary hover:border-accent-primary/50 hover:bg-accent-primary/3 hover:shadow-md'
                }`}
            onClick={() => !isConfirming && onSelect()}
        >
            {/* Icon + title */}
            <div className="flex items-start gap-3 mb-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${isConfirming ? 'bg-accent-primary/20' : 'bg-surface-secondary group-hover:bg-accent-primary/10'}`}>
                    <Icon className={`w-4 h-4 ${isConfirming ? 'text-accent-primary' : 'text-content-secondary group-hover:text-accent-primary'} transition-colors`} />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-content-primary">{name}</div>
                    <div className="text-[10px] text-content-tertiary mt-0.5">{nodeCount} nodes</div>
                </div>
                {!isConfirming && (
                    <ChevronRight className="w-4 h-4 text-content-tertiary opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-1" />
                )}
            </div>

            <p className="text-xs text-content-secondary leading-relaxed mb-3">{description}</p>

            {/* Tags */}
            <div className="flex flex-wrap gap-1 mb-3">
                {tags.map((tag) => (
                    <span key={tag} className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-surface-secondary text-content-tertiary">
                        {tag}
                    </span>
                ))}
            </div>

            {/* Confirm row */}
            <AnimatePresence>
                {isConfirming && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="flex items-center gap-2 pt-3 border-t border-stroke-subtle/50"
                    >
                        <p className="flex-1 text-[10px] text-content-tertiary">This will replace your current workflow.</p>
                        <button
                            onClick={(e) => { e.stopPropagation(); onCancel(); }}
                            className="px-2.5 py-1 rounded-lg text-xs text-content-tertiary hover:bg-surface-tertiary transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); onConfirm(); }}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-accent-primary text-white hover:bg-accent-primary/90 transition-colors shadow-sm"
                        >
                            <CheckCircle2 className="w-3 h-3" />
                            Load
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}

function NoResults() {
    return (
        <div className="flex flex-col items-center justify-center h-40 gap-2 text-content-tertiary">
            <Search className="w-6 h-6 opacity-30" />
            <span className="text-sm">No templates match your search</span>
        </div>
    );
}

function MyTemplatesEmpty({ onSave, isSaving, hasWorkflow }: { onSave: () => void; isSaving: boolean; hasWorkflow: boolean }) {
    return (
        <div className="flex flex-col items-center justify-center h-48 gap-4 text-center p-6">
            <div className="w-12 h-12 rounded-xl bg-surface-primary border border-stroke-subtle flex items-center justify-center">
                <User className="w-5 h-5 text-content-tertiary/50" />
            </div>
            <div className="space-y-1">
                <p className="text-sm font-semibold text-content-secondary">No saved templates yet</p>
                <p className="text-xs text-content-tertiary max-w-[240px] leading-relaxed">
                    Build a workflow you love, then save it here so you can jump straight back in next time.
                </p>
            </div>
            <button
                onClick={onSave}
                disabled={isSaving || !hasWorkflow}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent-primary text-white text-xs font-semibold hover:bg-accent-primary/90 transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
                {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Save current workflow
            </button>
        </div>
    );
}
