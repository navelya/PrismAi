/**
 * Wait for the user's subscription row to reach a target state.
 *
 * Billing API calls (`change-plan`, `cancel`, `resume`) return as soon as
 * Dodo accepts the request, but the user-visible state lives in the
 * `subscriptions` table — and that's only updated when Dodo's webhook
 * fires back to us. This helper bridges the gap: it polls the row until a
 * caller-supplied predicate is satisfied (e.g. "plan_id is now 'pro'") or
 * the timeout elapses.
 *
 * Returns the fresh row when the predicate matches, or null on timeout.
 */
import { createClient } from '@/lib/supabase/client';

export interface SubscriptionRow {
    plan_id: string;
    dodo_subscription_id: string | null;
    dodo_product_id: string | null;
    cancel_at_period_end: boolean;
    status: string;
}

interface PollOpts {
    /** Total time to wait before giving up. Default 15 seconds. */
    timeoutMs?: number;
    /** Delay between polls. Default 600 ms. */
    intervalMs?: number;
}

export async function pollSubscriptionUntil(
    predicate: (row: SubscriptionRow) => boolean,
    opts: PollOpts = {},
): Promise<SubscriptionRow | null> {
    const timeoutMs = opts.timeoutMs ?? 15000;
    const intervalMs = opts.intervalMs ?? 600;

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const { data } = await supabase
            .from('subscriptions')
            .select('plan_id, dodo_subscription_id, dodo_product_id, cancel_at_period_end, status')
            .eq('user_id', user.id)
            .maybeSingle();

        if (data && predicate(data as SubscriptionRow)) {
            return data as SubscriptionRow;
        }

        await sleep(intervalMs);
    }

    return null;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
