/**
 * GET /api/billing/subscription
 *
 * Returns the current user's subscription row with:
 *   - All standard fields (planId, status, billingCycle, etc.)
 *   - `pendingPlanChange: { planId, cycle } | null`  — the pending scheduled plan
 *     change resolved from the raw `pending_plan_change_price_id` (a Dodo product
 *     ID) via the server-side pricing snapshot. The client never sees raw product IDs.
 *
 * This replaces the previous pattern of reading `subscriptions` directly from the
 * client and matching `pendingPlanChangePriceId` against product IDs in the
 * displayed plan list (which is now stripped of product IDs in /api/pricing).
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { lookupPlanByProductId } from '@/lib/billing/pricing-source';
import type { PlanId } from '@/lib/billing/plans-config';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }

        const service = createServiceClient();

        const { data, error: fetchErr } = await service
            .from('subscriptions')
            .select('plan_id, status, next_topup_at, current_period_end, cancel_at_period_end, billing_cycle, pending_plan_change_price_id')
            .eq('user_id', user.id)
            .single();

        if (fetchErr || !data) {
            return NextResponse.json({ subscription: null });
        }

        // Resolve the pending plan change product ID → { planId, cycle } so the
        // client never needs raw Dodo product IDs for its UI logic.
        let pendingPlanChange: { planId: PlanId; cycle: 'monthly' | 'yearly' } | null = null;
        if (data.pending_plan_change_price_id) {
            const resolved = await lookupPlanByProductId(data.pending_plan_change_price_id);
            if (resolved) {
                pendingPlanChange = { planId: resolved.planId as PlanId, cycle: resolved.cycle };
            }
        }

        return NextResponse.json({
            subscription: {
                planId: data.plan_id as PlanId,
                status: data.status,
                nextTopupAt: data.next_topup_at,
                currentPeriodEnd: data.current_period_end,
                cancelAtPeriodEnd: data.cancel_at_period_end,
                billingCycle:
                    data.billing_cycle === 'monthly' || data.billing_cycle === 'yearly'
                        ? data.billing_cycle
                        : null,
                pendingPlanChange,
            },
        });
    } catch (err: any) {
        console.error('[GET /api/billing/subscription] Error:', err);
        return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
    }
}
