'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { PlanId } from './plans-config';

export interface SubscriptionInfo {
    planId: PlanId;
    status: 'active' | 'canceled' | 'past_due';
    nextTopupAt: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
}

export function useSubscription() {
    const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const supabase = createClient();
        let unmounted = false;

        (async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user || unmounted) {
                    setLoading(false);
                    return;
                }

                const { data, error: fetchErr } = await supabase
                    .from('subscriptions')
                    .select('plan_id, status, next_topup_at, current_period_end, cancel_at_period_end')
                    .eq('user_id', user.id)
                    .single();

                if (unmounted) return;

                if (fetchErr) {
                    setError(fetchErr.message);
                } else if (data) {
                    setSubscription({
                        planId: data.plan_id as PlanId,
                        status: data.status,
                        nextTopupAt: data.next_topup_at,
                        currentPeriodEnd: data.current_period_end,
                        cancelAtPeriodEnd: data.cancel_at_period_end,
                    });
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
