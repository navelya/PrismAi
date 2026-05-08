'use client';

import React, { useState } from 'react';
import { Check, ChevronDown, ChevronRight, AlertCircle, RotateCcw } from 'lucide-react';
import { useAppStore } from '@/lib/store/app-store';
import type { AiModel } from '@/lib/nodes/types';

export interface PlanCardProps {
    plan: {
        title: string;
        summary: string;
        arrows: string;
        models: string[];
        detail: string;
    };
    /**
     * Card state derived from history pairing in Message.tsx:
     * - 'pending'         : no answer yet; buttons clickable
     * - 'approved'        : answered with action 'approve'
     * - 'feedback-given'  : answered with action 'feedback' (feedbackText shown)
     * - 'approve-failed'  : transient client-only state after a failed approve
     */
    status: 'pending' | 'approved' | 'feedback-given' | 'approve-failed';
    /** Set when status === 'feedback-given'. The full feedback text. */
    feedbackText?: string;
    /** Set when status === 'approve-failed'. Error from server's dispatchTool. */
    approveError?: string;
    onApprove: () => void;
    onFeedback: (text: string) => void;
}

function ModelTag({ name, models }: { name: string; models: AiModel[] | undefined }) {
    const lower = name.toLowerCase();
    const match = models?.find(m => m.display_name?.toLowerCase() === lower);
    const logoUrl = match?.providers?.logo_url || null;

    return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-surface-tertiary/40 border border-stroke-subtle/60 text-[10px] text-content-secondary">
            {logoUrl && (
                <img
                    src={logoUrl}
                    alt=""
                    className="w-3 h-3 rounded-sm object-contain flex-shrink-0"
                />
            )}
            <span className="truncate max-w-[140px]">{name}</span>
        </span>
    );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <div className="text-[9px] uppercase tracking-widest text-content-tertiary/70 font-bold">
            {children}
        </div>
    );
}

/**
 * Plan-and-approve card rendered inside the assistant bubble. Minimal
 * three-section layout: what / workflow / models, with an expandable
 * detailed plan and approve/change actions.
 */
export function PlanCard({
    plan,
    status,
    feedbackText,
    approveError,
    onApprove,
    onFeedback,
}: PlanCardProps) {
    const [detailOpen, setDetailOpen] = useState(false);
    const [feedbackOpen, setFeedbackOpen] = useState(false);
    const [draft, setDraft] = useState('');
    const models = useAppStore(state => state.models);

    const isLocked = status !== 'pending';

    const handleSendFeedback = () => {
        const trimmed = draft.trim();
        if (trimmed.length === 0 || isLocked) return;
        onFeedback(trimmed);
        setDraft('');
        setFeedbackOpen(false);
    };

    const handleCancelFeedback = () => {
        setFeedbackOpen(false);
        setDraft('');
    };

    return (
        <div className="mt-2 rounded-lg border border-stroke-subtle/70 bg-surface-secondary/30 p-2.5 animate-fade-in">
            {/* Status header (only when locked) */}
            {status === 'approved' && (
                <div className="flex items-center gap-1 text-[10px] font-medium text-accent-primary mb-1">
                    <Check className="w-3 h-3" />
                    Approved
                </div>
            )}
            {status === 'feedback-given' && (
                <div className="flex items-center gap-1 text-[10px] font-medium text-content-tertiary mb-1">
                    <RotateCcw className="w-3 h-3" />
                    Revising
                </div>
            )}
            {status === 'approve-failed' && (
                <div className="flex items-center gap-1 text-[10px] font-medium text-red-500 mb-1">
                    <AlertCircle className="w-3 h-3" />
                    Approve failed
                </div>
            )}

            {/* Title + minimal divider */}
            <div className="font-medium text-xs text-content-primary">{plan.title}</div>
            <div className="h-px bg-stroke-subtle/50 my-1.5" />

            {/* What it does */}
            <div className="space-y-0.5 mb-2">
                <SectionLabel>What it does</SectionLabel>
                <div className="text-[11px] text-content-secondary/90 leading-snug whitespace-pre-wrap">
                    {plan.summary}
                </div>
            </div>

            {/* Overall workflow */}
            {plan.arrows && (
                <div className="space-y-0.5 mb-2">
                    <SectionLabel>Overall workflow</SectionLabel>
                    <div className="text-[10px] font-mono text-content-tertiary leading-snug whitespace-pre-wrap break-words">
                        {plan.arrows}
                    </div>
                </div>
            )}

            {/* Models used */}
            {plan.models.length > 0 && (
                <div className="space-y-1 mb-2">
                    <SectionLabel>Models used</SectionLabel>
                    <div className="flex flex-wrap gap-1">
                        {plan.models.map((name, i) => (
                            <ModelTag key={`${name}-${i}`} name={name} models={models} />
                        ))}
                    </div>
                </div>
            )}

            {/* Feedback excerpt (locked feedback-given state) */}
            {status === 'feedback-given' && feedbackText && (
                <div className="mb-2 text-[10px] text-content-secondary/80 italic border-l border-stroke-subtle pl-2">
                    "{feedbackText}"
                </div>
            )}

            {/* Approve-failed error inline */}
            {status === 'approve-failed' && approveError && (
                <div className="mb-2 text-[10px] text-red-500/90 border-l border-red-500/40 pl-2">
                    {approveError}
                </div>
            )}

            {/* Detail toggle */}
            <button
                type="button"
                onClick={() => setDetailOpen(o => !o)}
                className="flex items-center gap-0.5 text-[10px] text-content-tertiary/80 hover:text-content-primary transition-colors cursor-pointer mb-1"
            >
                {detailOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                Detailed plan
            </button>

            {detailOpen && (
                <div className="text-[10px] text-content-secondary/70 leading-relaxed whitespace-pre-wrap pl-2 border-l border-stroke-subtle/40 mb-2">
                    {plan.detail}
                </div>
            )}

            {/* Action buttons (only when pending) */}
            {!isLocked && !feedbackOpen && (
                <div className="flex gap-1.5 pt-1">
                    <button
                        type="button"
                        onClick={onApprove}
                        className="flex-1 px-2.5 py-1 rounded-md text-[11px] font-medium bg-accent-primary text-white hover:bg-accent-primary/90 transition-colors cursor-pointer"
                    >
                        Approve
                    </button>
                    <button
                        type="button"
                        onClick={() => setFeedbackOpen(true)}
                        className="px-2.5 py-1 rounded-md text-[11px] bg-surface-tertiary/50 border border-stroke-subtle/70 text-content-secondary hover:bg-accent-primary/10 hover:border-accent-primary/30 hover:text-content-primary transition-colors cursor-pointer"
                    >
                        Change
                    </button>
                </div>
            )}

            {/* Feedback textarea (expanded when feedbackOpen + pending) */}
            {!isLocked && feedbackOpen && (
                <div className="space-y-1.5 pt-1">
                    <textarea
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSendFeedback();
                            }
                        }}
                        placeholder="What should change?"
                        autoFocus
                        rows={2}
                        className="w-full px-2 py-1.5 rounded-md text-[11px] bg-surface-tertiary/50 border border-stroke-subtle/70 text-content-primary placeholder-content-tertiary/70 focus:outline-none focus:border-accent-primary/50 resize-none leading-snug"
                    />
                    <div className="flex items-center gap-1.5">
                        <button
                            type="button"
                            onClick={onApprove}
                            className="flex-1 px-2.5 py-1 rounded-md text-[11px] font-medium bg-accent-primary text-white hover:bg-accent-primary/90 transition-colors cursor-pointer"
                        >
                            Approve
                        </button>
                        <button
                            type="button"
                            onClick={handleCancelFeedback}
                            className="px-2 py-1 rounded-md text-[10px] text-content-tertiary hover:text-content-primary transition-colors cursor-pointer"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleSendFeedback}
                            disabled={draft.trim().length === 0}
                            className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                                draft.trim().length > 0
                                    ? 'bg-accent-primary/15 border border-accent-primary/40 text-accent-primary hover:bg-accent-primary/25 cursor-pointer'
                                    : 'bg-surface-tertiary/30 border border-stroke-subtle/50 text-content-tertiary/70 cursor-not-allowed'
                            }`}
                        >
                            Send
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
