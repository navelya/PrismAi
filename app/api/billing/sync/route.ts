/**
 * Subscription resync endpoint (Dodo Payments).
 *
 * Re-derives the user's subscription state from Dodo (source of truth) and
 * writes it to our DB. Used to self-heal stale rows when webhooks were missed
 * or events for orphaned subscriptions overwrote the wrong record.
 *
 * Behavior:
 *   - No Dodo customer linked → no-op (user has never purchased).
 *   - One or more active Dodo subs → pick the best candidate (prefer one
 *     that isn't scheduled to cancel; tiebreak by most-recently-created) and
 *     upsert our row to match it via `dodo_subscription_upsert` RPC.
 *   - No active Dodo subs → clear our row back to free.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getDodo } from '@/lib/billing/dodo-server';
import { lookupPlanByProductId } from '@/lib/billing/pricing-source';
import type { SubscriptionListResponse } from 'dodopayments/resources/subscriptions';

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
            .select('dodo_customer_id, dodo_subscription_id, plan_id, cancel_at_period_end')
            .eq('user_id', user.id)
            .maybeSingle();

        if (!row?.dodo_customer_id) {
            return NextResponse.json({ synced: false, changed: false, reason: 'no_customer' });
        }

        const before = {
            planId: row.plan_id ?? 'free',
            dodoSubscriptionId: row.dodo_subscription_id ?? null,
            cancelAtPeriodEnd: !!row.cancel_at_period_end,
        };

        const dodo = getDodo();

        // Collect subscriptions across active + on_hold statuses.
        // Dodo's list takes one status value at a time.
        const subs: SubscriptionListResponse[] = [];

        for (const statusFilter of ['active', 'on_hold'] as const) {
            for await (const sub of dodo.subscriptions.list({
                customer_id: row.dodo_customer_id,
                status: statusFilter,
                page_size: 50,
            })) {
                subs.push(sub);
            }
        }

        // Pick the best candidate. Prefer subs NOT scheduled to cancel,
        // tiebreak by most-recent `created_at`.
        const sorted = [...subs].sort((a, b) => {
            const aCancel = a.cancel_at_next_billing_date ? 1 : 0;
            const bCancel = b.cancel_at_next_billing_date ? 1 : 0;
            if (aCancel !== bCancel) return aCancel - bCancel;
            const aStart = a.created_at ? new Date(a.created_at).getTime() : 0;
            const bStart = b.created_at ? new Date(b.created_at).getTime() : 0;
            return bStart - aStart;
        });
        const candidate = sorted[0];

        if (!candidate) {
            // No active Dodo sub → reset to free.
            await service
                .from('subscriptions')
                .update({
                    plan_id: 'free',
                    status: 'active',
                    cancel_at_period_end: false,
                    current_period_end: null,
                    dodo_subscription_id: null,
                    dodo_product_id: null,
                    billing_cycle: null,
                    updated_at: new Date().toISOString(),
                })
                .eq('user_id', user.id);

            const changed =
                before.planId !== 'free' ||
                before.dodoSubscriptionId !== null ||
                before.cancelAtPeriodEnd !== false;
            return NextResponse.json({ synced: true, changed, plan: 'free' });
        }

        const productId = candidate.product_id;
        const lookup = productId ? await lookupPlanByProductId(productId) : null;
        if (!lookup || !productId) {
            return NextResponse.json({ error: 'Active sub has no known plan' }, { status: 500 });
        }

        const status = mapDodoStatusToOurs(candidate.status);
        const { error: rpcErr } = await service.rpc('dodo_subscription_upsert', {
            p_user_id: user.id,
            p_dodo_subscription_id: candidate.subscription_id,
            p_dodo_customer_id: candidate.customer.customer_id,
            p_dodo_product_id: productId,
            p_plan_id: lookup.planId,
            p_status: status,
            p_current_period_end: candidate.next_billing_date || null,
            p_cancel_at_period_end: candidate.cancel_at_next_billing_date,
            p_billing_cycle: lookup.cycle,
        });

        if (rpcErr) {
            console.error('[Sync] RPC failed:', rpcErr);
            return NextResponse.json({ error: rpcErr.message }, { status: 500 });
        }

        const candidateCancels = candidate.cancel_at_next_billing_date;
        const changed =
            before.planId !== lookup.planId ||
            before.dodoSubscriptionId !== candidate.subscription_id ||
            before.cancelAtPeriodEnd !== candidateCancels;

        return NextResponse.json({
            synced: true,
            changed,
            plan: lookup.planId,
            subscriptionId: candidate.subscription_id,
        });
    } catch (err: any) {
        console.error('[Sync] Error:', err);
        return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
    }
}

function mapDodoStatusToOurs(dodoStatus: string): 'active' | 'canceled' | 'past_due' {
    switch (dodoStatus) {
        case 'active':
        case 'pending':
            return 'active';
        case 'cancelled':
        case 'expired':
            return 'canceled';
        case 'on_hold':
        case 'failed':
            return 'past_due';
        default:
            return 'active';
    }
}
