/**
 * Plan-change endpoint (Dodo Payments).
 *
 * Mutates the user's existing Dodo subscription in-place via
 * `subscriptions.changePlan` with prorated_immediately billing. Dodo charges
 * the prorated difference immediately and fires `subscription.updated`, which
 * our webhook then maps to the new plan_id in our `subscriptions` row.
 *
 * Only call this when the user already has a paid Dodo subscription.
 * First-time purchases must still go through the checkout flow.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getDodo } from '@/lib/billing/dodo-server';
import { getPricing } from '@/lib/billing/pricing-source';

export const dynamic = 'force-dynamic';

interface ChangePlanBody {
    planId?: string;
    cycle?: 'monthly' | 'yearly';
}

export async function POST(request: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }

        // Dispute gate: refuse plan changes while a chargeback is unresolved.
        // Admin clears profiles.payment_disputed_at directly in the DB once the
        // dispute is resolved (no admin UI in v1).
        {
            const service = createServiceClient();
            const { data: profile } = await service
                .from('profiles')
                .select('payment_disputed_at')
                .eq('id', user.id)
                .maybeSingle();

            if (profile?.payment_disputed_at) {
                return NextResponse.json(
                    {
                        error: 'account_disputed',
                        message: 'Your account has a pending payment dispute. Contact support.',
                    },
                    { status: 403 },
                );
            }
        }

        const body = (await request.json().catch(() => ({}))) as ChangePlanBody;
        const { planId, cycle } = body;
        if (!planId || typeof planId !== 'string') {
            return NextResponse.json({ error: 'planId is required' }, { status: 400 });
        }
        if (cycle !== 'monthly' && cycle !== 'yearly') {
            return NextResponse.json({ error: 'cycle must be "monthly" or "yearly"' }, { status: 400 });
        }

        // Resolve the Dodo product ID server-side — the client never sees product IDs.
        const snap = await getPricing();
        const plan = snap.plans.find(p => p.id === planId);
        if (!plan) {
            return NextResponse.json({ error: 'Unknown plan ID' }, { status: 400 });
        }
        const productId = cycle === 'yearly'
            ? (plan.dodoProductIdYearly ?? plan.dodoProductIdMonthly)
            : (plan.dodoProductIdMonthly ?? plan.dodoProductIdYearly);
        if (!productId) {
            return NextResponse.json(
                { error: `No Dodo product ID configured for plan "${planId}" (${cycle})` },
                { status: 400 },
            );
        }

        const service = createServiceClient();
        const { data: sub, error: subErr } = await service
            .from('subscriptions')
            .select('dodo_subscription_id, dodo_product_id, plan_id, status')
            .eq('user_id', user.id)
            .single();

        if (subErr || !sub?.dodo_subscription_id) {
            return NextResponse.json(
                { error: 'No active Dodo subscription. Subscribe first.' },
                { status: 404 }
            );
        }

        if (sub.dodo_product_id === productId) {
            return NextResponse.json({ error: 'Already on this plan' }, { status: 409 });
        }

        const dodo = getDodo();

        // Check for a scheduled plan change and cancel it first, since Dodo
        // may reject combining a plan change with existing scheduled changes.
        const current = await dodo.subscriptions.retrieve(sub.dodo_subscription_id);
        if (current.scheduled_change) {
            await dodo.subscriptions.cancelChangePlan(sub.dodo_subscription_id);
        }

        await dodo.subscriptions.changePlan(sub.dodo_subscription_id, {
            product_id: productId,
            proration_billing_mode: 'prorated_immediately',
            quantity: 1,
            effective_at: 'immediately',
        });

        // The user just made a fresh choice — any previously scheduled
        // downgrade no longer reflects intent. Clear it so we don't switch
        // them to a stale target at the next boundary.
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
        console.error('[Change Plan] Error:', err);
        return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
    }
}
