/**
 * POST /api/billing/portal
 *
 * Creates a Dodo Payments customer portal session and returns its hosted URL.
 * The portal is Dodo's maintained billing UI — the customer can change their
 * payment method, view/download invoices, and (for subscribers) cancel.
 *
 * Available to ANY user with a saved Dodo customer: subscribers AND free-plan
 * users who saved a card while buying a credit pack. The client must only show
 * the entry point when `hasSavedCustomer` is true (exposed on /api/billing/
 * subscription) — otherwise this 404s.
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
        const { data: sub } = await service
            .from('subscriptions')
            .select('dodo_customer_id')
            .eq('user_id', user.id)
            .maybeSingle();

        if (!sub?.dodo_customer_id) {
            return NextResponse.json(
                { error: 'No saved billing information found.' },
                { status: 404 },
            );
        }

        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
        const session = await getDodo().customers.customerPortal.create(
            sub.dodo_customer_id,
            { return_url: `${appUrl}/settings?tab=plan-billing` },
        );

        if (!session.link) {
            return NextResponse.json(
                { error: 'Dodo did not return a billing portal URL.' },
                { status: 502 },
            );
        }

        return NextResponse.json({ url: session.link });
    } catch (err: any) {
        console.error('[Billing Portal] Error:', err);
        return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
    }
}
