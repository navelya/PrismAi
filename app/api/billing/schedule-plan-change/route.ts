/**
 * Schedule a plan change for the end of the current billing period (Dodo Payments).
 *
 * Used by the downgrade flow: instead of switching the user to a lower tier
 * immediately (and dealing with prorations + the credit-cycling exploit),
 * we record the target Dodo product ID and let Dodo apply it via
 * `subscriptions.changePlan` with `effective_at:'next_billing_date'`.
 *
 * Upgrades go through `/api/billing/change-plan` (immediate, prorated)
 * instead. This endpoint is for scheduled changes only.
 *
 * The `pending_plan_change_price_id` column name is preserved from the original
 * implementation; it now stores the Dodo product ID.
 *
 * Calling it again with a different productId replaces the pending change.
 * Calling it with the user's CURRENT productId is a no-op (returns 409).
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getDodo } from '@/lib/billing/dodo-server';
import { lookupPlanByProductId } from '@/lib/billing/pricing-source';

export const dynamic = 'force-dynamic';

interface ScheduleBody {
    productId?: string;
}

export async function POST(request: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }

        const body = (await request.json().catch(() => ({}))) as ScheduleBody;
        if (!body.productId) {
            return NextResponse.json({ error: 'productId is required' }, { status: 400 });
        }

        const target = await lookupPlanByProductId(body.productId);
        if (!target) {
            return NextResponse.json({ error: 'Unknown product ID' }, { status: 400 });
        }

        const service = createServiceClient();
        const { data: sub } = await service
            .from('subscriptions')
            .select('dodo_subscription_id, dodo_product_id, plan_id, current_period_end')
            .eq('user_id', user.id)
            .maybeSingle();

        if (!sub?.dodo_subscription_id) {
            return NextResponse.json(
                { error: 'No active subscription to schedule a change on.' },
                { status: 404 },
            );
        }

        if (sub.dodo_product_id === body.productId) {
            return NextResponse.json(
                { error: 'You are already on this plan.' },
                { status: 409 },
            );
        }

        // Schedule the change with Dodo at next billing date.
        const dodo = getDodo();
        try {
            await dodo.subscriptions.changePlan(sub.dodo_subscription_id, {
                product_id: body.productId,
                proration_billing_mode: 'do_not_bill',
                quantity: 1,
                effective_at: 'next_billing_date',
            });
        } catch (dodoErr: any) {
            console.error('[Schedule Plan Change] Dodo changePlan failed:', dodoErr);
            return NextResponse.json({ error: dodoErr?.message || 'Could not schedule plan change.' }, { status: 502 });
        }

        // Record the pending change in our DB so the UI can reflect it and
        // the cron/webhook can reconcile. The column name `pending_plan_change_price_id`
        // is preserved from the original schema; it stores the Dodo product ID.
        const { error: updateErr } = await service
            .from('subscriptions')
            .update({
                pending_plan_change_price_id: body.productId,
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
        const { data: sub } = await service
            .from('subscriptions')
            .select('dodo_subscription_id, pending_plan_change_price_id')
            .eq('user_id', user.id)
            .maybeSingle();

        // If there's an active Dodo subscription with a pending change, cancel it.
        if (sub?.dodo_subscription_id && sub?.pending_plan_change_price_id) {
            const dodo = getDodo();
            try {
                await dodo.subscriptions.cancelChangePlan(sub.dodo_subscription_id);
            } catch (dodoErr: any) {
                // cancelChangePlan may fail if no scheduled change exists — that's fine,
                // we still clear our DB record below.
                console.warn('[Schedule Plan Change] cancelChangePlan failed (may not exist):', dodoErr?.message);
            }
        }

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
