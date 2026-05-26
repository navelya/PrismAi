'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { useTokenBalance } from '@/lib/billing/use-balance';
import { useSubscription } from '@/lib/billing/use-subscription';
import { getPlanDisplay, PLANS } from '@/lib/billing/plans-config';
import { formatCredits } from '@/lib/billing/cost';
import { loadPaddle } from '@/lib/billing/paddle-client';
import { pollSubscriptionUntil } from '@/lib/billing/poll-subscription';
import PlansModal from './PlansModal';
import BillingProcessingModal, { type BillingStatus } from './BillingProcessingModal';
import CancelConfirmModal from './CancelConfirmModal';

function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
}

// Session flag so we resync DB ↔ Paddle once per browser tab on mount.
// Cheap insurance against rare cases where webhooks missed an update or
// events for an orphaned subscription overwrote the active row.
const SYNC_SESSION_FLAG = 'prisfol_billing_synced';

export default function PlanBillingView() {
    const { balance } = useTokenBalance();
    const { subscription, loading: subLoading } = useSubscription();
    const [showPlans, setShowPlans] = useState(false);
    // `syncCompleted` gates the plan card render so it never paints with a
    // stale row. It starts false and only flips true once we've either run
    // the resync OR confirmed it was skipped (already done this session). If
    // we end up reloading, we deliberately leave it false so the skeleton
    // bridges the gap until the new page paints.
    const [syncCompleted, setSyncCompleted] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (sessionStorage.getItem(SYNC_SESSION_FLAG)) {
            setSyncCompleted(true);
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/billing/sync', { method: 'POST' });
                const json = await res.json().catch(() => ({}));
                if (!cancelled && res.ok) {
                    sessionStorage.setItem(SYNC_SESSION_FLAG, '1');
                    if (json.synced && json.changed) {
                        // DB actually moved. Reload so every hook on the page
                        // (useSubscription, useTokenBalance) sees the fresh row.
                        // Do NOT release the skeleton — the reload owns it from
                        // here, otherwise the user sees a frame of stale data.
                        window.location.reload();
                        return;
                    }
                }
            } catch {
                // Silent: a failed resync isn't fatal — show whatever the DB
                // has and let the user retry.
            }
            if (!cancelled) setSyncCompleted(true);
        })();
        return () => { cancelled = true; };
        // Run once on mount only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const plan = getPlanDisplay(subscription?.planId ?? 'free');

    return (
        <>
            <div className="max-w-4xl mx-auto p-6 sm:p-8 space-y-6">
                {/* Header */}
                <header className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-black font-display text-content-primary tracking-tight">
                            Plan & Billing
                        </h1>
                        <p className="text-sm text-content-secondary mt-1">
                            Manage your plan and balance.
                        </p>
                    </div>
                </header>

                {/* Past-due banner — surfaces a failed renewal so the user can
                    fix their card before the sub gets canceled by Paddle. */}
                {!subLoading && syncCompleted && subscription?.status === 'past_due' && (
                    <PastDueBanner />
                )}

                {/* Current plan card */}
                <section className="relative rounded-2xl border border-stroke-subtle bg-gradient-to-br from-surface-elevated to-surface-primary/40 overflow-hidden">
                    <div className="pointer-events-none absolute -right-20 -top-20 w-72 h-72 rounded-full bg-accent-primary/10 blur-3xl" />
                    {subLoading || !syncCompleted ? (
                        <PlanCardSkeleton />
                    ) : (
                        <>
                            <div className="relative p-6 sm:p-7 flex flex-col sm:flex-row gap-6 sm:items-start">
                                {/* Plan info */}
                                <div className="flex-1 min-w-0">
                                    <span className="text-[10px] font-bold tracking-widest uppercase text-content-tertiary">
                                        Current plan
                                    </span>
                                    <h2 className="text-xl font-bold font-display text-content-primary mt-1">
                                        {plan?.name ?? 'Free'}
                                    </h2>
                                    <p className="text-xs text-content-tertiary mt-0.5">
                                        {plan?.tagline}
                                    </p>
                                    <div className="grid grid-cols-2 gap-4 mt-5">
                                        <Stat
                                            label="Monthly floor"
                                            value={formatCredits(plan?.monthlyCredits ?? 0)}
                                        />
                                        <Stat
                                            label={subscription?.cancelAtPeriodEnd ? 'Ends on' : 'Next refill'}
                                            value={
                                                !subscription
                                                    ? '—'
                                                    : formatDate(
                                                        subscription.cancelAtPeriodEnd && subscription.currentPeriodEnd
                                                            ? subscription.currentPeriodEnd
                                                            : subscription.nextTopupAt,
                                                    )
                                            }
                                        />
                                    </div>
                                </div>

                                {/* Balance + CTA */}
                                <div className="flex sm:flex-col gap-4 sm:items-end items-center sm:min-w-[180px] pt-4 sm:pt-0 border-t sm:border-t-0 sm:border-l border-stroke-subtle sm:pl-6">
                                    <div className="flex-1 sm:flex-none sm:text-right">
                                        <div className="text-[10px] font-bold tracking-widest uppercase text-content-tertiary mb-1">
                                            Balance
                                        </div>
                                        <div className="text-2xl font-bold font-display text-content-primary tabular-nums">
                                            {balance === null ? <Skeleton className="h-7 w-20 ml-auto" /> : formatCredits(balance)}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setShowPlans(true)}
                                        className="px-4 py-2 rounded-full bg-accent-primary text-white text-sm font-semibold hover:bg-accent-primary/90 transition-all shadow-lg shadow-accent-primary/30"
                                    >
                                        {subscription && subscription.planId !== 'free' ? 'Change plan' : 'Upgrade'}
                                    </button>
                                </div>
                            </div>

                            {/* Subscription actions / cancel banner */}
                            {subscription && subscription.planId !== 'free' && (
                                <SubscriptionActions
                                    cancelAtPeriodEnd={subscription.cancelAtPeriodEnd}
                                    currentPeriodEnd={subscription.currentPeriodEnd}
                                    planName={plan?.name ?? subscription.planId}
                                    pendingPlanChangePriceId={subscription.pendingPlanChangePriceId}
                                />
                            )}
                        </>
                    )}
                </section>

                {/* Invoices */}
                <InvoicesSection hasPaidSub={!!subscription && subscription.planId !== 'free'} />
            </div>

            <PlansModal isOpen={showPlans} onClose={() => setShowPlans(false)} />
        </>
    );
}

interface SubscriptionActionsProps {
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: string | null;
    planName: string;
    pendingPlanChangePriceId: string | null;
}

function SubscriptionActions({
    cancelAtPeriodEnd,
    currentPeriodEnd,
    planName,
    pendingPlanChangePriceId,
}: SubscriptionActionsProps) {
    const [paymentLoading, setPaymentLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [confirmingCancel, setConfirmingCancel] = useState(false);

    // One modal serves both cancel and resume — the copy is set per action via
    // these refs/state so the user always sees the right title and outcome.
    const [billingStatus, setBillingStatus] = useState<BillingStatus | null>(null);
    const [billingErrorMessage, setBillingErrorMessage] = useState<string | null>(null);
    const [actionKind, setActionKind] = useState<'cancel' | 'resume' | null>(null);

    const cancelLoading = billingStatus === 'processing' && actionKind === 'cancel';
    const resumeLoading = billingStatus === 'processing' && actionKind === 'resume';

    const handleCancel = async () => {
        setError(null);
        setBillingErrorMessage(null);
        setActionKind('cancel');
        setBillingStatus('processing');
        try {
            const res = await fetch('/api/billing/cancel', { method: 'POST' });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setBillingErrorMessage(json.error || 'Failed to cancel subscription');
                setBillingStatus('error');
                return;
            }
            // Close the confirmation modal — the processing modal owns the UI now.
            setConfirmingCancel(false);

            const settled = await pollSubscriptionUntil(
                (row) => row.cancel_at_period_end === true,
                { timeoutMs: 20000 },
            );

            if (!settled) {
                setBillingErrorMessage(
                    'Your cancellation request was accepted, but we’re still waiting on confirmation from Paddle. Refresh in a moment.',
                );
                setBillingStatus('error');
                return;
            }

            setBillingStatus('success');
            setTimeout(() => window.location.reload(), 1400);
        } catch (e: any) {
            setBillingErrorMessage(e?.message || 'Failed to cancel subscription');
            setBillingStatus('error');
        }
    };

    const handleResume = async () => {
        setError(null);
        setBillingErrorMessage(null);
        setActionKind('resume');
        setBillingStatus('processing');
        try {
            const res = await fetch('/api/billing/resume', { method: 'POST' });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setBillingErrorMessage(json.error || 'Failed to resume subscription');
                setBillingStatus('error');
                return;
            }

            const settled = await pollSubscriptionUntil(
                (row) => row.cancel_at_period_end === false,
                { timeoutMs: 20000 },
            );

            if (!settled) {
                setBillingErrorMessage(
                    'Resume request was accepted, but we’re still waiting on confirmation from Paddle. Refresh in a moment.',
                );
                setBillingStatus('error');
                return;
            }

            setBillingStatus('success');
            setTimeout(() => window.location.reload(), 1400);
        } catch (e: any) {
            setBillingErrorMessage(e?.message || 'Failed to resume subscription');
            setBillingStatus('error');
        }
    };

    const [pendingCancelLoading, setPendingCancelLoading] = useState(false);
    const handleCancelPending = async () => {
        setError(null);
        setPendingCancelLoading(true);
        try {
            const res = await fetch('/api/billing/schedule-plan-change', {
                method: 'DELETE',
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(json.error || 'Failed to cancel scheduled change');
                return;
            }
            setTimeout(() => window.location.reload(), 200);
        } catch (e: any) {
            setError(e?.message || 'Failed to cancel scheduled change');
        } finally {
            setPendingCancelLoading(false);
        }
    };

    const handleUpdatePayment = async () => {
        setError(null);
        setPaymentLoading(true);
        try {
            const res = await fetch('/api/billing/payment-method', { method: 'POST' });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || !json.transactionId) {
                setError(json.error || 'Failed to open payment update');
                return;
            }
            const paddle = await loadPaddle();
            if (!paddle) {
                setError('Could not initialize payment form.');
                return;
            }
            paddle.Checkout.open({
                transactionId: json.transactionId,
                settings: {
                    displayMode: 'overlay',
                    theme: 'dark',
                    // Paddle reloads this URL on completion, refreshing the
                    // page so the new payment method shows up.
                    successUrl: `${window.location.origin}/settings?tab=plan-billing`,
                },
            });
        } catch (e: any) {
            setError(e?.message || 'Failed to open payment update');
        } finally {
            setPaymentLoading(false);
        }
    };

    return (
        <>
            <div className="relative border-t border-stroke-subtle bg-surface-primary/30 px-6 sm:px-7 py-4">
                {cancelAtPeriodEnd && currentPeriodEnd && (
                    <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-200">
                        Your <span className="font-semibold">{planName}</span> plan will end on{' '}
                        <span className="font-semibold">{formatDate(currentPeriodEnd)}</span>.
                        You&apos;ll keep access until then.
                    </div>
                )}

                {!cancelAtPeriodEnd && pendingPlanChangePriceId && currentPeriodEnd && (() => {
                    // Resolve the pending price ID to a display name. Walk
                    // PLANS rather than calling getPlanDisplay so we can find
                    // both yearly and monthly cycle entries.
                    const targetPlan = PLANS.find(
                        (p) =>
                            p.paddlePriceIdMonthly === pendingPlanChangePriceId ||
                            p.paddlePriceIdYearly === pendingPlanChangePriceId,
                    );
                    const targetName = targetPlan?.name ?? 'a different plan';
                    return (
                        <div className="mb-3 rounded-lg border border-accent-primary/30 bg-accent-primary/[0.06] px-3 py-2.5 flex flex-wrap items-center justify-between gap-2">
                            <div className="text-xs text-content-secondary leading-relaxed min-w-0">
                                Switching to <span className="font-semibold text-content-primary">{targetName}</span> on{' '}
                                <span className="font-semibold text-content-primary">{formatDate(currentPeriodEnd)}</span>.
                                You&apos;ll stay on {planName} until then.
                            </div>
                            <button
                                onClick={handleCancelPending}
                                disabled={pendingCancelLoading}
                                className="flex-shrink-0 px-3 py-1 rounded-full text-[11px] font-semibold text-content-secondary hover:text-content-primary hover:bg-surface-tertiary border border-stroke-subtle transition-all disabled:opacity-50"
                            >
                                {pendingCancelLoading ? 'Canceling…' : 'Cancel switch'}
                            </button>
                        </div>
                    );
                })()}

                <div className="flex flex-wrap items-center gap-2">
                    <button
                        onClick={handleUpdatePayment}
                        disabled={paymentLoading}
                        className="px-3 py-1.5 rounded-full border border-stroke-subtle text-content-secondary hover:text-content-primary hover:bg-surface-tertiary text-xs font-semibold transition-all disabled:opacity-50"
                    >
                        {paymentLoading ? 'Opening…' : 'Update payment method'}
                    </button>

                    {cancelAtPeriodEnd ? (
                        <button
                            onClick={handleResume}
                            disabled={resumeLoading}
                            className="px-3 py-1.5 rounded-full bg-accent-primary/15 border border-accent-primary/40 text-accent-primary hover:bg-accent-primary/25 text-xs font-semibold transition-all disabled:opacity-50"
                        >
                            {resumeLoading ? 'Resuming…' : 'Resume subscription'}
                        </button>
                    ) : (
                        <button
                            onClick={() => setConfirmingCancel(true)}
                            className="px-3 py-1.5 rounded-full text-content-tertiary hover:text-content-primary hover:bg-surface-tertiary text-xs font-semibold transition-all"
                        >
                            Cancel subscription
                        </button>
                    )}
                </div>

                {error && (
                    <p className="mt-2 text-[11px] text-accent-error">{error}</p>
                )}
            </div>

            <CancelConfirmModal
                open={confirmingCancel}
                planName={planName}
                currentPeriodEnd={currentPeriodEnd}
                loading={cancelLoading}
                onConfirm={handleCancel}
                onClose={() => {
                    if (!cancelLoading) setConfirmingCancel(false);
                }}
            />

            <BillingProcessingModal
                status={billingStatus}
                processingTitle={
                    actionKind === 'cancel' ? 'Canceling your subscription…' : 'Resuming your subscription…'
                }
                processingDescription={
                    actionKind === 'cancel'
                        ? 'Confirming the cancellation with Paddle. You’ll keep access until your period ends.'
                        : 'Letting Paddle know you’re staying on. This usually takes a second.'
                }
                successTitle={
                    actionKind === 'cancel'
                        ? 'Subscription canceled'
                        : `You’re staying on ${planName}`
                }
                successDescription={
                    actionKind === 'cancel'
                        ? currentPeriodEnd
                            ? `Access continues until ${formatDate(currentPeriodEnd)}.`
                            : 'You’ll keep access until your period ends.'
                        : 'Your subscription will continue renewing as normal.'
                }
                errorTitle={
                    actionKind === 'cancel' ? 'Couldn’t cancel' : 'Couldn’t resume'
                }
                errorMessage={billingErrorMessage}
                onClose={() => setBillingStatus(null)}
            />
        </>
    );
}


interface InvoiceRow {
    id: string;
    invoiceNumber: string | null;
    status: string;
    billedAt: string | null;
    currencyCode: string;
    grandTotal: string | null;
    origin: string;
    subscriptionId: string | null;
}

function formatMinor(amountMinor: string | null, currency: string): string {
    if (!amountMinor) return '—';
    const n = Number(amountMinor);
    if (!Number.isFinite(n)) return '—';
    return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: currency || 'USD',
    }).format(n / 100);
}

function InvoicesSection({ hasPaidSub }: { hasPaidSub: boolean }) {
    const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchInvoices = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/billing/invoices');
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(json.error || 'Failed to load invoices');
                setInvoices([]);
                return;
            }
            setInvoices(json.invoices || []);
        } catch (e: any) {
            setError(e?.message || 'Failed to load invoices');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (hasPaidSub) {
            fetchInvoices();
        } else {
            setInvoices([]);
        }
    }, [hasPaidSub, fetchInvoices]);

    if (!hasPaidSub) return null;

    return (
        <section className="rounded-2xl border border-stroke-subtle bg-surface-elevated overflow-hidden">
            <header className="flex items-center justify-between px-6 py-4 border-b border-stroke-subtle">
                <div>
                    <h2 className="text-base font-bold text-content-primary">Invoices</h2>
                    <p className="text-xs text-content-tertiary mt-0.5">
                        Receipts from Paddle. Download the PDF for tax records.
                    </p>
                </div>
                <button
                    onClick={fetchInvoices}
                    className="px-3 py-1.5 text-xs font-medium text-content-secondary hover:text-content-primary hover:bg-surface-tertiary rounded-lg transition-colors"
                >
                    {loading ? 'Refreshing…' : 'Refresh'}
                </button>
            </header>

            {loading && invoices.length === 0 ? (
                <div className="flex items-center justify-center py-12">
                    <div className="w-5 h-5 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
                </div>
            ) : error ? (
                <div className="px-6 py-8 text-center text-sm text-accent-error">{error}</div>
            ) : invoices.length === 0 ? (
                <div className="px-6 py-10 text-center text-sm text-content-tertiary">
                    No invoices yet.
                </div>
            ) : (
                <ul className="divide-y divide-stroke-subtle">
                    {invoices.map((inv) => (
                        <li
                            key={inv.id}
                            className="flex items-center gap-4 px-6 py-3.5 hover:bg-surface-primary/40 transition-colors"
                        >
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-semibold text-content-primary truncate">
                                    {inv.invoiceNumber || inv.id}
                                </div>
                                <div className="text-xs text-content-tertiary mt-0.5">
                                    {inv.billedAt ? formatDate(inv.billedAt) : '—'} · {inv.status}
                                </div>
                            </div>
                            <div className="text-sm font-bold tabular-nums text-content-primary flex-shrink-0">
                                {formatMinor(inv.grandTotal, inv.currencyCode)}
                            </div>
                            <a
                                href={`/api/billing/invoices/${inv.id}/pdf`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-content-secondary hover:text-content-primary hover:bg-surface-tertiary transition-colors"
                            >
                                PDF
                            </a>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

function Stat({ label, value }: { label: string; value: string | React.ReactNode }) {
    return (
        <div>
            <div className="text-[10px] font-bold tracking-widest uppercase text-content-tertiary mb-1">
                {label}
            </div>
            <div className="text-sm font-semibold text-content-primary">{value}</div>
        </div>
    );
}

function Skeleton({ className = '' }: { className?: string }) {
    return (
        <div className={`rounded-md bg-surface-tertiary/70 animate-pulse ${className}`} />
    );
}

function PastDueBanner() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleClick = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/billing/payment-method', { method: 'POST' });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || !json.transactionId) {
                setError(json.error || 'Could not open the payment update form.');
                return;
            }
            const paddle = await loadPaddle();
            if (!paddle) {
                setError('Could not initialize payment form.');
                return;
            }
            paddle.Checkout.open({
                transactionId: json.transactionId,
                settings: {
                    displayMode: 'overlay',
                    theme: 'dark',
                    successUrl: `${window.location.origin}/settings?tab=plan-billing`,
                },
            });
        } catch (e: any) {
            setError(e?.message || 'Could not open the payment update form.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="rounded-2xl border border-accent-error/40 bg-accent-error/[0.06] px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-start gap-3 flex-1 min-w-0">
                <AlertCircle className="w-5 h-5 text-accent-error flex-shrink-0 mt-0.5" strokeWidth={2.5} />
                <div className="min-w-0">
                    <div className="text-sm font-bold text-content-primary">
                        Your last payment failed
                    </div>
                    <p className="text-xs text-content-secondary mt-0.5 leading-relaxed">
                        Update your card so we can retry the charge and keep your plan active.
                        We&apos;ll keep retrying for a few days before pausing access.
                    </p>
                    {error && (
                        <p className="text-[11px] text-accent-error mt-1.5">{error}</p>
                    )}
                </div>
            </div>
            <button
                onClick={handleClick}
                disabled={loading}
                className="flex-shrink-0 px-4 py-2 rounded-full bg-accent-error/90 hover:bg-accent-error text-white text-sm font-semibold transition-colors disabled:opacity-60"
            >
                {loading ? 'Opening…' : 'Update payment method'}
            </button>
        </div>
    );
}

function PlanCardSkeleton() {
    return (
        <div className="relative p-6 sm:p-7 flex flex-col sm:flex-row gap-6 sm:items-start">
            <div className="flex-1 min-w-0 space-y-3">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-7 w-32" />
                <Skeleton className="h-3 w-44" />
                <div className="grid grid-cols-2 gap-4 mt-5">
                    <div className="space-y-2">
                        <Skeleton className="h-3 w-20" />
                        <Skeleton className="h-4 w-16" />
                    </div>
                    <div className="space-y-2">
                        <Skeleton className="h-3 w-20" />
                        <Skeleton className="h-4 w-24" />
                    </div>
                </div>
            </div>
            <div className="flex sm:flex-col gap-4 sm:items-end items-center sm:min-w-[180px] pt-4 sm:pt-0 border-t sm:border-t-0 sm:border-l border-stroke-subtle sm:pl-6">
                <div className="flex-1 sm:flex-none sm:text-right space-y-2">
                    <Skeleton className="h-3 w-16 sm:ml-auto" />
                    <Skeleton className="h-7 w-24 sm:ml-auto" />
                </div>
                <Skeleton className="h-9 w-28 rounded-full" />
            </div>
        </div>
    );
}

