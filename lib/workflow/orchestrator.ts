/**
 * Workflow Engine v2 - DAG Orchestrator
 * Core reactive engine that resolves dependencies and triggers child nodes
 */

import { createServiceClient } from '@/lib/supabase/service';
import { GraphJson, NodeConfig } from './types-v2';
import { dispatchNode } from './dispatch-v2';
import { coerceResultDataArray, getPrimaryInputValue, normalizeNodeResultType } from './result-format';
import { serverRegistry } from '@/lib/nodes/core/server-registry';

const EPHEMERAL_BUCKET = 'workflow-ephemeral-tmp';

// Module-scoped cache for ai_models.inputs_schema array-input keys.
// Schema rows can be edited from the admin panel, so we expire entries on a
// short TTL — high enough to absorb the bursty per-edge lookups inside a
// single dispatch (same model is hit N times in one buildInputsFromParents
// call) yet low enough that admin edits propagate without a server restart.
const ARRAY_INPUT_KEYS_TTL_MS = 60_000;
const aiArrayInputKeysCache = new Map<
  string,
  { keys: Set<string>; expiresAt: number }
>();

export async function getAiArrayInputKeys(
  supabase: ReturnType<typeof createServiceClient>,
  node: NodeConfig | undefined
): Promise<Set<string>> {
  if (!node || node.type !== 'ai_generator') return new Set<string>();

  const modelId = node.data?.config?.model_id ?? node.data?.model_id;
  if (!modelId) return new Set<string>();

  const now = Date.now();
  const cached = aiArrayInputKeysCache.get(modelId);
  if (cached && cached.expiresAt > now) return cached.keys;

  const { data: model } = await supabase
    .from('ai_models')
    .select('inputs_schema')
    .eq('id', modelId)
    .single();

  const handles = model?.inputs_schema?.handles || [];
  const keys = new Set<string>(
    handles
      .filter((h: any) => h?.is_array)
      .map((h: any) => h?.api_mapping_key)
      .filter(Boolean)
  );
  aiArrayInputKeysCache.set(modelId, {
    keys,
    expiresAt: now + ARRAY_INPUT_KEYS_TTL_MS,
  });
  return keys;
}

/**
 * Triggered when a node completes. Checks if its children are ready and dispatches them.
 * This is the core "Chain Reaction" logic.
 */
export async function checkAndDispatchChildren(
  executionId: string,
  completedNodeId: string,
  baseUrl?: string
): Promise<void> {
  console.log(`[Orchestrator] Node ${completedNodeId} finished. Checking for children in execution ${executionId}...`);
  
  const supabase = createServiceClient();
  
  try {
    // 1. Fetch the immutable graph snapshot for this execution
    const { data: execution, error: execError } = await supabase
      .from('executions')
      .select('graph_json, session_id')
      .eq('id', executionId)
      .single();
      
    if (execError || !execution) {
      console.error(`[Orchestrator] Failed to fetch execution snapshot:`, execError);
      return;
    }
    
    const graph: GraphJson = execution.graph_json as any;
    const sessionId = execution.session_id;
    
    // 2. Identify all direct successors (children) of the completed node
    const outgoingEdges = (graph.edges || []).filter(edge => edge.source === completedNodeId);
    
    if (outgoingEdges.length === 0) {
      console.log(`[Orchestrator] Node ${completedNodeId} has no children. Checking if workflow is finished.`);
      await updateExecutionFinalStatus(executionId);
      return;
    }
    
    // 3. For each successor, check if all ITS parents are completed
    const successorIds = Array.from(new Set(outgoingEdges.map(edge => edge.target)));

    console.log(`[Orchestrator] Found ${successorIds.length} potential successors: ${successorIds.join(', ')}`);

    // Collect every parent id required across all successors so we can fetch
    // their results in ONE query (status + result_data) instead of N+1 round-trips.
    const allParentIds = new Set<string>();
    const parentIdsByChild = new Map<string, string[]>();
    for (const childId of successorIds) {
      const parentIds = (graph.edges || [])
        .filter(edge => edge.target === childId)
        .map(edge => edge.source);
      parentIdsByChild.set(childId, parentIds);
      parentIds.forEach(pid => allParentIds.add(pid));
    }

    // Single batched query — readiness check AND input building share this result map.
    // Scoped by execution_id (NOT session_id) so prior-run results never leak in.
    const { data: parentResultsRaw, error: resultsError } = await supabase
      .from('node_results')
      .select('node_id, status, result_type, result_data')
      .eq('execution_id', executionId)
      .in('node_id', Array.from(allParentIds));

    if (resultsError) {
      console.error(`[Orchestrator] Failed to batch-fetch parent results:`, resultsError);
      return;
    }

    const parentResultsByNode = new Map<string, { status: string; result_type: any; result_data: any }>();
    (parentResultsRaw || []).forEach(r => {
      parentResultsByNode.set(r.node_id, r);
    });

    for (const childId of successorIds) {
      const childNode = graph.nodes.find(n => n.id === childId);
      if (!childNode) continue;

      const parentIds = parentIdsByChild.get(childId) || [];
      const allParentsCompleted = parentIds.every(pid =>
        parentResultsByNode.get(pid)?.status === 'completed'
      );

      if (allParentsCompleted) {
        console.log(`[Orchestrator] ✅ All parents completed for child ${childId}. DISPATCHING.`);
        const inputs = await buildInputsFromParents(childId, graph, parentResultsByNode);
        await dispatchNode(executionId, childId, childNode, inputs, baseUrl, sessionId);
      } else {
        const incomplete = parentIds.filter(pid =>
          parentResultsByNode.get(pid)?.status !== 'completed'
        );
        console.log(`[Orchestrator] ⏳ Child ${childId} is still waiting for parents: ${incomplete.join(', ')}`);
      }
    }
    
  } catch (error) {
    console.error(`[Orchestrator] Unexpected error in checkAndDispatchChildren:`, error);
  }
}

/**
 * Builds an input object for a node by gathering typed results from its parents.
 * Parent results are passed in (already fetched once for the whole successor batch),
 * so this function does NOT touch the DB for results — only for the cached
 * ai_models lookup via getAiArrayInputKeys.
 */
async function buildInputsFromParents(
  nodeId: string,
  graph: GraphJson,
  parentResultsByNode: Map<string, { status: string; result_type: any; result_data: any }>
): Promise<Record<string, any>> {
  const supabase = createServiceClient();

  // Seed with preseeded inputs from generative ancestors that aren't part of
  // this execution. The start route stuffs these into graph_json so non-root
  // nodes (which the dispatch loop's direct preseed pass-through skips) still
  // receive their outside-the-set parent values. Live parent results below
  // overlay preseed on key collision, so a re-running parent always wins.
  const preseedForNode = graph.preseedInputs?.[nodeId];
  const inputs: Record<string, any> = preseedForNode && typeof preseedForNode === 'object'
    ? { ...preseedForNode }
    : {};

  const incomingEdges = (graph.edges || []).filter(e => e.target === nodeId);
  const targetNode = graph.nodes.find((n) => n.id === nodeId);
  const arrayInputKeys = await getAiArrayInputKeys(supabase, targetNode);

  for (const edge of incomingEdges) {
    const parentResult = parentResultsByNode.get(edge.source);
    if (!parentResult || parentResult.status !== 'completed') continue;

    const resultType = normalizeNodeResultType(parentResult.result_type);
    const resultData = coerceResultDataArray(parentResult.result_data || []);
    const inputKey = edge.targetHandle || edge.sourceHandle || 'image';
    const typedValue = arrayInputKeys.has(inputKey)
      ? resultData
      : getPrimaryInputValue(resultType, resultData);

    if (typedValue !== undefined && typedValue !== null) {
      // Deliver strictly under the wired handle's key. With connection
      // validation in place, edge.targetHandle is the consumer's
      // api_mapping_key, so this matches what the executor reads.
      //
      // The previous prompt-source override (force-routing every prompt
      // node's output to inputs.prompt and mirroring any "*prompt*" target
      // to inputs.prompt) was a workaround for missing/wrong handles in
      // older edges. It silently overwrote the user's typed prompt control
      // when they wired a Prompt node to negative_prompt, and clobbered
      // legitimate per-handle wiring on multi-prompt models.
      //
      // Array handles (e.g. nano-banana-pro's single `image_input`) can be
      // fed by MULTIPLE edges — two character nodes both wire into the one
      // reference-image slot. Plain assignment would let the last edge
      // overwrite the first, silently dropping a whole character's
      // references (the model then reinvents that subject from the prompt
      // text alone). So for array handles we CONCATENATE every edge's values
      // (and any preseeded array already under this key) instead of
      // overwriting. Non-array handles keep last-write-wins.
      if (arrayInputKeys.has(inputKey)) {
        const existing = inputs[inputKey];
        const existingArr = Array.isArray(existing)
          ? existing
          : existing !== undefined && existing !== null
            ? [existing]
            : [];
        const incomingArr = Array.isArray(typedValue) ? typedValue : [typedValue];
        inputs[inputKey] = [...existingArr, ...incomingArr];
      } else {
        inputs[inputKey] = typedValue;
      }

      // Also key by edge.id. The Compositor stores
      // `layer.sourceHandleId = edge.id` because every layer edge shares
      // the same static `layers` target handle, so per-edge id is the only
      // way to disambiguate which upstream value belongs to which layer.
      // Single-input nodes (Blur reads `inputs.image`) are unaffected — they
      // still find their value under the handle name. Mirrors the browser-
      // side input map in lib/hooks/use-node-auto-compute.ts. Use the non-
      // array `getPrimaryInputValue(...)` shape here regardless of the
      // arrayInputKeys flag, since `layer.sourceHandleId` is always a single-
      // value lookup.
      if (edge.id) {
        const perEdgeValue = arrayInputKeys.has(inputKey)
          ? getPrimaryInputValue(resultType, resultData)
          : typedValue;
        if (perEdgeValue !== undefined && perEdgeValue !== null) {
          inputs[edge.id] = perEdgeValue;
        }
      }
    }
  }

  return inputs;
}

/**
 * Checks if the entire execution (target set) is finished and updates the status.
 */
export async function updateExecutionFinalStatus(executionId: string): Promise<void> {
  const supabase = createServiceClient();
  
  try {
    // 1. Fetch graph snapshot to see all nodes that were supposed to run
    const { data: execution } = await supabase
      .from('executions')
      .select('graph_json')
      .eq('id', executionId)
      .single();
      
    if (!execution) return;
    const graph: GraphJson = execution.graph_json as any;
    const targetNodeIds = graph.nodes.map(n => n.id);
    
    // 2. Check current status of all nodes in target set
    const { data: results } = await supabase
      .from('node_results')
      .select('status')
      .eq('execution_id', executionId)
      .in('node_id', targetNodeIds);
      
    if (!results) return;
    
    const anyRunning = results.some(r => r.status === 'running' || r.status === 'pending');
    if (anyRunning) {
      console.log(`[Orchestrator] Execution ${executionId} still has active nodes. Staying in 'running'.`);
      return;
    }
    
    // 3. All finished! Determine if overall success or failure
    const anyFailed = results.some(r => r.status === 'failed');
    const finalStatus = anyFailed ? 'failed' : 'completed';
    
    // Find the "Final Result" (result from a node with no children in this target set)
    const leafNodeIds = targetNodeIds.filter(id => 
        !graph.edges.some(e => e.source === id)
    );
    
    // Get the result of the most recently updated leaf node
    const { data: finalNodeResult } = await supabase
        .from('node_results')
        .select('result_type, result_data')
        .eq('execution_id', executionId)
        .in('node_id', leafNodeIds)
        .eq('status', 'completed')
        .order('updated_at', { ascending: false })
        .limit(1)
        .single();

    console.log(`[Orchestrator] 🏁 All nodes finished in execution ${executionId}. Final Status: ${finalStatus}`);
    
    await supabase
      .from('executions')
      .update({
        status: finalStatus,
        result_data: finalNodeResult
          ? {
              type: finalNodeResult.result_type,
              data: finalNodeResult.result_data || [],
            }
          : null,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', executionId);

    // If the execution failed, refund the credits that were debited at start.
    // Idempotent on the execution id, so safe even if this path runs twice.
    if (finalStatus === 'failed') {
      const { error: refundError } = await supabase.rpc('refund_tokens', {
        p_execution_id: executionId,
        p_reason: 'execution_failed',
      });
      if (refundError) {
        console.error(`[Orchestrator] Refund failed for execution ${executionId}:`, refundError);
      } else {
        console.log(`[Orchestrator] Refunded credits for failed execution ${executionId}`);
      }
    }

    await cleanupEphemeralResults(executionId, graph);

  } catch (error) {
    console.error(`[Orchestrator] Error updating final status:`, error);
  }
}

/**
 * Removes ephemeral node outputs (storage objects + node_results rows) for an
 * execution after it reaches a terminal state. Ephemeral nodes (blur, levels,
 * compositor, ...) are identified via `meta.ephemeral === true` on their
 * server-registry definition. Persistent outputs (ai_generator, media_input)
 * are left untouched so they remain visible in the asset library.
 *
 * Failures are logged but never thrown — cleanup is best-effort and must not
 * mask the execution's final status.
 */
async function cleanupEphemeralResults(
  executionId: string,
  graph: GraphJson,
): Promise<void> {
  try {
    const ephemeralNodeIds = (graph?.nodes || [])
      .filter((n) => serverRegistry[n.type]?.meta?.ephemeral === true)
      .map((n) => n.id);

    if (ephemeralNodeIds.length === 0) return;

    const supabase = createServiceClient();

    // Storage objects are written under `{executionId}/{nodeId}/...` by every
    // ephemeral plugin, so listing the execution prefix gives us every file
    // across every ephemeral node in this run in one round-trip.
    const { data: nodeFolders, error: listErr } = await supabase.storage
      .from(EPHEMERAL_BUCKET)
      .list(executionId, { limit: 1000 });

    if (listErr) {
      console.error(
        `[Orchestrator] Failed listing ephemeral storage for execution ${executionId}:`,
        listErr,
      );
    } else if (nodeFolders && nodeFolders.length > 0) {
      const ephemeralIdSet = new Set(ephemeralNodeIds);
      const fileLists = await Promise.all(
        nodeFolders
          .filter((entry) => ephemeralIdSet.has(entry.name))
          .map((entry) =>
            supabase.storage
              .from(EPHEMERAL_BUCKET)
              .list(`${executionId}/${entry.name}`, { limit: 1000 })
              .then((res) => ({ nodeId: entry.name, ...res })),
          ),
      );

      const pathsToDelete: string[] = [];
      for (const { nodeId, data, error } of fileLists) {
        if (error) {
          console.error(
            `[Orchestrator] Failed listing ${executionId}/${nodeId}:`,
            error,
          );
          continue;
        }
        for (const file of data || []) {
          pathsToDelete.push(`${executionId}/${nodeId}/${file.name}`);
        }
      }

      if (pathsToDelete.length > 0) {
        const { error: removeErr } = await supabase.storage
          .from(EPHEMERAL_BUCKET)
          .remove(pathsToDelete);
        if (removeErr) {
          console.error(
            `[Orchestrator] Failed removing ${pathsToDelete.length} ephemeral objects:`,
            removeErr,
          );
        } else {
          console.log(
            `[Orchestrator] Removed ${pathsToDelete.length} ephemeral storage objects for execution ${executionId}`,
          );
        }
      }
    }

    const { error: deleteErr, count } = await supabase
      .from('node_results')
      .delete({ count: 'exact' })
      .eq('execution_id', executionId)
      .in('node_id', ephemeralNodeIds);

    if (deleteErr) {
      console.error(
        `[Orchestrator] Failed deleting ephemeral node_results rows:`,
        deleteErr,
      );
    } else {
      console.log(
        `[Orchestrator] Deleted ${count ?? 0} ephemeral node_results rows for execution ${executionId}`,
      );
    }
  } catch (err) {
    console.error(
      `[Orchestrator] cleanupEphemeralResults threw for execution ${executionId}:`,
      err,
    );
  }
}
