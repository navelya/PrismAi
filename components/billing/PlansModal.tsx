'use client';

import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { type PlanDisplay, type CreditPack } from '@/lib/billing/plans-config';
import { usePricing } from '@/lib/billing/use-pricing';
import { useSubscription } from '@/lib/billing/use-subscription';
import { formatCredits } from '@/lib/billing/cost';
import { pollSubscriptionUntil } from '@/lib/billing/poll-subscription';
import { pollLedgerForPack } from '@/lib/billing/poll-ledger';
import BillingProcessingModal, { type BillingStatus } from './BillingProcessingModal';
import CancelConfirmModal from './CancelConfirmModal';

interface PlansModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function PlansModal({ isOpen, onClose }: PlansModalProps) {
    const { plans, packs } = usePricing();
    const { subscription } = useSubscription();
    const currentPlanId = subscription?.planId ?? 'free';
    const currentCycle = subscription?.billingCycle ?? 'monthly';

    // `selectedCycle` drives which prices the cards display and which price ID
    // the CTA submits. Default to the user's current cycle so the modal opens
    // showing what they're already paying for; they can flip the toggle to
    // upsell themselves to yearly (or downgrade to monthly).
    const [selectedCycle, setSelectedCycle] = useState<'monthly' | 'yearly'>(currentCycle);

    // Re-sync the toggle whenever the modal reopens — if the user changed
    // their cycle elsewhere, we want the default to reflect reality.
    useEffect(() => {
        if (isOpen) setSelectedCycle(currentCycle);
    }, [isOpen, currentCycle]);

    return (
        <Modal
            open={isOpen}
            onOpenChange={(o) => !o && onClose()}
            // Opens over the account modal.
            level="elevated"
            size="full"
            contentClassName="overflow-hidden"
        >
            {/* Decorative gradient */}
            <div className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-accent-primary/10 blur-3xl" />

            {/* Header */}
            <div className="relative flex items-start justify-between px-8 pt-8 pb-2 flex-shrink-0 pr-14">
                <div>
                    <Modal.Title className="text-2xl sm:text-3xl font-bold font-display tracking-tight">
                        Choose your plan
                    </Modal.Title>
                    <p className="text-sm text-content-secondary mt-1">
                        Cancel anytime. Unused credits never expire.
                    </p>
                </div>
            </div>

                            {/* Billing cycle toggle */}
                            <div className="relative flex justify-center px-8 pt-4">
                                <CycleToggle
                                    cycle={selectedCycle}
                                    onChange={setSelectedCycle}
                                />
                            </div>

                            {/* Plan cards grid */}
                            <div className="relative px-6 sm:px-8 pt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
                                {plans.map((plan) => (
                                    <PlanCard
                                        key={plan.id}
                                        plan={plan}
                                        plans={plans}
                                        currentPlanId={currentPlanId}
                                        currentCycle={currentCycle}
                                        selectedCycle={selectedCycle}
                                        currentPeriodEnd={subscription?.currentPeriodEnd ?? null}
                                        cancelAtPeriodEnd={subscription?.cancelAtPeriodEnd ?? false}
                                        pendingPlanChangePriceId={subscription?.pendingPlanChangePriceId ?? null}
                                        onClose={onClose}
                                    />
                                ))}
                            </div>

                            {/* Credit packs section */}
                            <div className="relative px-6 sm:px-8 pt-10 pb-2">
                                <div className="flex items-baseline justify-between mb-4">
                                    <div>
                                        <h3 className="text-base sm:text-lg font-bold font-display text-content-primary tracking-tight">
                                            Need a one-time top-up?
                                        </h3>
                                        <p className="text-xs text-content-tertiary mt-0.5">
                                            Buy credits without changing your plan. Top-up credits never expire.
                                        </p>
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                                    {packs.map((pack) => (
                                        <CreditPackCard key={pack.id} pack={pack} />
                                    ))}
                                </div>
                            </div>

            {/* Footer */}
            <div className="relative px-8 pt-6 pb-6 mt-6 text-center text-xs text-content-tertiary border-t border-white/10">
                Prices in USD. Sales tax / VAT calculated at checkout by Dodo Payments, our Merchant of Record.
            </div>
        </Modal>
    );
}

function CycleToggle({
    cycle,
    onChange,
}: {
    cycle: 'monthly' | 'yearly';
    onChange: (next: 'monthly' | 'yearly') => void;
}) {
    return (
        <div className="inline-flex items-center p-1 bg-surface-primary/60 border border-stroke-subtle rounded-full">
            <button
                onClick={() => onChange('monthly')}
                className={`px-4 py-1.5 text-xs font-semibold rounded-full transition-colors ${
                    cycle === 'monthly'
                        ? 'bg-surface-tertiary text-content-primary'
                        : 'text-content-tertiary hover:text-content-primary'
                }`}
            >
                Monthly
            </button>
            <button
                onClick={() => onChange('yearly')}
                className={`px-4 py-1.5 text-xs font-semibold rounded-full transition-colors flex items-center gap-2 ${
                    cycle === 'yearly'
                        ? 'bg-surface-tertiary text-content-primary'
                        : 'text-content-tertiary hover:text-content-primary'
                }`}
            >
                Yearly
                <span className={`text-[10px] font-bold tracking-wider ${cycle === 'yearly' ? 'text-emerald-400' : 'text-emerald-400/70'}`}>
                    SAVE 20%
                </span>
            </button>
        </div>
    );
}

interface PlanCardProps {
    plan: PlanDisplay;
    plans: PlanDisplay[];
    currentPlanId: string;
    currentCycle: 'monthly' | 'yearly';
    selectedCycle: 'monthly' | 'yearly';
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    pendingPlanChangePriceId: string | null;
    onClose: () => void;
}

function PlanCard({
    plan,
    plans,
    currentPlanId,
    currentCycle,
    selectedCycle,
    currentPeriodEnd,
    cancelAtPeriodEnd,
    pendingPlanChangePriceId,
    onClose,
}: PlanCardProps) {
    // "Current plan" means BOTH the plan and the cycle match what the user
    // is paying for right now. Same plan / different cycle is still a change
    // we can offer (it goes through the same change-plan endpoint).
    const isCurrent =
        plan.id === currentPlanId &&
        (selectedCycle === currentCycle || plan.id === 'free');
    const accentClasses =
        plan.accent === 'highlight'
            ? 'border-accent-primary/50 bg-gradient-to-b from-accent-primary/[0.07] to-transparent shadow-[0_0_40px_-10px_rgba(var(--accent-primary),0.4)]'
            : plan.accent === 'premium'
                ? 'border-stroke-subtle bg-gradient-to-b from-purple-500/[0.05] via-accent-primary/[0.03] to-transparent'
                : 'border-stroke-subtle bg-surface-primary/40';

    return (
        <div
            className={`relative rounded-2xl border p-5 flex flex-col ${accentClasses} transition-all duration-300`}
        >
            {/* Badges */}
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 flex gap-2 items-center">
                {plan.accent === 'highlight' && !isCurrent && (
                    <span className="px-3 py-1 text-[10px] font-bold tracking-wider uppercase rounded-full bg-accent-primary text-white shadow-lg shadow-accent-primary/30">
                        Recommended
                    </span>
                )}
                {plan.accent === 'premium' && !isCurrent && (
                    <span className="px-3 py-1 text-[10px] font-bold tracking-wider uppercase rounded-full bg-gradient-to-r from-purple-500 to-accent-primary text-white shadow-lg shadow-purple-500/30">
                        Teams
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
            <PlanPrice plan={plan} selectedCycle={selectedCycle} />

            {/* Credits highlight */}
            <div className="mt-2 mb-5 text-sm">
                <span className="font-semibold text-content-primary">
                    {formatCredits(plan.monthlyCredits)}
                </span>
                <span className="text-content-tertiary"> credits / month</span>
            </div>

            {/* Features */}
            <ul className="space-y-2 mb-6 flex-1">
                {plan.features.map((feature, i) => (
                    <li key={i} className="text-xs text-content-secondary leading-relaxed">
                        {feature}
                    </li>
                ))}
            </ul>

            {/* CTA */}
            <PlanCTA
                plan={plan}
                plans={plans}
                isCurrent={isCurrent}
                currentPlanId={currentPlanId}
                currentCycle={currentCycle}
                selectedCycle={selectedCycle}
                currentPeriodEnd={currentPeriodEnd}
                cancelAtPeriodEnd={cancelAtPeriodEnd}
                pendingPlanChangePriceId={pendingPlanChangePriceId}
                onClose={onClose}
            />
        </div>
    );
}

function PlanPrice({
    plan,
    selectedCycle,
}: {
    plan: PlanDisplay;
    selectedCycle: 'monthly' | 'yearly';
}) {
    // Free plan is always "$0/month" — yearly doesn't apply.
    if (plan.priceMonthly === 0) {
        return (
            <div className="flex items-baseline gap-1 mb-1">
                <span className="text-3xl font-bold font-display text-content-primary tracking-tight">$0</span>
            </div>
        );
    }

    // For paid plans on yearly, show the per-month equivalent (X/12) as the
    // headline so plans are visually comparable against the monthly column —
    // then footnote the actual annual charge below.
    if (selectedCycle === 'yearly' && plan.priceYearly) {
        const perMonth = Math.round((plan.priceYearly / 12) * 100) / 100;
        return (
            <>
                <div className="flex items-baseline gap-1 mb-0.5">
                    <span className="text-3xl font-bold font-display text-content-primary tracking-tight">
                        ${perMonth}
                    </span>
                    <span className="text-xs text-content-tertiary">/month</span>
                </div>
                <div className="text-[11px] text-content-tertiary">
                    ${plan.priceYearly} billed annually
                </div>
            </>
        );
    }

    return (
        <div className="flex items-baseline gap-1 mb-1">
            <span className="text-3xl font-bold font-display text-content-primary tracking-tight">
                ${plan.priceMonthly}
            </span>
            <span className="text-xs text-content-tertiary">/month</span>
        </div>
    );
}

// =============================================================================
// CREDIT PACK CARD
// =============================================================================

function CreditPackCard({ pack }: { pack: CreditPack }) {
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<BillingStatus | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const accentClasses =
        pack.accent === 'highlight'
            ? 'border-accent-primary/40 bg-gradient-to-b from-accent-primary/[0.06] to-transparent'
            : pack.accent === 'premium'
                ? 'border-stroke-subtle bg-gradient-to-b from-purple-500/[0.04] via-accent-primary/[0.02] to-transparent'
                : 'border-stroke-subtle bg-surface-primary/40';

    const buttonClass = pack.accent === 'highlight'
        ? 'bg-accent-primary text-white hover:bg-accent-primary/90 shadow-md shadow-accent-primary/30'
        : 'bg-surface-tertiary text-content-primary hover:bg-surface-tertiary/70';

    const isReady = pack.available && pack.dodoProductId;

    const handleClick = async () => {
        if (loading || !pack.dodoProductId) return;
        setLoading(true);
        setErrorMessage(null);
        setStatus('processing');

        // Mark the moment BEFORE the API call so we can distinguish this
        // purchase from any previous grant of the same pack in the ledger.
        // Subtract a tiny buffer (1s) to absorb clock skew between client
        // and Supabase server.
        const startedAtMs = Date.now() - 1000;

        try {
            const res = await fetch('/api/billing/buy-pack', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ packId: pack.id }),
            });
            const json = await res.json().catch(() => ({}));

            if (!res.ok) {
                setErrorMessage(json.error || 'Could not complete the purchase.');
                setStatus('error');
                return;
            }

            // No saved card → redirect to the Dodo checkout URL returned by
            // the server. The webhook handles the grant on completion.
            if (json.requiresCheckout) {
                if (json.url) {
                    window.location.href = json.url;
                } else {
                    setErrorMessage('Could not open checkout. Please try again.');
                    setStatus('error');
                }
                return;
            }

            // Watch the ledger for a fresh pack-purchase grant matching this
            // pack ID. `transactions.create` returns the tx ID but we filter
            // by pack + cutoff to stay robust against ordering surprises.
            const grant = await pollLedgerForPack(pack.id, startedAtMs, { timeoutMs: 25000 });
            if (!grant) {
                setErrorMessage(
                    "Payment accepted, but the credits haven't been added yet. Refresh in a moment — they'll show up automatically.",
                );
                setStatus('error');
                return;
            }

            setStatus('success');
            // Brief celebration, then reload so balance/ledger UI everywhere
            // picks up the new state.
            setTimeout(() => {
                window.location.reload();
            }, 1400);
        } catch (e: any) {
            setErrorMessage(e?.message || 'Could not complete the purchase.');
            setStatus('error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <div className={`relative rounded-xl border p-4 flex items-center gap-4 ${accentClasses} transition-all duration-300`}>
                {pack.accent === 'highlight' && (
                    <span className="absolute -top-2.5 left-4 px-2 py-0.5 text-[9px] font-bold tracking-wider uppercase rounded-full bg-accent-primary text-white shadow-md shadow-accent-primary/30">
                        {pack.tagline}
                    </span>
                )}

                <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1.5">
                        <span className="text-lg font-bold font-display text-content-primary leading-tight">
                            {pack.name}
                        </span>
                        <span className="text-[10px] text-content-tertiary uppercase tracking-wider">
                            ${(pack.price / pack.credits).toFixed(3)}/cr
                        </span>
                    </div>
                    <div className="mt-1 text-xs text-content-secondary">
                        <span className="font-semibold text-content-primary">{formatCredits(pack.credits)}</span> credits
                    </div>
                </div>

                <button
                    onClick={handleClick}
                    disabled={!isReady || loading}
                    title={isReady ? '' : 'Credit packs launch soon'}
                    className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-semibold transition-all whitespace-nowrap flex items-center gap-2 ${
                        isReady
                            ? `${buttonClass} disabled:opacity-60 disabled:cursor-not-allowed`
                            : 'bg-surface-tertiary/50 text-content-tertiary opacity-60 cursor-not-allowed border border-stroke-subtle'
                    }`}
                >
                    {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {loading ? '…' : `$${pack.price}`}
                </button>
            </div>

            <BillingProcessingModal
                status={status}
                processingTitle="Buying credits…"
                processingDescription="Charging your saved payment method. This usually takes a second or two."
                successTitle={`+${formatCredits(pack.credits)} credits added`}
                successDescription="Your new credits are ready to use. They never expire."
                errorTitle="Couldn't complete the purchase"
                errorMessage={errorMessage}
                onClose={() => setStatus(null)}
            />
        </>
    );
}

function planRank(planId: string): number {
    const order: Record<string, number> = { free: 0, starter: 1, pro: 2, studio: 3 };
    return order[planId] ?? -1;
}

function PlanCTA({
    plan,
    plans,
    isCurrent,
    currentPlanId,
    currentCycle,
    selectedCycle,
    currentPeriodEnd,
    cancelAtPeriodEnd,
    pendingPlanChangePriceId,
    onClose,
}: {
    plan: PlanDisplay;
    plans: PlanDisplay[];
    isCurrent: boolean;
    currentPlanId: string;
    currentCycle: 'monthly' | 'yearly';
    selectedCycle: 'monthly' | 'yearly';
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    pendingPlanChangePriceId: string | null;
    onClose: () => void;
}) {
    const router = useRouter();
    const [status, setStatus] = useState<BillingStatus | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [confirmingCancel, setConfirmingCancel] = useState(false);
    const [cancelingPending, setCancelingPending] = useState(false);

    // This card matches the scheduled target plan (regardless of selected
    // cycle in the toggle). Industry-standard treatment: don't offer the
    // change again — show "Scheduled" with the date, plus a "Cancel switch"
    // affordance so the user can back out without leaving the modal.
    const isPendingTarget =
        pendingPlanChangePriceId != null &&
        (plan.dodoProductIdMonthly === pendingPlanChangePriceId ||
            plan.dodoProductIdYearly === pendingPlanChangePriceId);

    if (isPendingTarget) {
        const endDate = currentPeriodEnd
            ? new Date(currentPeriodEnd).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
            })
            : null;

        const handleCancelSwitch = async () => {
            setCancelingPending(true);
            try {
                const res = await fetch('/api/billing/schedule-plan-change', {
                    method: 'DELETE',
                });
                if (res.ok) {
                    onClose();
                    setTimeout(() => window.location.reload(), 200);
                    return;
                }
            } catch {
                // Fall through to enable the button again so the user can retry.
            }
            setCancelingPending(false);
        };

        return (
            <div className="space-y-2">
                <button
                    disabled
                    className="w-full py-2.5 rounded-xl text-sm font-semibold border border-accent-primary/40 bg-accent-primary/[0.07] text-accent-primary cursor-default"
                >
                    Scheduled{endDate ? ` for ${endDate}` : ''}
                </button>
                <button
                    onClick={handleCancelSwitch}
                    disabled={cancelingPending}
                    className="w-full py-2 rounded-lg text-xs font-semibold text-content-tertiary hover:text-content-primary hover:bg-surface-tertiary transition-colors disabled:opacity-50"
                >
                    {cancelingPending ? 'Canceling switch…' : 'Cancel switch'}
                </button>
            </div>
        );
    }

    if (isCurrent) {
        // If a downgrade is scheduled, the current-plan card should reflect
        // that: "You're on this plan (active until [date])". Helps the user
        // understand they're not losing access right away.
        if (pendingPlanChangePriceId && currentPeriodEnd) {
            const endDate = new Date(currentPeriodEnd).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
            });
            return (
                <div className="space-y-1">
                    <button
                        disabled
                        className="w-full py-2.5 rounded-xl text-sm font-semibold border border-stroke-subtle text-content-tertiary cursor-default"
                    >
                        You&apos;re on this plan
                    </button>
                    <p className="text-[11px] text-content-tertiary text-center leading-snug">
                        Active until {endDate}
                    </p>
                </div>
            );
        }
        return (
            <button
                disabled
                className="w-full py-2.5 rounded-xl text-sm font-semibold border border-stroke-subtle text-content-tertiary cursor-default"
            >
                You&apos;re on this plan
            </button>
        );
    }

    // Free plan from a paid user → that IS a cancellation. Wire it to the
    // same cancel flow as the plan card's cancel button so the user has a
    // single mental model: "to go back to Free, cancel your subscription."
    if (plan.id === 'free' && currentPlanId !== 'free') {
        const currentPlan = plans.find((p) => p.id === currentPlanId);
        const currentPlanName = currentPlan?.name ?? currentPlanId;

        // Already scheduled to cancel — surface that instead of offering it again.
        if (cancelAtPeriodEnd) {
            return (
                <button
                    disabled
                    className="w-full py-2.5 rounded-xl text-sm font-semibold border border-stroke-subtle text-content-tertiary cursor-default"
                >
                    Already scheduled
                </button>
            );
        }

        const handleCancel = async () => {
            setErrorMessage(null);
            setStatus('processing');
            try {
                const res = await fetch('/api/billing/cancel', { method: 'POST' });
                const json = await res.json().catch(() => ({}));
                if (!res.ok) {
                    setErrorMessage(json.error || 'Failed to cancel subscription');
                    setStatus('error');
                    return;
                }
                setConfirmingCancel(false);
                const settled = await pollSubscriptionUntil(
                    (row) => row.cancel_at_period_end === true,
                    { timeoutMs: 20000 },
                );
                if (!settled) {
                    setErrorMessage(
                        "Cancellation accepted, but the update hasn't landed yet. Refresh in a moment.",
                    );
                    setStatus('error');
                    return;
                }
                setStatus('success');
                setTimeout(() => {
                    onClose();
                    window.location.reload();
                }, 1400);
            } catch (e: any) {
                setErrorMessage(e?.message || 'Failed to cancel subscription');
                setStatus('error');
            }
        };

        return (
            <>
                <button
                    onClick={() => setConfirmingCancel(true)}
                    disabled={status === 'processing'}
                    className="w-full py-2.5 rounded-xl text-sm font-semibold border border-stroke-subtle text-content-secondary hover:text-content-primary hover:bg-surface-tertiary transition-all disabled:opacity-50"
                >
                    Cancel subscription
                </button>

                <CancelConfirmModal
                    open={confirmingCancel}
                    planName={currentPlanName}
                    currentPeriodEnd={currentPeriodEnd}
                    loading={status === 'processing'}
                    onConfirm={handleCancel}
                    onClose={() => {
                        if (status !== 'processing') setConfirmingCancel(false);
                    }}
                />

                <BillingProcessingModal
                    status={status}
                    processingTitle="Canceling your subscription…"
                    processingDescription="Confirming the cancellation. You'll keep access until your period ends."
                    successTitle="Subscription canceled"
                    successDescription={
                        currentPeriodEnd
                            ? `Access continues until ${new Date(currentPeriodEnd).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}.`
                            : "You'll keep access until your period ends."
                    }
                    errorTitle="Couldn't cancel"
                    errorMessage={errorMessage}
                    onClose={() => setStatus(null)}
                />
            </>
        );
    }

    // Always submit the product ID for the cycle the user picked in the toggle.
    // Fall back to the other cycle only if this plan doesn't offer the
    // selected one (defensive — all our paid plans ship both).
    const targetProductId =
        selectedCycle === 'yearly'
            ? plan.dodoProductIdYearly ?? plan.dodoProductIdMonthly
            : plan.dodoProductIdMonthly ?? plan.dodoProductIdYearly;

    if (!plan.available || !targetProductId) {
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

    // Coming from a paid plan → mutate the existing subscription via the API.
    // Coming from the free plan (or no plan) → route through the checkout
    // page so Dodo can collect a payment method.
    const hasPaidSub = currentPlanId !== 'free' && currentPlanId !== '';
    const targetRank = planRank(plan.id);
    const currentRank = planRank(currentPlanId);

    // Classification of this transition. Each category has its own button
    // copy, its own backend route, and its own success/processing UX.
    //   - cycleSwap: same plan, different billing cycle → immediate change
    //   - downgrade: lower plan rank (or yearly→monthly on same plan) →
    //     scheduled for period end (no immediate charge / no credits)
    //   - upgrade / switch: immediate, prorated
    const isCycleSwap =
        plan.id === currentPlanId && currentRank > 0 && selectedCycle !== currentCycle;
    const isDowngrade =
        !isCycleSwap &&
        currentRank > 0 &&
        targetRank > 0 &&
        targetRank < currentRank;

    let label: string;
    let processingTitle: string;
    if (isCycleSwap) {
        const direction = selectedCycle === 'yearly' ? 'annual' : 'monthly';
        label = `Switch to ${direction} billing`;
        processingTitle = `Switching to ${direction} billing…`;
    } else if (isDowngrade) {
        label = `Downgrade to ${plan.name}`;
        processingTitle = 'Scheduling your downgrade…';
    } else {
        const verb = targetRank > currentRank ? 'Upgrade' : 'Switch';
        label = `${verb} to ${plan.name}`;
        processingTitle = verb === 'Upgrade' ? 'Upgrading your plan…' : 'Updating your plan…';
    }

    const handleClick = async () => {
        setErrorMessage(null);
        if (!hasPaidSub) {
            // First-time purchase: no saved sub to mutate, so route through
            // the checkout page. Pass through whatever cycle the user picked
            // so they don't get surprised on the checkout page.
            router.push(`/checkout/${plan.id}?cycle=${selectedCycle}`);
            return;
        }

        // Downgrades take the scheduled path — no immediate charge, no
        // immediate plan change, no credit grant. The user keeps their
        // current (higher) plan until the period rolls over, then Dodo
        // applies the change at next billing date.
        if (isDowngrade) {
            setStatus('processing');
            try {
                const res = await fetch('/api/billing/schedule-plan-change', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ productId: targetProductId }),
                });
                const json = await res.json().catch(() => ({}));
                if (!res.ok) {
                    setErrorMessage(json.error || 'Failed to schedule downgrade');
                    setStatus('error');
                    return;
                }
                setStatus('success');
                setTimeout(() => {
                    onClose();
                    window.location.reload();
                }, 1400);
            } catch (e: any) {
                setErrorMessage(e?.message || 'Failed to schedule downgrade');
                setStatus('error');
            }
            return;
        }

        setStatus('processing');
        try {
            const res = await fetch('/api/billing/change-plan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ productId: targetProductId }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setErrorMessage(json.error || 'Failed to change plan');
                setStatus('error');
                return;
            }

            // Wait for Dodo's webhook to land the new state in our DB.
            const settled = await pollSubscriptionUntil(
                (row) => row.plan_id === plan.id,
                { timeoutMs: 20000 },
            );

            if (!settled) {
                setErrorMessage(
                    "Your payment went through, but we haven't heard back yet. Refresh in a moment to see the new plan.",
                );
                setStatus('error');
                return;
            }

            setStatus('success');
            // Brief celebration, then reload so every billing hook (balance,
            // subscription) sees the freshly written row.
            setTimeout(() => {
                onClose();
                window.location.reload();
            }, 1400);
        } catch (e: any) {
            setErrorMessage(e?.message || 'Failed to change plan');
            setStatus('error');
        }
    };

    // The success card text branches on the transition type so the user
    // sees exactly what just happened — not a generic "plan changed" line.
    let successTitle: string;
    let successDescription: string;
    if (isDowngrade) {
        successTitle = `Switch to ${plan.name} scheduled`;
        successDescription = `You'll keep your current plan until your period ends, then automatically switch to ${plan.name}. You can cancel the switch any time before then.`;
    } else if (isCycleSwap) {
        successTitle = `Now billed ${selectedCycle === 'yearly' ? 'annually' : 'monthly'}`;
        successDescription = selectedCycle === 'yearly'
            ? 'Your subscription renews once a year. Any unused monthly time was credited toward this year.'
            : 'Your subscription renews monthly now. Any unused yearly time was credited toward future renewals.';
    } else {
        successTitle = `You're on ${plan.name}`;
        successDescription = 'Your new plan is active and your credits have been updated.';
    }

    return (
        <>
            <button
                onClick={handleClick}
                disabled={status === 'processing'}
                className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all ${buttonClass} disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2`}
            >
                {label}
            </button>

            <BillingProcessingModal
                status={status}
                processingTitle={processingTitle}
                processingDescription={
                    isDowngrade
                        ? "No charges today — we're just recording your choice. The switch happens automatically when your current period ends."
                        : 'Charging your saved payment method. This usually takes a second or two.'
                }
                successTitle={successTitle}
                successDescription={successDescription}
                errorTitle={isDowngrade ? "Couldn't schedule downgrade" : "Couldn't change plan"}
                errorMessage={errorMessage}
                onClose={() => setStatus(null)}
            />
        </>
    );
}
