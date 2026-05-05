'use client';

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { PLANS, type PlanDisplay } from '@/lib/billing/plans-config';
import { useSubscription } from '@/lib/billing/use-subscription';
import { formatCredits } from '@/lib/billing/cost';

interface PlansModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function PlansModal({ isOpen, onClose }: PlansModalProps) {
    const { subscription } = useSubscription();
    const currentPlanId = subscription?.planId ?? 'free';

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        if (isOpen) document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [isOpen, onClose]);

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div
                        key="plans-backdrop"
                        className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-md"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                    />

                    <motion.div
                        key="plans-modal"
                        className="fixed inset-0 z-[91] flex items-center justify-center p-4 sm:p-8 pointer-events-none overflow-y-auto"
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
                    >
                        <div
                            className="relative w-full max-w-6xl my-auto bg-surface-elevated border border-stroke-subtle rounded-3xl shadow-2xl flex flex-col overflow-hidden pointer-events-auto"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Decorative gradient */}
                            <div className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-accent-primary/10 blur-3xl" />

                            {/* Header */}
                            <div className="relative flex items-start justify-between px-8 pt-8 pb-2 flex-shrink-0">
                                <div>
                                    <h2 className="text-2xl sm:text-3xl font-bold font-display text-content-primary tracking-tight">
                                        Choose your plan
                                    </h2>
                                    <p className="text-sm text-content-secondary mt-1">
                                        Cancel anytime. Unused credits never expire.
                                    </p>
                                </div>
                                <button
                                    onClick={onClose}
                                    className="p-2 hover:bg-surface-tertiary rounded-lg transition-colors"
                                >
                                    <X className="w-5 h-5 text-content-tertiary" />
                                </button>
                            </div>

                            {/* Plan cards grid */}
                            <div className="relative px-6 sm:px-8 pb-6 sm:pb-8 pt-6 grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
                                {PLANS.map((plan) => (
                                    <PlanCard
                                        key={plan.id}
                                        plan={plan}
                                        isCurrent={plan.id === currentPlanId}
                                    />
                                ))}
                            </div>

                            {/* Footer */}
                            <div className="relative px-8 pb-6 text-center text-xs text-content-tertiary border-t border-stroke-subtle pt-4">
                                Paid plans coming soon. Prices in USD, billed monthly. Taxes may apply.
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}

interface PlanCardProps {
    plan: PlanDisplay;
    isCurrent: boolean;
}

function PlanCard({ plan, isCurrent }: PlanCardProps) {
    const accentClasses =
        plan.accent === 'highlight'
            ? 'border-accent-primary/50 bg-gradient-to-b from-accent-primary/[0.07] to-transparent shadow-[0_0_40px_-10px_rgba(var(--accent-primary),0.4)]'
            : plan.accent === 'premium'
                ? 'border-stroke-subtle bg-gradient-to-b from-purple-500/[0.05] via-accent-primary/[0.03] to-transparent'
                : 'border-stroke-subtle bg-surface-primary/40';

    return (
        <div
            className={`relative rounded-2xl border p-6 flex flex-col ${accentClasses} transition-all duration-300`}
        >
            {/* Badges */}
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 flex gap-2 items-center">
                {plan.accent === 'highlight' && !isCurrent && (
                    <span className="px-3 py-1 text-[10px] font-bold tracking-wider uppercase rounded-full bg-accent-primary text-white shadow-lg shadow-accent-primary/30">
                        Recommended
                    </span>
                )}
                {isCurrent && (
                    <span className="px-3 py-1 text-[10px] font-bold tracking-wider uppercase rounded-full bg-content-primary text-surface-elevated">
                        Current Plan
                    </span>
                )}
            </div>

            {/* Header */}
            <div className="mb-4">
                <h3 className="text-lg font-bold font-display text-content-primary leading-tight">
                    {plan.name}
                </h3>
                <p className="text-xs text-content-tertiary mt-0.5">{plan.tagline}</p>
            </div>

            {/* Price */}
            <div className="flex items-baseline gap-1 mb-1">
                <span className="text-4xl font-bold font-display text-content-primary tracking-tight">
                    ${plan.priceMonthly}
                </span>
                {plan.priceMonthly > 0 && (
                    <span className="text-sm text-content-tertiary">/month</span>
                )}
            </div>

            {/* Credits highlight */}
            <div className="mt-2 mb-5 text-sm">
                <span className="font-semibold text-content-primary">
                    {formatCredits(plan.monthlyCredits)}
                </span>
                <span className="text-content-tertiary"> credits / month</span>
            </div>

            {/* Features */}
            <ul className="space-y-2.5 mb-6 flex-1">
                {plan.features.map((feature, i) => (
                    <li key={i} className="text-sm text-content-secondary leading-relaxed">
                        {feature}
                    </li>
                ))}
            </ul>

            {/* CTA */}
            <PlanCTA plan={plan} isCurrent={isCurrent} />
        </div>
    );
}

function PlanCTA({ plan, isCurrent }: { plan: PlanDisplay; isCurrent: boolean }) {
    if (isCurrent) {
        return (
            <button
                disabled
                className="w-full py-2.5 rounded-xl text-sm font-semibold border border-stroke-subtle text-content-tertiary cursor-default"
            >
                You're on this plan
            </button>
        );
    }

    if (!plan.available) {
        return (
            <button
                disabled
                title="Paid plans launch soon"
                className="w-full py-2.5 rounded-xl text-sm font-semibold border border-stroke-subtle text-content-tertiary opacity-60 cursor-not-allowed"
            >
                Coming soon
            </button>
        );
    }

    const buttonClass =
        plan.accent === 'highlight'
            ? 'bg-accent-primary text-white hover:bg-accent-primary/90 shadow-lg shadow-accent-primary/30'
            : plan.accent === 'premium'
                ? 'bg-gradient-to-r from-purple-500 to-accent-primary text-white hover:opacity-90 shadow-lg shadow-purple-500/20'
                : 'bg-surface-tertiary text-content-primary hover:bg-surface-tertiary/70';

    return (
        <button
            className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all ${buttonClass}`}
        >
            Upgrade to {plan.name}
        </button>
    );
}
