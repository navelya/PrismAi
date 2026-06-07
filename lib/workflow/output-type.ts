import { createServiceClient } from '@/lib/supabase/service';
import { NodeResultType, normalizeNodeResultType } from './result-format';

/**
 * Resolve a node's output wire type (image | video | audio | 3d | text | json)
 * from its model's `ai_models.outputs_schema`. Shared by the Replicate webhook
 * and the dispatcher's fan-out finalize so both stamp node_results.result_type
 * identically. Falls back to 'json' when the node carries no resolvable model.
 */
export async function resolveNodeOutputWireTypeFromGraph(
  supabase: ReturnType<typeof createServiceClient>,
  executionGraph: any,
  nodeId: string
): Promise<NodeResultType> {
  const graphNodes = executionGraph?.nodes;
  const node = Array.isArray(graphNodes) ? graphNodes.find((n: any) => n?.id === nodeId) : null;
  const modelId = node?.data?.config?.model_id ?? node?.data?.model_id;

  if (!modelId) return 'json';

  const { data: model } = await supabase
    .from('ai_models')
    .select('outputs_schema')
    .eq('id', modelId)
    .single();

  const handleType = model?.outputs_schema?.handles?.[0]?.type;
  return normalizeNodeResultType(handleType);
}

/**
 * As above, but loads the execution graph first. Convenience for callers that
 * only hold the executionId (e.g. the dispatcher).
 */
export async function resolveNodeOutputWireType(
  supabase: ReturnType<typeof createServiceClient>,
  executionId: string,
  nodeId: string
): Promise<NodeResultType> {
  const { data: exec } = await supabase
    .from('executions')
    .select('graph_json')
    .eq('id', executionId)
    .single();
  return resolveNodeOutputWireTypeFromGraph(supabase, exec?.graph_json, nodeId);
}
