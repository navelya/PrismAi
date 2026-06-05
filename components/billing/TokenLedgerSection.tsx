'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatCredits } from '@/lib/billing/cost';

interface LedgerRow {
    id: string;
    amount: number;
    reason: string;
    metadata: any;
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
    const [ledgerLoading, setLedgerLoading] = useState(true);
    const [page, setPage] = useState(0);
    const [hasMore, setHasMore] = useState(false);

    const fetchLedger = useCallback(async (pageIdx: number) => {
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
