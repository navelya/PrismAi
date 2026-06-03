/**
 * Workflow Engine v2 - Cancel Execution Endpoint
 *
 * Cancellation policy (intentional — see the design discussion):
 *   - PENDING nodes (never dispatched → never billed by Replicate) are stopped
 *     (set to 'idle') and the EXACT credits charged for them are refunded.
 *   - RUNNING nodes (in-flight on Replicate → already billed) are LEFT ALONE.
 *     We do NOT call Replicate's cancel API: we've already paid, so the user
 *     should get the result. Their webhooks still land and save the output;
 *     the orchestrator's cancelled-gate just stops anything downstream from
 *     launching.
 *
 * The execution is moved to a terminal 'cancelled' status. If in-flight nodes
 * remain, the execution stays 'cancelled' while they drain and is finalized
 * (result_data + cleanup) by updateExecutionFinalStatus once the last one
 * settles.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getAuthenticatedUser } from '@/lib/api/auth';
import { updateExecutionFinalStatus } from '@/lib/workflow/orchestrator';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const authedUserId = auth.user.id;

    const body = await request.json();
    const executionId: string | undefined = body.execution_id;
    if (!executionId) {
      return NextResponse.json({ error: 'Missing execution_id' }, { status: 400 });
    }

    const supabase = createServiceClient();

    const { data: execution } = await supabase
      .from('executions')
      .select('id, session_id, status')
      .eq('id', executionId)
      .single();

    if (!execution) {
      return NextResponse.json({ error: 'Execution not found' }, { status: 404 });
    }

    // ── Access check (mirrors /api/executions/start): canvas owner OR an
    //    editor collaborator. The service client bypasses RLS, so we verify
    //    explicitly.
    {
      const { data: canvasRow } = await supabase
        .from('sessions')
        .select('user_id, canvas_session_id')
        .eq('id', execution.session_id)
        .single();
      const isOwner = canvasRow && !canvasRow.canvas_session_id && canvasRow.user_id === authedUserId;
      if (!isOwner) {
        const { data: collab } = await supabase
          .from('session_collaborators')
          .select('role')
          .eq('session_id', execution.session_id)
          .eq('user_id', authedUserId)
          .single();
        if (!collab || collab.role !== 'editor') {
          return NextResponse.json({ error: 'No edit access' }, { status: 403 });
        }
      }
    }

    // Idempotent: already finished → nothing to cancel.
    if (TERMINAL_STATUSES.has(execution.status)) {
      return NextResponse.json({ success: true, status: execution.status, alreadyTerminal: true });
    }

    // 1. Set the cancellation gate. The orchestrator reads this in
    //    checkAndDispatchChildren and stops launching new nodes.
    await supabase
      .from('executions')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', executionId);

    // 2. Stop only still-pending nodes. CONDITIONAL on status='pending' so a
    //    node that just flipped to 'running' (raced with a dispatch) is never
    //    clobbered — it stays in-flight and finishes normally.
    const { data: cancelledRows, error: cancelRowsError } = await supabase
      .from('node_results')
      .update({ status: 'idle', updated_at: new Date().toISOString() })
      .eq('execution_id', executionId)
      .eq('status', 'pending')
      .select('node_id');

    if (cancelRowsError) {
      console.error(`[Execution/Cancel] Failed to idle pending nodes for ${executionId}:`, cancelRowsError);
    }
    const cancelledNodeIds = (cancelledRows || []).map((r) => r.node_id);

    // 3. Partial refund — credit back the EXACT cost of the nodes we just
    //    stopped (they never dispatched, so they cost $0 on Replicate).
    //    In-flight running nodes keep their charge. Idempotent on the
    //    cancel_refund:<id> ledger key, and distinct from the failure-path
    //    refund:<id> key so the two can never double up.
    if (cancelledNodeIds.length > 0) {
      const { data: debitRow } = await supabase
        .from('token_ledger')
        .select('user_id, metadata')
        .eq('execution_id', executionId)
        .eq('reason', 'execution_debit')
        .maybeSingle();

      const costByNode: Record<string, number> = (debitRow?.metadata as any)?.cost_by_node || {};
      const refundUserId = debitRow?.user_id;
      let refundAmount = 0;
      for (const nid of cancelledNodeIds) {
        const c = Number(costByNode[nid]);
        if (Number.isFinite(c) && c > 0) refundAmount += c;
      }

      if (refundUserId && refundAmount > 0) {
        const { error: refundError } = await supabase.rpc('credit_tokens', {
          p_user_id: refundUserId,
          p_amount: refundAmount,
          p_reason: 'execution_refund',
          p_idempotency_key: `cancel_refund:${executionId}`,
          p_execution_id: executionId,
          p_metadata: {
            refund_reason: 'execution_cancelled',
            node_ids: cancelledNodeIds,
            amount: refundAmount,
          },
        });
        if (refundError) {
          console.error(`[Execution/Cancel] Partial refund failed for ${executionId}:`, refundError);
        } else {
          console.log(
            `[Execution/Cancel] Refunded ${refundAmount} credits for ${cancelledNodeIds.length} cancelled node(s) in ${executionId}`
          );
        }
      }
    }

    // 4. Finalize. If no node is left running, this stamps the terminal
    //    'cancelled' status (+ result_data of whatever finished, + ephemeral
    //    cleanup) right now. If in-flight nodes remain, it no-ops and their
    //    webhooks finalize later via the cancelled-gate.
    await updateExecutionFinalStatus(executionId);

    return NextResponse.json({
      success: true,
      status: 'cancelled',
      cancelledNodes: cancelledNodeIds.length,
    });
  } catch (error) {
    console.error('[Execution/Cancel] Unexpected error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
