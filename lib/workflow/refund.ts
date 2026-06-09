import { createServiceClient } from '@/lib/supabase/service';
import { clampIterations } from '@/lib/billing/cost';

/**
 * Refund a single failed fan-out iteration. The upfront debit charged
 * cost_by_node[nodeId] (which already includes the iteration multiplier), so one
 * iteration's share is that value / iterations. Sourced from the persisted
 * execution_debit ledger metadata so it can't drift from what was charged.
 * Idempotent per (execution, node, prediction_index) via the credit_tokens key.
 */
export async function refundFailedIteration(
  supabase: ReturnType<typeof createServiceClient>,
  executionId: string,
  nodeId: string,
  predictionIndex: number
): Promise<void> {
  // The execution_debit ledger row holds user_id + the per-node cost map.
  const { data: debitRow } = await supabase
    .from('token_ledger')
    .select('user_id, metadata')
    .eq('execution_id', executionId)
    .eq('reason', 'execution_debit')
    .maybeSingle();
  if (!debitRow?.user_id) return; // nothing was charged (cost 0) → nothing to refund

  const costByNode = (debitRow.metadata as any)?.cost_by_node ?? {};
  const nodeTotal = Number(costByNode[nodeId]);
  if (!Number.isFinite(nodeTotal) || nodeTotal <= 0) return;

  // Resolve this node's iteration count from the execution graph to divide correctly.
  const { data: exec } = await supabase
    .from('executions')
    .select('graph_json')
    .eq('id', executionId)
    .single();
  const graphNodes = (exec?.graph_json as any)?.nodes ?? [];
  const node = graphNodes.find((n: any) => n.id === nodeId);
  const iterations = clampIterations(node?.data?.config?.iterations ?? node?.config?.iterations);
  const perIteration = nodeTotal / iterations;
  if (!(perIteration > 0)) return;

  const { error } = await supabase.rpc('credit_tokens', {
    p_user_id: debitRow.user_id,
    p_amount: perIteration,
    p_reason: 'execution_partial_refund',
    p_idempotency_key: `refund:${executionId}:${nodeId}:${predictionIndex}`,
    p_execution_id: executionId,
    p_stripe_event_id: null,
    p_metadata: { node_id: nodeId, prediction_index: predictionIndex, reason: 'iteration_failed' },
  });
  if (error) {
    // Don't fail the caller over a refund hiccup — log and continue so the node
    // can still finalize. A missed refund is recoverable; a stuck node is not.
    // Shared by both the Replicate webhook and the synchronous dispatch path.
    console.error(`[Billing/PartialRefund] Partial refund failed for ${nodeId}#${predictionIndex}:`, error.message);
  }
}
