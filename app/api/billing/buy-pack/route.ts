/**
 * Silent credit-pack purchase.
 *
 * A card saved against a Paddle SUBSCRIPTION is bound to that subscription —
 * it is NOT reusable for an arbitrary customer-level transaction. So a fresh
 * `transactions.create` against the customer comes back `ready` (Paddle won't
 * auto-bill it) and forces the checkout overlay, even for paying subscribers.
 * That's why plan changes are silent (they mutate the subscription, reusing
 * its bound card) but top-ups used to pop the overlay.
 *
 * Fix: bill subscribers the same way plan changes are billed — as a one-time
 * charge ON the subscription (`subscriptions.createOneTimeCharge`), which
 * reuses the bound payment method with no checkout. Fall back to the
 * customer-level transaction (and then the overlay) only when there's no
 * active subscription to charge.
 *
 * Flow:
 *   1. Active subscription → `createOneTimeCharge(effectiveFrom: immediately)`.
 *      Silent; reuses the subscription's payment method. Webhook grants credits
 *      when the spawned `transaction.completed` lands.
 *   2. No active sub but a `paddle_customer_id` (ex-subscriber) → attempt a
 *      customer-level `transactions.create`; status `ready`/`draft` falls back
 *      to the overlay so they can supply a card.
 *   3. No customer record at all → `requiresCheckout: true` immediately.
 *
 * Credits aren't granted here; the existing `transaction.completed` webhook
 * handler does that with full idempotency. This endpoint only kicks off the
 * charge — the source of truth for "did the grant happen" is the ledger. The
 * subscription-charge path doesn't return the spawned transaction, so the
 * client confirms via `pollLedgerForPack` (filtered by pack ID).
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getPaddle } from '@/lib/billing/paddle-server';
import { lookupPackByPriceId } from '@/lib/billing/paddle-mapping';
import { CREDIT_PACKS } from '@/lib/billing/plans-config';

export const dynamic = 'force-dynamic';

interface BuyPackBody {
    packId?: string;
}

export async function POST(request: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }

        // Dispute gate: refuse new purchases while a chargeback is unresolved.
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

        const body = (await request.json().catch(() => ({}))) as BuyPackBody;
        if (!body.packId) {
            return NextResponse.json({ error: 'packId is required' }, { status: 400 });
        }

        const pack = CREDIT_PACKS.find((p) => p.id === body.packId);
        if (!pack || !pack.paddlePriceId) {
            return NextResponse.json({ error: 'Unknown credit pack' }, { status: 400 });
        }

        // Defence-in-depth: confirm the price ID we hold maps to the pack we
        // just looked up. Guards against config drift between the catalog and
        // the mapping module.
        const lookup = lookupPackByPriceId(pack.paddlePriceId);
        if (!lookup || lookup.packId !== pack.id) {
            return NextResponse.json(
                { error: 'Credit pack price is misconfigured. Contact support.' },
                { status: 500 },
            );
        }

        const service = createServiceClient();
        const { data: sub } = await service
            .from('subscriptions')
            .select('paddle_customer_id, paddle_subscription_id, status')
            .eq('user_id', user.id)
            .maybeSingle();

        const paddle = getPaddle();

        // Preferred path: the user has an ACTIVE subscription. Charge the pack
        // as a one-time addition to it, reusing the payment method already
        // bound to the subscription. This is the same mechanism that makes plan
        // changes silent — no checkout overlay. `prevent_change` ensures a
        // declined card doesn't apply a phantom charge; with no completed
        // transaction the webhook never grants credits.
        if (sub?.paddle_subscription_id && sub.status === 'active') {
            try {
                await paddle.subscriptions.createOneTimeCharge(sub.paddle_subscription_id, {
                    effectiveFrom: 'immediately',
                    onPaymentFailure: 'prevent_change',
                    items: [{ priceId: pack.paddlePriceId, quantity: 1 }],
                });
            } catch (chargeErr: any) {
                console.error('[Buy Pack] createOneTimeCharge failed:', chargeErr);
                return NextResponse.json(
                    { error: chargeErr?.message || 'Could not charge your saved card.' },
                    { status: 502 },
                );
            }

            // The spawned transaction isn't returned here; the client confirms
            // the grant by polling the ledger for this pack.
            return NextResponse.json({ ok: true });
        }

        // No Paddle customer = nobody to charge silently. Fall back to the
        // overlay so the user can enter (and save) a card on this purchase.
        if (!sub?.paddle_customer_id) {
            return NextResponse.json({ requiresCheckout: true });
        }

        let tx;
        try {
            tx = await paddle.transactions.create({
                items: [{ priceId: pack.paddlePriceId, quantity: 1 }],
                customerId: sub.paddle_customer_id,
                collectionMode: 'automatic',
                customData: {
                    user_id: user.id,
                    pack_id: pack.id,
                },
            });
        } catch (paddleErr: any) {
            // Paddle throws when the customer has no payment method on file
            // (or it's been deleted). Fall back to the overlay so they can
            // add one rather than seeing a hard error.
            const message = paddleErr?.message || '';
            const noMethod =
                /payment method/i.test(message) ||
                /no.*card/i.test(message) ||
                paddleErr?.code === 'transaction_payment_method_required';
            if (noMethod) {
                return NextResponse.json({ requiresCheckout: true });
            }
            console.error('[Buy Pack] Paddle transactions.create failed:', paddleErr);
            return NextResponse.json(
                { error: message || 'Could not charge your saved card.' },
                { status: 502 },
            );
        }

        switch (tx.status) {
            case 'completed':
            case 'paid':
            case 'billed':
                // Auto-bill succeeded (or is in-flight). The webhook will
                // confirm via `transaction.completed` and grant credits.
                return NextResponse.json({
                    ok: true,
                    transactionId: tx.id,
                    status: tx.status,
                });

            case 'past_due':
                // Card was on file but the charge was declined.
                return NextResponse.json(
                    {
                        error: 'Your card was declined. Try updating your payment method and buying the pack again.',
                        cardDeclined: true,
                    },
                    { status: 402 },
                );

            case 'ready':
            case 'draft':
            default:
                // Paddle didn't auto-bill (most commonly: customer has no
                // default payment method). Surface the overlay so the user
                // can enter one for this purchase.
                return NextResponse.json({ requiresCheckout: true });
        }
    } catch (err: any) {
        console.error('[Buy Pack] Error:', err);
        return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
    }
}
