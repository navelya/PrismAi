/**
 * Workflow Engine v2 - Dispatch Logic
 * Handles dispatching nodes to Replicate or ephemeral execution
 */

import { replicate } from '@/lib/ai/replicate-client';
import { createServiceClient } from '@/lib/supabase/service';
import { NodeConfig, NodeState } from './types-v2';
import { isEphemeralNode } from './handlers';
import { executeEphemeralNode } from './ephemeral-executor';
import { inferResultTypeFromValue, toResultDataForType } from './result-format';

const WEBHOOK_BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

import { checkAndDispatchChildren } from './orchestrator';

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
    console.error(`[Dispatch] Error dispatching node ${nodeId}:`, error);
    
    await updateNodeState(executionId, nodeId, {
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown dispatch error',
    }, sessionId, currentBaseUrl);
    
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown dispatch error' 
    };
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
      throw new Error(result.error || 'Ephemeral execution failed');
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

import { aiGeneratorExecutor } from '../nodes/core/ai-generator-executor';

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
    
    const result = await aiGeneratorExecutor(config, inputs, {
      sessionId: sessionId || 'server-execution',
      executionId: executionId,
      nodeId: nodeId,
      workflowId: executionId,
      data: nodeConfig.data
    });
    
    if (!result.success) {
      throw new Error(result.error || 'AI Generator Executor failed');
    }
    
      if (result.status === 'success') {
        const rawData = result.data;
        const resultType = inferResultTypeFromValue(rawData);
        const resultData = toResultDataForType(resultType, rawData);
        
        console.log(`[Dispatch/Replicate] ✅ Synchronous typed result for node ${nodeId}: ${resultType} (${resultData.length} item(s))`);
        
        await updateNodeState(executionId, nodeId, {
            status: 'completed',
            result_type: resultType,
            result_data: resultData,
            dispatched_at: new Date().toISOString(),
            completed_at: new Date().toISOString()
        }, sessionId, baseUrl);
    } else {
        // PRODUCTION: Asynchronous result via Webhook
        await updateNodeState(executionId, nodeId, {
            status: 'running',
            replicate_prediction_id: (result.data as any)?.id,
            dispatched_at: new Date().toISOString(),
        }, sessionId, baseUrl);
    }
    
    return { success: true, data: result.data };
    
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
  
  // 1. Update node_results table (Engine source of truth)
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
  
  if (upsertError) {
    throw new Error(`Failed to update node state for ${nodeId}: ${upsertError.message}`);
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
