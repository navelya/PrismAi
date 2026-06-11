import { createServiceClient } from '@/lib/supabase/service';
import { checkAndDispatchChildren } from '@/lib/workflow/orchestrator';
import {
  NodeResultType,
  isMediaResultType,
  toResultDataForType,
} from '@/lib/workflow/result-format';
import { resolveNodeOutputWireTypeFromGraph } from '@/lib/workflow/output-type';
import { mirrorMediaToStorage } from '@/lib/workflow/media-mirror';

function isReplicateHostedUrl(value: string): boolean {
  return value.includes('replicate.delivery') || value.includes('replicate.com');
}

/**
 * Provider-agnostic completion for a SINGLE (non-fan-out) node. Idempotent under
 * concurrent triggers (a late webhook + the cron sweep): media is mirrored, then
 * `claim_node_completion` atomically claims the running->terminal transition and
 * writes the result. Only the caller that WINS the claim dispatches children, so
 * children fire exactly once no matter how many triggers race.
 *
 * `outputs` is the RAW provider output (already normalized to {url}/{text} shape
 * by the adapter's poll/normalize); this function owns mirroring + persistence.
 */
export async function completeJob(args: {
  executionId: string;
  nodeId: string;
  providerId: string;
  providerJobId: string;
  outcome: { status: 'completed' | 'failed'; outputs?: any; error?: string | null };
  baseUrl: string;
}): Promise<void> {
  const { executionId, nodeId, providerId, providerJobId, outcome, baseUrl } = args;
  const supabase = createServiceClient();

  const { data: executionCtx } = await supabase
    .from('executions')
    .select('session_id, graph_json, sessions(user_id)')
    .eq('id', executionId)
    .single();

  const storageUserId = (executionCtx?.sessions as any)?.user_id || 'unknown_user';
  const storageSessionId = executionCtx?.session_id || 'unknown_session';

  // ── Failure ──────────────────────────────────────────────────────────────
  if (outcome.status === 'failed') {
    const won = await supabase.rpc('claim_node_completion', {
      p_execution_id: executionId,
      p_node_id: nodeId,
      p_status: 'failed',
      p_result_type: null,
      p_result_data: null,
      p_error: outcome.error || 'Generation failed',
      p_provider_id: providerId,
      p_provider_job_id: providerJobId,
    });
    if (won.data === true) {
      await checkAndDispatchChildren(executionId, nodeId, baseUrl);
    }
    return;
  }

  // ── Success ──────────────────────────────────────────────────────────────
  const outputType: NodeResultType = await resolveNodeOutputWireTypeFromGraph(
    supabase,
    executionCtx?.graph_json,
    nodeId
  );
  let resultData = toResultDataForType(outputType, outcome.outputs);

  let failError: string | null = null;
  try {
    if (isMediaResultType(outputType)) {
      resultData = await mirrorMediaToStorage(
        supabase,
        resultData.filter((item): item is string => typeof item === 'string'),
        outputType,
        storageUserId,
        storageSessionId,
        nodeId
      );
    }
  } catch (uploadErr) {
    failError = `Media upload to storage failed: ${
      uploadErr instanceof Error ? uploadErr.message : 'Unknown error'
    }`;
  }

  if (!failError && resultData.some((item) => typeof item === 'string' && isReplicateHostedUrl(item))) {
    failError = 'Media could not be permanently stored. Please re-run the node.';
  }

  const won = await supabase.rpc('claim_node_completion', {
    p_execution_id: executionId,
    p_node_id: nodeId,
    p_status: failError ? 'failed' : 'completed',
    p_result_type: failError ? null : outputType,
    p_result_data: failError ? null : resultData,
    p_error: failError,
    p_provider_id: providerId,
    p_provider_job_id: providerJobId,
  });

  if (won.data === true) {
    await checkAndDispatchChildren(executionId, nodeId, baseUrl);
  }
}
