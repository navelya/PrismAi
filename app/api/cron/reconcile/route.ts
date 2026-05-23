/**
 * Cron: Credits reconciliation safety net
 *
 * Runs nightly. Two responsibilities:
 *
 *   1. Refund stuck failed executions. The orchestrator calls refund_tokens
 *      on failure, but if that path crashed (Next.js function killed mid-write,
 *      DB hiccup, etc.), the user got charged for a run that never produced a
 *      result. This catches them and refunds.
 *
 *   2. Audit balance drift. profiles.token_balance is a cache; the ledger
 *      is the source of truth. They must always agree. If they drift, that's
 *      a bug — log it loudly and surface in the response so monitoring can
 *      alert. We do NOT auto-correct: silent fixing would hide the bug.
 */
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return new Response('Unauthorized', { status: 401 });
    }

    const startedAt = Date.now();
    const supabase = createServiceClient();

    try {
        // ── (1) Stuck failed executions ───────────────────────────────────────
        const { data: orphans, error: orphanError } = await supabase
            .rpc('find_unrefunded_failed_executions', { p_limit: 500 });

        if (orphanError) {
            console.error('[Cron/Reconcile] find_unrefunded_failed_executions failed:', orphanError);
        }

        let refundedCount = 0;
        const refundFailures: { execution_id: string; error: string }[] = [];

        for (const row of orphans || []) {
            const executionId = row.execution_id;
            const { error: refundError } = await supabase.rpc('refund_tokens', {
                p_execution_id: executionId,
                p_reason: 'reconcile_orphaned_failure',
            });

            if (refundError) {
                refundFailures.push({ execution_id: executionId, error: refundError.message });
                console.error(`[Cron/Reconcile] Refund failed for ${executionId}:`, refundError.message);
            } else {
                refundedCount++;
                console.log(`[Cron/Reconcile] Refunded orphaned failed execution ${executionId}`);
            }
        }

        // ── (2) Balance drift audit ───────────────────────────────────────────
        const { data: drifts, error: driftError } = await supabase
            .rpc('audit_balance_drift');

        if (driftError) {
            console.error('[Cron/Reconcile] audit_balance_drift failed:', driftError);
        }

        const driftCount = drifts?.length ?? 0;
        if (driftCount > 0) {
            // Loud log — this should never happen. If it does, investigate
            // before doing anything else.
            console.error(
                `[Cron/Reconcile] 🚨 BALANCE DRIFT detected for ${driftCount} user(s):`,
                JSON.stringify(drifts, null, 2)
            );
        }

        // ── (3) Top-up bucket drift audit ─────────────────────────────────────
        const { data: topupDrifts, error: topupDriftError } = await supabase
            .rpc('audit_topup_drift');

        if (topupDriftError) {
            console.error('[Cron/Reconcile] audit_topup_drift failed:', topupDriftError);
        }

        const topupDriftCount = topupDrifts?.length ?? 0;
        if (topupDriftCount > 0) {
            console.error(
                `[Cron/Reconcile] 🚨 TOPUP DRIFT detected for ${topupDriftCount} user(s):`,
                JSON.stringify(topupDrifts, null, 2)
            );
        }

        const elapsedMs = Date.now() - startedAt;
        console.log(
            `[Cron/Reconcile] Done. Orphan refunds: ${refundedCount}/${orphans?.length ?? 0}, ` +
            `drift users: ${driftCount}, topup drift users: ${topupDriftCount}, elapsed: ${elapsedMs}ms`
        );

        return NextResponse.json({
            success: true,
            orphansFound: orphans?.length ?? 0,
            orphansRefunded: refundedCount,
            refundFailures: refundFailures.slice(0, 50),
            driftCount,
            drifts: drifts?.slice(0, 50) ?? [],
            topupDriftCount,
            topupDrifts: topupDrifts?.slice(0, 50) ?? [],
            elapsedMs,
        });
    } catch (error: any) {
        console.error('[Cron/Reconcile] Unexpected error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
