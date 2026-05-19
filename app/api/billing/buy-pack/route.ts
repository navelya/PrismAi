/**
 * Silent credit-pack purchase.
 *
 * Creates a Paddle transaction billed against the user's saved payment method
 * (no overlay, no card re-entry) and returns the transaction ID for the
 * client to track via webhook → token_ledger.
 *
 * If the user has no Paddle customer record yet (never purchased before),
 * we can't charge a saved card — we return `requiresCheckout: true` so the
 * client falls back to the Paddle.js overlay for first-time card capture.
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

        // No saved customer → must go through the Paddle overlay to capture
        // a payment method. The client falls back automatically.
        if (!sub?.paddle_customer_id) {
            return NextResponse.json({ requiresCheckout: true });
        }

        const paddle = getPaddle();
        try {
            const tx = await paddle.transactions.create({
                items: [{ priceId: pack.paddlePriceId, quantity: 1 }],
                customerId: sub.paddle_customer_id,
                collectionMode: 'automatic',
                // Status 'billed' tells Paddle to immediately attempt the
                // charge against the saved payment method.
                status: 'billed',
                customData: {
                    user_id: user.id,
                    pack_id: pack.id,
                },
            });

            return NextResponse.json({
                transactionId: tx.id,
                status: tx.status,
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
            console.error('[Buy Pack] Paddle transaction.create failed:', paddleErr);
            return NextResponse.json(
                { error: message || 'Could not charge your saved card.' },
                { status: 502 },
            );
        }
    } catch (err: any) {
        console.error('[Buy Pack] Error:', err);
        return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
    }
}
