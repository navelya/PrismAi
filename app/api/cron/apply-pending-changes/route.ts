/**
 * Cron: Apply scheduled plan changes.
 *
 * Runs frequently (every 15 minutes is the recommended cadence). For every
 * subscription with `pending_plan_change_price_id IS NOT NULL`, applies the
 * change via Paddle's API as soon as the current billing period ends.
 *
 * Timing model:
 *   - We apply the change immediately upon detecting `current_period_end <=
 *     now`. By that point Paddle has typically auto-renewed the previous
 *     plan, so `subscriptions.update` with `prorated_immediately` issues an
 *     adjustment that refunds the just-charged old plan and bills the new
 *     one. The webhook then lands the new state and grants are governed by
 *     the period-cap rule in the transaction.completed handler.
 *   - If Paddle hasn't yet renewed by the time we run, the update applies a
 *     tiny end-of-period proration — also fine.
 *
 * If the API call fails for one user, we log and continue with the next so
 * a single bad row doesn't block the batch. The pending field is only
 * cleared on success — failed rows will retry next run.
 */
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getPaddle } from '@/lib/billing/paddle-server';

export const dynamic = 'force-dynamic';

const BATCH_LIMIT = 200;

interface PendingRow {
    user_id: string;
    paddle_subscription_id: string | null;
    pending_plan_change_price_id: string | null;
    paddle_price_id: string | null;
    current_period_end: string | null;
    status: string;
    cancel_at_period_end: boolean;
}

export async function GET(request: Request) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return new Response('Unauthorized', { status: 401 });
    }

    const supabase = createServiceClient();
    const nowIso = new Date().toISOString();

    // Only consider ACTIVE subs that are due. A canceled or past_due sub
    // can't accept a plan change via Paddle's API — and a sub scheduled to
    // cancel at period end takes priority over a scheduled downgrade
    // (you're leaving, not switching). Either way, we clear the pending
    // field as housekeeping so the row stops appearing in this query.
    const { data: due, error: fetchErr } = await supabase
        .from('subscriptions')
        .select('user_id, paddle_subscription_id, pending_plan_change_price_id, paddle_price_id, current_period_end, status, cancel_at_period_end')
        .not('pending_plan_change_price_id', 'is', null)
        .lte('current_period_end', nowIso)
        .limit(BATCH_LIMIT);

    if (fetchErr) {
        console.error('[Cron apply-pending-changes] Fetch failed:', fetchErr);
        return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }

    const rows = (due || []) as PendingRow[];
    const results: Array<{ user_id: string; ok: boolean; error?: string; skipped?: string }> = [];

    const paddle = getPaddle();

    for (const row of rows) {
        try {
            if (!row.paddle_subscription_id || !row.pending_plan_change_price_id) {
                // Defensive: shouldn't happen given the WHERE clause, but if
                // someone hand-edits the row we shouldn't crash.
                continue;
            }

            // Dead-end states: the sub can't accept a plan change. Just
            // clear the pending marker so it stops appearing in this query.
            const isDeadEnd =
                row.status !== 'active' ||
                row.cancel_at_period_end === true;
            if (isDeadEnd) {
                await clearPending(supabase, row.user_id);
                results.push({ user_id: row.user_id, ok: true, skipped: 'inactive_or_canceling' });
                continue;
            }

            // No-op if the target equals the current — clear the pending
            // marker without calling Paddle.
            if (row.paddle_price_id === row.pending_plan_change_price_id) {
                await clearPending(supabase, row.user_id);
                results.push({ user_id: row.user_id, ok: true, skipped: 'already_on_target' });
                continue;
            }

            await paddle.subscriptions.update(row.paddle_subscription_id, {
                items: [{ priceId: row.pending_plan_change_price_id, quantity: 1 }],
                prorationBillingMode: 'prorated_immediately',
            });

            // Clear the pending marker only after Paddle has accepted the
            // change. The subsequent `subscription.updated` webhook will
            // write the new plan_id; we don't have to mirror it here.
            await clearPending(supabase, row.user_id);

            results.push({ user_id: row.user_id, ok: true });
        } catch (err: any) {
            console.error(
                '[Cron apply-pending-changes] Failed for user',
                row.user_id,
                ':',
                err?.message,
            );
            results.push({
                user_id: row.user_id,
                ok: false,
                error: err?.message || 'unknown',
            });
        }
    }

    return NextResponse.json({
        processed: rows.length,
        succeeded: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results,
    });
}

async function clearPending(
    supabase: ReturnType<typeof createServiceClient>,
    userId: string,
): Promise<void> {
    await supabase
        .from('subscriptions')
        .update({
            pending_plan_change_price_id: null,
            updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId);
}
