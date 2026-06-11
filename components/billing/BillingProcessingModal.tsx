'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, Check, Loader2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';

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
    // Closing mid-processing would strand the user with no idea whether the
    // change went through — so it's only dismissable once we're done.
    const processing = status === 'processing';

    return (
        <Modal
            open={status !== null}
            onOpenChange={(o) => { if (!o && !processing) onClose(); }}
            // Must sit above the plans modal it's launched from.
            level="top"
            size="sm"
            dismissable={!processing}
            showClose={false}
            srTitle="Billing status"
        >
            {status && (
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
            )}
        </Modal>
    );
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
