/**
 * Silent credit-pack purchase.
 *
 * Kicks off a one-time charge against the user's active subscription's saved
 * payment method via Paddle's purpose-built `subscriptions.createOneTimeCharge`
 * endpoint. The resulting `transaction.completed` webhook lands the credit
 * grant in `token_ledger`, which the client polls for to confirm completion.
 *
 * Why not `transactions.create({ status: 'billed' })`? Paddle rejects that
 * directly ("Transaction status needs to be ready") — the create endpoint
 * only accepts draft/ready statuses. One-time charges on an existing
 * subscription are the documented way to bill a saved card synchronously.
 *
 * If the user has no active subscription, we can't use createOneTimeCharge
 * and return `requiresCheckout: true` so the client opens the Paddle.js
 * overlay for first-time card capture instead.
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
            .select('paddle_subscription_id, status')
            .eq('user_id', user.id)
            .maybeSingle();

        // No active subscription = no path to charge a saved card via
        // createOneTimeCharge. Fall back to the Paddle.js overlay so the
        // user can enter (and save) a card on this first purchase.
        if (!sub?.paddle_subscription_id || sub.status !== 'active') {
            return NextResponse.json({ requiresCheckout: true });
        }

        const paddle = getPaddle();
        try {
            await paddle.subscriptions.createOneTimeCharge(
                sub.paddle_subscription_id,
                {
                    effectiveFrom: 'immediately',
                    items: [{ priceId: pack.paddlePriceId, quantity: 1 }],
                },
            );

            return NextResponse.json({ ok: true });
        } catch (paddleErr: any) {
            // Paddle throws when the subscription has no payment method on
            // file (or it's been deleted). Fall back to the overlay so they
            // can add one rather than seeing a hard error.
            const message = paddleErr?.message || '';
            const noMethod =
                /payment method/i.test(message) ||
                /no.*card/i.test(message) ||
                paddleErr?.code === 'transaction_payment_method_required';
            if (noMethod) {
                return NextResponse.json({ requiresCheckout: true });
            }
            console.error('[Buy Pack] Paddle createOneTimeCharge failed:', paddleErr);
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
