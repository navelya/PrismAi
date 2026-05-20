/**
 * Silent credit-pack purchase.
 *
 * Charges the user's saved payment method directly via `transactions.create`
 * against their Paddle CUSTOMER record. This is intentionally not coupled to
 * subscriptions — a credit pack is a standalone purchase. Anyone with a card
 * on file (current subscriber, ex-subscriber, or someone who bought a pack
 * before) can use the silent flow.
 *
 * Flow:
 *   1. Find the user's `paddle_customer_id`. No customer record yet (free
 *      user who's never purchased) → return `requiresCheckout: true` so the
 *      client opens the Paddle.js overlay for first-time card capture.
 *   2. Create a transaction with `collectionMode: 'automatic'`. Paddle
 *      attempts to bill the customer's default payment method immediately.
 *   3. Inspect the returned status:
 *      - `completed` / `paid` → charge succeeded; webhook will grant credits.
 *      - `past_due` → card declined; return a clear error to the client.
 *      - `ready` / `draft` → Paddle couldn't auto-bill (no saved card);
 *        fall back to the overlay.
 *
 * Credits aren't granted here; the existing `transaction.completed` webhook
 * handler does that with full idempotency. This endpoint only kicks off the
 * charge — the source of truth for "did the grant happen" is the ledger.
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
            .select('paddle_customer_id')
            .eq('user_id', user.id)
            .maybeSingle();

        // No Paddle customer = nobody to charge silently. Fall back to the
        // overlay so the user can enter (and save) a card on this purchase.
        if (!sub?.paddle_customer_id) {
            return NextResponse.json({ requiresCheckout: true });
        }

        const paddle = getPaddle();

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
