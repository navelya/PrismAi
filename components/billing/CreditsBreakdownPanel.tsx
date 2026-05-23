'use client';

import React from 'react';
import { formatCredits } from '@/lib/billing/cost';
import { Skeleton } from '@/components/ui/Skeleton';
import type { CreditBreakdown } from '@/lib/billing/use-credit-breakdown';

interface CreditsBreakdownPanelProps {
    data: CreditBreakdown | null;
    loading: boolean;
}

/**
 * Hover panel showing how the credit balance splits between plan-origin
 * ("monthly") and purchased ("top-up") credits, with a proportional bar.
 */
export function CreditsBreakdownPanel({ data, loading }: CreditsBreakdownPanelProps) {
    const total = data ? Math.max(0, data.monthly + data.topup) : 0;
    const monthlyPct = total > 0 ? (data!.monthly / total) * 100 : 0;
    const topupPct = total > 0 ? (data!.topup / total) * 100 : 0;

    return (
        <div className="w-64 rounded-xl border border-stroke-subtle bg-surface-elevated/95 backdrop-blur-md shadow-xl shadow-black/30 p-3.5">
            <div className="flex items-center justify-between mb-2.5">
                <span className="text-[10px] font-bold uppercase tracking-widest text-content-tertiary">
                    Credit breakdown
                </span>
                {data && (
                    <span className="text-xs font-semibold text-content-primary tabular-nums">
                        {formatCredits(data.balance)}
                    </span>
                )}
            </div>

            {loading && !data ? (
                <div className="space-y-2.5">
                    <Skeleton className="h-2 w-full rounded-full" />
                    <Skeleton className="h-3 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                </div>
            ) : !data || total === 0 ? (
                <p className="text-xs text-content-tertiary py-1">No credits to break down.</p>
            ) : (
                <>
                    {/* Proportional bar */}
                    <div className="h-2 w-full rounded-full overflow-hidden bg-white/10 flex">
                        {monthlyPct > 0 && (
                            <div className="bg-accent-primary h-full" style={{ width: `${monthlyPct}%` }} />
                        )}
                        {topupPct > 0 && (
                            <div className="bg-violet-400 h-full" style={{ width: `${topupPct}%` }} />
                        )}
                    </div>

                    {/* Legend */}
                    <div className="mt-3 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-1.5 text-content-secondary">
                                <span className="w-2 h-2 rounded-full bg-accent-primary" />
                                Monthly
                            </span>
                            <span className="font-semibold text-content-primary tabular-nums">
                                {formatCredits(data.monthly)}
                            </span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-1.5 text-content-secondary">
                                <span className="w-2 h-2 rounded-full bg-violet-400" />
                                Top-up
                            </span>
                            <span className="font-semibold text-content-primary tabular-nums">
                                {formatCredits(data.topup)}
                            </span>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
