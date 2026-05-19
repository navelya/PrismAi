/**
 * Invoice PDF redirect.
 *
 * Paddle returns a short-lived signed URL for the invoice PDF. We require the
 * caller to own the underlying transaction (verified by matching customer_id
 * against the user's subscription) before redirecting, so links can't be
 * shared to leak invoices.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getPaddle } from '@/lib/billing/paddle-server';

export const dynamic = 'force-dynamic';

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function GET(_request: Request, ctx: RouteContext) {
    try {
        const { id } = await ctx.params;
        if (!id) {
            return NextResponse.json({ error: 'Missing transaction id' }, { status: 400 });
        }

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
            return NextResponse.json({ error: 'No customer record' }, { status: 404 });
        }

        const paddle = getPaddle();
        const tx = await paddle.transactions.get(id);

        // Ownership check: the transaction must belong to this user's Paddle
        // customer record. Otherwise the user could enumerate other people's
        // invoice IDs.
        if (tx.customerId !== sub.paddle_customer_id) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const pdf = await paddle.transactions.getInvoicePDF(id);
        if (!pdf.url) {
            return NextResponse.json({ error: 'Invoice not available' }, { status: 404 });
        }

        return NextResponse.redirect(pdf.url);
    } catch (err: any) {
        console.error('[Invoice PDF] Error:', err);
        return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
    }
}
