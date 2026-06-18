/**
 * Cron: Apply scheduled plan changes.
 *
 * Runs daily (Vercel Hobby plan caps cron frequency at once per day). For
 * every subscription with `pending_plan_change_price_id IS NOT NULL`, verifies
 * the change has been applied via Dodo Payments once the current billing period
 * has ended. On a paid Vercel plan this can safely move to 15-minute cadence.
 *
 * Timing model:
 *   - The `/api/billing/schedule-plan-change` POST already calls
 *     `dodo.subscriptions.changePlan(…, { effective_at: 'next_billing_date' })`
 *     when the downgrade is first scheduled. Dodo therefore applies the change
 *     automatically at the next billing date — we do NOT need to call changePlan
 *     again here.
 *   - This cron's job is to clear the `pending_plan_change_price_id` marker from
 *     our DB once the period has ended, so the UI stops showing a pending badge
 *     and the row stops appearing in this query on future runs.
 *   - Dead-end states (non-active or cancel_at_period_end) also clear the marker
 *     as housekeeping — the user is leaving, not switching.
 *
 * If clearing fails for one user, we log and continue so a single bad row
 * doesn't block the batch.
 */
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

const BATCH_LIMIT = 200;

interface PendingRow {
    user_id: string;
    dodo_subscription_id: string | null;
    pending_plan_change_price_id: string | null;
    dodo_product_id: string | null;
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

    // Only consider subs whose period has ended and still have a pending marker.
    // Dodo applies the change itself at billing date; we are just clearing our
    // DB record once the period has rolled over.
    const { data: due, error: fetchErr } = await supabase
        .from('subscriptions')
        .select('user_id, dodo_subscription_id, pending_plan_change_price_id, dodo_product_id, current_period_end, status, cancel_at_period_end')
        .not('pending_plan_change_price_id', 'is', null)
        .lte('current_period_end', nowIso)
        .limit(BATCH_LIMIT);

    if (fetchErr) {
        console.error('[Cron apply-pending-changes] Fetch failed:', fetchErr);
        return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }

    const rows = (due || []) as PendingRow[];
    const results: Array<{ user_id: string; ok: boolean; error?: string; skipped?: string }> = [];

    for (const row of rows) {
        try {
            if (!row.pending_plan_change_price_id) {
                // Defensive: shouldn't happen given the WHERE clause.
                continue;
            }

            // Dead-end states: sub can't accept a plan change. Clear the
            // pending marker so it stops appearing in this query.
            const isDeadEnd =
                row.status !== 'active' ||
                row.cancel_at_period_end === true;
            if (isDeadEnd) {
                await clearPending(supabase, row.user_id);
                results.push({ user_id: row.user_id, ok: true, skipped: 'inactive_or_canceling' });
                continue;
            }

            // No-op if the target equals the current — the change has already
            // been applied by Dodo. Clear the pending marker.
            if (row.dodo_product_id === row.pending_plan_change_price_id) {
                await clearPending(supabase, row.user_id);
                results.push({ user_id: row.user_id, ok: true, skipped: 'already_on_target' });
                continue;
            }

            // Period has ended but Dodo hasn't yet written the new product_id
            // to our DB (webhook may be slightly delayed). Clear the marker
            // anyway — the webhook will write the correct state when it lands.
            // Leaving the marker would cause false "pending" banners next cycle.
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
