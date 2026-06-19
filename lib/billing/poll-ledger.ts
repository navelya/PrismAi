/**
 * Wait for a Dodo-driven credit grant to land in `token_ledger`.
 *
 * Used by the silent credit-pack flow: after kicking off a charge against
 * the saved card, the client polls the ledger until the webhook has
 * recorded the grant — at which point the UI can confidently flip from
 * "processing" to "success".
 *
 * Returns the ledger row on success, or null on timeout.
 */
import { createClient } from '@/lib/supabase/client';

export interface LedgerGrantRow {
    id: string;
    amount: number;
    reason: string;
    metadata: Record<string, any> | null;
    created_at: string;
}

interface PollOpts {
    /** Total time to wait before giving up. Default 25 seconds. */
    timeoutMs?: number;
    /** Delay between polls. Default 700 ms. */
    intervalMs?: number;
}

/**
 * Watch for a pack-purchase grant for the given pack created after
 * `sinceMs`. We filter by pack ID (not payment ID) because
 * `buy-pack` doesn't return the payment it spawns — the
 * webhook is the first place we learn it. The `sinceMs` cutoff prevents
 * matching a previous purchase of the same pack.
 */
export async function pollLedgerForPack(
    packId: string,
    sinceMs: number,
    opts: PollOpts = {},
): Promise<LedgerGrantRow | null> {
    const timeoutMs = opts.timeoutMs ?? 25000;
    const intervalMs = opts.intervalMs ?? 700;

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const sinceIso = new Date(sinceMs).toISOString();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const { data } = await supabase
            .from('token_ledger')
            .select('id, amount, reason, metadata, created_at')
            .eq('user_id', user.id)
            .eq('reason', 'dodo_pack_purchase')
            .filter('metadata->>pack_id', 'eq', packId)
            .gte('created_at', sinceIso)
            .order('created_at', { ascending: false })
            .limit(1);

        if (data && data.length > 0) {
            return data[0] as LedgerGrantRow;
        }

        await sleep(intervalMs);
    }

    return null;
}

/**
 * Watch for ANY pack-purchase grant created after `sinceMs` — used by the
 * post-checkout success page, which (unlike the silent-charge flow) doesn't
 * know which pack was bought. The redirect lands here right after payment, so a
 * pack grant within the recent window is the purchase that just completed.
 *
 * Returns the ledger row on success, or null on timeout.
 */
export async function pollLedgerForRecentPack(
    sinceMs: number,
    opts: PollOpts = {},
): Promise<LedgerGrantRow | null> {
    const timeoutMs = opts.timeoutMs ?? 25000;
    const intervalMs = opts.intervalMs ?? 700;

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const sinceIso = new Date(sinceMs).toISOString();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const { data } = await supabase
            .from('token_ledger')
            .select('id, amount, reason, metadata, created_at')
            .eq('user_id', user.id)
            .eq('reason', 'dodo_pack_purchase')
            .gte('created_at', sinceIso)
            .order('created_at', { ascending: false })
            .limit(1);

        if (data && data.length > 0) {
            return data[0] as LedgerGrantRow;
        }

        await sleep(intervalMs);
    }

    return null;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
