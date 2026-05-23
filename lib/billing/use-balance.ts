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
 * Auth resolution is deliberately resilient. We seed from `getSession()` (reads
 * the locally stored session — no network round-trip, so it can't transiently
 * fail the way `getUser()` can) AND listen to `onAuthStateChange`. If the session
 * isn't hydrated yet at mount, or a token refresh lands later, the auth listener
 * (re)loads the balance — so the UI never dead-ends on the '—' placeholder until
 * a manual refresh.
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
        let loadedUserId: string | null = null;

        const load = async (uid: string) => {
            if (!unmounted) setUserId(uid);

            const { data: profile, error: fetchErr } = await supabase
                .from('profiles')
                .select('token_balance')
                .eq('id', uid)
                .single();

            if (unmounted) return;
            if (fetchErr) {
                setError(fetchErr.message);
            } else {
                setError(null);
                setRawBalance(Number(profile?.token_balance ?? 0));
                resetOptimisticDelta();
            }
            setLoading(false);

            // Subscribe once per user. Realtime UPDATEs are the authoritative
            // source; each one resets the optimistic delta back to 0.
            if (!channel) {
                channel = supabase
                    .channel(`balance:${uid}`)
                    .on(
                        'postgres_changes',
                        {
                            event: 'UPDATE',
                            schema: 'public',
                            table: 'profiles',
                            filter: `id=eq.${uid}`,
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
            }
            loadedUserId = uid;
        };

        // Fast path: seed from the locally stored session (no network).
        (async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (unmounted) return;
                if (session?.user) {
                    await load(session.user.id);
                } else {
                    // No local session — likely logged out. Resolve loading so we
                    // don't spin forever; the auth listener recovers if a session
                    // arrives.
                    setLoading(false);
                }
            } catch (e: any) {
                if (!unmounted) {
                    setError(e?.message || 'Failed to load balance');
                    setLoading(false);
                }
            }
        })();

        // Recovery path: load (or reload) whenever auth resolves a user — covers
        // the initial-session-not-yet-hydrated race and token refreshes.
        const { data: authListener } = supabase.auth.onAuthStateChange((_event: any, session: any) => {
            if (unmounted) return;
            const uid = session?.user?.id;
            if (uid) {
                if (uid !== loadedUserId) load(uid);
            } else {
                // Signed out — clear and tear down the realtime channel.
                loadedUserId = null;
                setUserId(null);
                setRawBalance(null);
                setLoading(false);
                if (channel) {
                    channel.unsubscribe();
                    channel = null;
                }
            }
        });

        return () => {
            unmounted = true;
            if (channel) channel.unsubscribe();
            authListener?.subscription?.unsubscribe();
        };
    }, [resetOptimisticDelta]);

    const balance = rawBalance === null ? null : rawBalance + optimisticDelta;

    return { balance, userId, loading, error };
}
