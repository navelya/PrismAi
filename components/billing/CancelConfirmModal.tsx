'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Check, Loader2, X } from 'lucide-react';

/**
 * Confirmation dialog shown before scheduling a subscription cancellation.
 * Lists the reassurances industry-standard products use (continued access
 * until period end, resumable, credits stay, no fee) so the user isn't
 * surprised by what's about to happen.
 *
 * The modal is purely presentational — the actual cancel call is owned by
 * the caller, which also drives `loading` and `onConfirm`.
 */
export interface CancelConfirmModalProps {
    open: boolean;
    planName: string;
    currentPeriodEnd: string | null;
    loading: boolean;
    onConfirm: () => void;
    onClose: () => void;
}

function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
}

export default function CancelConfirmModal({
    open,
    planName,
    currentPeriodEnd,
    loading,
    onConfirm,
    onClose,
}: CancelConfirmModalProps) {
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);

    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [open, onClose]);

    if (!mounted) return null;

    const endDate = currentPeriodEnd ? formatDate(currentPeriodEnd) : null;

    const overlay = (
        <AnimatePresence>
            {open && (
                <motion.div
                    key="cancel-overlay"
                    className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={onClose}
                >
                    <motion.div
                        key="cancel-card"
                        className="relative w-full max-w-md bg-surface-elevated border border-stroke-subtle rounded-2xl shadow-2xl overflow-hidden"
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="px-6 pt-6 pb-2 flex items-start justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-amber-500/15 flex items-center justify-center flex-shrink-0">
                                    <AlertTriangle className="w-5 h-5 text-amber-400" strokeWidth={2.5} />
                                </div>
                                <h2 className="text-lg font-bold font-display text-content-primary leading-tight">
                                    Cancel your {planName} plan?
                                </h2>
                            </div>
                            <button
                                onClick={onClose}
                                disabled={loading}
                                className="p-1.5 hover:bg-surface-tertiary rounded-lg transition-colors disabled:opacity-50"
                            >
                                <X className="w-4 h-4 text-content-tertiary" />
                            </button>
                        </div>

                        <div className="px-6 pb-2">
                            <p className="text-sm text-content-secondary leading-relaxed">
                                Cancellation takes effect at the end of your current billing
                                period{endDate ? <> — <span className="font-semibold text-content-primary">{endDate}</span></> : ''}.
                                You&apos;ll still have full access to {planName} until then.
                            </p>
                        </div>

                        <ul className="px-6 py-4 space-y-2.5 text-sm">
                            <ReassureRow>
                                Keep using every {planName} feature until {endDate ?? 'period end'}
                            </ReassureRow>
                            <ReassureRow>
                                Resume any time before then — no break in service
                            </ReassureRow>
                            <ReassureRow>
                                Your existing credits stay in your account and never expire
                            </ReassureRow>
                            <ReassureRow>
                                No cancellation fee. You won&apos;t be charged again
                            </ReassureRow>
                        </ul>

                        <div className="px-6 py-4 border-t border-stroke-subtle bg-surface-primary/30 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
                            <button
                                onClick={onClose}
                                disabled={loading}
                                className="px-4 py-2 rounded-xl text-sm font-semibold text-content-primary hover:bg-surface-tertiary transition-colors disabled:opacity-50"
                            >
                                Keep my plan
                            </button>
                            <button
                                onClick={onConfirm}
                                disabled={loading}
                                className="px-4 py-2 rounded-xl bg-accent-error/90 hover:bg-accent-error text-white text-sm font-semibold transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                            >
                                {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                {loading ? 'Canceling…' : 'Cancel subscription'}
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );

    return createPortal(overlay, document.body);
}

function ReassureRow({ children }: { children: React.ReactNode }) {
    return (
        <li className="flex items-start gap-2.5">
            <Check className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" strokeWidth={2.5} />
            <span className="text-content-secondary leading-snug">{children}</span>
        </li>
    );
}
