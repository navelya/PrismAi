'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useCreditBreakdown } from '@/lib/billing/use-credit-breakdown';
import { CreditsBreakdownPanel } from '@/components/billing/CreditsBreakdownPanel';
import { TokenLedgerSection } from '@/components/billing/TokenLedgerSection';
import { InvoicesSection, useHasPaidSub } from '@/components/billing/PlanBillingView';
import { useSubscription } from '@/lib/billing/use-subscription';
import { Switch } from '@/components/ui/Switch';

/**
 * "Credits & billing" tab — the live credit breakdown on top, with usage
 * history and (for paid plans) invoices laid out side by side beneath it.
 * Also shows a "save payment info" toggle for returning customers.
 */
export function CreditsBillingTab() {
    const { data: breakdown, loading, fetchBreakdown } = useCreditBreakdown();
    const hasPaidSub = useHasPaidSub();
    const { subscription } = useSubscription();

    const hasSavedCustomer = subscription?.hasSavedCustomer ?? false;
    const [savePaymentInfo, setSavePaymentInfo] = useState<boolean>(false);
    const [savingPref, setSavingPref] = useState(false);

    // Sync local state when subscription data loads.
    useEffect(() => {
        if (subscription?.savePaymentInfo !== undefined) {
            setSavePaymentInfo(subscription.savePaymentInfo);
        }
    }, [subscription?.savePaymentInfo]);

    useEffect(() => {
        fetchBreakdown();
    }, [fetchBreakdown]);

    const handleToggleSave = useCallback(async (checked: boolean) => {
        const prev = !checked;
        setSavePaymentInfo(checked);
        setSavingPref(true);
        try {
            const res = await fetch('/api/billing/save-payment-info', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: checked }),
            });
            if (!res.ok) {
                // Revert optimistic toggle on server error.
                setSavePaymentInfo(prev);
            }
        } catch {
            // Network error — revert optimistic toggle.
            setSavePaymentInfo(prev);
        } finally {
            setSavingPref(false);
        }
    }, []);

    return (
        <div className="space-y-5">
            <CreditsBreakdownPanel data={breakdown} loading={loading} variant="panel" />

            {hasSavedCustomer && (
                <div className="rounded-xl border border-stroke-subtle bg-surface-primary/40 p-4 space-y-1.5">
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <p className="text-sm font-medium text-content-primary">
                                Save my payment info for faster checkout
                            </p>
                            <p className="text-xs text-content-tertiary mt-0.5">
                                We&apos;ll show your saved card next time for faster checkout.
                            </p>
                        </div>
                        <Switch
                            checked={savePaymentInfo}
                            onCheckedChange={handleToggleSave}
                            disabled={savingPref}
                            size="sm"
                        />
                    </div>
                </div>
            )}

            <div className={`grid gap-5 ${hasPaidSub ? 'xl:grid-cols-2' : ''}`}>
                <TokenLedgerSection />
                <InvoicesSection hasPaidSub={hasPaidSub} />
            </div>
        </div>
    );
}
