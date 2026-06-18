/**
 * Invoice PDF redirect (Dodo Payments).
 *
 * Dodo includes an `invoice_url` (hosted PDF URL) directly on the payment
 * object. We verify that the requested payment_id belongs to this user's
 * Dodo customer before redirecting, so links can't be shared to leak invoices.
 *
 * Note: Dodo's invoice_url is included on the payment object and may be a
 * permanent hosted link. We redirect directly to it.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getDodo } from '@/lib/billing/dodo-server';

export const dynamic = 'force-dynamic';

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function GET(_request: Request, ctx: RouteContext) {
    try {
        const { id } = await ctx.params;
        if (!id) {
            return NextResponse.json({ error: 'Missing payment id' }, { status: 400 });
        }

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
            .single();

        if (!sub?.dodo_customer_id) {
            return NextResponse.json({ error: 'No customer record' }, { status: 404 });
        }

        const dodo = getDodo();
        const payment = await dodo.payments.retrieve(id);

        // Ownership check: the payment must belong to this user's Dodo customer
        // record. Otherwise the user could enumerate other people's payment IDs.
        if (payment.customer.customer_id !== sub.dodo_customer_id) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        if (!payment.invoice_url) {
            return NextResponse.json({ error: 'Invoice not available' }, { status: 404 });
        }

        return NextResponse.redirect(payment.invoice_url);
    } catch (err: any) {
        console.error('[Invoice PDF] Error:', err);
        return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
    }
}
