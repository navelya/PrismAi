/**
 * Subscription resume endpoint.
 *
 * Clears a scheduled cancellation. The subscription stays on its current plan
 * and continues to renew. Calls `subscriptions.update` with
 * `scheduledChange: null` — Paddle fires `subscription.updated` and the
 * webhook flips `cancel_at_period_end` back to false.
 *
 * This is NOT for resuming paused subscriptions (use `paddle.subscriptions.resume`
 * for that). We don't currently expose pause in the UI.
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
            .select('paddle_subscription_id, cancel_at_period_end')
            .eq('user_id', user.id)
            .single();

        if (subErr || !sub?.paddle_subscription_id) {
            return NextResponse.json(
                { error: 'No active Paddle subscription' },
                { status: 404 }
            );
        }

        if (!sub.cancel_at_period_end) {
            return NextResponse.json({ error: 'Nothing to resume' }, { status: 409 });
        }

        const paddle = getPaddle();
        await paddle.subscriptions.update(sub.paddle_subscription_id, {
            scheduledChange: null,
        });

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        console.error('[Resume Subscription] Error:', err);
        return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
    }
}
