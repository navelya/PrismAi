/**
 * Invoice list endpoint.
 *
 * Returns the authenticated user's billing transactions from Paddle. Only
 * billed / paid transactions are surfaced — drafts and ready (unpaid) ones
 * aren't shown. Each row carries everything the UI needs to render a list and
 * a "Download invoice" button.
 *
 * Invoice PDF URLs are issued via a separate endpoint (see invoices/[id]/pdf)
 * because Paddle returns a short-lived signed URL on a per-request basis.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getPaddle } from '@/lib/billing/paddle-server';

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
            .select('paddle_customer_id')
            .eq('user_id', user.id)
            .single();

        if (!sub?.paddle_customer_id) {
            return NextResponse.json({ invoices: [] });
        }

        const paddle = getPaddle();
        const collection = paddle.transactions.list({
            customerId: [sub.paddle_customer_id],
            status: ['billed', 'paid', 'completed'],
            perPage: MAX_PAGE_SIZE,
            orderBy: 'billed_at[DESC]',
        });

        const page = await collection.next();
        const invoices = page.map((tx) => ({
            id: tx.id,
            invoiceNumber: tx.invoiceNumber,
            status: tx.status,
            billedAt: tx.billedAt ?? tx.createdAt,
            currencyCode: tx.details?.totals?.currencyCode ?? tx.currencyCode,
            grandTotal: tx.details?.totals?.grandTotal ?? null,
            origin: tx.origin,
            subscriptionId: tx.subscriptionId,
        }));

        return NextResponse.json({ invoices });
    } catch (err: any) {
        console.error('[Invoices] Error:', err);
        return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
    }
}
