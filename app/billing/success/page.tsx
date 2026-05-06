'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Check, Loader2, ArrowRight } from 'lucide-react';
import { useTokenBalance } from '@/lib/billing/use-balance';
import { useSubscription } from '@/lib/billing/use-subscription';
import { formatCredits } from '@/lib/billing/cost';
import { getPlanDisplay } from '@/lib/billing/plans-config';

/**
 * Post-checkout landing page.
 *
 * The webhook is what actually grants credits / activates subscriptions, so
 * this page polls for the change. We give the webhook ~10 seconds before
 * showing a "still processing" state.
 */
export default function BillingSuccessPage() {
    const { balance } = useTokenBalance();
    const { subscription } = useSubscription();
    const [waited, setWaited] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => setWaited((w) => w + 1), 1000);
        return () => clearInterval(interval);
    }, []);

    const plan = getPlanDisplay(subscription?.planId);
    const isProcessing = waited < 8 && (!subscription || subscription.planId === 'free');

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
                        isProcessing
                            ? 'bg-accent-primary/10'
                            : 'bg-accent-success/10'
                    }`}>
                        {isProcessing ? (
                            <Loader2 className="w-7 h-7 text-accent-primary animate-spin" />
                        ) : (
                            <Check className="w-7 h-7 text-accent-success" strokeWidth={3} />
                        )}
                    </div>
                </div>

                <h1 className="text-3xl font-bold font-display mb-3 tracking-tight">
                    {isProcessing ? 'Processing your purchase…' : 'Payment confirmed!'}
                </h1>

                <p className="text-content-secondary leading-relaxed mb-8">
                    {isProcessing ? (
                        <>This usually takes a few seconds. We&rsquo;re activating your purchase and adding credits to your account.</>
                    ) : (
                        <>
                            Thanks for supporting Prisfol.{' '}
                            {plan && plan.id !== 'free' && (
                                <>You&rsquo;re now on the <span className="font-semibold text-content-primary">{plan.name}</span> plan.</>
                            )}
                        </>
                    )}
                </p>

                {balance !== null && (
                    <div className="mb-8 p-5 rounded-2xl border border-stroke-subtle bg-surface-elevated">
                        <div className="text-xs uppercase tracking-wider text-content-tertiary mb-1">Current balance</div>
                        <div className="text-3xl font-bold font-display text-content-primary">
                            {formatCredits(balance)}
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
