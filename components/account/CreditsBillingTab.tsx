'use client';

import React, { useEffect } from 'react';
import { useCreditBreakdown } from '@/lib/billing/use-credit-breakdown';
import { CreditsBreakdownPanel } from '@/components/billing/CreditsBreakdownPanel';
import { TokenLedgerSection } from '@/components/billing/TokenLedgerSection';
import { InvoicesSection, useHasPaidSub } from '@/components/billing/PlanBillingView';

/**
 * "Credits & billing" tab — the live credit breakdown on top, with usage
 * history and (for paid plans) invoices laid out side by side beneath it.
 */
export function CreditsBillingTab() {
    const { data: breakdown, loading, fetchBreakdown } = useCreditBreakdown();
    const hasPaidSub = useHasPaidSub();

    useEffect(() => {
        fetchBreakdown();
    }, [fetchBreakdown]);

    return (
        <div className="space-y-5">
            <CreditsBreakdownPanel data={breakdown} loading={loading} variant="panel" />

            <div className={`grid gap-5 ${hasPaidSub ? 'xl:grid-cols-2' : ''}`}>
                <TokenLedgerSection />
                <InvoicesSection hasPaidSub={hasPaidSub} />
            </div>
        </div>
    );
}
