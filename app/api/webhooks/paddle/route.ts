/**
 * Paddle webhook receiver.
 *
 * Paddle posts every billing event here (subscriptions, transactions, refunds).
 * We verify the signature using the notification secret, then dispatch to the
 * matching handler. All DB writes use SECURITY DEFINER RPCs and an idempotency
 * key derived from the Paddle event ID — replays don't double-grant credits.
 *
 * Customer ↔ Supabase user mapping:
 *   - When checkout opens, we pass customData.user_id (the Supabase auth UID)
 *   - Paddle echoes that customData back on every subsequent event for the
 *     subscription / transaction, so we always have it available
 *   - We persist paddle_customer_id on the subscription so we can also look
 *     up by customer when customData isn't included (e.g. portal-driven cancels)
 */
import { NextResponse } from 'next/server';
import { EventName } from '@paddle/paddle-node-sdk';
import { getPaddle } from '@/lib/billing/paddle-server';
import { createServiceClient } from '@/lib/supabase/service';
import { lookupPlanByPriceId, lookupPackByPriceId } from '@/lib/billing/paddle-mapping';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    const signature = request.headers.get('paddle-signature') || '';
    const webhookSecret = process.env.PADDLE_WEBHOOK_SECRET;

    if (!webhookSecret) {
        console.error('[Paddle Webhook] PADDLE_WEBHOOK_SECRET is not configured.');
        return new Response('Server misconfigured', { status: 500 });
    }

    const rawBody = await request.text();

    let event;
    try {
        const paddle = getPaddle();
        event = await paddle.webhooks.unmarshal(rawBody, webhookSecret, signature);
    } catch (err: any) {
        console.error('[Paddle Webhook] Signature verification failed:', err?.message);
        return new Response('Invalid signature', { status: 401 });
    }

    if (!event) {
        return new Response('Unprocessable event', { status: 400 });
    }

    const supabase = createServiceClient();

    try {
        switch (event.eventType) {
            case EventName.SubscriptionActivated:
            case EventName.SubscriptionUpdated:
                await handleSubscriptionUpserted(event.data, supabase);
                break;

            case EventName.SubscriptionCanceled:
                await handleSubscriptionCanceled(event.data, supabase);
                break;

            case EventName.TransactionCompleted:
                await handleTransactionCompleted(event.data, event.eventId, supabase);
                break;

            case EventName.TransactionPaymentFailed:
                console.warn('[Paddle Webhook] Payment failed:', event.data.id);
                break;

            default:
                // Acknowledge unhandled events so Paddle doesn't retry forever.
                console.log('[Paddle Webhook] Ignoring event:', event.eventType);
        }
    } catch (err: any) {
        console.error('[Paddle Webhook] Handler error:', err);
        return new Response('Handler failed', { status: 500 });
    }

    return NextResponse.json({ ok: true });
}

// =============================================================================
// HANDLERS
// =============================================================================

async function handleSubscriptionUpserted(data: any, supabase: ReturnType<typeof createServiceClient>) {
    const userId = extractUserId(data);
    if (!userId) {
        console.error('[Paddle Webhook] Subscription event missing user_id in customData:', data.id);
        return;
    }

    const item = data.items?.[0];
    const priceId: string | undefined = item?.price?.id;
    const lookup = priceId ? lookupPlanByPriceId(priceId) : null;

    if (!lookup) {
        console.error('[Paddle Webhook] No plan match for Paddle price', priceId);
        return;
    }

    // Defend against stale events for a previously-orphaned subscription.
    // If the user has TWO Paddle subs (e.g. from the old broken upgrade flow),
    // events from the inactive one must not overwrite the active row.
    //
    // Rule: only accept this event if it's for the sub our row currently
    // tracks, OR our row has no sub_id yet, OR our row's tracked sub has been
    // canceled. Otherwise skip and let `/api/billing/sync` reconcile.
    const { data: existing } = await supabase
        .from('subscriptions')
        .select('paddle_subscription_id, status')
        .eq('user_id', userId)
        .maybeSingle();

    if (
        existing?.paddle_subscription_id &&
        existing.paddle_subscription_id !== data.id &&
        existing.status === 'active'
    ) {
        console.warn(
            '[Paddle Webhook] Ignoring event for non-tracked sub',
            data.id,
            '— DB row tracks',
            existing.paddle_subscription_id,
        );
        return;
    }

    const status = mapPaddleStatusToOurs(data.status);

    const { error } = await supabase.rpc('paddle_subscription_upsert', {
        p_user_id: userId,
        p_paddle_subscription_id: data.id,
        p_paddle_customer_id: data.customerId,
        p_paddle_price_id: priceId,
        p_plan_id: lookup.planId,
        p_status: status,
        p_current_period_end: data.currentBillingPeriod?.endsAt || null,
        p_cancel_at_period_end: !!data.scheduledChange?.action && data.scheduledChange.action === 'cancel',
        p_billing_cycle: lookup.cycle,
    });

    if (error) {
        console.error('[Paddle Webhook] paddle_subscription_upsert RPC failed:', error);
        throw new Error(error.message);
    }
}

async function handleSubscriptionCanceled(data: any, supabase: ReturnType<typeof createServiceClient>) {
    // Paddle sends `subscription.canceled` once the subscription has actually
    // ended (not when the user clicks cancel — that's a `subscription.updated`
    // with `scheduledChange.action = 'cancel'`). Downgrade to free, but only
    // if the canceled sub is the one our row is tracking. A cancellation for
    // an orphaned sub (e.g. from the old broken upgrade flow) must not
    // downgrade an active subscription the user still pays for.
    const userId = extractUserId(data);
    if (!userId) {
        console.error('[Paddle Webhook] Cancel event missing user_id:', data.id);
        return;
    }

    const { error } = await supabase
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
        .eq('user_id', userId)
        .eq('paddle_subscription_id', data.id);

    if (error) {
        console.error('[Paddle Webhook] Failed to downgrade subscription:', error);
        throw new Error(error.message);
    }
}

async function handleTransactionCompleted(data: any, eventId: string, supabase: ReturnType<typeof createServiceClient>) {
    const userId = extractUserId(data);
    if (!userId) {
        console.error('[Paddle Webhook] Transaction event missing user_id:', data.id);
        return;
    }

    // The line items carry per-item proration. Pull from details.lineItems
    // first (where proration lives); fall back to top-level items for older
    // payload shapes that don't ship details.
    const lineItems = data.details?.lineItems || data.items || [];

    for (const item of lineItems) {
        const priceId: string | undefined = item.price?.id || item.priceId;
        if (!priceId) continue;

        // Skip refund/credit lines. Paddle includes a NEGATIVE line item on
        // mid-period plan changes (and refunds) that credits back the unused
        // portion of the previous plan. We don't want to grant credits for
        // those — the prior plan's credits were already granted on the
        // original purchase and shouldn't be re-granted on a refund line.
        if (isRefundLine(item)) continue;

        const pack = lookupPackByPriceId(priceId);
        if (pack) {
            // One-time credit packs always grant their full pack size,
            // regardless of proration (packs aren't subscription items).
            await grantCredits(supabase, {
                userId,
                amount: pack.credits,
                reason: 'paddle_pack_purchase',
                idempotencyKey: `paddle:tx:${data.id}:item:${priceId}`,
                paddleEventId: eventId,
                metadata: {
                    paddle_transaction_id: data.id,
                    paddle_price_id: priceId,
                    pack_id: pack.packId,
                },
            });
            continue;
        }

        const plan = lookupPlanByPriceId(priceId);
        if (plan) {
            // Same-plan cycle swap (e.g. Studio monthly → Studio yearly):
            // Paddle emits a positive line for the new cycle's price AND a
            // negative line for the old cycle's price. Both map to the same
            // plan_id. The user already has credits for the current billing
            // period — don't grant again just because the cycle changed.
            if (isSamePlanCycleSwap(item, lineItems, plan.planId)) continue;

            // Match credits to money paid. For first-time purchases and
            // renewals, proration is null (or rate=1) and the user is paying
            // for the full period — grant the full monthly allowance. For
            // mid-period plan changes (origin=subscription_update), Paddle
            // charges a prorated diff and the line item has rate<1; grant
            // proportionally so we don't over-credit.
            const rate = parseProrationRate(item.proration);
            const credits = Math.max(0, Math.round(plan.monthlyCredits * rate));
            if (credits === 0) continue;

            await grantCredits(supabase, {
                userId,
                amount: credits,
                reason: 'paddle_subscription_grant',
                idempotencyKey: `paddle:tx:${data.id}:item:${priceId}`,
                paddleEventId: eventId,
                metadata: {
                    paddle_transaction_id: data.id,
                    paddle_price_id: priceId,
                    plan_id: plan.planId,
                    cycle: plan.cycle,
                    proration_rate: rate,
                    transaction_origin: data.origin ?? null,
                },
            });
        }
    }
}

/**
 * True when this positive line item is the "new cycle" side of a same-plan
 * cycle swap — meaning some OTHER line in the same transaction is a refund
 * for the same plan_id on a different priceId. In that case the user has
 * already been credited for the current period and we must not re-grant.
 *
 * Cross-plan refunds (e.g. Pro → Studio) DO get a fresh grant for the new
 * plan, since the user paid for Studio and didn't previously have Studio
 * credits — only same-plan, different-cycle is the no-op case.
 */
function isSamePlanCycleSwap(item: any, allItems: any[], planId: string): boolean {
    const positivePriceId = item?.price?.id || item?.priceId;
    if (!positivePriceId) return false;
    for (const other of allItems) {
        if (other === item) continue;
        const otherPriceId = other?.price?.id || other?.priceId;
        if (!otherPriceId || otherPriceId === positivePriceId) continue;
        if (!isRefundLine(other)) continue;
        const otherPlan = lookupPlanByPriceId(otherPriceId);
        if (otherPlan && otherPlan.planId === planId) return true;
    }
    return false;
}

/**
 * A line item is a refund/credit when its totals are negative. Paddle emits
 * these on subscription updates and refunds — we should never grant credits
 * for them, regardless of whether the price ID maps to one of our plans.
 *
 * Paddle ships totals as decimal strings in minor units (cents), so we parse
 * defensively and fall back to "not a refund" if anything is unparseable
 * (better to grant in an ambiguous case than to silently swallow a real
 * subscription event).
 */
function isRefundLine(item: any): boolean {
    const candidates = [
        item?.totals?.total,
        item?.totals?.subtotal,
        item?.unitTotals?.total,
        item?.unitTotals?.subtotal,
    ];
    for (const raw of candidates) {
        if (raw == null) continue;
        const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw));
        if (Number.isFinite(n)) return n < 0;
    }
    return false;
}

// =============================================================================
// HELPERS
// =============================================================================

interface GrantArgs {
    userId: string;
    amount: number;
    reason: 'paddle_pack_purchase' | 'paddle_subscription_grant';
    idempotencyKey: string;
    paddleEventId: string;
    metadata: Record<string, any>;
}

async function grantCredits(supabase: ReturnType<typeof createServiceClient>, args: GrantArgs) {
    const { error } = await supabase.rpc('credit_tokens', {
        p_user_id: args.userId,
        p_amount: args.amount,
        p_reason: args.reason,
        p_idempotency_key: args.idempotencyKey,
        p_execution_id: null,
        p_stripe_event_id: args.paddleEventId, // reusing existing column for the event id
        p_metadata: args.metadata,
    });

    if (error) {
        console.error('[Paddle Webhook] credit_tokens RPC failed:', error);
        throw new Error(error.message);
    }
}

function extractUserId(data: any): string | null {
    const fromCustomData = data?.customData?.user_id || data?.custom_data?.user_id;
    if (typeof fromCustomData === 'string' && fromCustomData.length > 0) return fromCustomData;
    return null;
}

/**
 * Read a line item's proration rate as a number in [0, 1].
 *
 * Paddle ships proration as a decimal string ("0.5", "1", etc.) on prorated
 * mid-period charges and as null/missing on full-period charges (first-time
 * purchases, renewals). Anything we can't parse falls back to 1 so we err on
 * the side of granting full credits rather than under-granting paying users.
 */
function parseProrationRate(proration: any): number {
    const raw = proration?.rate;
    if (raw == null) return 1;
    const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw));
    if (!Number.isFinite(n) || n <= 0) return 1;
    return Math.min(1, n);
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
