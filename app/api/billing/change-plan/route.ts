/**
 * Plan-change endpoint.
 *
 * Mutates the user's existing Paddle subscription in-place via
 * `subscriptions.update` instead of opening a second checkout. Paddle charges
 * the prorated difference immediately and fires `subscription.updated`, which
 * our webhook then maps to the new plan_id in our `subscriptions` row.
 *
 * Important: ONLY call this when the user already has a paid Paddle
 * subscription. First-time purchases must still go through the checkout flow
 * so Paddle can collect a payment method.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getPaddle } from '@/lib/billing/paddle-server';
import { lookupPlanByPriceId } from '@/lib/billing/paddle-mapping';

export const dynamic = 'force-dynamic';

interface ChangePlanBody {
    priceId?: string;
}

export async function POST(request: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }

        const body = (await request.json().catch(() => ({}))) as ChangePlanBody;
        const priceId = body.priceId;
        if (!priceId || typeof priceId !== 'string') {
            return NextResponse.json({ error: 'priceId is required' }, { status: 400 });
        }

        const target = lookupPlanByPriceId(priceId);
        if (!target) {
            return NextResponse.json({ error: 'Unknown price ID' }, { status: 400 });
        }

        const service = createServiceClient();
        const { data: sub, error: subErr } = await service
            .from('subscriptions')
            .select('paddle_subscription_id, paddle_price_id, plan_id, status')
            .eq('user_id', user.id)
            .single();

        if (subErr || !sub?.paddle_subscription_id) {
            return NextResponse.json(
                { error: 'No active Paddle subscription. Subscribe first.' },
                { status: 404 }
            );
        }

        if (sub.paddle_price_id === priceId) {
            return NextResponse.json({ error: 'Already on this plan' }, { status: 409 });
        }

        const paddle = getPaddle();

        // Paddle rejects `scheduledChange: null` combined with any other field
        // updates ("cannot combine updating schedule_change with other fields").
        // If the user is upgrading/downgrading while a cancellation is queued,
        // we need to clear that cancellation first, then change the plan.
        const current = await paddle.subscriptions.get(sub.paddle_subscription_id);
        if (current.scheduledChange) {
            await paddle.subscriptions.update(sub.paddle_subscription_id, {
                scheduledChange: null,
            });
        }

        await paddle.subscriptions.update(sub.paddle_subscription_id, {
            items: [{ priceId, quantity: 1 }],
            prorationBillingMode: 'prorated_immediately',
        });

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        console.error('[Change Plan] Error:', err);
        return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
    }
}
