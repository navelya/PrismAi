/**
 * Update-payment-method transaction.
 *
 * Returns a Paddle transaction ID that the client can hand to Paddle.js's
 * `Checkout.open({ transactionId })`. That renders the card-entry form
 * inside our page (overlay or inline iframe) instead of redirecting the user
 * to Paddle's hosted portal.
 *
 * Under the hood, Paddle generates a special $0 transaction whose only
 * purpose is to capture a new payment method and attach it to the
 * subscription. The transaction ID is short-lived; clients should fetch a
 * fresh one each time the user clicks "Update payment method".
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
            .select('paddle_subscription_id')
            .eq('user_id', user.id)
            .single();

        if (subErr || !sub?.paddle_subscription_id) {
            return NextResponse.json(
                { error: 'No active subscription found.' },
                { status: 404 }
            );
        }

        const paddle = getPaddle();
        const tx = await paddle.subscriptions.getPaymentMethodChangeTransaction(
            sub.paddle_subscription_id,
        );

        return NextResponse.json({ transactionId: tx.id });
    } catch (err: any) {
        console.error('[Payment Method] Error:', err);
        return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
    }
}
