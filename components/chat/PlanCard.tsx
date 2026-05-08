'use client';

import React, { useState } from 'react';
import { Check, ChevronDown, ChevronRight, AlertCircle, RotateCcw } from 'lucide-react';

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

/**
 * Plan-and-approve card rendered inside the assistant bubble. Shows
 * title, summary, arrow overview, models, expandable detail, and either
 * the approve/feedback buttons or a locked status header.
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
        <div className="mt-3 rounded-xl border border-stroke-subtle bg-surface-secondary/40 p-3 space-y-2 animate-fade-in">
            {/* Status header (only shown when locked) */}
            {status === 'approved' && (
                <div className="flex items-center gap-1.5 text-xs font-medium text-accent-primary">
                    <Check className="w-3.5 h-3.5" />
                    Approved &amp; built
                </div>
            )}
            {status === 'feedback-given' && (
                <div className="flex items-center gap-1.5 text-xs font-medium text-content-tertiary">
                    <RotateCcw className="w-3.5 h-3.5" />
                    Revising — see new plan below
                </div>
            )}
            {status === 'approve-failed' && (
                <div className="flex items-center gap-1.5 text-xs font-medium text-red-500">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Approve failed — try feedback
                </div>
            )}

            {/* Title */}
            <div className="font-medium text-sm text-content-primary">{plan.title}</div>

            {/* Summary */}
            <div className="text-sm text-content-secondary whitespace-pre-wrap">{plan.summary}</div>

            {/* Arrows */}
            {plan.arrows && (
                <div className="text-xs font-mono text-content-tertiary whitespace-pre-wrap break-words">
                    {plan.arrows}
                </div>
            )}

            {/* Models pills */}
            {plan.models.length > 0 && (
                <div className="flex flex-wrap gap-1.5 text-xs text-content-tertiary">
                    <span className="font-medium">Models:</span>
                    <span>{plan.models.join(' · ')}</span>
                </div>
            )}

            {/* Feedback excerpt (locked feedback-given state) */}
            {status === 'feedback-given' && feedbackText && (
                <div className="text-xs text-content-secondary italic border-l-2 border-stroke-subtle pl-2">
                    Your feedback: "{feedbackText}"
                </div>
            )}

            {/* Approve-failed error inline */}
            {status === 'approve-failed' && approveError && (
                <div className="text-xs text-red-500 border-l-2 border-red-500/40 pl-2">
                    {approveError}
                </div>
            )}

            {/* Detail toggle */}
            <button
                type="button"
                onClick={() => setDetailOpen(o => !o)}
                className="flex items-center gap-1 text-xs text-content-tertiary hover:text-content-primary transition-colors cursor-pointer"
            >
                {detailOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                {detailOpen ? 'Hide detailed plan' : 'Detailed plan'}
            </button>

            {detailOpen && (
                <div className="text-sm text-content-secondary whitespace-pre-wrap pl-4 border-l-2 border-stroke-subtle/50">
                    {plan.detail}
                </div>
            )}

            {/* Action buttons (only when pending) */}
            {!isLocked && !feedbackOpen && (
                <div className="flex gap-2 pt-1">
                    <button
                        type="button"
                        onClick={onApprove}
                        className="flex-1 px-3 py-2 rounded-lg text-sm font-medium bg-accent-primary text-white hover:bg-accent-primary/90 transition-colors cursor-pointer"
                    >
                        Approve &amp; Build
                    </button>
                    <button
                        type="button"
                        onClick={() => setFeedbackOpen(true)}
                        className="px-3 py-2 rounded-lg text-sm bg-surface-tertiary/60 border border-stroke-subtle text-content-primary hover:bg-accent-primary/10 hover:border-accent-primary/30 transition-colors cursor-pointer"
                    >
                        Provide feedback
                    </button>
                </div>
            )}

            {/* Feedback textarea (expanded when feedbackOpen + pending) */}
            {!isLocked && feedbackOpen && (
                <div className="space-y-2 pt-1">
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
                        rows={3}
                        className="w-full px-3 py-2 rounded-lg text-sm bg-surface-tertiary/60 border border-stroke-subtle text-content-primary placeholder-content-tertiary focus:outline-none focus:border-accent-primary/50 resize-none"
                    />
                    <div className="flex justify-between items-center gap-2">
                        <button
                            type="button"
                            onClick={onApprove}
                            className="flex-1 px-3 py-2 rounded-lg text-sm font-medium bg-accent-primary text-white hover:bg-accent-primary/90 transition-colors cursor-pointer"
                        >
                            Approve &amp; Build
                        </button>
                        <button
                            type="button"
                            onClick={handleCancelFeedback}
                            className="px-3 py-2 rounded-lg text-sm text-content-tertiary hover:text-content-primary transition-colors cursor-pointer"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleSendFeedback}
                            disabled={draft.trim().length === 0}
                            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                                draft.trim().length > 0
                                    ? 'bg-accent-primary/15 border border-accent-primary/40 text-accent-primary hover:bg-accent-primary/25 cursor-pointer'
                                    : 'bg-surface-tertiary/30 border border-stroke-subtle/50 text-content-tertiary cursor-not-allowed'
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
