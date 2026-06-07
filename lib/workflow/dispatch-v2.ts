/**
 * Workflow Engine v2 - Dispatch Logic
 * Handles dispatching nodes to Replicate or ephemeral execution
 */

import { replicate } from '@/lib/ai/replicate-client';
import { createServiceClient } from '@/lib/supabase/service';
import { NodeConfig, NodeState } from './types-v2';
import { isEphemeralNode } from '@/lib/nodes/core/server-registry';
import { executeEphemeralNode } from './ephemeral-executor';
import { inferResultTypeFromValue, toResultDataForType } from './result-format';
import { resolveNodeOutputWireType } from './output-type';

const WEBHOOK_BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

import { checkAndDispatchChildren, handleNodeFailure } from './orchestrator';

/**
 * Supabase REST calls occasionally fail at the transport layer with an opaque
 * `TypeError: fetch failed` (a dropped keep-alive socket, a brief network blip).
 * A single dropped STATE write must never orphan a node in a non-terminal
 * status — that hangs the whole execution — so we retry a few times with short
 * backoff before giving up. The callback throws on a returned PostgREST error
 * (supabase-js surfaces `fetch failed` as a returned error, not a throw).
 */
export async function withRetry<T>(fn: () => Promise<T>, label: string, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isLast = i === attempts - 1;
      console.warn(
        `[Dispatch] ${label} failed (attempt ${i + 1}/${attempts})${isLast ? '' : ', retrying'}:`,
        err instanceof Error ? err.message : err
      );
      if (!isLast) await new Promise((res) => setTimeout(res, 250 * (i + 1)));
    }
  }
  throw lastErr;
}

/**
 * Main dispatch function - routes to appropriate handler based on node type
 */
export async function dispatchNode(
  executionId: string,
  nodeId: string,
  nodeConfig: NodeConfig,
  inputs: Record<string, any> = {},
  baseUrl?: string,
  sessionId?: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  const currentBaseUrl = baseUrl || WEBHOOK_BASE_URL;
  console.log(`[Dispatch] Starting dispatch for node ${nodeId} in execution ${executionId} (BaseURL: ${currentBaseUrl})`);
  
  try {
    const nodeType = nodeConfig.type;

    // Groups are non-executable visual containers. If anything ever asks for
    // their dispatch (orchestrator misfire, AI-generated bad patch, etc.) we
    // log and bail safely instead of marking the execution failed.
    if (nodeType === 'group_container') {
      console.log(`[Dispatch] Skipping group_container node ${nodeId} (groups are non-executable).`);
      return { success: true, data: null };
    }

    if (isEphemeralNode(nodeType)) {
      return await dispatchEphemeralNode(executionId, nodeId, nodeConfig, inputs, currentBaseUrl, sessionId);
    }
    
    // Check if this is a Replicate-based node (dynamic check based on model field)
    if (isReplicateNode(nodeConfig)) {
      return await dispatchReplicateNode(executionId, nodeId, nodeConfig, inputs, currentBaseUrl, sessionId);
    }
    
    // Unsupported node type
    console.error(`[Dispatch] Unknown node type: ${nodeType} - no model field and not ephemeral`);
    
    await updateNodeState(executionId, nodeId, {
      status: 'failed',
      error: `Unsupported node type: ${nodeType}`,
    }, sessionId, currentBaseUrl);
    
    return { success: false, error: `Unsupported node type: ${nodeType}` };
    
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown dispatch error';
    console.error(`[Dispatch] Error dispatching node ${nodeId}:`, error);

    // Route the failure through the orchestrator's ephemeral-aware handler. It
    // decides WHERE the error surfaces (ephemeral nodes never show an error —
    // it's attributed to the consumer that ran them), marks every affected node
    // terminally so nothing hangs, and finalizes the execution. We call it
    // directly (NOT updateNodeState(failed)) precisely so an ephemeral node is
    // never written 'failed' even momentarily. Best-effort: never let it throw.
    try {
      await handleNodeFailure(executionId, nodeId, message);
    } catch (writeErr) {
      console.error(`[Dispatch] CRITICAL: could not handle failure for ${nodeId}:`, writeErr);
    }

    return { success: false, error: message };
  }
}

/**
 * Dispatch an ephemeral node (server-side processing)
 */
async function dispatchEphemeralNode(
  executionId: string,
  nodeId: string,
  nodeConfig: NodeConfig,
  inputs: Record<string, any>,
  baseUrl: string,
  sessionId?: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  
  console.log(`[Dispatch/Ephemeral] Executing node ${nodeId} DIRECTLY`, { nodeType: nodeConfig.type });
  
  try {
    await updateNodeState(executionId, nodeId, {
      status: 'running',
      dispatched_at: new Date().toISOString(),
    }, sessionId, baseUrl);
    
    const result = await executeEphemeralNode(executionId, nodeId, sessionId, inputs);

    if (!result.success) {
      // Distinct, node-typed message so the canvas error badge says what
      // actually broke (e.g. "compositor processing failed: ...") rather than
      // a generic failure — and the node leaves the loading state.
      throw new Error(`${nodeConfig.type} processing failed: ${result.error || 'unknown error'}`);
    }
    
    console.log(`[Dispatch/Ephemeral] ✅ Successfully executed node ${nodeId} directly. Triggering children.`);
    
    // MARK AS COMPLETED - this will trigger children via updateNodeState
    await updateNodeState(executionId, nodeId, {
        status: 'completed',
        result_type: result.result_type,
        result_data: result.result_data,
        completed_at: new Date().toISOString()
    }, sessionId, baseUrl);
    
    return { success: true, data: result.result_data };
    
  } catch (error) {
    console.error(`[Dispatch/Ephemeral] ❌ Error:`, error);
    throw error;
  }
}

import { aiGeneratorExecutor } from '../nodes/plugins/ai_generator/executor.server';
import { clampIterations } from '@/lib/billing/cost';

/**
 * Dispatch a node to Replicate API using the battle-tested executor
 */
async function dispatchReplicateNode(
  executionId: string,
  nodeId: string,
  nodeConfig: NodeConfig,
  inputs: Record<string, any>,
  baseUrl: string,
  sessionId?: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  
  console.log(`[Dispatch/Replicate] Dispatching node ${nodeId} via aiGeneratorExecutor`, { inputs });
  
  try {
    const config = nodeConfig.data.config || nodeConfig.data || {};

    const iterations = clampIterations(config.iterations);

    // ── iterations === 1: unchanged single-prediction path ──────────────────
    if (iterations <= 1) {
        const result = await aiGeneratorExecutor(config, inputs, {
            sessionId: sessionId || 'server-execution',
            executionId,
            nodeId,
            workflowId: executionId,
            data: nodeConfig.data,
        });
        if (!result.success) throw new Error(result.error || 'AI Generator Executor failed');

        if (result.status === 'success') {
            const rawData = result.data;
            const resultType = inferResultTypeFromValue(rawData);
            const resultData = toResultDataForType(resultType, rawData);
            await updateNodeState(executionId, nodeId, {
                status: 'completed',
                result_type: resultType,
                result_data: resultData,
                dispatched_at: new Date().toISOString(),
                completed_at: new Date().toISOString(),
            }, sessionId, baseUrl);
        } else {
            await updateNodeState(executionId, nodeId, {
                status: 'running',
                replicate_prediction_id: (result.data as any)?.id,
                dispatched_at: new Date().toISOString(),
            }, sessionId, baseUrl);
        }
        return { success: true, data: result.data };
    }

    // ── iterations > 1: fan out into N independent generations ───────────────
    const ctx = {
        sessionId: sessionId || 'server-execution',
        executionId,
        nodeId,
        workflowId: executionId,
        data: nodeConfig.data,
    };
    // Fan out concurrently: kick off all N predictions at once rather than
    // awaiting each in turn. Each executor call just CREATES one Replicate
    // prediction (the heavy generation runs async on Replicate and returns via
    // webhook), so concurrent creation removes the serial latency and, in the
    // local synchronous path, runs the generations in parallel. allSettled keeps
    // a single failed creation from aborting the rest; a rejection maps to the
    // same shape the previous per-iteration catch produced.
    const settled = await Promise.allSettled(
        Array.from({ length: iterations }, (_, i) => aiGeneratorExecutor(config, inputs, { ...ctx, predictionIndex: i }))
    );
    const results: Awaited<ReturnType<typeof aiGeneratorExecutor>>[] = settled.map((s) =>
        s.status === 'fulfilled'
            ? s.value
            : ({ success: false, status: 'error', data: null, error: s.reason instanceof Error ? s.reason.message : 'Prediction create threw' } as any)
    );

    // 'pending' is production-exclusive (an async prediction was created). If none
    // are pending, every result is a synchronous success or a failure → aggregate
    // locally. This is safer than checking for 'success' (a mixed batch with even
    // one async prediction must use the production tracking path, not be dropped).
    const anyPending = results.some((r) => r.status === 'pending');

    if (!anyPending) {
        // Local dev: replicate.run returned outputs synchronously. Aggregate all
        // successful iterations into one result and complete the node.
        let resultType = 'json' as ReturnType<typeof inferResultTypeFromValue>;
        const aggregated: any[] = [];
        for (const r of results) {
            if (!r.success || r.status !== 'success') continue;
            const t = inferResultTypeFromValue(r.data);
            resultType = t;
            aggregated.push(...toResultDataForType(t, r.data));
        }
        if (aggregated.length === 0) throw new Error('All iterations failed');
        await updateNodeState(executionId, nodeId, {
            status: 'completed',
            result_type: resultType,
            result_data: aggregated,
            dispatched_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
        }, sessionId, baseUrl);
        return { success: true, data: aggregated };
    }

    // Production: each iteration created an async prediction. Track them in
    // node_predictions so the webhook can aggregate once all resolve. Mark the
    // node running first so the UI shows progress and the webhook has a row to
    // transition.
    await updateNodeState(executionId, nodeId, {
        status: 'running',
        dispatched_at: new Date().toISOString(),
    }, sessionId, baseUrl);

    const supabase = createServiceClient();
    const rows = results.map((r, i) => ({
        execution_id: executionId,
        node_id: nodeId,
        prediction_index: i,
        replicate_id: r.status === 'pending' ? ((r.data as any)?.id ?? null) : null,
        status: r.status === 'pending' ? 'pending' : 'failed',
        error: r.status === 'pending' ? null : (r.error || 'Prediction create failed'),
        updated_at: new Date().toISOString(),
    }));
    // Insert-ONLY (ignoreDuplicates): a fast prediction's webhook may have already
    // upserted its row to 'completed'/'failed' before this batch runs. The webhook
    // is the authoritative resolver — dispatch must register the initial rows
    // without clobbering an already-resolved one back to 'pending'.
    const { error: insErr } = await supabase
        .from('node_predictions')
        .upsert(rows, { onConflict: 'execution_id,node_id,prediction_index', ignoreDuplicates: true });
    if (insErr) throw new Error(`Failed to record predictions: ${insErr.message}`);

    if (rows.every((r) => r.status === 'failed')) {
        await updateNodeState(executionId, nodeId, {
            status: 'failed',
            error: 'All iterations failed to start',
            completed_at: new Date().toISOString(),
        }, sessionId, baseUrl);
        return { success: true, data: { iterations, pending: 0 } };
    }

    // Covers the pathological case where every created prediction's webhook fired
    // (and returned "not ready" for lack of a 'running' row / complete row set)
    // before this point: now that the row set is complete, re-check. finalize is
    // claim-once and a no-op until all iterations have resolved.
    const outputType = await resolveNodeOutputWireType(supabase, executionId, nodeId);
    const { data: claimed } = await supabase.rpc('finalize_fan_out', {
        p_execution_id: executionId,
        p_node_id: nodeId,
        p_output_type: outputType,
        p_expected_count: iterations,
    });
    if (claimed === true) {
        await checkAndDispatchChildren(executionId, nodeId, baseUrl);
    }

    return { success: true, data: { iterations, pending: rows.filter((r) => r.status === 'pending').length } };
    
  } catch (error) {
    console.error(`[Dispatch/Replicate] Error:`, error);
    throw error;
  }
}

/**
 * Update node state in the node_results table
 * If status is 'completed' or 'failed', it triggers the orchestrator for children.
 * 
 * V3.1: Also mirrors status into the sessions table (canvas_state) to satisfy the current UI.
 */
async function updateNodeState(
  executionId: string,
  nodeId: string,
  state: Partial<NodeState>,
  sessionId?: string,
  baseUrl?: string
): Promise<void> {
  
  const supabase = createServiceClient();
  const resolvedResultType = state.result_type ?? (state.result_url ? inferResultTypeFromValue(state.result_url) : undefined);
  const resolvedResultData = state.result_data ?? (state.result_url ? [state.result_url] : undefined);
  
  // 1. Update node_results table (Engine source of truth). Retried because a
  // transient `fetch failed` here would otherwise orphan the node in a
  // non-terminal status and hang the whole execution in 'running'.
  try {
    await withRetry(async () => {
      const { error: upsertError } = await supabase
        .from('node_results')
        .upsert({
          execution_id: executionId,
          node_id: nodeId,
          session_id: sessionId,
          status: state.status || 'running',
          result_type: resolvedResultType,
          result_data: resolvedResultData,
          error: state.error,
          replicate_id: state.replicate_prediction_id,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'execution_id,node_id'
        });
      if (upsertError) throw new Error(upsertError.message);
    }, `node_results upsert for ${nodeId}`);
  } catch (err) {
    throw new Error(`Failed to update node state for ${nodeId}: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 2. If node is now finished, trigger the "Chain Reaction"
  if (state.status === 'completed' || state.status === 'failed') {
      // AWAIT the orchestrator — do NOT fire-and-forget.
      // In Next.js App Router, background promises are killed when the HTTP response
      // is returned from the route. Logs confirmed: orchestrator logged "Checking for
      // children" but never reached "Dispatching" because the request context ended.
      // Awaiting it keeps the orchestrator alive within the full call chain.
      try {
          await checkAndDispatchChildren(executionId, nodeId, baseUrl);
      } catch (err) {
          console.error(`[Dispatch] Orchestrator error for node ${nodeId}:`, err);
      }
  } else if (state.status === 'running') {
    // Ensure overall execution is marked as running
    await supabase
      .from('executions')
      .update({ status: 'running', updated_at: new Date().toISOString() })
      .eq('id', executionId)
      .eq('status', 'pending');
  }
  
  console.log(`[Dispatch] Updated node state for ${nodeId} to ${state.status}`);
}

/**
 * Log an execution event
 */
async function logExecutionEvent(
  executionId: string,
  nodeId: string,
  eventType: string,
  payload: Record<string, any> = {}
): Promise<void> {
  
  const supabase = createServiceClient();
  
  // V3: log_execution_event RPC might be dropped, so we use console as fallback
  console.log(`[ExecutionEvent] ${executionId}/${nodeId} - ${eventType}:`, payload);
  
  /*
  const { error } = await supabase.rpc('log_execution_event', {
    p_execution_id: executionId,
    p_node_id: nodeId,
    p_event_type: eventType,
    p_payload: payload,
  });
  
  if (error) {
    console.error(`[Dispatch] Failed to log event:`, error);
  }
  */
}

/**
 * Check if a node requires Replicate execution
 * 
 * DYNAMIC: Checks if node has a model field, not a hardcoded list.
 * Any node with model/version is considered a Replicate node.
 */
function isReplicateNode(nodeConfig: NodeConfig): boolean {
  // Check V1 format (data.config.model_id) or V2 flattened format (data.model)
  return !!(
    nodeConfig.data?.model || 
    nodeConfig.data?.version || 
    nodeConfig.data?.config?.model_id ||
    nodeConfig.type === 'ai_generator'
  );
}
