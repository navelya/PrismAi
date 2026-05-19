/**
 * Update-payment-method URL endpoint.
 *
 * Returns a Paddle-hosted single-purpose URL that lets the user update the
 * card on file. Card collection has to live on Paddle's domain for PCI-DSS,
 * so the rest of subscription management stays in-app — this endpoint is
 * scoped to *just* the card-update flow, not the full customer portal.
 *
 * The URL is short-lived; clients should request a fresh one each time the
 * user clicks "Update payment method".
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getPaddle } from '@/lib/billing/paddle-server';

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
            .select('paddle_customer_id, paddle_subscription_id')
            .eq('user_id', user.id)
            .single();

        if (subErr || !sub?.paddle_customer_id || !sub.paddle_subscription_id) {
            return NextResponse.json(
                { error: 'No active subscription found.' },
                { status: 404 }
            );
        }

        const paddle = getPaddle();
        const session = await paddle.customerPortalSessions.create(
            sub.paddle_customer_id,
            [sub.paddle_subscription_id]
        );

        const subUrl = session.urls?.subscriptions?.find(
            (s) => s.id === sub.paddle_subscription_id
        );
        const updateUrl = subUrl?.updateSubscriptionPaymentMethod;

        if (!updateUrl) {
            return NextResponse.json(
                { error: 'Failed to create payment-method update link.' },
                { status: 500 }
            );
        }

        return NextResponse.json({ url: updateUrl });
    } catch (err: any) {
        console.error('[Payment Method URL] Error:', err);
        return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
    }
}
