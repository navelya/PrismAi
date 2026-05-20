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
import { PLANS } from '@/lib/billing/plans-config';
import { sendAdminAlert } from '@/lib/email/admin-alerts';

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

            case EventName.AdjustmentCreated:
                await handleAdjustmentCreated(event.data, event.eventId, supabase);
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
            const wouldGrant = Math.max(0, Math.round(plan.monthlyCredits * rate));
            if (wouldGrant === 0) continue;

            // Cap-this-period: prevent the cycling exploit where a user goes
            // Studio→Pro→Studio and accumulates credits on every hop. The
            // rule is that across one billing period, total subscription
            // credits granted must not exceed the highest plan held during
            // that period. Plays cleanly with legitimate flows:
            //   - Fresh subscription: nothing prior → grant full amount.
            //   - Renewal: prior anchor advances → fresh budget for the
            //     new period.
            //   - Real upgrade: grants the delta up to the new tier.
            //   - Downgrade or cycle-back: no credits (already at cap).
            const periodCap = await computePeriodGrantCap(supabase, userId, plan.planId);

            // Belt: if the SAME plan was already granted in the current
            // period, mid-period updates are no-ops for credits regardless
            // of what the cap math says. Catches cycle-swaps where the
            // refund line lives in adjustments (not lineItems) and
            // isSamePlanCycleSwap can't see it.
            if (data.origin === 'subscription_update' && periodCap.samePlanAlreadyGranted) {
                continue;
            }

            const remaining = Math.max(0, periodCap.maxCredits - periodCap.alreadyGranted);
            const credits = Math.min(wouldGrant, remaining);
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
                    period_max_credits: periodCap.maxCredits,
                    period_already_granted: periodCap.alreadyGranted,
                },
            });
        }
    }
}

/**
 * Compute the credit-grant ceiling for the user's current billing period.
 *
 * Period boundary: we anchor the start of the current period at the most
 * recent `paddle_subscription_grant` whose `transaction_origin` is a
 * fresh-period signal — `web` (first checkout), `subscription_recurring`
 * (auto-renewal), or `api` (admin/server-side creation). Mid-period plan
 * changes (`subscription_update`) are NOT anchors; they fall WITHIN the
 * current period. If no fresh-period grant exists yet, we fall back to
 * "since the dawn of time" so the first grant always lands.
 *
 * Ceiling: the highest `monthlyCredits` of any plan held during the period
 * — including the plan we're about to grant for. Already-granted is the sum
 * of grants since the period anchor.
 *
 * Returns `{ maxCredits, alreadyGranted }`. Caller computes
 * `remaining = max(0, maxCredits - alreadyGranted)` and grants
 * `min(wouldGrant, remaining)`.
 */
async function computePeriodGrantCap(
    supabase: ReturnType<typeof createServiceClient>,
    userId: string,
    incomingPlanId: string,
): Promise<{ maxCredits: number; alreadyGranted: number; samePlanAlreadyGranted: boolean }> {
    const incomingPlanCredits = monthlyCreditsForPlan(incomingPlanId);

    // Find the period anchor: the timestamp of the most recent
    // "fresh-period" grant (initial purchase or renewal). We deliberately
    // exclude `subscription_update` origins — those are mid-period changes
    // that should NOT advance the anchor, otherwise the cycling exploit
    // (Studio→Pro→Studio) could "reset" the budget every hop.
    //
    // supabase-js `.or()` doesn't reliably parse JSON arrow paths, so we
    // issue one query per origin and take the latest. Three queries instead
    // of one — fine on the webhook path.
    const anchorOrigins = ['web', 'subscription_recurring', 'api'];
    let anchorIso = '1970-01-01T00:00:00.000Z';
    for (const origin of anchorOrigins) {
        const { data } = await supabase
            .from('token_ledger')
            .select('created_at')
            .eq('user_id', userId)
            .eq('reason', 'paddle_subscription_grant')
            .filter('metadata->>transaction_origin', 'eq', origin)
            .order('created_at', { ascending: false })
            .limit(1);
        const ts = data?.[0]?.created_at as string | undefined;
        if (ts && ts > anchorIso) anchorIso = ts;
    }

    // Pull every subscription grant since the anchor (inclusive) — this is
    // our view of "what's already been granted in the current period."
    const { data: priorGrants } = await supabase
        .from('token_ledger')
        .select('amount, metadata')
        .eq('user_id', userId)
        .eq('reason', 'paddle_subscription_grant')
        .gte('created_at', anchorIso);

    let alreadyGranted = 0;
    let maxCredits = incomingPlanCredits;
    let samePlanAlreadyGranted = false;
    if (priorGrants) {
        for (const row of priorGrants as any[]) {
            alreadyGranted += row.amount;
            const pid = row.metadata?.plan_id;
            const planCredits = pid ? monthlyCreditsForPlan(pid) : 0;
            if (planCredits > maxCredits) maxCredits = planCredits;
            if (pid === incomingPlanId && row.amount > 0) samePlanAlreadyGranted = true;
        }
    }

    return { maxCredits, alreadyGranted, samePlanAlreadyGranted };
}

function monthlyCreditsForPlan(planId: string): number {
    const plan = PLANS.find((p) => p.id === planId);
    return plan?.monthlyCredits ?? 0;
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

// =============================================================================
// ADJUSTMENT (REFUND / CHARGEBACK) HANDLERS
// =============================================================================

/**
 * Find the ledger rows that recorded the original positive grant(s) for a
 * given Paddle transaction. grantCredits() stores paddle_transaction_id in
 * metadata, which is how we re-locate them on a refund/chargeback.
 */
async function findOriginalGrants(
    supabase: ReturnType<typeof createServiceClient>,
    paddleTransactionId: string,
): Promise<Array<{ id: string; user_id: string; amount: number; reason: string; metadata: any }>> {
    const { data, error } = await supabase
        .from('token_ledger')
        .select('id, user_id, amount, reason, metadata')
        .in('reason', ['paddle_pack_purchase', 'paddle_subscription_grant'])
        .filter('metadata->>paddle_transaction_id', 'eq', paddleTransactionId);

    if (error) {
        console.error('[Paddle Webhook] findOriginalGrants failed:', error);
        return [];
    }
    return (data ?? []) as any;
}

/**
 * Classify a Paddle adjustment as a full refund relative to the original
 * transaction total. Paddle ships totals as decimal strings in minor units
 * (cents). We compare adjustment.totals.total against the original
 * transaction's total — equal within 1 cent → full refund.
 */
function isFullRefund(adjustment: any, originalTxTotalCents: number): boolean {
    const totalsRaw = adjustment?.totals?.total ?? adjustment?.payoutTotals?.total;
    if (totalsRaw == null) return false;
    const adjustmentTotal = typeof totalsRaw === 'number' ? totalsRaw : Number.parseFloat(String(totalsRaw));
    if (!Number.isFinite(adjustmentTotal)) return false;
    return Math.abs(adjustmentTotal - originalTxTotalCents) < 1;
}

/**
 * Paddle emits `adjustment.created` for refunds, chargebacks, and chargeback
 * reversals. We only act when `status === 'approved'` — pending adjustments
 * may be revoked. Each action routes to its own subhandler. Unknown actions
 * are logged + ignored so Paddle doesn't retry forever.
 */
async function handleAdjustmentCreated(data: any, eventId: string, supabase: ReturnType<typeof createServiceClient>) {
    if (data?.status !== 'approved') {
        console.log('[Paddle Webhook] Skipping non-approved adjustment:', data?.id, 'status:', data?.status);
        return;
    }

    const action: string = data?.action ?? '';
    switch (action) {
        case 'refund':
            await handleRefund(data, eventId, supabase);
            break;
        case 'chargeback':
            await handleChargeback(data, eventId, supabase);
            break;
        case 'chargeback_reverse':
            await handleChargebackReverse(data, eventId, supabase);
            break;
        default:
            console.warn('[Paddle Webhook] Unknown adjustment action:', action, 'id:', data?.id);
    }
}

async function handleRefund(data: any, eventId: string, supabase: ReturnType<typeof createServiceClient>) {
    const adjustmentId: string = data?.id ?? '';
    const txId: string = data?.transactionId ?? '';

    if (!txId) {
        console.error('[Paddle Webhook] Refund missing transactionId:', adjustmentId);
        void sendAdminAlert({
            kind: 'unknown_user',
            summary: 'Refund event without transactionId',
            details: { adjustmentId, eventId, raw: data },
        });
        return;
    }

    const grants = await findOriginalGrants(supabase, txId);
    if (grants.length === 0) {
        console.warn('[Paddle Webhook] Refund for unknown transaction:', txId);
        void sendAdminAlert({
            kind: 'unknown_user',
            summary: `Refund for transaction with no recorded grants`,
            details: { adjustmentId, eventId, paddleTransactionId: txId },
        });
        return;
    }

    const userId = grants[0].user_id;
    const grantedCredits = grants.reduce((sum, g) => sum + Number(g.amount), 0);

    const originalTotalCents = Number(data?.originalTotals?.total ?? data?.transactionTotals?.total ?? 0);
    const adjustmentTotalCents = Number(data?.totals?.total ?? 0);
    const fullRefund = originalTotalCents > 0 && isFullRefund(data, originalTotalCents);

    if (!fullRefund) {
        // Partial refund — admin handles credit adjustment manually.
        void sendAdminAlert({
            kind: 'partial_refund',
            summary: `Partial refund seen for user ${userId} — no auto-clawback`,
            details: {
                userId,
                adjustmentId,
                eventId,
                paddleTransactionId: txId,
                originalTotalCents,
                adjustmentTotalCents,
                grantedCredits,
            },
        });
        return;
    }

    // Full refund — claw back each grant row independently.
    let totalClawedBack = 0;
    let totalShortfall = 0;

    for (const grant of grants) {
        const idemKey = `paddle:adj:${adjustmentId}:row:${grant.id}`;
        const { data: rpcResult, error } = await supabase.rpc('paddle_refund_clawback', {
            p_user_id: userId,
            p_event_id: eventId,
            p_original_grant_id: grant.id,
            p_idempotency_key: idemKey,
            p_metadata: {
                paddle_adjustment_id: adjustmentId,
                paddle_transaction_id: txId,
                refund_reason: data?.reason ?? null,
            },
        });

        if (error) {
            console.error('[Paddle Webhook] paddle_refund_clawback RPC failed:', error);
            throw new Error(error.message);
        }

        const result = rpcResult as { clawed_back?: number; shortfall?: number };
        totalClawedBack += Number(result?.clawed_back ?? 0);
        totalShortfall  += Number(result?.shortfall  ?? 0);
    }

    if (totalShortfall > 0) {
        void sendAdminAlert({
            kind: 'clawback_shortfall',
            summary: `Refund clawback short by ${totalShortfall} credits for user ${userId}`,
            details: {
                userId,
                adjustmentId,
                eventId,
                paddleTransactionId: txId,
                totalGranted: grantedCredits,
                totalClawedBack,
                totalShortfall,
            },
        });
    }
}

async function handleChargeback(data: any, eventId: string, _supabase: ReturnType<typeof createServiceClient>) {
    console.log('[Paddle Webhook] Chargeback stub:', data?.id, 'event:', eventId);
}

async function handleChargebackReverse(data: any, eventId: string, _supabase: ReturnType<typeof createServiceClient>) {
    console.log('[Paddle Webhook] Chargeback reverse stub:', data?.id, 'event:', eventId);
}
