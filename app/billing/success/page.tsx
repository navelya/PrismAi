'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion, useMotionValue, useTransform, useReducedMotion, animate } from 'framer-motion';
import { Check, Loader2, ArrowRight, AlertCircle } from 'lucide-react';
import { useTokenBalance } from '@/lib/billing/use-balance';
import { formatCredits } from '@/lib/billing/cost';
import { type PlanId } from '@/lib/billing/plans-config';
import { usePricing, getPlanFrom } from '@/lib/billing/use-pricing';
import { pollSubscriptionUntil, type SubscriptionRow } from '@/lib/billing/poll-subscription';

/**
 * Post-checkout landing page.
 *
 * The webhook is what actually grants credits / activates a subscription, so
 * this page polls the `subscriptions` row until Paddle's webhook has landed
 * the change — then it switches from the processing state to the confirmed
 * state. If the webhook is unusually slow we fall into a 'pending' state
 * that tells the user what's happening rather than lying about success.
 */
type Status = 'processing' | 'confirmed' | 'pending';

/**
 * Counts up to `value` once it's shown. Because `animate` re-targets from the
 * motion value's *current* position, a balance that lands late (e.g. the
 * realtime credit update arriving after first paint) continues counting toward
 * the new total instead of snapping. Honors prefers-reduced-motion.
 */
function AnimatedCredits({ value }: { value: number }) {
    const reduceMotion = useReducedMotion();
    const count = useMotionValue(reduceMotion ? value : 0);
    const display = useTransform(count, (latest) => formatCredits(Math.round(latest)));

    useEffect(() => {
        if (reduceMotion) {
            count.set(value);
            return;
        }
        const controls = animate(count, value, {
            duration: 1.2,
            ease: [0.16, 1, 0.3, 1], // easeOutExpo — fast start, gentle settle
        });
        return () => controls.stop();
    }, [value, reduceMotion, count]);

    return <motion.span>{display}</motion.span>;
}

export default function BillingSuccessPage() {
    const { plans } = usePricing();
    const { balance } = useTokenBalance();
    const [status, setStatus] = useState<Status>('processing');
    const [confirmedRow, setConfirmedRow] = useState<SubscriptionRow | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const row = await pollSubscriptionUntil(
                (r) => r.plan_id !== 'free' && r.status === 'active',
                { timeoutMs: 25000, intervalMs: 700 },
            );
            if (cancelled) return;
            if (row) {
                setConfirmedRow(row);
                setStatus('confirmed');
            } else {
                setStatus('pending');
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const plan = confirmedRow ? getPlanFrom(plans, confirmedRow.plan_id as PlanId) : null;

    return (
        <div className="min-h-screen w-full bg-bg-primary text-content-primary flex items-center justify-center p-6">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="w-full max-w-md text-center"
            >
                <div className="mb-8 flex justify-center">
                    <div className={`w-16 h-16 rounded-full flex items-center justify-center ${
                        status === 'processing'
                            ? 'bg-accent-primary/10'
                            : status === 'pending'
                                ? 'bg-amber-500/15'
                                : 'bg-accent-success/10'
                    }`}>
                        {status === 'processing' && (
                            <Loader2 className="w-7 h-7 text-accent-primary animate-spin" />
                        )}
                        {status === 'pending' && (
                            <AlertCircle className="w-7 h-7 text-amber-400" />
                        )}
                        {status === 'confirmed' && (
                            <Check className="w-7 h-7 text-accent-success" strokeWidth={3} />
                        )}
                    </div>
                </div>

                <h1 className="text-3xl font-bold font-display mb-3 tracking-tight">
                    {status === 'processing' && 'Processing your purchase…'}
                    {status === 'pending' && 'Almost there'}
                    {status === 'confirmed' && 'Payment confirmed!'}
                </h1>

                <p className="text-content-secondary leading-relaxed mb-8">
                    {status === 'processing' && (
                        <>This usually takes a few seconds. We&rsquo;re activating your purchase and adding credits to your account.</>
                    )}
                    {status === 'pending' && (
                        <>Your payment went through, but we haven&rsquo;t heard back from Paddle yet. This is rare and resolves on its own — refresh in a moment, or check your email for the receipt.</>
                    )}
                    {status === 'confirmed' && (
                        <>
                            Thanks for supporting Prisfol.{' '}
                            {plan && plan.id !== 'free' && (
                                <>You&rsquo;re now on the <span className="font-semibold text-content-primary">{plan.name}</span> plan.</>
                            )}
                        </>
                    )}
                </p>

                {balance !== null && status !== 'processing' && (
                    <div className="mb-8 p-5 rounded-2xl border border-stroke-subtle bg-surface-elevated">
                        <div className="text-xs uppercase tracking-wider text-content-tertiary mb-1">Current balance</div>
                        <div className="text-3xl font-bold font-display text-content-primary tabular-nums">
                            <AnimatedCredits value={balance} />
                            <span className="text-sm font-normal text-content-tertiary ml-2">credits</span>
                        </div>
                    </div>
                )}

                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                    <Link
                        href="/chat"
                        className="px-6 py-3 rounded-xl bg-accent-primary text-white font-semibold text-sm hover:bg-accent-primary/90 transition-colors flex items-center justify-center gap-2"
                    >
                        Start building
                        <ArrowRight className="w-4 h-4" />
                    </Link>
                    <Link
                        href="/settings?tab=plan-billing"
                        className="px-6 py-3 rounded-xl border border-stroke-subtle text-content-primary font-semibold text-sm hover:bg-surface-tertiary transition-colors"
                    >
                        Manage plan
                    </Link>
                </div>

                <p className="mt-10 text-xs text-content-tertiary">
                    A receipt has been sent to your email by Paddle. Need help?{' '}
                    <a href="mailto:support@prisfol.com" className="text-accent-primary hover:underline">
                        support@prisfol.com
                    </a>
                </p>
            </motion.div>
        </div>
    );
}
