'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { formatCredits } from '@/lib/billing/cost';
import { RunResultStrip } from '@/components/billing/RunResultStrip';
import type { RunDetail } from '@/lib/billing/run-details';

interface LedgerRow {
    id: string;
    amount: number;
    reason: string;
    metadata: any;
    execution_id: string | null;
    created_at: string;
}

const PAGE_SIZE = 10;

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

/**
 * Paginated list of every credit movement on the user's account, read from the
 * `token_ledger` table. Lives in the Tokens & Credits Usage settings tab.
 */
export function TokenLedgerSection() {
    const [ledger, setLedger] = useState<LedgerRow[]>([]);
    const [runs, setRuns] = useState<Record<string, RunDetail>>({});
    const [ledgerLoading, setLedgerLoading] = useState(true);
    const [page, setPage] = useState(0);
    const [hasMore, setHasMore] = useState(false);

    const fetchLedger = useCallback(async (pageIdx: number) => {
        setLedgerLoading(true);
        try {
            const res = await fetch(`/api/billing/runs?page=${pageIdx}&pageSize=${PAGE_SIZE}`);
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);

            setLedger((data.rows || []) as LedgerRow[]);
            setRuns((data.runDetails || {}) as Record<string, RunDetail>);
            setHasMore(!!data.hasMore);
        } catch (err) {
            console.error('[Billing] Failed to load usage history:', err);
        } finally {
            setLedgerLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchLedger(page);
    }, [page, fetchLedger]);

    return (
        <section className="rounded-2xl border border-stroke-subtle bg-surface-elevated overflow-hidden">
            <header className="flex items-center justify-between px-6 py-4 border-b border-stroke-subtle">
                <div>
                    <h2 className="text-base font-bold text-content-primary">Usage history</h2>
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
                        <LedgerRowItem
                            key={row.id}
                            row={row}
                            detail={row.execution_id ? runs[row.execution_id] : undefined}
                        />
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
    );
}

function LedgerRowItem({ row, detail }: { row: LedgerRow; detail?: RunDetail }) {
    const isCredit = row.amount > 0;
    const reason = humanizeReason(row);

    return (
        <li className="px-6 py-3.5 hover:bg-surface-primary/40 transition-colors">
            <div className="flex items-center gap-4">
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
            </div>
            <RunResultStrip detail={detail} />
        </li>
    );
}
