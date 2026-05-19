/**
 * Subscription resync endpoint.
 *
 * Re-derives the user's subscription state from Paddle (source of truth) and
 * writes it to our DB. Used to self-heal stale rows when webhooks were missed
 * or events for orphaned subscriptions overwrote the wrong record.
 *
 * Behavior:
 *   - No Paddle customer linked → no-op (user has never purchased).
 *   - One or more active Paddle subs → pick the best candidate (prefer one
 *     that isn't scheduled to cancel; tiebreak by most-recently-created) and
 *     upsert our row to match it.
 *   - No active Paddle subs → clear our row back to free.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getPaddle } from '@/lib/billing/paddle-server';
import { lookupPlanByPriceId } from '@/lib/billing/paddle-mapping';

export const dynamic = 'force-dynamic';

export async function POST() {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }

        const service = createServiceClient();
        const { data: row } = await service
            .from('subscriptions')
            .select('paddle_customer_id, paddle_subscription_id, plan_id, cancel_at_period_end')
            .eq('user_id', user.id)
            .maybeSingle();

        if (!row?.paddle_customer_id) {
            return NextResponse.json({ synced: false, changed: false, reason: 'no_customer' });
        }

        const before = {
            planId: row.plan_id ?? 'free',
            paddleSubscriptionId: row.paddle_subscription_id ?? null,
            cancelAtPeriodEnd: !!row.cancel_at_period_end,
        };

        const paddle = getPaddle();
        const collection = paddle.subscriptions.list({
            customerId: [row.paddle_customer_id],
            status: ['active', 'trialing', 'past_due'],
            perPage: 50,
        });
        const subs = await collection.next();

        // Pick the best candidate. We want the sub the user is actually
        // riding right now — that means prefer ones NOT scheduled to cancel,
        // and tiebreak by most-recent `started_at`.
        const sorted = [...subs].sort((a, b) => {
            const aCancel = a.scheduledChange?.action === 'cancel' ? 1 : 0;
            const bCancel = b.scheduledChange?.action === 'cancel' ? 1 : 0;
            if (aCancel !== bCancel) return aCancel - bCancel;
            const aStart = a.startedAt ? new Date(a.startedAt).getTime() : 0;
            const bStart = b.startedAt ? new Date(b.startedAt).getTime() : 0;
            return bStart - aStart;
        });
        const candidate = sorted[0];

        if (!candidate) {
            // No active Paddle sub → reset to free.
            await service
                .from('subscriptions')
                .update({
                    plan_id: 'free',
                    status: 'active',
                    cancel_at_period_end: false,
                    current_period_end: null,
                    paddle_subscription_id: null,
                    paddle_price_id: null,
                    billing_cycle: null,
                    updated_at: new Date().toISOString(),
                })
                .eq('user_id', user.id);

            const changed =
                before.planId !== 'free' ||
                before.paddleSubscriptionId !== null ||
                before.cancelAtPeriodEnd !== false;
            return NextResponse.json({ synced: true, changed, plan: 'free' });
        }

        const priceId = candidate.items?.[0]?.price?.id;
        const lookup = priceId ? lookupPlanByPriceId(priceId) : null;
        if (!lookup || !priceId) {
            return NextResponse.json({ error: 'Active sub has no known plan' }, { status: 500 });
        }

        const status = mapPaddleStatusToOurs(candidate.status);
        const { error: rpcErr } = await service.rpc('paddle_subscription_upsert', {
            p_user_id: user.id,
            p_paddle_subscription_id: candidate.id,
            p_paddle_customer_id: candidate.customerId,
            p_paddle_price_id: priceId,
            p_plan_id: lookup.planId,
            p_status: status,
            p_current_period_end: candidate.currentBillingPeriod?.endsAt || null,
            p_cancel_at_period_end: candidate.scheduledChange?.action === 'cancel',
            p_billing_cycle: lookup.cycle,
        });

        if (rpcErr) {
            console.error('[Sync] RPC failed:', rpcErr);
            return NextResponse.json({ error: rpcErr.message }, { status: 500 });
        }

        const candidateCancels = candidate.scheduledChange?.action === 'cancel';
        const changed =
            before.planId !== lookup.planId ||
            before.paddleSubscriptionId !== candidate.id ||
            before.cancelAtPeriodEnd !== candidateCancels;

        return NextResponse.json({
            synced: true,
            changed,
            plan: lookup.planId,
            subscriptionId: candidate.id,
        });
    } catch (err: any) {
        console.error('[Sync] Error:', err);
        return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
    }
}

function mapPaddleStatusToOurs(paddleStatus: string): 'active' | 'canceled' | 'past_due' {
    switch (paddleStatus) {
        case 'active':
        case 'trialing':
            return 'active';
        case 'canceled':
            return 'canceled';
        case 'past_due':
        case 'paused':
            return 'past_due';
        default:
            return 'active';
    }
}
