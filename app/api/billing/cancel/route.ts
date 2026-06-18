/**
 * Subscription cancel endpoint (Dodo Payments).
 *
 * Schedules cancellation at the end of the current billing period (the user
 * keeps access until then) via `subscriptions.update({ cancel_at_next_billing_date: true })`.
 * Dodo fires `subscription.updated`; the webhook persists that as
 * `cancel_at_period_end = true`.
 *
 * For immediate cancellation, pass { immediate: true }. We default to
 * next_billing_date because the user has already paid for this period.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getDodo } from '@/lib/billing/dodo-server';

export const dynamic = 'force-dynamic';

interface CancelBody {
    immediate?: boolean;
}

export async function POST(request: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }

        const body = (await request.json().catch(() => ({}))) as CancelBody;

        const service = createServiceClient();
        const { data: sub, error: subErr } = await service
            .from('subscriptions')
            .select('dodo_subscription_id')
            .eq('user_id', user.id)
            .single();

        if (subErr || !sub?.dodo_subscription_id) {
            return NextResponse.json(
                { error: 'No active Dodo subscription' },
                { status: 404 }
            );
        }

        const dodo = getDodo();

        if (body.immediate) {
            // Immediate cancellation: set status to cancelled directly.
            await dodo.subscriptions.update(sub.dodo_subscription_id, {
                status: 'cancelled',
            });
        } else {
            // Period-end cancellation: flag to cancel at next billing date.
            await dodo.subscriptions.update(sub.dodo_subscription_id, {
                cancel_at_next_billing_date: true,
            });
        }

        // Cancel takes priority over a scheduled downgrade — the user is
        // leaving, not switching plans. Clear any pending change so it
        // doesn't interfere with a cancelled sub.
        await service
            .from('subscriptions')
            .update({
                pending_plan_change_price_id: null,
                updated_at: new Date().toISOString(),
            })
            .eq('user_id', user.id)
            .not('pending_plan_change_price_id', 'is', null);

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        console.error('[Cancel Subscription] Error:', err);
        return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
    }
}
