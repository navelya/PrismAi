/**
 * Wait for the credit-grant row to appear in `token_ledger` for a given
 * Paddle transaction. Used by the silent credit-pack flow to know when the
 * webhook has confirmed the purchase and granted credits — so the UI can
 * flip from "processing" to "success" exactly when the user's balance
 * actually changes, not on a fixed timer.
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
    /** Total time to wait before giving up. Default 20 seconds. */
    timeoutMs?: number;
    /** Delay between polls. Default 700 ms. */
    intervalMs?: number;
}

export async function pollLedgerForTx(
    paddleTransactionId: string,
    opts: PollOpts = {},
): Promise<LedgerGrantRow | null> {
    const timeoutMs = opts.timeoutMs ?? 20000;
    const intervalMs = opts.intervalMs ?? 700;

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        // Filter via the JSON metadata column — we tag every Paddle-driven
        // grant with `paddle_transaction_id` so we can find this specific
        // purchase rather than just polling for any new credit movement.
        const { data } = await supabase
            .from('token_ledger')
            .select('id, amount, reason, metadata, created_at')
            .eq('user_id', user.id)
            .filter('metadata->>paddle_transaction_id', 'eq', paddleTransactionId)
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
