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
    // with `scheduledChange.action = 'cancel'`). Downgrade to free.
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
        .eq('user_id', userId);

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

    // Each transaction can have multiple line items. Walk them and grant
    // credits for any that match a known plan or credit pack.
    const items = data.items || data.details?.lineItems || [];

    for (const item of items) {
        const priceId: string | undefined = item.price?.id || item.priceId;
        if (!priceId) continue;

        const pack = lookupPackByPriceId(priceId);
        if (pack) {
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
            // For subscription transactions, grant the monthly credits.
            // The monthly_topup cron will keep things refilled going forward.
            await grantCredits(supabase, {
                userId,
                amount: plan.monthlyCredits,
                reason: 'paddle_subscription_grant',
                idempotencyKey: `paddle:tx:${data.id}:item:${priceId}`,
                paddleEventId: eventId,
                metadata: {
                    paddle_transaction_id: data.id,
                    paddle_price_id: priceId,
                    plan_id: plan.planId,
                    cycle: plan.cycle,
                },
            });
        }
    }
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
