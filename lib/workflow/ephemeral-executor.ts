/**
 * Workflow Engine v2 — Ephemeral Node Executor (post-refactor).
 *
 * Executes ephemeral nodes by calling serverRegistry[type].executor directly.
 * Each plugin's server executor is responsible for uploading any binary
 * outputs it produces. This wrapper only handles graph loading, input
 * gathering, and writing the final node_results row.
 */
import { createServiceClient } from '@/lib/supabase/service';
import { serverRegistry } from '@/lib/nodes/core/server-registry';
import { GraphJson, NodeState } from './types-v2';
import {
  NodeResultType,
  coerceResultDataArray,
  getPrimaryInputValue,
  inferResultTypeFromValue,
  normalizeNodeResultType,
  toResultDataForType,
} from './result-format';
import type { ExecutionContext, NodeExecutionResult } from '@/lib/nodes/types';

export async function executeEphemeralNode(
  executionId: string,
  nodeId: string,
  sessionId?: string,
  providedInputs?: Record<string, any>,
): Promise<{ success: boolean; result_type?: NodeResultType; result_data?: any[]; error?: string }> {
  console.log(`[EphemeralExecutor] Processing node ${nodeId} in execution ${executionId} (Session: ${sessionId})`);

  const supabase = createServiceClient();
  let currentSessionId = sessionId;

  try {
    const { data: execution, error: fetchError } = await supabase
      .from('executions').select('*').eq('id', executionId).single();
    if (fetchError || !execution) throw new Error(`Execution ${executionId} not found`);

    if (!currentSessionId) currentSessionId = execution.session_id;

    let graph: GraphJson = execution.graph_json;
    if (!graph) {
      const { data: session } = await supabase
        .from('sessions').select('canvas_state').eq('id', execution.session_id).single();
      graph = session?.canvas_state;
    }
    if (!graph) throw new Error(`Graph not found for execution ${executionId}`);

    let inputs = providedInputs;
    if (!inputs) {
      const { data: results } = await supabase
        .from('node_results').select('*').eq('execution_id', executionId);
      const nodeStates: Record<string, any> = {};
      (results || []).forEach((r: any) => {
        nodeStates[r.node_id] = {
          status: r.status,
          result_type: r.result_type,
          result_data: r.result_data,
          error: r.error,
        };
      });
      inputs = buildNodeInputs(nodeId, graph, nodeStates);
    }

    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found in graph`);

    const def = serverRegistry[node.type];
    if (!def) throw new Error(`No server registry entry for node type: ${node.type}`);

    // The plugin executor sees the same shape it used to — `node.data` is the
    // node's full data envelope (containing `config`, `label`, etc.). Plugins
    // historically read either `properties.config` or `properties` directly,
    // so we pass `node.data` as the first arg, matching the previous
    // EPHEMERAL_HANDLERS convention.
    const config = (node.data as any)?.config ?? node.data ?? {};
    const ctx: ExecutionContext = {
      workflowId: (graph as any).id || '',
      executionId,
      sessionId: currentSessionId,
      userId: execution.user_id,
      nodeId,
      data: {},
    };

    console.log(`[EphemeralExecutor] Executing ${node.type} with inputs:`, Object.keys(inputs || {}));

    const result: NodeExecutionResult = await def.executor(config, inputs || {}, ctx);

    if (!result?.success) {
      throw new Error(result?.error || 'Executor returned failure');
    }

    // Infer result_type and result_data from the executor's `data` payload.
    let resultType: NodeResultType = 'json';
    let resultData: any[] = [];

    if (result.result_type) {
      // Executor declared its type explicitly (e.g. `collect`, whose output
      // type is dynamic and can't be recovered from item shape — a video URL
      // string would otherwise be mis-typed as text). Trust it; just flatten
      // media items down to their URL strings to match the stored shape.
      resultType = normalizeNodeResultType(result.result_type);
      const arr = Array.isArray(result.data)
        ? result.data
        : result.data == null
          ? []
          : [result.data];
      resultData = arr.map((d: any) =>
        d && typeof d === 'object' && typeof d.url === 'string' ? d.url : d,
      );
    } else if (Array.isArray(result.data)) {
      // Conventional plugin shape: array of items (ImageObject[], string[], etc.).
      const first = result.data[0];
      if (first && typeof first === 'object' && typeof (first as any).url === 'string') {
        resultType = 'image';
        resultData = result.data.map((d: any) => d.url);
      } else if (typeof first === 'string') {
        resultType = 'text';
        resultData = result.data;
      } else {
        resultType = inferResultTypeFromValue(result.data);
        resultData = toResultDataForType(resultType, result.data);
      }
    } else if (typeof result.data === 'string') {
      resultType = 'text';
      resultData = [result.data];
    } else if (result.data !== null && result.data !== undefined) {
      resultType = inferResultTypeFromValue(result.data);
      resultData = toResultDataForType(resultType, result.data);
    }

    const { error: updateError } = await supabase.from('node_results').upsert({
      execution_id: executionId,
      node_id: nodeId,
      session_id: currentSessionId,
      status: 'completed',
      result_type: resultType,
      result_data: resultData,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'execution_id,node_id' });

    if (updateError) throw new Error(`Failed to update node state: ${updateError.message}`);

    console.log(`[EphemeralExecutor] Node ${nodeId} completed`);
    return { success: true, result_type: resultType, result_data: resultData };
  } catch (error) {
    // Deliberately do NOT write a 'failed' status to this (ephemeral) node's
    // row. Ephemeral nodes never show an error status — the caller
    // (dispatchEphemeralNode → handleNodeFailure) owns failure handling and
    // attributes the error to the nearest non-ephemeral consumer instead.
    // Writing 'failed' here would flash an error badge on the ephemeral node
    // before the orchestrator resets it to 'idle'.
    console.error(`[EphemeralExecutor] Error in node ${nodeId}:`, error);
    return { success: false, error: error instanceof Error ? error.message : 'Internal server error' };
  }
}

function buildNodeInputs(
  nodeId: string,
  graph: GraphJson,
  nodeStates: Record<string, NodeState>,
): Record<string, any> {
  const inputs: Record<string, any> = {};
  const incomingEdges = (graph.edges || []).filter((edge) => edge.target === nodeId);
  // `collect` aggregates whole upstream arrays, not just each upstream's
  // primary item. Deliver every edge's FULL result_data under its edge id so
  // the collect executor can flatten all items (its OFF/default mode).
  const isCollectTarget = graph.nodes.find((n) => n.id === nodeId)?.type === 'collect';
  for (const edge of incomingEdges) {
    const sourceNodeState = nodeStates[edge.source];
    if (sourceNodeState?.status === 'completed') {
      const inputKey = edge.targetHandle || edge.sourceHandle || 'image';
      let value: any;
      if (sourceNodeState.result_type && sourceNodeState.result_data) {
        value = getPrimaryInputValue(
          normalizeNodeResultType(sourceNodeState.result_type),
          sourceNodeState.result_data,
        );
      } else if ((sourceNodeState as any).result_url) {
        value = (sourceNodeState as any).result_url;
      } else {
        value = (sourceNodeState as any).output;
      }
      if (isCollectTarget && edge.id) {
        // Full array for collect; falls back to the primary value's shape.
        inputs[inputKey] = value;
        inputs[edge.id] = sourceNodeState.result_data != null
          ? coerceResultDataArray(sourceNodeState.result_data)
          : value;
        continue;
      }
      // Key by BOTH the target handle id AND the edge id. Compositor layers
      // store `layer.sourceHandleId = edge.id` because every layer edge shares
      // the same static `layers` target handle, so per-edge id is the only way
      // to disambiguate which upstream value belongs to which layer. Single-
      // input nodes (Blur reads `inputs.image`) are unaffected — they read by
      // handle name. Mirrors the browser-side input map in
      // lib/hooks/use-node-auto-compute.ts.
      inputs[inputKey] = value;
      if (edge.id) inputs[edge.id] = value;
    }
  }
  return inputs;
}
