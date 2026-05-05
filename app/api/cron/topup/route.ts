/**
 * Cron: Monthly token top-up
 *
 * Runs daily. For every active subscription whose next_topup_at is in the
 * past, calls the monthly_topup(user_id) RPC. The RPC is idempotent on the
 * scheduled date, so a delayed cron run never double-grants and never
 * skips a period.
 *
 * Top-up rule: balance := MAX(balance, plan.monthly_floor). Users with
 * more than the floor (e.g. they bought credits) are not topped up.
 */
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

const BATCH_LIMIT = 1000;

export async function GET(request: Request) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return new Response('Unauthorized', { status: 401 });
    }

    const startedAt = Date.now();
    const supabase = createServiceClient();

    try {
        const { data: due, error: fetchError } = await supabase
            .from('subscriptions')
            .select('user_id, plan_id, next_topup_at')
            .eq('status', 'active')
            .lte('next_topup_at', new Date().toISOString())
            .limit(BATCH_LIMIT);

        if (fetchError) {
            console.error('[Cron/Topup] Failed to fetch due subscriptions:', fetchError);
            return NextResponse.json({ error: fetchError.message }, { status: 500 });
        }

        if (!due || due.length === 0) {
            return NextResponse.json({ message: 'No subscriptions due for top-up.', processed: 0 });
        }

        console.log(`[Cron/Topup] Found ${due.length} subscription(s) due for top-up.`);

        let succeeded = 0;
        let failed = 0;
        const failures: { user_id: string; error: string }[] = [];

        for (const sub of due) {
            const { error: rpcError } = await supabase.rpc('monthly_topup', {
                p_user_id: sub.user_id,
            });

            if (rpcError) {
                failed++;
                failures.push({ user_id: sub.user_id, error: rpcError.message });
                console.error(`[Cron/Topup] monthly_topup failed for ${sub.user_id}:`, rpcError.message);
            } else {
                succeeded++;
            }
        }

        const elapsedMs = Date.now() - startedAt;
        console.log(`[Cron/Topup] Done. Succeeded: ${succeeded}, failed: ${failed}, elapsed: ${elapsedMs}ms`);

        return NextResponse.json({
            success: true,
            due: due.length,
            succeeded,
            failed,
            elapsedMs,
            failures: failures.slice(0, 50),
        });
    } catch (error: any) {
        console.error('[Cron/Topup] Unexpected error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
