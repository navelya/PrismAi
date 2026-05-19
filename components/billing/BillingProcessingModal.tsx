'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, Check, Loader2 } from 'lucide-react';

/**
 * Modal that bridges the gap between an asynchronous billing action and the
 * server-side webhook that finalizes it. Renders three visual states:
 *
 *   - processing → spinner + "we're charging your card / updating your plan"
 *   - success    → green check + outcome message, auto-dismisses
 *   - error      → red icon + the error from the API
 *
 * The component is intentionally generic: callers control the copy via props
 * so the same modal can wrap upgrades, downgrades, cancels, resumes, and
 * future one-time charges without proliferating component variants.
 */
export type BillingStatus = 'processing' | 'success' | 'error';

interface BillingProcessingModalProps {
    status: BillingStatus | null;
    processingTitle?: string;
    processingDescription?: string;
    successTitle?: string;
    successDescription?: string;
    errorTitle?: string;
    errorMessage?: string | null;
    onClose: () => void;
}

export default function BillingProcessingModal({
    status,
    processingTitle = 'Processing payment…',
    processingDescription = 'This usually takes a second or two.',
    successTitle = 'Success',
    successDescription = '',
    errorTitle = 'Something went wrong',
    errorMessage,
    onClose,
}: BillingProcessingModalProps) {
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);

    // ESC closes — but only when we're done. Closing mid-processing would
    // strand the user with no idea whether the change went through.
    useEffect(() => {
        if (!status || status === 'processing') return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [status, onClose]);

    if (!mounted) return null;

    const overlay = (
        <AnimatePresence>
            {status && (
                <motion.div
                    key="billing-processing-overlay"
                    className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => {
                        // Block backdrop dismiss while processing.
                        if (status !== 'processing') onClose();
                    }}
                >
                    <motion.div
                        key="billing-processing-card"
                        className="relative w-full max-w-sm bg-surface-elevated border border-stroke-subtle rounded-2xl shadow-2xl overflow-hidden"
                        initial={{ opacity: 0, scale: 0.9, y: 16 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 8 }}
                        transition={{ type: 'spring', damping: 26, stiffness: 320 }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="px-7 py-9 flex flex-col items-center text-center">
                            <StatusIcon status={status} />
                            <h2 className="mt-5 text-lg font-bold font-display text-content-primary tracking-tight">
                                {status === 'processing' && processingTitle}
                                {status === 'success' && successTitle}
                                {status === 'error' && errorTitle}
                            </h2>
                            <p className="mt-2 text-sm text-content-secondary leading-relaxed max-w-[18rem]">
                                {status === 'processing' && processingDescription}
                                {status === 'success' && successDescription}
                                {status === 'error' && (errorMessage || 'Please try again. If this keeps happening, contact support.')}
                            </p>

                            {status === 'error' && (
                                <button
                                    onClick={onClose}
                                    className="mt-6 px-4 py-2 rounded-xl bg-surface-tertiary hover:bg-surface-tertiary/70 text-content-primary text-sm font-semibold transition-colors"
                                >
                                    Dismiss
                                </button>
                            )}
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );

    return createPortal(overlay, document.body);
}

function StatusIcon({ status }: { status: BillingStatus }) {
    if (status === 'processing') {
        return (
            <div className="w-14 h-14 rounded-full bg-accent-primary/10 flex items-center justify-center">
                <Loader2 className="w-7 h-7 text-accent-primary animate-spin" strokeWidth={2.5} />
            </div>
        );
    }
    if (status === 'success') {
        return (
            <motion.div
                className="w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center"
                initial={{ scale: 0.6 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', damping: 14, stiffness: 240 }}
            >
                <Check className="w-7 h-7 text-emerald-400" strokeWidth={3} />
            </motion.div>
        );
    }
    return (
        <div className="w-14 h-14 rounded-full bg-accent-error/15 flex items-center justify-center">
            <AlertCircle className="w-7 h-7 text-accent-error" strokeWidth={2.5} />
        </div>
    );
}
