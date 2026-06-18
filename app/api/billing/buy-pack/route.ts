/**
 * Silent credit-pack purchase (Dodo Payments).
 *
 * Active subscription → `subscriptions.charge(dodo_subscription_id, { product_price })`.
 * Silent; reuses the mandate bound to the subscription. Webhook grants credits
 * when `payment.succeeded` lands (keyed by payment_id).
 *
 * No active sub → create a one-time hosted checkout session (attaching the
 * existing `dodo_customer_id` if present, else creating a new customer from
 * the user's email) and return `{ requiresCheckout: true, url }`. The client
 * redirects to that URL. We always return a URL in this branch.
 *
 * Credits aren't granted here; the existing `payment.succeeded` webhook
 * handler does that with full idempotency. This endpoint only kicks off the
 * charge.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getDodo, getDodoCheckoutMode } from '@/lib/billing/dodo-server';
import { getPricing, lookupPackByProductId } from '@/lib/billing/pricing-source';

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

        // Dispute gate.
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

        const { packs } = await getPricing();
        const pack = packs.find((p) => p.id === body.packId);
        if (!pack || !pack.dodoProductId) {
            return NextResponse.json({ error: 'Unknown credit pack or pack has no Dodo product configured' }, { status: 400 });
        }

        // Defence-in-depth: confirm the product ID we hold maps back to the pack
        // we just looked up. Guards against config drift between the catalog and
        // the mapping module.
        const lookup = await lookupPackByProductId(pack.dodoProductId);
        if (!lookup || lookup.packId !== pack.id) {
            return NextResponse.json(
                { error: 'Credit pack product is misconfigured. Contact support.' },
                { status: 500 },
            );
        }

        const service = createServiceClient();
        const { data: sub } = await service
            .from('subscriptions')
            .select('dodo_customer_id, dodo_subscription_id, status')
            .eq('user_id', user.id)
            .maybeSingle();

        const dodo = getDodo();

        // Preferred path: the user has an ACTIVE subscription. Charge the pack
        // as a one-time addition to it, reusing the mandate already bound to
        // the subscription. No checkout overlay needed.
        if (sub?.dodo_subscription_id && sub.status === 'active') {
            try {
                await dodo.subscriptions.charge(sub.dodo_subscription_id, {
                    product_price: Math.round(pack.price * 100), // dollars → integer cents (guard float drift)
                    metadata: {
                        user_id: user.id,
                        kind: 'pack',
                        pack_id: pack.id,
                    },
                });
            } catch (chargeErr: any) {
                console.error('[Buy Pack] subscriptions.charge failed:', chargeErr);
                return NextResponse.json(
                    { error: chargeErr?.message || 'Could not charge your saved card.' },
                    { status: 502 },
                );
            }

            // The spawned payment isn't returned here; the client confirms
            // the grant by polling the ledger for this pack.
            return NextResponse.json({ ok: true });
        }

        // No active subscription to charge silently → create a one-time hosted
        // checkout session for the pack. Attach the existing Dodo customer if we
        // have one; otherwise create a NEW customer from the user's email (this
        // is the common first-purchase path). Either way we MUST return a URL —
        // the client has no other way to open Dodo's hosted checkout.
        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
        const customer = sub?.dodo_customer_id
            ? { customer_id: sub.dodo_customer_id }
            : { email: user.email ?? '', name: user.email ?? '' };

        let session;
        try {
            session = await dodo.checkoutSessions.create({
                product_cart: [{ product_id: pack.dodoProductId, quantity: 1 }],
                customer,
                metadata: {
                    user_id: user.id,
                    kind: 'pack',
                    pack_id: pack.id,
                },
                return_url: `${appUrl}/billing/success`,
                // No subscription_data → one-time payment
            });
        } catch (sessionErr: any) {
            console.error('[Buy Pack] checkoutSessions.create failed:', sessionErr);
            return NextResponse.json(
                { error: sessionErr?.message || 'Could not create checkout session.' },
                { status: 502 },
            );
        }

        if (!session.checkout_url) {
            return NextResponse.json(
                { error: 'Dodo Payments did not return a checkout URL. Please try again.' },
                { status: 502 },
            );
        }

        return NextResponse.json({ requiresCheckout: true, url: session.checkout_url, mode: getDodoCheckoutMode() });
    } catch (err: any) {
        console.error('[Buy Pack] Error:', err);
        return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
    }
}
