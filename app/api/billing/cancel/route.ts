/**
 * Subscription cancel endpoint.
 *
 * Schedules cancellation at the end of the current billing period (the user
 * keeps access until then). Paddle fires `subscription.updated` with a
 * scheduledChange of action='cancel'; the webhook persists that as
 * `cancel_at_period_end = true`.
 *
 * For immediate cancellation, pass { immediate: true }. We default to
 * next_billing_period because the user has already paid for this period.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getPaddle } from '@/lib/billing/paddle-server';

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
            .select('paddle_subscription_id')
            .eq('user_id', user.id)
            .single();

        if (subErr || !sub?.paddle_subscription_id) {
            return NextResponse.json(
                { error: 'No active Paddle subscription' },
                { status: 404 }
            );
        }

        const paddle = getPaddle();
        await paddle.subscriptions.cancel(sub.paddle_subscription_id, {
            effectiveFrom: body.immediate ? 'immediately' : 'next_billing_period',
        });

        // Cancel takes priority over a scheduled downgrade — the user is
        // leaving, not switching plans. Clear any pending change so the
        // cron doesn't try to apply it later against a canceled sub.
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
