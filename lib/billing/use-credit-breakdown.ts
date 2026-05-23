'use client';

import { useState, useCallback } from 'react';

export interface CreditBreakdown {
    /** Authoritative DB balance (no optimistic overlay). */
    balance: number;
    /** Plan-origin credits remaining (monthly_topup, signup_bonus, subscription). */
    monthly: number;
    /** Purchased top-up credits remaining (packs). */
    topup: number;
}

/**
 * Lazily fetches the monthly-vs-top-up split of the user's credit balance from
 * /api/billing/credit-breakdown. Call `fetchBreakdown()` when the breakdown UI
 * opens (e.g. on hover) so the numbers are fresh.
 */
export function useCreditBreakdown() {
    const [data, setData] = useState<CreditBreakdown | null>(null);
    const [loading, setLoading] = useState(false);

    const fetchBreakdown = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/billing/credit-breakdown');
            if (res.ok) {
                setData((await res.json()) as CreditBreakdown);
            }
        } catch {
            // Soft-fail: leave any prior data in place; the popover shows a
            // graceful empty state when data is null.
        } finally {
            setLoading(false);
        }
    }, []);

    return { data, loading, fetchBreakdown };
}
