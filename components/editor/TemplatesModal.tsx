'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    X, Search, BookOpen, Loader2, ChevronRight, CheckCircle2, Sparkles,
} from 'lucide-react';
import { templatesApi } from '@/lib/api/client';
import { useAppStore } from '@/lib/store/app-store';

// ─── Component ───────────────────────────────────────────────────────────────

interface TemplatesModalProps {
    isOpen: boolean;
    onClose: () => void;
    onLoad: (workflow: { nodes: any[]; edges: any[] }) => void;
}

export function TemplatesModal({ isOpen, onClose, onLoad }: TemplatesModalProps) {
    // Shared, preloaded template list (same source as the /templates gallery) —
    // opening this modal reads it from the store instead of refetching.
    const templates = useAppStore((s) => s.templates);
    const loading = useAppStore((s) => s.isTemplatesLoading);
    const fetchTemplates = useAppStore((s) => s.fetchTemplates);
    const [search, setSearch] = useState('');
    const [confirmId, setConfirmId] = useState<string | null>(null);
    const [loadingId, setLoadingId] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) fetchTemplates(); // no-op when already loaded
    }, [isOpen, fetchTemplates]);

    // Close on Escape
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        if (isOpen) document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [isOpen, onClose]);

    const handleConfirmLoad = useCallback(async (templateId: string) => {
        setLoadingId(templateId);
        try {
            const { template } = await templatesApi.get(templateId);
            onLoad({
                nodes: template?.workflow?.nodes ?? [],
                edges: template?.workflow?.edges ?? [],
            });
            onClose();
        } catch {
            // Leave the modal open on failure so the user can retry.
        } finally {
            setLoadingId(null);
        }
    }, [onLoad, onClose]);

    const filtered = templates.filter((t) =>
        !search ||
        t.name?.toLowerCase().includes(search.toLowerCase()) ||
        (t.tags || []).some((g: string) => g.toLowerCase().includes(search.toLowerCase()))
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
                                <button
                                    onClick={onClose}
                                    className="p-2 hover:bg-surface-tertiary rounded-lg transition-colors"
                                >
                                    <X className="w-4 h-4 text-content-tertiary" />
                                </button>
                            </div>

                            {/* Search */}
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
                            </div>

                            {/* Template grid */}
                            <div className="flex-1 overflow-y-auto p-5">
                                {loading ? (
                                    <div className="flex items-center justify-center h-40 gap-2 text-content-tertiary">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        <span className="text-sm">Loading templates…</span>
                                    </div>
                                ) : filtered.length > 0 ? (
                                    <div className="grid grid-cols-2 gap-4">
                                        {filtered.map((tpl) => (
                                            <TemplateCard
                                                key={tpl.id}
                                                name={tpl.name}
                                                description={tpl.description || 'Workflow template'}
                                                nodeCount={(tpl.nodes_used || []).length}
                                                tags={tpl.tags || []}
                                                isConfirming={confirmId === tpl.id}
                                                isLoading={loadingId === tpl.id}
                                                onSelect={() => setConfirmId(tpl.id)}
                                                onConfirm={() => handleConfirmLoad(tpl.id)}
                                                onCancel={() => setConfirmId(null)}
                                            />
                                        ))}
                                    </div>
                                ) : (
                                    <NoResults hasSearch={!!search} />
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
    name, description, nodeCount, tags,
    isConfirming, isLoading, onSelect, onConfirm, onCancel,
}: {
    name: string;
    description: string;
    nodeCount: number;
    tags: string[];
    isConfirming: boolean;
    isLoading: boolean;
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
                    <Sparkles className={`w-4 h-4 ${isConfirming ? 'text-accent-primary' : 'text-content-secondary group-hover:text-accent-primary'} transition-colors`} />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-content-primary">{name}</div>
                    <div className="text-[10px] text-content-tertiary mt-0.5">{nodeCount} nodes</div>
                </div>
                {!isConfirming && (
                    <ChevronRight className="w-4 h-4 text-content-tertiary opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-1" />
                )}
            </div>

            <p className="text-xs text-content-secondary leading-relaxed mb-3 line-clamp-2">{description}</p>

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
                            disabled={isLoading}
                            className="px-2.5 py-1 rounded-lg text-xs text-content-tertiary hover:bg-surface-tertiary transition-colors disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); onConfirm(); }}
                            disabled={isLoading}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-accent-primary text-white hover:bg-accent-primary/90 transition-colors shadow-sm disabled:opacity-50"
                        >
                            {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                            Load
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}

function NoResults({ hasSearch }: { hasSearch: boolean }) {
    return (
        <div className="flex flex-col items-center justify-center h-40 gap-2 text-content-tertiary">
            <Search className="w-6 h-6 opacity-30" />
            <span className="text-sm">{hasSearch ? 'No templates match your search' : 'No templates available yet'}</span>
        </div>
    );
}
