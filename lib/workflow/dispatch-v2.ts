/**
 * Workflow Engine v2 - Dispatch Logic
 * Handles dispatching nodes to Replicate or ephemeral execution
 */

import { replicate } from '@/lib/ai/replicate-client';
import { createServiceClient } from '@/lib/supabase/service';
import { NodeConfig, NodeState } from './types-v2';
import { isEphemeralNode } from './handlers';
import { executeEphemeralNode } from './ephemeral-executor';

const WEBHOOK_BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

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
  
  const supabase = createServiceClient();
  
  try {
    // STEP 5: Check if this is an ephemeral node
    const nodeType = nodeConfig.type;
    
    if (isEphemeralNode(nodeType)) {
      return await dispatchEphemeralNode(executionId, nodeId, nodeConfig, inputs, sessionId);
    }
    
    // Check if this is a Replicate-based node (dynamic check based on model field)
    if (isReplicateNode(nodeConfig)) {
      return await dispatchReplicateNode(executionId, nodeId, nodeConfig, inputs, currentBaseUrl, sessionId);
    }
    
    // Unsupported node type
    console.error(`[Dispatch] Unknown node type: ${nodeType} - no model field and not ephemeral`);
    
    // Update node state to failed
    await updateNodeState(executionId, nodeId, {
      status: 'failed',
      error: `Unsupported node type: ${nodeType}`,
    }, sessionId);
    
    return { success: false, error: `Unsupported node type: ${nodeType}` };
    
  } catch (error) {
    console.error(`[Dispatch] Error dispatching node ${nodeId}:`, error);
    
    await updateNodeState(executionId, nodeId, {
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown dispatch error',
    }, sessionId);
    
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
  sessionId?: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  
  console.log(`[Dispatch/Ephemeral] Executing node ${nodeId} DIRECTLY`, { nodeType: nodeConfig.type });
  
  try {
    // Update node state to running
    await updateNodeState(executionId, nodeId, {
      status: 'running',
      dispatched_at: new Date().toISOString(),
    }, sessionId);
    
    // Log dispatch event
    await logExecutionEvent(executionId, nodeId, 'dispatched', {
      handler: nodeConfig.type,
      ephemeral: true,
      execution_mode: 'direct'
    });
    
    // CALL DIRECTLY (This fixes the ECONNREFUSED localhost:3000 error)
    const result = await executeEphemeralNode(executionId, nodeId, sessionId);
    
    if (!result.success) {
      throw new Error(result.error || 'Ephemeral execution failed');
    }
    
    console.log(`[Dispatch/Ephemeral] ✅ Successfully executed node ${nodeId} directly`);
    
    return { success: true, data: result.result_url };
    
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
  
  console.log(`[Dispatch/Replicate] Dispatching node ${nodeId} via aiGeneratorExecutor`, { nodeConfig, inputs });
  
  try {
    // We pass the raw nodeConfig.data.config (where V1 stores settings) or nodeConfig.data
    const config = nodeConfig.data.config || nodeConfig.data || {};
    
    // Call the robust aiGeneratorExecutor which handles DB schema mapping
    const result = await aiGeneratorExecutor(config, inputs, {
      sessionId: 'server-execution', // Dummy for webhook validation
      executionId: executionId,
      nodeId: nodeId,
      workflowId: executionId,
      data: nodeConfig.data
    });
    
    if (!result.success) {
      throw new Error(result.error || 'AI Generator Executor failed');
    }
    
    // Update node state to running with prediction ID
    await updateNodeState(executionId, nodeId, {
      status: 'running',
      replicate_prediction_id: result.data?.id,
      dispatched_at: new Date().toISOString(),
    }, sessionId);
    
    // Log event
    await logExecutionEvent(executionId, nodeId, 'dispatched', {
      replicate_prediction_id: result.data?.id,
    });
    
    return { success: true, data: result.data };
    
  } catch (error) {
    console.error(`[Dispatch/Replicate] Error:`, error);
    throw error;
  }
}

// Remove the old buildReplicateInput since aiGeneratorExecutor handles it
// We also need to update isReplicateNode


/**
 * Update node state in the node_results table
 */
async function updateNodeState(
  executionId: string,
  nodeId: string,
  state: Partial<NodeState>,
  sessionId?: string
): Promise<void> {
  
  const supabase = createServiceClient();
  
  // V3: Update node_results table
  const { error: upsertError } = await supabase
    .from('node_results')
    .upsert({
      execution_id: executionId,
      node_id: nodeId,
      session_id: sessionId,
      status: state.status || 'running',
      result_url: state.result_url,
      error: state.error,
      replicate_id: state.replicate_prediction_id,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'execution_id,node_id'
    });
  
  if (upsertError) {
    throw new Error(`Failed to update node state for ${nodeId}: ${upsertError.message}`);
  }
  
  // Update execution status if needed
  if (state.status === 'running') {
    await supabase
      .from('executions')
      .update({
        status: 'running',
        updated_at: new Date().toISOString(),
      })
      .eq('id', executionId)
      .eq('status', 'pending'); // Only if currently pending
  }
  
  console.log(`[Dispatch] Updated node state for ${nodeId}:`, state);
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
