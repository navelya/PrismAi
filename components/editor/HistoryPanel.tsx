'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { History, Star, Clock, RotateCcw, Trash2, Plus, X } from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';
import { useAppStore } from '@/lib/store/app-store';
import { useVersions } from '@/lib/hooks/use-versions';
import { SaveCheckpointModal } from '@/components/editor/SaveCheckpointModal';
import { ConfirmationModal } from '@/components/ui/ConfirmationModal';
import type { WorkflowVersion } from '@/lib/api/client';

interface HistoryPanelProps {
    onClose: () => void;
}

function relativeTime(iso: string): string {
    const then = new Date(iso).getTime();
    const diff = Math.max(0, Date.now() - then);
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hr ago`;
    const days = Math.floor(hrs / 24);
    return `${days} day${days > 1 ? 's' : ''} ago`;
}

export function HistoryPanel({ onClose }: HistoryPanelProps) {
    const { versions, loading, createCheckpoint, restore, remove } = useVersions();
    const collabRole = useAppStore((s) => s.collabRole);
    // null = non-collab session (user's own canvas) → treat as owner
    const isOwner = collabRole !== 'editor' && collabRole !== 'viewer';
    const [busyId, setBusyId] = useState<string | null>(null);
    const [saveOpen, setSaveOpen] = useState(false);
    // Pending restore/delete awaiting confirmation in the shared modal.
    const [confirmAction, setConfirmAction] = useState<{ kind: 'restore' | 'delete'; version: WorkflowVersion } | null>(null);

    const checkpoints = versions.filter((v) => v.kind === 'checkpoint');
    const autos = versions.filter((v) => v.kind === 'auto');

    // Run the confirmed restore/delete. ConfirmationModal closes itself on
    // confirm; the row keeps its busy spinner until the async action settles.
    const runConfirm = async (action: { kind: 'restore' | 'delete'; version: WorkflowVersion }) => {
        setBusyId(action.version.id);
        try {
            if (action.kind === 'restore') await restore(action.version.id);
            else await remove(action.version.id);
        } catch (err) {
            console.error(`[HistoryPanel] ${action.kind} failed:`, err);
            alert(`Failed to ${action.kind} version. Please try again.`);
        } finally {
            setBusyId(null);
        }
    };

    const confirmCopy = confirmAction?.kind === 'restore'
        ? {
            title: 'Restore this version?',
            message: 'Your current canvas will be saved as a version first, then replaced with this one.',
            confirmText: 'Restore',
            variant: 'warning' as const,
        }
        : {
            title: 'Delete this checkpoint?',
            message: 'This checkpoint will be permanently removed. Auto-saved versions are not affected.',
            confirmText: 'Delete',
            variant: 'danger' as const,
        };

    return (
        <div className="relative w-full h-full bg-surface-elevated/80 backdrop-blur-md border border-stroke-subtle rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-stroke-subtle/60">
                <div className="flex items-center gap-2 text-content-secondary">
                    <History className="w-4 h-4" />
                    <span className="text-sm font-semibold">Version history</span>
                </div>
                <div className="flex items-center gap-0.5">
                    {isOwner && (
                        <button
                            onClick={() => setSaveOpen(true)}
                            className="p-1 hover:bg-white/10 rounded-md transition-colors group"
                            title="Save checkpoint"
                        >
                            <Plus className="w-3.5 h-3.5 text-content-tertiary group-hover:text-content-primary transition-colors" />
                        </button>
                    )}
                    <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-md transition-colors group" title="Close">
                        <X className="w-3.5 h-3.5 text-content-tertiary group-hover:text-content-primary" />
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-3">
                {loading ? (
                    <div className="space-y-2">
                        {Array.from({ length: 5 }).map((_, i) => (
                            <Skeleton key={i} className="h-12 rounded-xl border border-stroke-subtle" />
                        ))}
                    </div>
                ) : versions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center">
                        <History className="w-7 h-7 text-content-tertiary/50" />
                        <p className="text-xs text-content-tertiary leading-relaxed max-w-[200px]">
                            No versions yet. Versions are captured automatically before the AI edits your workflow, or save a checkpoint anytime.
                        </p>
                    </div>
                ) : (
                    <>
                        {checkpoints.length > 0 && (
                            <div className="space-y-1.5">
                                <p className="px-1 text-[10px] font-bold uppercase tracking-wider text-content-tertiary">Checkpoints</p>
                                <AnimatePresence initial={false}>
                                    {checkpoints.map((v) => (
                                        <VersionRowItem key={v.id} v={v} isOwner={isOwner} busy={busyId === v.id} onRestore={(ver) => setConfirmAction({ kind: 'restore', version: ver })} onDelete={(ver) => setConfirmAction({ kind: 'delete', version: ver })} />
                                    ))}
                                </AnimatePresence>
                            </div>
                        )}
                        {autos.length > 0 && (
                            <div className="space-y-1.5">
                                <p className="px-1 text-[10px] font-bold uppercase tracking-wider text-content-tertiary">Auto-saved</p>
                                <AnimatePresence initial={false}>
                                    {autos.map((v) => (
                                        <VersionRowItem key={v.id} v={v} isOwner={isOwner} busy={busyId === v.id} onRestore={(ver) => setConfirmAction({ kind: 'restore', version: ver })} onDelete={(ver) => setConfirmAction({ kind: 'delete', version: ver })} />
                                    ))}
                                </AnimatePresence>
                            </div>
                        )}
                    </>
                )}
            </div>

            <SaveCheckpointModal
                isOpen={saveOpen}
                onClose={() => setSaveOpen(false)}
                onSave={(label) => createCheckpoint(label)}
            />

            <ConfirmationModal
                isOpen={!!confirmAction}
                onClose={() => setConfirmAction(null)}
                onConfirm={() => { if (confirmAction) void runConfirm(confirmAction); }}
                title={confirmCopy.title}
                message={confirmCopy.message}
                confirmText={confirmCopy.confirmText}
                variant={confirmCopy.variant}
            />
        </div>
    );
}

function VersionRowItem({
    v, isOwner, busy, onRestore, onDelete,
}: {
    v: WorkflowVersion;
    isOwner: boolean;
    busy: boolean;
    onRestore: (v: WorkflowVersion) => void;
    onDelete: (v: WorkflowVersion) => void;
}) {
    const isCheckpoint = v.kind === 'checkpoint';
    return (
        <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="group flex items-center gap-2 px-2 py-2 rounded-xl border border-stroke-subtle bg-surface-primary hover:border-accent-primary/40 transition-colors"
        >
            {isCheckpoint
                ? <Star className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                : <Clock className="w-3.5 h-3.5 text-content-tertiary shrink-0" />}
            <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-content-secondary truncate">
                    {isCheckpoint ? (v.label || 'Checkpoint') : 'Auto-saved'}
                </p>
                <p className="text-[10px] text-content-tertiary">{relativeTime(v.created_at)}</p>
            </div>
            {isOwner && (
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                        onClick={() => onRestore(v)}
                        disabled={busy}
                        className="p-1 rounded-md hover:bg-white/10 text-content-tertiary hover:text-content-primary disabled:opacity-40"
                        title="Restore this version"
                    >
                        <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                    {isCheckpoint && (
                        <button
                            onClick={() => onDelete(v)}
                            disabled={busy}
                            className="p-1 rounded-md hover:bg-white/10 text-content-tertiary hover:text-red-400 disabled:opacity-40"
                            title="Delete checkpoint"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>
            )}
        </motion.div>
    );
}
