/**
 * Schedule a plan change for the end of the current billing period.
 *
 * Used by the downgrade flow: instead of switching the user to a lower tier
 * immediately (and dealing with prorations + the credit-cycling exploit),
 * we record the target price ID and let a cron job apply it via
 * `paddle.subscriptions.update` when the current period rolls over.
 *
 * Upgrades go through `/api/billing/change-plan` (immediate, prorated)
 * instead. This endpoint is for scheduled changes only.
 *
 * Calling it again with a different priceId replaces the pending change.
 * Calling it with the user's CURRENT priceId is a no-op (returns 409).
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { lookupPlanByPriceId } from '@/lib/billing/pricing-source';

export const dynamic = 'force-dynamic';

interface ScheduleBody {
    priceId?: string;
}

export async function POST(request: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }

        const body = (await request.json().catch(() => ({}))) as ScheduleBody;
        if (!body.priceId) {
            return NextResponse.json({ error: 'priceId is required' }, { status: 400 });
        }

        const target = await lookupPlanByPriceId(body.priceId);
        if (!target) {
            return NextResponse.json({ error: 'Unknown price ID' }, { status: 400 });
        }

        const service = createServiceClient();
        const { data: sub } = await service
            .from('subscriptions')
            .select('paddle_subscription_id, paddle_price_id, plan_id, current_period_end')
            .eq('user_id', user.id)
            .maybeSingle();

        if (!sub?.paddle_subscription_id) {
            return NextResponse.json(
                { error: 'No active subscription to schedule a change on.' },
                { status: 404 },
            );
        }

        if (sub.paddle_price_id === body.priceId) {
            return NextResponse.json(
                { error: 'You are already on this plan.' },
                { status: 409 },
            );
        }

        const { error: updateErr } = await service
            .from('subscriptions')
            .update({
                pending_plan_change_price_id: body.priceId,
                updated_at: new Date().toISOString(),
            })
            .eq('user_id', user.id);

        if (updateErr) {
            console.error('[Schedule Plan Change] DB update failed:', updateErr);
            return NextResponse.json({ error: updateErr.message }, { status: 500 });
        }

        return NextResponse.json({
            scheduled: true,
            effectiveAt: sub.current_period_end,
            targetPlanId: target.planId,
            targetCycle: target.cycle,
        });
    } catch (err: any) {
        console.error('[Schedule Plan Change] Error:', err);
        return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
    }
}

export async function DELETE() {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }

        const service = createServiceClient();
        const { error } = await service
            .from('subscriptions')
            .update({
                pending_plan_change_price_id: null,
                updated_at: new Date().toISOString(),
            })
            .eq('user_id', user.id);

        if (error) {
            console.error('[Schedule Plan Change] DB clear failed:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        console.error('[Schedule Plan Change] DELETE error:', err);
        return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
    }
}
