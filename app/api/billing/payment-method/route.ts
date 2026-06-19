/**
 * Update-payment-method endpoint (Dodo Payments).
 *
 * Returns a Dodo payment link URL that the client redirects the user to.
 * Calls `subscriptions.updatePaymentMethod(id, { payment_method: { type:'new', return_url } })`.
 * The response's `payment_link` field is the hosted page where the user
 * can enter a new card, which will then be bound to the subscription.
 *
 * The URL is short-lived; clients should fetch a fresh one each time the
 * user clicks "Update payment method".
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getDodo } from '@/lib/billing/dodo-server';

export const dynamic = 'force-dynamic';

export async function POST() {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }

        const service = createServiceClient();
        const { data: sub, error: subErr } = await service
            .from('subscriptions')
            .select('dodo_subscription_id')
            .eq('user_id', user.id)
            .single();

        if (subErr || !sub?.dodo_subscription_id) {
            return NextResponse.json(
                { error: 'No active subscription found.' },
                { status: 404 }
            );
        }

        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
        const dodo = getDodo();
        const result = await dodo.subscriptions.updatePaymentMethod(
            sub.dodo_subscription_id,
            {
                payment_method: {
                    type: 'new',
                    // /billing has no index page — return to the account billing tab.
                    return_url: `${appUrl}/settings?tab=plan-billing`,
                },
            },
        );

        // Dodo returns a payment_link (hosted page URL) for the user to enter
        // a new payment method. If client_secret is returned, it could also be
        // used for an embedded checkout SDK; we expose the link for redirect flow.
        const url = result.payment_link;
        if (!url) {
            return NextResponse.json(
                { error: 'Dodo did not return a payment method update URL.' },
                { status: 502 },
            );
        }

        return NextResponse.json({ url });
    } catch (err: any) {
        console.error('[Payment Method] Error:', err);
        return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
    }
}
