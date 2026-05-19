'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useTokenBalance } from '@/lib/billing/use-balance';
import { useSubscription } from '@/lib/billing/use-subscription';
import { getPlanDisplay } from '@/lib/billing/plans-config';
import { formatCredits } from '@/lib/billing/cost';
import PlansModal from './PlansModal';

interface LedgerRow {
    id: string;
    amount: number;
    reason: string;
    metadata: any;
    created_at: string;
}

const PAGE_SIZE = 20;

const REASON_LABELS: Record<string, string> = {
    signup_bonus: 'Signup bonus',
    monthly_topup: 'Monthly refill',
    execution_debit: 'Workflow run',
    execution_refund: 'Refund (failed run)',
    purchase: 'Credit purchase',
    subscription_grant: 'Subscription grant',
    admin_adjustment: 'Adjustment',
    stripe_refund: 'Stripe refund',
    stripe_chargeback: 'Chargeback',
    paddle_pack_purchase: 'Credit pack',
    paddle_subscription_grant: 'Subscription credits',
    paddle_refund: 'Refund',
    paddle_chargeback: 'Chargeback',
};

function humanizeReason(row: LedgerRow): string {
    if (row.reason === 'admin_adjustment') {
        const note = typeof row.metadata?.note === 'string' ? row.metadata.note.trim() : '';
        if (note) return note;
        return row.amount > 0 ? 'Prisfol Gift' : 'Adjustment';
    }
    return REASON_LABELS[row.reason] ?? row.reason;
}

function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
}

export default function PlanBillingView() {
    const { balance } = useTokenBalance();
    const { subscription, loading: subLoading } = useSubscription();
    const [showPlans, setShowPlans] = useState(false);
    const [ledger, setLedger] = useState<LedgerRow[]>([]);
    const [ledgerLoading, setLedgerLoading] = useState(true);
    const [page, setPage] = useState(0);
    const [hasMore, setHasMore] = useState(false);

    const fetchLedger = React.useCallback(async (pageIdx: number) => {
        setLedgerLoading(true);
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            setLedgerLoading(false);
            return;
        }

        const from = pageIdx * PAGE_SIZE;
        const to = from + PAGE_SIZE;

        const { data, error } = await supabase
            .from('token_ledger')
            .select('id, amount, reason, metadata, created_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .range(from, to);

        if (error) {
            console.error('[Billing] Failed to load ledger:', error);
            setLedgerLoading(false);
            return;
        }

        const rows = (data || []) as LedgerRow[];
        setHasMore(rows.length > PAGE_SIZE);
        setLedger(rows.slice(0, PAGE_SIZE));
        setLedgerLoading(false);
    }, []);

    useEffect(() => {
        fetchLedger(page);
    }, [page, fetchLedger]);

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
                            Manage your plan, balance, and credit history.
                        </p>
                    </div>
                </header>

                {/* Current plan card */}
                <section className="relative rounded-2xl border border-stroke-subtle bg-gradient-to-br from-surface-elevated to-surface-primary/40 overflow-hidden">
                    <div className="pointer-events-none absolute -right-20 -top-20 w-72 h-72 rounded-full bg-accent-primary/10 blur-3xl" />
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
                                        subLoading || !subscription
                                            ? '…'
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
                                    {formatCredits(balance)}
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
                        />
                    )}
                </section>

                {/* Invoices */}
                <InvoicesSection hasPaidSub={!!subscription && subscription.planId !== 'free'} />

                {/* Billing history */}
                <section className="rounded-2xl border border-stroke-subtle bg-surface-elevated overflow-hidden">
                    <header className="flex items-center justify-between px-6 py-4 border-b border-stroke-subtle">
                        <div>
                            <h2 className="text-base font-bold text-content-primary">Billing history</h2>
                            <p className="text-xs text-content-tertiary mt-0.5">
                                Every credit movement on your account.
                            </p>
                        </div>
                        <button
                            onClick={() => fetchLedger(page)}
                            className="px-3 py-1.5 text-xs font-medium text-content-secondary hover:text-content-primary hover:bg-surface-tertiary rounded-lg transition-colors"
                        >
                            {ledgerLoading ? 'Refreshing…' : 'Refresh'}
                        </button>
                    </header>

                    {ledgerLoading && ledger.length === 0 ? (
                        <div className="flex items-center justify-center py-16">
                            <div className="w-5 h-5 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
                        </div>
                    ) : ledger.length === 0 ? (
                        <div className="px-6 py-12 text-center text-sm text-content-tertiary">
                            No activity yet.
                        </div>
                    ) : (
                        <ul className="divide-y divide-stroke-subtle">
                            {ledger.map((row) => (
                                <LedgerRowItem key={row.id} row={row} />
                            ))}
                        </ul>
                    )}

                    {/* Pagination */}
                    {(page > 0 || hasMore) && (
                        <div className="flex items-center justify-between px-6 py-3 border-t border-stroke-subtle">
                            <button
                                onClick={() => setPage((p) => Math.max(0, p - 1))}
                                disabled={page === 0}
                                className="px-3 py-1.5 text-xs font-medium text-content-secondary hover:text-content-primary hover:bg-surface-tertiary rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                Previous
                            </button>
                            <span className="text-xs text-content-tertiary tabular-nums">
                                Page {page + 1}
                            </span>
                            <button
                                onClick={() => setPage((p) => p + 1)}
                                disabled={!hasMore}
                                className="px-3 py-1.5 text-xs font-medium text-content-secondary hover:text-content-primary hover:bg-surface-tertiary rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                Next
                            </button>
                        </div>
                    )}
                </section>
            </div>

            <PlansModal isOpen={showPlans} onClose={() => setShowPlans(false)} />
        </>
    );
}

interface SubscriptionActionsProps {
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: string | null;
    planName: string;
}

function SubscriptionActions({
    cancelAtPeriodEnd,
    currentPeriodEnd,
    planName,
}: SubscriptionActionsProps) {
    const [cancelLoading, setCancelLoading] = useState(false);
    const [resumeLoading, setResumeLoading] = useState(false);
    const [paymentLoading, setPaymentLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [confirmingCancel, setConfirmingCancel] = useState(false);

    const handleCancel = async () => {
        setError(null);
        setCancelLoading(true);
        try {
            const res = await fetch('/api/billing/cancel', { method: 'POST' });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(json.error || 'Failed to cancel subscription');
                return;
            }
            setConfirmingCancel(false);
            // Paddle's webhook updates our row; give it a beat, then refresh.
            setTimeout(() => window.location.reload(), 800);
        } catch (e: any) {
            setError(e?.message || 'Failed to cancel subscription');
        } finally {
            setCancelLoading(false);
        }
    };

    const handleResume = async () => {
        setError(null);
        setResumeLoading(true);
        try {
            const res = await fetch('/api/billing/resume', { method: 'POST' });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(json.error || 'Failed to resume subscription');
                return;
            }
            setTimeout(() => window.location.reload(), 800);
        } catch (e: any) {
            setError(e?.message || 'Failed to resume subscription');
        } finally {
            setResumeLoading(false);
        }
    };

    const handleUpdatePayment = async () => {
        setError(null);
        setPaymentLoading(true);
        try {
            const res = await fetch('/api/billing/payment-method', { method: 'POST' });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || !json.url) {
                setError(json.error || 'Failed to open payment update');
                return;
            }
            window.open(json.url, '_blank', 'noopener,noreferrer');
        } catch (e: any) {
            setError(e?.message || 'Failed to open payment update');
        } finally {
            setPaymentLoading(false);
        }
    };

    return (
        <div className="relative border-t border-stroke-subtle bg-surface-primary/30 px-6 sm:px-7 py-4">
            {cancelAtPeriodEnd && currentPeriodEnd && (
                <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-200">
                    Your <span className="font-semibold">{planName}</span> plan will end on{' '}
                    <span className="font-semibold">{formatDate(currentPeriodEnd)}</span>.
                    You&apos;ll keep access until then.
                </div>
            )}

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
                ) : confirmingCancel ? (
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-content-secondary">Cancel at period end?</span>
                        <button
                            onClick={handleCancel}
                            disabled={cancelLoading}
                            className="px-3 py-1.5 rounded-full bg-accent-error/15 border border-accent-error/40 text-accent-error hover:bg-accent-error/25 text-xs font-semibold transition-all disabled:opacity-50"
                        >
                            {cancelLoading ? 'Canceling…' : 'Yes, cancel'}
                        </button>
                        <button
                            onClick={() => setConfirmingCancel(false)}
                            disabled={cancelLoading}
                            className="px-3 py-1.5 rounded-full text-content-tertiary hover:text-content-primary text-xs font-semibold transition-all"
                        >
                            Keep
                        </button>
                    </div>
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

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <div className="text-[10px] font-bold tracking-widest uppercase text-content-tertiary mb-1">
                {label}
            </div>
            <div className="text-sm font-semibold text-content-primary">{value}</div>
        </div>
    );
}

function LedgerRowItem({ row }: { row: LedgerRow }) {
    const isCredit = row.amount > 0;
    const reason = humanizeReason(row);

    return (
        <li className="flex items-center gap-4 px-6 py-3.5 hover:bg-surface-primary/40 transition-colors">
            <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-content-primary">{reason}</div>
                <div className="text-xs text-content-tertiary mt-0.5">
                    {formatDate(row.created_at)}
                </div>
            </div>
            <div
                className={`text-sm font-bold tabular-nums flex-shrink-0 ${isCredit ? 'text-emerald-400' : 'text-content-primary'
                    }`}
            >
                {isCredit ? '+' : '−'}
                {formatCredits(Math.abs(row.amount))}
            </div>
        </li>
    );
}
