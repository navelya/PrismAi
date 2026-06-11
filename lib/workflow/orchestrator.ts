/**
 * Workflow Engine v2 - DAG Orchestrator
 * Core reactive engine that resolves dependencies and triggers child nodes
 */

import { createServiceClient } from '@/lib/supabase/service';
import { GraphJson, NodeConfig } from './types-v2';
import { dispatchNode, withRetry } from './dispatch-v2';
import { coerceResultDataArray, getPrimaryInputValue, normalizeNodeResultType } from './result-format';
import { serverRegistry, isEphemeralNode } from '@/lib/nodes/core/server-registry';
import { promoteEphemeralUrl, isEphemeralUrl } from '@/lib/storage/promote-ephemeral';

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
      .select('graph_json, session_id, status')
      .eq('id', executionId)
      .single();

    if (execError || !execution) {
      console.error(`[Orchestrator] Failed to fetch execution snapshot:`, execError);
      return;
    }

    // Cancellation gate. Once an execution is cancelled we stop launching ANY
    // new nodes. The node that just finished has already had its result saved
    // by the caller (the Replicate webhook / ephemeral executor write the row
    // BEFORE calling us), so in-flight outputs are preserved — we simply refuse
    // to dispatch the next hop. Finalizing here lands the execution terminally
    // on 'cancelled' once the last in-flight node drains.
    if ((execution as any).status === 'cancelled') {
      console.log(`[Orchestrator] Execution ${executionId} is cancelled — not dispatching children of ${completedNodeId}.`);
      await updateExecutionFinalStatus(executionId);
      return;
    }

    const graph: GraphJson = execution.graph_json as any;
    const sessionId = execution.session_id;

    // If the node that just finished FAILED, nothing downstream of it can ever
    // run. Hand off to handleNodeFailure, which attributes the error, marks
    // every affected node terminally, and finalizes the execution — otherwise
    // descendants sit in 'pending' forever and the canvas spins with no error.
    // This branch is the entry point for callers that write 'failed' directly
    // then call us (the Replicate webhook, dispatchReplicateNode); the
    // in-process dispatch path calls handleNodeFailure itself. (completedNodeId
    // is a misnomer: this fires for any finished node, success OR failure.)
    const { data: selfResult } = await supabase
      .from('node_results')
      .select('status, error')
      .eq('execution_id', executionId)
      .eq('node_id', completedNodeId)
      .single();

    if (selfResult?.status === 'failed') {
      const msg = typeof selfResult.error === 'string'
        ? selfResult.error
        : (selfResult.error ? JSON.stringify(selfResult.error) : 'Node failed');
      await handleNodeFailure(executionId, completedNodeId, msg);
      return;
    }

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
 * A node failed. Compute a terminal status for it and every node downstream,
 * then finalize the execution. The execution can never hang on a non-terminal
 * node because every reachable node is given a terminal status here.
 *
 * Status rules (product decision — ephemeral nodes are plumbing, not results):
 *  - Ephemeral nodes NEVER show an error. A failed or blocked ephemeral node is
 *    reset to 'idle' (neutral: no badge, no spinner).
 *  - When an EPHEMERAL node fails, the error is attributed to its nearest
 *    non-ephemeral descendant(s) — "the node that made it run" — reached through
 *    only-ephemeral edges. Those carry the real message.
 *  - When a NON-ephemeral node fails, it carries the error itself.
 *  - Non-ephemeral nodes further downstream are blocked ("Blocked by upstream
 *    failure").
 *
 * Independent branches that don't depend on the failed node are untouched and
 * keep running; updateExecutionFinalStatus finalizes as 'failed' once nothing
 * is left running (refund + ephemeral cleanup happen there).
 */
export async function handleNodeFailure(
  executionId: string,
  failedNodeId: string,
  errorMessage: string
): Promise<void> {
  const supabase = createServiceClient();
  try {
    const { data: execution } = await supabase
      .from('executions')
      .select('graph_json, session_id')
      .eq('id', executionId)
      .single();
    if (!execution) return;
    const graph: GraphJson = execution.graph_json as any;
    const sessionId = execution.session_id;

    const typeById = new Map((graph.nodes || []).map(n => [n.id, n.type]));
    const isEph = (id: string) => isEphemeralNode(typeById.get(id) || '');
    const edges = graph.edges || [];

    // node_id -> { status, error } we intend to write.
    const updates = new Map<string, { status: string; error: string | null }>();
    const setFailed = (id: string, err: string) =>
      updates.set(id, { status: isEph(id) ? 'idle' : 'failed', error: isEph(id) ? null : err });

    // The failed node itself: shows the error if non-ephemeral, neutral if not.
    setFailed(failedNodeId, errorMessage);

    // Pass 1 — expand through ONLY ephemeral edges. Ephemeral nodes on the way
    // become 'idle'; the first non-ephemeral node on each path is a "consumer"
    // that carries the real error.
    const consumers = new Set<string>();
    {
      const visited = new Set<string>([failedNodeId]);
      const queue = [failedNodeId];
      while (queue.length) {
        const cur = queue.shift()!;
        for (const edge of edges) {
          if (edge.source !== cur || visited.has(edge.target)) continue;
          visited.add(edge.target);
          if (isEph(edge.target)) {
            updates.set(edge.target, { status: 'idle', error: null });
            queue.push(edge.target);
          } else {
            consumers.add(edge.target);
            updates.set(edge.target, { status: 'failed', error: errorMessage });
          }
        }
      }
    }

    // No non-ephemeral consumer exists (pure-ephemeral subgraph or ephemeral
    // leaf) → there is nowhere to attribute the error. Fall back to marking the
    // ephemeral node itself failed so the execution fails instead of falsely
    // completing. (Rare; the normal case always has a downstream consumer.)
    if (consumers.size === 0 && isEph(failedNodeId)) {
      updates.set(failedNodeId, { status: 'failed', error: errorMessage });
    }

    // Pass 2 — full downstream reachability. Anything not already classified
    // (i.e. downstream of a consumer) gets a terminal status so nothing hangs.
    {
      const visited = new Set<string>([failedNodeId]);
      const queue = [failedNodeId];
      while (queue.length) {
        const cur = queue.shift()!;
        for (const edge of edges) {
          if (edge.source !== cur || visited.has(edge.target)) continue;
          visited.add(edge.target);
          queue.push(edge.target);
          if (updates.has(edge.target)) continue;
          updates.set(edge.target, isEph(edge.target)
            ? { status: 'idle', error: null }
            : { status: 'failed', error: 'Blocked by upstream failure' });
        }
      }
    }

    // Only transition nodes that are still unfinished — never clobber a node
    // that already completed/failed via an independent path. (The failed node
    // itself is 'running' right now, so it qualifies.)
    const ids = Array.from(updates.keys());
    const { data: existingRows } = await supabase
      .from('node_results')
      .select('node_id, status')
      .eq('execution_id', executionId)
      .in('node_id', ids);
    const statusById = new Map((existingRows || []).map(r => [r.node_id, r.status]));

    const rows = ids
      .filter(id => {
        const cur = statusById.get(id);
        return cur === undefined || cur === 'pending' || cur === 'running' || id === failedNodeId;
      })
      .map(id => ({
        execution_id: executionId,
        node_id: id,
        session_id: sessionId,
        status: updates.get(id)!.status,
        error: updates.get(id)!.error,
        updated_at: new Date().toISOString(),
      }));

    if (rows.length > 0) {
      try {
        await withRetry(async () => {
          const { error } = await supabase
            .from('node_results')
            .upsert(rows, { onConflict: 'execution_id,node_id' });
          if (error) throw new Error(error.message);
        }, `failure write for ${failedNodeId}`);
      } catch (e) {
        console.error(`[Orchestrator] Failed to write failure states for ${failedNodeId}:`, e);
      }
      console.log(`[Orchestrator] Node ${failedNodeId} failed; wrote ${rows.length} terminal status(es), error attributed to: ${Array.from(consumers).join(', ') || failedNodeId}.`);
    }

    await updateExecutionFinalStatus(executionId);
  } catch (error) {
    console.error(`[Orchestrator] handleNodeFailure error for ${failedNodeId}:`, error);
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

  // When MORE THAN ONE character node is wired into this node, we send only
  // each character's PRIMARY (base) reference image — referenceImages[0] — and
  // drop the rest of their reference set. A character can carry up to ~6
  // references; concatenating several full sets into one image_input slot
  // floods the model with images and blends/dilutes the distinct subjects.
  // One clean base image per character keeps identities separable. A single
  // character still sends its full reference set (no dilution risk there).
  const nodeTypeById = new Map(graph.nodes.map((n) => [n.id, n.type]));
  const characterParentIds = new Set(
    incomingEdges
      .map((e) => e.source)
      .filter((src) => nodeTypeById.get(src) === 'character')
  );
  const limitCharactersToBase = characterParentIds.size > 1;

  for (const edge of incomingEdges) {
    const parentResult = parentResultsByNode.get(edge.source);
    if (!parentResult || parentResult.status !== 'completed') continue;

    const resultType = normalizeNodeResultType(parentResult.result_type);
    let resultData = coerceResultDataArray(parentResult.result_data || []);

    // Trim multi-character contributions down to the base reference image.
    if (
      limitCharactersToBase &&
      nodeTypeById.get(edge.source) === 'character' &&
      resultData.length > 1
    ) {
      resultData = resultData.slice(0, 1);
    }
    const inputKey = edge.targetHandle || edge.sourceHandle || 'image';
    // An ai_generator exposes only its active (carousel-front) output
    // downstream. A (re)run resets its selection to the newest item, which
    // leads result_data, so the primary value IS the front image. Deliver just
    // that one even to array handles — never the whole set of variations — so a
    // downstream node fed by a single ai_generator gets its active image, not
    // all of them. (Multi-image inputs are still possible by wiring several
    // upstream nodes; each contributes its primary and they concatenate below.)
    const isAiSource = nodeTypeById.get(edge.source) === 'ai_generator';
    const typedValue = (arrayInputKeys.has(inputKey) && !isAiSource)
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

    // `collect` aggregates whole upstream arrays. Override its per-edge id with
    // the FULL result_data (not just the primary) so its OFF/default mode can
    // flatten every item of every input. Keyed by edge id like the compositor;
    // the collect executor reads each edge id key. Done outside the
    // typedValue guard so even a single-item upstream lands as a 1-element
    // array under its edge id.
    if (targetNode?.type === 'collect' && edge.id && resultData.length > 0) {
      inputs[edge.id] = resultData;
    }
  }

  // Hidden signal for the ai_generator executor: how many distinct character
  // nodes feed this node. The executor prepends framing so each character sheet
  // is read as one consistent person. Reserved key, never sent to the model.
  if (characterParentIds.size > 0) {
    inputs.__characterRefCount = characterParentIds.size;
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
      .select('graph_json, status, session_id')
      .eq('id', executionId)
      .single();

    if (!execution) return;
    const graph: GraphJson = execution.graph_json as any;
    const wasCancelled = (execution as any).status === 'cancelled';
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
    
    // 3. All finished! Determine the terminal status. A cancelled execution
    //    stays 'cancelled' no matter how its in-flight nodes resolved — the
    //    partial cancel-refund already settled the credits, so we must NOT let
    //    a post-cancel node failure flip this to 'failed' (which would fire the
    //    full refund below and double-refund).
    const anyFailed = results.some(r => r.status === 'failed');
    const finalStatus = wasCancelled ? 'cancelled' : (anyFailed ? 'failed' : 'completed');
    
    // Find the "Final Result" (result from a node with no children in this target set)
    const leafNodeIds = targetNodeIds.filter(id =>
        !graph.edges.some(e => e.source === id)
    );

    // A chat run freezes the LEAF node's output onto the message as the result.
    // When that leaf is an ephemeral node (compositor, blur, …), its media lives
    // in `workflow-ephemeral-tmp` and is about to be deleted by
    // cleanupEphemeralResults below — so the frozen URL would 404 shortly after.
    // Promote those leaf outputs into the durable `chat-assets` bucket FIRST and
    // rewrite their node_results rows (the realtime UPDATE carries the durable
    // URL to the client, which swaps its frozen result over). Runs before the
    // executions.result_data write so that reflects the durable URL too. The set
    // of successfully-promoted leaves is excluded from row deletion in cleanup.
    const promotedLeafIds = await promoteLeafEphemeralResults(
      supabase,
      executionId,
      graph,
      leafNodeIds,
      (execution as any).session_id,
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

    await cleanupEphemeralResults(executionId, graph, promotedLeafIds);

  } catch (error) {
    console.error(`[Orchestrator] Error updating final status:`, error);
  }
}

/**
 * Promote chat-run terminal (leaf) ephemeral outputs from the ephemeral bucket
 * into durable `chat-assets` storage so they survive cleanupEphemeralResults.
 *
 * For each leaf node that is ephemeral and produced media, every
 * `workflow-ephemeral-tmp` URL in its `node_results.result_data` is copied to
 * `chat-assets` and the row is rewritten to the durable URLs. A node is only
 * added to the returned "promoted" set when ALL of its ephemeral URLs copied
 * successfully — its row is then kept (not deleted) by cleanup. On any failure
 * the original tmp object is left in place (cleanup will skip its row too only
 * if promoted), so a failed promotion degrades to "result lives in tmp" rather
 * than "result disappears".
 *
 * Best-effort: never throws — promotion failure must not mask the run's status.
 */
async function promoteLeafEphemeralResults(
  supabase: ReturnType<typeof createServiceClient>,
  executionId: string,
  graph: GraphJson,
  leafNodeIds: string[],
  sessionId: string | null | undefined,
): Promise<Set<string>> {
  const promoted = new Set<string>();
  try {
    if (!sessionId) return promoted;

    const typeById = new Map(graph.nodes.map((n) => [n.id, n.type]));
    const ephemeralLeafIds = leafNodeIds.filter(
      (id) => serverRegistry[typeById.get(id) || '']?.meta?.ephemeral === true,
    );
    if (ephemeralLeafIds.length === 0) return promoted;

    // Destination path needs the owner's user id (node_results.user_id is null
    // until session-cleanup stamps it, so resolve via the session).
    const { data: session } = await supabase
      .from('sessions')
      .select('user_id')
      .eq('id', sessionId)
      .single();
    const userId = (session as any)?.user_id as string | undefined;
    if (!userId) {
      console.error(`[Orchestrator] promote: no user_id for session ${sessionId}; skipping`);
      return promoted;
    }

    const { data: rows } = await supabase
      .from('node_results')
      .select('node_id, result_data')
      .eq('execution_id', executionId)
      .in('node_id', ephemeralLeafIds)
      .eq('status', 'completed');

    for (const row of rows || []) {
      const items = Array.isArray((row as any).result_data) ? (row as any).result_data : [];
      if (items.length === 0) continue;

      let allOk = true;
      let changed = false;
      const durable = await Promise.all(
        items.map(async (item: any) => {
          const url = typeof item === 'string' ? item : item?.url;
          if (!isEphemeralUrl(url)) return item; // already durable / external
          const newUrl = await promoteEphemeralUrl(supabase, url, {
            userId,
            sessionId,
            nodeId: (row as any).node_id,
          });
          if (!newUrl) {
            allOk = false;
            return item;
          }
          changed = true;
          return typeof item === 'string' ? newUrl : { ...item, url: newUrl };
        }),
      );

      // Only rewrite when every ephemeral URL promoted — never leave a row
      // pointing at a half-copied set.
      if (!allOk || !changed) continue;

      const { error } = await supabase
        .from('node_results')
        .update({ result_data: durable, updated_at: new Date().toISOString() })
        .eq('execution_id', executionId)
        .eq('node_id', (row as any).node_id);
      if (error) {
        console.error(`[Orchestrator] promote: row rewrite failed for ${(row as any).node_id}:`, error);
        continue;
      }
      promoted.add((row as any).node_id);
    }

    if (promoted.size > 0) {
      console.log(
        `[Orchestrator] Promoted ${promoted.size} leaf ephemeral output(s) to chat-assets for execution ${executionId}`,
      );
    }
  } catch (err) {
    console.error(`[Orchestrator] promoteLeafEphemeralResults threw for execution ${executionId}:`, err);
  }
  return promoted;
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
  promotedLeafIds: Set<string> = new Set(),
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

    // Promoted leaf nodes now hold durable chat-assets URLs (their tmp originals
    // were removed above) — KEEP their rows so the chat result stays resolvable
    // and the row survives as a session-cleanup "keeper". Delete the rest.
    const rowsToDelete = ephemeralNodeIds.filter((id) => !promotedLeafIds.has(id));
    if (rowsToDelete.length === 0) {
      return;
    }

    const { error: deleteErr, count } = await supabase
      .from('node_results')
      .delete({ count: 'exact' })
      .eq('execution_id', executionId)
      .in('node_id', rowsToDelete);

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
