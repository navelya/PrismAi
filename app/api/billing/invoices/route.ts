/**
 * Invoice list endpoint (Dodo Payments).
 *
 * Returns the authenticated user's billing payments from Dodo. Only succeeded
 * payments are surfaced. Each row carries everything the UI needs to render a
 * list and a "Download invoice" button.
 *
 * Dodo payments include an `invoice_url` (hosted PDF URL); the separate
 * `/invoices/[id]/pdf` endpoint redirects to that URL for ownership-verified
 * access.
 *
 * Response shape mirrors the Paddle version so the frontend keeps working:
 *   { invoices: Array<{ id, invoiceNumber, status, billedAt, currencyCode,
 *                       grandTotal, origin, subscriptionId }> }
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getDodo } from '@/lib/billing/dodo-server';
import type { PaymentListResponse } from 'dodopayments/resources/payments';

export const dynamic = 'force-dynamic';

const MAX_PAGE_SIZE = 50;

export async function GET() {
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
            .single();

        if (!sub?.dodo_customer_id) {
            return NextResponse.json({ invoices: [] });
        }

        const dodo = getDodo();
        const collected: PaymentListResponse[] = [];

        for await (const payment of dodo.payments.list({
            customer_id: sub.dodo_customer_id,
            status: 'succeeded',
            page_size: MAX_PAGE_SIZE,
        })) {
            collected.push(payment);
            if (collected.length >= MAX_PAGE_SIZE) break;
        }

        const invoices = collected.map((p) => ({
            // id matches what the PDF route expects (payment_id)
            id: p.payment_id,
            // Dodo uses invoice_id (alphanumeric) as the invoice number
            invoiceNumber: p.invoice_id ?? null,
            status: p.status ?? 'succeeded',
            billedAt: p.created_at,
            currencyCode: p.currency,
            // total_amount is in smallest currency unit (cents); match Paddle's grandTotal
            grandTotal: p.total_amount,
            // Dodo doesn't have an 'origin' field; set to 'subscription' if subscription_id present
            origin: p.subscription_id ? 'subscription' : 'web',
            subscriptionId: p.subscription_id ?? null,
            // Include invoice_url so the PDF endpoint can redirect to it
            invoiceUrl: p.invoice_url ?? null,
        }));

        return NextResponse.json({ invoices });
    } catch (err: any) {
        console.error('[Invoices] Error:', err);
        return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
    }
}
