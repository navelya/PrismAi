/**
 * Customer Portal endpoint.
 *
 * Returns a Paddle-hosted customer portal URL for the authenticated user.
 * The portal is where customers manage their payment method, view invoices,
 * cancel/upgrade — Paddle handles the entire UI.
 *
 * The portal session URL is short-lived; clients should request a fresh one
 * each time the user clicks "Manage subscription".
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

        if (subErr || !sub?.paddle_customer_id) {
            return NextResponse.json(
                { error: 'No Paddle customer found. Make a purchase first to access the customer portal.' },
                { status: 404 }
            );
        }

        const paddle = getPaddle();
        const session = await paddle.customerPortalSessions.create(
            sub.paddle_customer_id,
            sub.paddle_subscription_id ? [sub.paddle_subscription_id] : []
        );

        const portalUrl = session.urls?.general?.overview;
        if (!portalUrl) {
            return NextResponse.json({ error: 'Failed to create portal session' }, { status: 500 });
        }

        return NextResponse.json({ url: portalUrl });
    } catch (err: any) {
        console.error('[Billing Portal] Error:', err);
        return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
    }
}
