'use client';

import { useEffect, useState } from 'react';
import type { PlanId } from './plans-config';

export interface PendingPlanChange {
    planId: PlanId;
    cycle: 'monthly' | 'yearly';
}

export interface SubscriptionInfo {
    planId: PlanId;
    status: 'active' | 'canceled' | 'past_due';
    nextTopupAt: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    /** 'monthly' or 'yearly' for paid plans; null for free. */
    billingCycle: 'monthly' | 'yearly' | null;
    /**
     * Resolved pending plan change — the user has scheduled a switch to this
     * plan+cycle at the end of their current period. Null when no change is pending.
     * Resolved server-side from the raw Dodo product ID so the client never sees
     * raw product IDs.
     */
    pendingPlanChange: PendingPlanChange | null;
}

export function useSubscription() {
    const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let unmounted = false;

        (async () => {
            try {
                const res = await fetch('/api/billing/subscription');
                if (unmounted) return;

                if (!res.ok) {
                    if (res.status !== 401) {
                        const json = await res.json().catch(() => ({}));
                        setError(json.error || 'Failed to load subscription');
                    }
                    setLoading(false);
                    return;
                }

                const json = await res.json().catch(() => ({}));
                if (unmounted) return;

                if (json.subscription) {
                    setSubscription(json.subscription as SubscriptionInfo);
                }
                setLoading(false);
            } catch (e: any) {
                if (!unmounted) {
                    setError(e?.message || 'Failed to load subscription');
                    setLoading(false);
                }
            }
        })();

        return () => { unmounted = true; };
    }, []);

    return { subscription, loading, error };
}
