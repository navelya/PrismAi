'use client';

import { useAppStore } from '@/lib/store/app-store';

export interface CreditBreakdown {
    /** Authoritative DB balance (no optimistic overlay). */
    balance: number;
    /** Plan-origin credits remaining (monthly_topup, signup_bonus, subscription). */
    monthly: number;
    /** Purchased top-up credits remaining (packs). */
    topup: number;
}

/**
 * Reads the monthly-vs-top-up credit split from the shared store. It is preloaded
 * on app open (see AppLayout), so the popover renders instantly; `fetchBreakdown()`
 * triggers a silent refresh (e.g. on hover) without blanking the existing data.
 */
export function useCreditBreakdown() {
    const data = useAppStore((s) => s.creditBreakdown) as CreditBreakdown | null;
    const loading = useAppStore((s) => s.isCreditBreakdownLoading);
    const fetchBreakdown = useAppStore((s) => s.fetchCreditBreakdown);
    return { data, loading, fetchBreakdown };
}
