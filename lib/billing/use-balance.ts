'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAppStore } from '@/lib/store/app-store';

/**
 * Subscribes to the authenticated user's token_balance with realtime updates,
 * and overlays the store's ephemeral optimisticCreditDelta so the displayed
 * balance reflects an in-flight run instantly. Any authoritative update (initial
 * fetch or realtime) resets the optimistic delta to 0 — the server is then truth.
 *
 * The trigger on profiles only allows service_role to mutate token_balance, so
 * any change you see here came from a server-side RPC (debit / credit / refund /
 * topup).
 */
export function useTokenBalance() {
    const [rawBalance, setRawBalance] = useState<number | null>(null);
    const [userId, setUserId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const optimisticDelta = useAppStore((s) => s.optimisticCreditDelta);
    const resetOptimisticDelta = useAppStore((s) => s.resetOptimisticDelta);

    useEffect(() => {
        const supabase = createClient();
        let unmounted = false;
        let channel: ReturnType<typeof supabase.channel> | null = null;

        (async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) {
                    if (!unmounted) setLoading(false);
                    return;
                }
                if (unmounted) return;
                setUserId(user.id);

                const { data: profile, error: fetchErr } = await supabase
                    .from('profiles')
                    .select('token_balance')
                    .eq('id', user.id)
                    .single();

                if (unmounted) return;
                if (fetchErr) {
                    setError(fetchErr.message);
                } else {
                    setRawBalance(Number(profile?.token_balance ?? 0));
                    resetOptimisticDelta();
                }
                setLoading(false);

                channel = supabase
                    .channel(`balance:${user.id}`)
                    .on(
                        'postgres_changes',
                        {
                            event: 'UPDATE',
                            schema: 'public',
                            table: 'profiles',
                            filter: `id=eq.${user.id}`,
                        },
                        (payload: { new: { token_balance?: number | string } }) => {
                            const next = payload.new?.token_balance;
                            if (next !== undefined && next !== null) {
                                setRawBalance(Number(next));
                                resetOptimisticDelta();
                            }
                        }
                    )
                    .subscribe();
            } catch (e: any) {
                if (!unmounted) {
                    setError(e?.message || 'Failed to load balance');
                    setLoading(false);
                }
            }
        })();

        return () => {
            unmounted = true;
            if (channel) channel.unsubscribe();
        };
    }, [resetOptimisticDelta]);

    const balance = rawBalance === null ? null : rawBalance + optimisticDelta;

    return { balance, userId, loading, error };
}
