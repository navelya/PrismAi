'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * Subscribes to the authenticated user's token_balance with realtime
 * updates. The trigger on profiles only allows service_role to mutate
 * token_balance, so any change you see here came from a server-side
 * RPC (debit / credit / refund / topup).
 */
export function useTokenBalance() {
    const [balance, setBalance] = useState<number | null>(null);
    const [userId, setUserId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

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
                    setBalance(Number(profile?.token_balance ?? 0));
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
                        (payload) => {
                            const next = (payload.new as { token_balance?: number | string })?.token_balance;
                            if (next !== undefined && next !== null) {
                                setBalance(Number(next));
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
    }, []);

    return { balance, userId, loading, error };
}
