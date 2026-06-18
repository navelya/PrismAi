/**
 * Dodo Payments webhook receiver.
 *
 * Dodo posts every billing event here (subscriptions, payments, refunds,
 * disputes). We verify the signature using standardwebhooks, then dispatch to
 * the matching handler. All DB writes use SECURITY DEFINER RPCs and an
 * idempotency key derived from the Dodo event — replays don't double-grant
 * credits.
 *
 * User ↔ Supabase user mapping:
 *   - When checkout opens, we pass metadata.user_id (the Supabase auth UID).
 *   - Dodo echoes that metadata back on every subsequent event for the
 *     subscription / payment, so we always have it available.
 *   - We persist dodo_customer_id on the subscription so we can also look
 *     up by customer when metadata isn't included (e.g. portal-driven cancels).
 *
 * Credit-grant safety:
 *   - Pack purchases: grant on payment.succeeded (idempotency key = payment_id).
 *   - Subscription credits: grant ONLY on subscription.active / subscription.renewed.
 *     payment.succeeded for a subscription payment does NOT grant — to prevent
 *     double-granting (the subscription event is the canonical source of truth).
 *   - Period-cap logic: same billing-period cycling exploit prevention as the
 *     Paddle handler — anchor at the most recent fresh-period grant, cap total
 *     subscription credits at the highest plan held in that period.
 */
import { NextResponse } from 'next/server';
import { Webhook } from 'standardwebhooks';
import { createServiceClient } from '@/lib/supabase/service';
import { getDodo } from '@/lib/billing/dodo-server';
import {
    lookupPlanByProductId,
    monthlyCreditsForPlan,
    creditsForPack,
} from '@/lib/billing/pricing-source';
import { sendAdminAlert } from '@/lib/email/admin-alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    const webhookKey = process.env.DODO_WEBHOOK_KEY;

    if (!webhookKey) {
        console.error('[Dodo Webhook] DODO_WEBHOOK_KEY is not configured.');
        return new Response('Server misconfigured', { status: 500 });
    }

    // IMPORTANT: read raw body BEFORE any JSON.parse — standardwebhooks needs
    // the raw bytes to verify the signature.
    const raw = await req.text();

    try {
        const wh = new Webhook(webhookKey);
        await wh.verify(raw, {
            'webhook-id': req.headers.get('webhook-id') ?? '',
            'webhook-signature': req.headers.get('webhook-signature') ?? '',
            'webhook-timestamp': req.headers.get('webhook-timestamp') ?? '',
        });
    } catch (err: any) {
        console.error('[Dodo Webhook] Signature verification failed:', err?.message);
        return new Response('Invalid signature', { status: 401 });
    }

    let evt: { type: string; data: any; business_id: string; timestamp: string };
    try {
        evt = JSON.parse(raw);
    } catch {
        return new Response('Unparseable payload', { status: 400 });
    }

    const supabase = createServiceClient();

    try {
        switch (evt.type) {
            // ── Subscription lifecycle ──────────────────────────────────────────
            case 'subscription.active':
            case 'subscription.renewed':
                await handleSubscriptionActiveOrRenewed(evt.data, supabase);
                break;

            case 'subscription.plan_changed':
            case 'subscription.updated':
                await handleSubscriptionUpdated(evt.data, supabase);
                break;

            case 'subscription.cancelled':
            case 'subscription.expired':
            case 'subscription.on_hold':
                await handleSubscriptionTerminated(evt.data, supabase);
                break;

            case 'subscription.failed':
                console.warn('[Dodo Webhook] subscription.failed:', evt.data?.subscription_id);
                break;

            // ── Payments ────────────────────────────────────────────────────────
            case 'payment.succeeded':
                await handlePaymentSucceeded(evt.data, supabase);
                break;

            case 'payment.failed':
                console.warn('[Dodo Webhook] payment.failed:', evt.data?.payment_id);
                break;

            // ── Refunds ─────────────────────────────────────────────────────────
            case 'refund.succeeded':
                await handleRefundSucceeded(evt.data, supabase);
                break;

            // ── Disputes ────────────────────────────────────────────────────────
            case 'dispute.opened':
            case 'dispute.lost':
                await handleDisputeAdverse(evt.data, evt.type, supabase);
                break;

            case 'dispute.won':
                await handleDisputeWon(evt.data, supabase);
                break;

            default:
                // Acknowledge unhandled events so Dodo doesn't retry forever.
                console.log('[Dodo Webhook] Ignoring event type:', evt.type);
        }
    } catch (err: any) {
        console.error('[Dodo Webhook] Handler error for', evt.type, ':', err?.message ?? err);
        return new Response('Handler failed', { status: 500 });
    }

    return NextResponse.json({ ok: true });
}

// =============================================================================
// SUBSCRIPTION HANDLERS
// =============================================================================

/**
 * Handle subscription.active and subscription.renewed.
 *
 * These are the ONLY events that grant subscription credits. We apply the same
 * billing-period cap as the Paddle handler to prevent the cycling exploit where
 * a user hops between plans and accumulates credits on every hop.
 */
async function handleSubscriptionActiveOrRenewed(
    data: any,
    supabase: ReturnType<typeof createServiceClient>,
) {
    const userId = await resolveUserId(data, supabase);
    if (!userId) {
        console.error('[Dodo Webhook] Cannot resolve user for subscription event:', data?.subscription_id);
        return;
    }

    const productId: string | undefined = data?.product_id;
    if (!productId) {
        console.error('[Dodo Webhook] subscription event missing product_id:', data?.subscription_id);
        return;
    }

    const lookup = await lookupPlanByProductId(productId);
    if (!lookup) {
        console.error('[Dodo Webhook] No plan match for Dodo product_id:', productId);
        return;
    }

    const subscriptionId: string = data?.subscription_id ?? '';
    // next_billing_date is the end of the current period — use as period anchor
    // in the idempotency key so subscription.active and subscription.renewed for
    // the SAME period are idempotent.
    const nextBillingDate: string = data?.next_billing_date ?? data?.previous_billing_date ?? '';

    // FIX 2: A grant event without a period boundary is malformed — we cannot
    // build a valid idempotency key or scope the period cap correctly.
    if (!nextBillingDate) {
        console.error(
            '[Dodo Webhook] subscription.active/renewed missing next_billing_date (and previous_billing_date).',
            'Cannot grant credits without a period boundary. subscription_id:', subscriptionId,
        );
        return;
    }

    // ── Period-cap logic ────────────────────────────────────────────────────
    // Prevents the cycling exploit: across one billing period, total
    // subscription credits must not exceed the highest plan held in that period.
    // The period is keyed by next_billing_date so each new period gets a fresh
    // grant even if the same plan was held in the previous period.
    const periodCap = await computePeriodGrantCap(supabase, userId, lookup.planId, nextBillingDate);
    const wouldGrant = await monthlyCreditsForPlan(lookup.planId);

    if (periodCap.samePlanAlreadyGranted) {
        // Already granted for this plan in the current period — no-op.
        console.log('[Dodo Webhook] Skipping re-grant: same plan already granted this period for user', userId);
    } else {
        const remaining = Math.max(0, periodCap.maxCredits - periodCap.alreadyGranted);
        const credits = Math.min(wouldGrant, remaining);

        if (credits > 0) {
            // Idempotency key includes the subscription ID and period boundary so
            // retries are no-ops and a new period gets a fresh grant.
            const idempotencyKey = `dodo:sub:${subscriptionId}:${nextBillingDate}`;
            await grantCredits(supabase, {
                userId,
                amount: credits,
                reason: 'dodo_subscription_grant',
                idempotencyKey,
                metadata: {
                    dodo_subscription_id: subscriptionId,
                    dodo_product_id: productId,
                    plan_id: lookup.planId,
                    cycle: lookup.cycle,
                    period_max_credits: periodCap.maxCredits,
                    period_already_granted: periodCap.alreadyGranted,
                    next_billing_date: nextBillingDate,
                },
            });
        }
    }

    // Upsert the subscription row regardless of credit grant path.
    await upsertSubscriptionRow(data, userId, lookup, supabase);
}

/**
 * Handle subscription.plan_changed and subscription.updated.
 *
 * For same-cycle swaps, we only update the row — no credit re-grant.
 * IMPORTANT: Dodo may emit subscription.updated with status='cancelled' instead
 * of a dedicated subscription.cancelled event when the cancel route fires.
 * We handle that case by mapping those statuses correctly.
 */
async function handleSubscriptionUpdated(
    data: any,
    supabase: ReturnType<typeof createServiceClient>,
) {
    const userId = await resolveUserId(data, supabase);
    if (!userId) {
        console.error('[Dodo Webhook] Cannot resolve user for subscription.updated:', data?.subscription_id);
        return;
    }

    const productId: string | undefined = data?.product_id;
    const lookup = productId ? await lookupPlanByProductId(productId) : null;

    // If status is terminal (cancelled/expired), treat like a termination.
    const status: string = data?.status ?? '';
    if (status === 'cancelled' || status === 'expired') {
        console.log('[Dodo Webhook] subscription.updated with terminal status:', status, data?.subscription_id);
        await handleSubscriptionTerminated(data, supabase);
        return;
    }

    if (!lookup) {
        // Can't resolve plan — still upsert what we know (status change, etc.)
        console.warn('[Dodo Webhook] subscription.updated: no plan for product_id', productId);
    }

    await upsertSubscriptionRow(data, userId, lookup, supabase);
}

/**
 * Handle subscription.cancelled, subscription.expired, subscription.on_hold.
 *
 * Downgrades the user to the free plan. Only acts if the canceled sub matches
 * our tracked row (same guard as the Paddle handler to prevent orphaned-sub
 * events from clobbering an active paid subscription).
 */
async function handleSubscriptionTerminated(
    data: any,
    supabase: ReturnType<typeof createServiceClient>,
) {
    const userId = await resolveUserId(data, supabase);
    if (!userId) {
        console.error('[Dodo Webhook] Cannot resolve user for subscription termination:', data?.subscription_id);
        return;
    }

    const subscriptionId: string = data?.subscription_id ?? '';

    // Only act if this sub is the one our row currently tracks (or if our row
    // has no tracked sub). Stale events for orphaned subs must not downgrade an
    // active paid subscription.
    const { data: existing } = await supabase
        .from('subscriptions')
        .select('dodo_subscription_id, status')
        .eq('user_id', userId)
        .maybeSingle();

    if (
        existing?.dodo_subscription_id &&
        existing.dodo_subscription_id !== subscriptionId &&
        existing.status === 'active'
    ) {
        console.warn(
            '[Dodo Webhook] Ignoring termination for non-tracked sub',
            subscriptionId,
            '— DB row tracks',
            existing.dodo_subscription_id,
        );
        return;
    }

    const { error } = await supabase
        .from('subscriptions')
        .update({
            plan_id: 'free',
            status: 'active',
            cancel_at_period_end: false,
            current_period_end: null,
            // Start a clean free cycle so accumulated paid credits expire ~1 month
            // after downgrade (not at a stale yearly period-end, nor immediately).
            next_topup_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            dodo_subscription_id: null,
            dodo_product_id: null,
            billing_cycle: null,
            updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('dodo_subscription_id', subscriptionId);

    if (error) {
        console.error('[Dodo Webhook] Failed to downgrade subscription:', error);
        throw new Error(error.message);
    }
}

// =============================================================================
// PAYMENT HANDLER
// =============================================================================

/**
 * Handle payment.succeeded.
 *
 * Only grants credits for one-time pack purchases (metadata.kind === 'pack').
 * Subscription payments are handled by subscription.active / subscription.renewed
 * to avoid double-granting.
 *
 * Pack identification: metadata.pack_id (set at checkout/charge time) takes
 * precedence over product_cart lookup. This covers both the subscriptions.charge
 * path (no product_cart) and the one-time checkout path.
 */
async function handlePaymentSucceeded(
    data: any,
    supabase: ReturnType<typeof createServiceClient>,
) {
    const metadata: Record<string, string> = data?.metadata ?? {};
    const kind: string = metadata?.kind ?? '';

    // If this payment is for a subscription (not a pack), credits are handled
    // by the subscription.active/renewed event — skip to avoid double-granting.
    if (kind !== 'pack') {
        // Log at debug level — this path is expected for subscription renewals.
        console.log('[Dodo Webhook] payment.succeeded: skipping non-pack payment', data?.payment_id, { kind });
        return;
    }

    const userId = await resolveUserId(data, supabase);
    if (!userId) {
        console.error('[Dodo Webhook] payment.succeeded: cannot resolve user for payment', data?.payment_id);
        return;
    }

    const paymentId: string = data?.payment_id ?? '';
    const packId: string | undefined = metadata?.pack_id;

    if (!packId) {
        console.error('[Dodo Webhook] payment.succeeded: pack purchase missing pack_id in metadata', paymentId);
        void sendAdminAlert({
            kind: 'unknown_user',
            summary: `Pack payment ${paymentId} has no pack_id in metadata`,
            details: { paymentId, userId, metadata },
        });
        return;
    }

    const packCredits = await creditsForPack(packId);
    if (packCredits <= 0) {
        console.error('[Dodo Webhook] payment.succeeded: creditsForPack returned 0 for pack_id', packId);
        return;
    }

    await grantCredits(supabase, {
        userId,
        amount: packCredits,
        reason: 'dodo_pack_purchase',
        idempotencyKey: `dodo:tx:${paymentId}`,
        metadata: {
            dodo_payment_id: paymentId,
            pack_id: packId,
        },
    });
}

// =============================================================================
// REFUND HANDLER
// =============================================================================

/**
 * Handle refund.succeeded.
 *
 * Finds the original grant rows by payment_id stored in ledger metadata,
 * then calls dodo_refund_clawback (caps at current balance — never goes
 * negative). Admin is alerted on shortfall or partial refund.
 *
 * Dodo Refund shape (confirmed from .d.ts):
 *   data.refund_id, data.payment_id, data.amount (number|null), data.is_partial,
 *   data.customer.customer_id, data.reason
 */
async function handleRefundSucceeded(
    data: any,
    supabase: ReturnType<typeof createServiceClient>,
) {
    const refundId: string = data?.refund_id ?? '';
    const paymentId: string = data?.payment_id ?? '';

    if (!paymentId) {
        console.error('[Dodo Webhook] refund.succeeded: missing payment_id on refund', refundId);
        void sendAdminAlert({
            kind: 'unknown_user',
            summary: 'Refund event without payment_id',
            details: { refundId, raw: data },
        });
        return;
    }

    const grants = await findOriginalGrantsByPaymentId(supabase, paymentId);
    if (grants.length === 0) {
        console.warn('[Dodo Webhook] Refund for unknown payment (no recorded grants):', paymentId);
        void sendAdminAlert({
            kind: 'unknown_user',
            summary: `Refund for payment with no recorded grants`,
            details: { refundId, dodoPaymentId: paymentId },
        });
        return;
    }

    const userId = grants[0].user_id;
    const grantedCredits = grants.reduce((sum, g) => sum + Number(g.amount), 0);
    const isPartial: boolean = data?.is_partial ?? false;

    if (isPartial) {
        // Partial refund — admin handles credit adjustment manually.
        void sendAdminAlert({
            kind: 'partial_refund',
            summary: `Partial refund seen for user ${userId} — no auto-clawback`,
            details: {
                userId,
                refundId,
                dodoPaymentId: paymentId,
                refundAmount: data?.amount ?? null,
                grantedCredits,
            },
        });
        return;
    }

    // Full refund — claw back each grant row independently.
    let totalClawedBack = 0;
    let totalShortfall = 0;

    for (const grant of grants) {
        const idemKey = `dodo:refund:${refundId}:row:${grant.id}`;
        const { data: rpcResult, error } = await supabase.rpc('dodo_refund_clawback', {
            p_user_id: userId,
            p_event_id: refundId,
            p_original_grant_id: grant.id,
            p_idempotency_key: idemKey,
            p_metadata: {
                dodo_refund_id: refundId,
                dodo_payment_id: paymentId,
                refund_reason: data?.reason ?? null,
            },
        });

        if (error) {
            console.error('[Dodo Webhook] dodo_refund_clawback RPC failed:', error);
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
                refundId,
                dodoPaymentId: paymentId,
                totalGranted: grantedCredits,
                totalClawedBack,
                totalShortfall,
            },
        });
    }
}

// =============================================================================
// DISPUTE HANDLERS
// =============================================================================

/**
 * Handle dispute.opened and dispute.lost.
 *
 * Force-clawbacks ALL grant rows via dodo_chargeback_clawback (allows balance
 * to go negative). Sets payment_disputed_at on the profile. Cancels the active
 * Dodo subscription. Alerts admin.
 *
 * Dodo GetDispute shape (confirmed from .d.ts):
 *   data.dispute_id, data.payment_id, data.amount (string), data.customer.customer_id,
 *   data.dispute_status, data.reason
 */
async function handleDisputeAdverse(
    data: any,
    eventType: string,
    supabase: ReturnType<typeof createServiceClient>,
) {
    const disputeId: string = data?.dispute_id ?? '';
    const paymentId: string = data?.payment_id ?? '';

    if (!paymentId) {
        console.error('[Dodo Webhook] dispute event: missing payment_id on dispute', disputeId);
        void sendAdminAlert({
            kind: 'unknown_user',
            summary: `Dispute event (${eventType}) without payment_id`,
            details: { disputeId, eventType, raw: data },
        });
        return;
    }

    const grants = await findOriginalGrantsByPaymentId(supabase, paymentId);
    if (grants.length === 0) {
        console.warn('[Dodo Webhook] Dispute for unknown payment (no recorded grants):', paymentId);
        void sendAdminAlert({
            kind: 'unknown_user',
            summary: `Dispute (${eventType}) for payment with no recorded grants`,
            details: { disputeId, eventType, dodoPaymentId: paymentId },
        });
        return;
    }

    const userId = grants[0].user_id;
    let totalClawedBack = 0;
    let anyWentNegative = false;

    // Force-clawback every grant. RPC allows negative balance.
    for (const grant of grants) {
        const idemKey = `dodo:dispute:${disputeId}:row:${grant.id}`;
        const { data: rpcResult, error } = await supabase.rpc('dodo_chargeback_clawback', {
            p_user_id: userId,
            p_event_id: disputeId,
            p_original_grant_id: grant.id,
            p_idempotency_key: idemKey,
            p_metadata: {
                dodo_dispute_id: disputeId,
                dodo_payment_id: paymentId,
                event_type: eventType,
                dispute_reason: data?.reason ?? null,
            },
        });

        if (error) {
            console.error('[Dodo Webhook] dodo_chargeback_clawback RPC failed:', error);
            throw new Error(error.message);
        }

        const result = rpcResult as { clawed_back?: number; went_negative?: boolean };
        totalClawedBack += Number(result?.clawed_back ?? 0);
        if (result?.went_negative) anyWentNegative = true;
    }

    // Cancel the active Dodo subscription (if any) via the Dodo API.
    let subscriptionCanceled: { ok: boolean; subscriptionId?: string; error?: string } = { ok: false };
    const { data: sub } = await supabase
        .from('subscriptions')
        .select('dodo_subscription_id, status')
        .eq('user_id', userId)
        .maybeSingle();

    if (sub?.dodo_subscription_id && sub.status === 'active') {
        try {
            const dodo = getDodo();
            await dodo.subscriptions.update(sub.dodo_subscription_id, {
                status: 'cancelled',
            });
            subscriptionCanceled = { ok: true, subscriptionId: sub.dodo_subscription_id };
        } catch (cancelErr: any) {
            subscriptionCanceled = {
                ok: false,
                subscriptionId: sub.dodo_subscription_id,
                error: cancelErr?.message ?? String(cancelErr),
            };
            console.error('[Dodo Webhook] Failed to cancel sub after dispute:', cancelErr);
        }
    }

    void sendAdminAlert({
        kind: 'chargeback',
        summary: `Dispute (${eventType}) for user ${userId} (${totalClawedBack} credits clawed back)`,
        details: {
            userId,
            disputeId,
            eventType,
            dodoPaymentId: paymentId,
            totalClawedBack,
            anyWentNegative,
            subscriptionCanceled,
            disputeReason: data?.reason ?? null,
            disputeStatus: data?.dispute_status ?? null,
        },
    });
}

/**
 * Handle dispute.won.
 *
 * No automatic credit restoration — alert admin to decide manually based on
 * dispute outcome and user behavior.
 */
async function handleDisputeWon(
    data: any,
    supabase: ReturnType<typeof createServiceClient>,
) {
    const disputeId: string = data?.dispute_id ?? '';
    const paymentId: string = data?.payment_id ?? '';

    // Best-effort user lookup so the alert is actionable.
    let userId: string | null = null;
    if (paymentId) {
        const grants = await findOriginalGrantsByPaymentId(supabase, paymentId);
        if (grants.length > 0) userId = grants[0].user_id;
    }

    void sendAdminAlert({
        kind: 'chargeback_reverse',
        summary: userId
            ? `Dispute won for user ${userId} — review whether to restore credits`
            : `Dispute won for unknown user — investigate`,
        details: {
            userId,
            disputeId,
            dodoPaymentId: paymentId,
            disputeStatus: data?.dispute_status ?? null,
            note: 'No automatic credit restoration. Admin must decide manually based on dispute outcome and user behavior.',
        },
    });
}

// =============================================================================
// PERIOD-CAP LOGIC
// =============================================================================

/**
 * Compute the credit-grant ceiling for a specific billing period.
 *
 * Period identity: `nextBillingDate` (the `next_billing_date` from the Dodo
 * event). Each unique `next_billing_date` is a distinct billing period.
 * Only ledger rows whose `metadata->>'next_billing_date'` matches the incoming
 * event's value count toward this period's already-granted total. Rows from
 * prior or future periods are IGNORED, which means:
 *   - subscription.active (period 1) finds no prior in-period grants → grants full credits.
 *   - subscription.renewed (period 2, new next_billing_date) also finds no prior
 *     in-period grants → grants full credits again.
 *   - A duplicate delivery of either event is blocked by the existing per-period
 *     idempotency key (dodo:sub:<id>:<next_billing_date>) at the credit_tokens level.
 *   - A within-period plan upgrade (same next_billing_date, higher plan) still
 *     gets capped to maxCredits - alreadyGrantedThisPeriod (anti-exploit preserved).
 *
 * Ceiling: the highest monthlyCredits of any plan held in this period,
 * including the incoming plan.
 *
 * Returns { maxCredits, alreadyGranted, samePlanAlreadyGranted }.
 * Caller computes remaining = max(0, maxCredits - alreadyGranted) and grants
 * min(wouldGrant, remaining).
 */
async function computePeriodGrantCap(
    supabase: ReturnType<typeof createServiceClient>,
    userId: string,
    incomingPlanId: string,
    nextBillingDate: string,
): Promise<{ maxCredits: number; alreadyGranted: number; samePlanAlreadyGranted: boolean }> {
    const incomingPlanCredits = await monthlyCreditsForPlan(incomingPlanId);

    // Pull every dodo subscription grant in this period specifically.
    // A row is "in this period" when its metadata->>'next_billing_date' matches
    // the incoming event's next_billing_date. This is the ONLY correct anchor
    // under Dodo's model — the most-recent-grant anchor used by the Paddle port
    // incorrectly fires samePlanAlreadyGranted on every renewal because the
    // anchor row is always the previous period's grant.
    const { data: priorGrants } = await supabase
        .from('token_ledger')
        .select('amount, metadata')
        .eq('user_id', userId)
        .eq('reason', 'dodo_subscription_grant')
        .filter('metadata->>next_billing_date', 'eq', nextBillingDate);

    let alreadyGranted = 0;
    let maxCredits = incomingPlanCredits;
    let samePlanAlreadyGranted = false;

    if (priorGrants) {
        for (const row of priorGrants as any[]) {
            alreadyGranted += row.amount;
            const pid = row.metadata?.plan_id;
            const planCredits = pid ? await monthlyCreditsForPlan(pid) : 0;
            if (planCredits > maxCredits) maxCredits = planCredits;
            if (pid === incomingPlanId && row.amount > 0) samePlanAlreadyGranted = true;
        }
    }

    return { maxCredits, alreadyGranted, samePlanAlreadyGranted };
}

// =============================================================================
// HELPERS
// =============================================================================

interface GrantArgs {
    userId: string;
    amount: number;
    reason: 'dodo_pack_purchase' | 'dodo_subscription_grant';
    idempotencyKey: string;
    metadata: Record<string, any>;
}

async function grantCredits(supabase: ReturnType<typeof createServiceClient>, args: GrantArgs) {
    const { error } = await supabase.rpc('credit_tokens', {
        p_user_id: args.userId,
        p_amount: args.amount,
        p_reason: args.reason,
        p_idempotency_key: args.idempotencyKey,
        p_execution_id: null,
        // credit_tokens still uses the p_stripe_event_id column name (not yet
        // renamed to p_dodo_event_id). The 20260618 migration adds a separate
        // dodo_event_id column to token_ledger but doesn't rename this RPC
        // parameter — so we pass the Dodo event reference here.
        p_stripe_event_id: args.idempotencyKey,
        p_metadata: args.metadata,
    });

    if (error) {
        console.error('[Dodo Webhook] credit_tokens RPC failed:', error);
        throw new Error(error.message);
    }
}

/**
 * Resolve the Supabase user ID from a Dodo event's data object.
 *
 * Strategy:
 *   1. data.metadata.user_id (set at checkout for both payments and subscriptions)
 *   2. DB lookup: subscriptions.dodo_customer_id = data.customer.customer_id
 *      (covers portal-driven events where metadata may be absent)
 *
 * Returns null if the user cannot be resolved — callers must NOT grant credits
 * in that case (log + return 200 to avoid a Dodo retry storm).
 */
async function resolveUserId(data: any, supabase: ReturnType<typeof createServiceClient>): Promise<string | null> {
    // 1. Prefer explicit user_id from metadata (most reliable).
    const fromMetadata = data?.metadata?.user_id;
    if (typeof fromMetadata === 'string' && fromMetadata.length > 0) return fromMetadata;

    // 2. Fallback: look up by dodo_customer_id.
    const customerId = data?.customer?.customer_id;
    if (customerId) {
        const { data: sub } = await supabase
            .from('subscriptions')
            .select('user_id')
            .eq('dodo_customer_id', customerId)
            .maybeSingle();
        if (sub?.user_id) return sub.user_id;
    }

    return null;
}

/**
 * Find ledger rows that recorded the original positive grant(s) for a given
 * Dodo payment. grantCredits() stores dodo_payment_id in metadata, which is
 * how we re-locate them on a refund/dispute.
 */
async function findOriginalGrantsByPaymentId(
    supabase: ReturnType<typeof createServiceClient>,
    paymentId: string,
): Promise<Array<{ id: string; user_id: string; amount: number; reason: string; metadata: any }>> {
    const { data, error } = await supabase
        .from('token_ledger')
        .select('id, user_id, amount, reason, metadata')
        .in('reason', ['dodo_pack_purchase', 'dodo_subscription_grant'])
        .filter('metadata->>dodo_payment_id', 'eq', paymentId);

    if (error) {
        console.error('[Dodo Webhook] findOriginalGrantsByPaymentId failed:', error);
        return [];
    }
    return (data ?? []) as any;
}

/**
 * Map Dodo subscription status to our internal status.
 *
 * Dodo SubscriptionStatus: 'pending' | 'active' | 'on_hold' | 'cancelled' | 'failed' | 'expired'
 */
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

/**
 * Upsert the subscriptions DB row via the dodo_subscription_upsert RPC.
 *
 * Called from both subscription.active/renewed (after credit grant) and
 * subscription.updated/plan_changed (no grant).
 *
 * Dodo Subscription shape (confirmed from .d.ts):
 *   data.subscription_id, data.customer.customer_id, data.product_id,
 *   data.next_billing_date, data.status, data.cancel_at_next_billing_date
 */
async function upsertSubscriptionRow(
    data: any,
    userId: string,
    lookup: { planId: string; cycle: 'monthly' | 'yearly' } | null,
    supabase: ReturnType<typeof createServiceClient>,
) {
    const subscriptionId: string = data?.subscription_id ?? '';
    const customerId: string = data?.customer?.customer_id ?? '';
    const productId: string | undefined = data?.product_id;
    const nextBillingDate: string | undefined = data?.next_billing_date;
    const status = mapDodoStatusToOurs(data?.status ?? '');
    const cancelAtNextBillingDate: boolean = data?.cancel_at_next_billing_date ?? false;

    const { error } = await supabase.rpc('dodo_subscription_upsert', {
        p_user_id: userId,
        p_dodo_subscription_id: subscriptionId,
        p_dodo_customer_id: customerId,
        p_dodo_product_id: productId ?? null,
        p_plan_id: lookup?.planId ?? 'free',
        p_status: status,
        p_current_period_end: nextBillingDate ?? null,
        p_cancel_at_period_end: cancelAtNextBillingDate,
        p_billing_cycle: lookup?.cycle ?? null,
    });

    if (error) {
        console.error('[Dodo Webhook] dodo_subscription_upsert RPC failed:', error);
        throw new Error(error.message);
    }
}
