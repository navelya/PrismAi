/**
 * Subscription resume endpoint (Dodo Payments).
 *
 * Clears a scheduled cancellation. The subscription stays on its current plan
 * and continues to renew. Calls `subscriptions.update({ cancel_at_next_billing_date: false })`.
 * Dodo fires `subscription.updated` and the webhook flips `cancel_at_period_end`
 * back to false.
 *
 * This is for un-scheduling a period-end cancellation, not for resuming paused
 * subscriptions.
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
            .select('dodo_subscription_id, cancel_at_period_end')
            .eq('user_id', user.id)
            .single();

        if (subErr || !sub?.dodo_subscription_id) {
            return NextResponse.json(
                { error: 'No active Dodo subscription' },
                { status: 404 }
            );
        }

        if (!sub.cancel_at_period_end) {
            return NextResponse.json({ error: 'Nothing to resume' }, { status: 409 });
        }

        const dodo = getDodo();
        await dodo.subscriptions.update(sub.dodo_subscription_id, {
            cancel_at_next_billing_date: false,
        });

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        console.error('[Resume Subscription] Error:', err);
        return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
    }
}
