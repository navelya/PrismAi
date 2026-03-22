/**
 * Workflow Engine v2 - Dispatch Logic
 * Handles dispatching nodes to Replicate or ephemeral execution
 */

import { replicate } from '@/lib/ai/replicate-client';
import { createServiceClient } from '@/lib/supabase/service';
import { NodeConfig, NodeState } from './types-v2';
import { isEphemeralNode } from './handlers';

const WEBHOOK_BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

/**
 * Main dispatch function - routes to appropriate handler based on node type
 */
export async function dispatchNode(
  executionId: string,
  nodeId: string,
  nodeConfig: NodeConfig,
  inputs: Record<string, any> = {}
): Promise<{ success: boolean; error?: string }> {
  console.log(`[Dispatch] Starting dispatch for node ${nodeId} in execution ${executionId}`);
  
  const supabase = createServiceClient();
  
  try {
    // STEP 5: Check if this is an ephemeral node
    const nodeType = nodeConfig.type;
    
    if (isEphemeralNode(nodeType)) {
      return await dispatchEphemeralNode(executionId, nodeId, nodeConfig, inputs);
    }
    
    // Check if this is a Replicate-based node (dynamic check based on model field)
    if (isReplicateNode(nodeConfig)) {
      return await dispatchReplicateNode(executionId, nodeId, nodeConfig, inputs);
    }
    
    // Unsupported node type
    console.error(`[Dispatch] Unknown node type: ${nodeType} - no model field and not ephemeral`);
    
    // Update node state to failed
    await updateNodeState(executionId, nodeId, {
      status: 'failed',
      error: `Unsupported node type: ${nodeType}`,
    });
    
    return { success: false, error: `Unsupported node type: ${nodeType}` };
    
  } catch (error) {
    console.error(`[Dispatch] Error dispatching node ${nodeId}:`, error);
    
    await updateNodeState(executionId, nodeId, {
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown dispatch error',
    });
    
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
  inputs: Record<string, any>
): Promise<{ success: boolean; error?: string }> {
  
  console.log(`[Dispatch/Ephemeral] Dispatching node ${nodeId}`, { nodeType: nodeConfig.type });
  
  try {
    // Update node state to running
    await updateNodeState(executionId, nodeId, {
      status: 'running',
      dispatched_at: new Date().toISOString(),
    });
    
    // Log dispatch event
    await logExecutionEvent(executionId, nodeId, 'dispatched', {
      handler: nodeConfig.type,
      ephemeral: true,
    });
    
    // Call internal API to process ephemeral node
    const response = await fetch(`${WEBHOOK_BASE_URL}/api/executions/dispatch-ephemeral`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        execution_id: executionId,
        node_id: nodeId,
      }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ephemeral dispatch failed: ${error}`);
    }
    
    console.log(`[Dispatch/Ephemeral] Successfully dispatched node ${nodeId}`);
    
    return { success: true };
    
  } catch (error) {
    console.error(`[Dispatch/Ephemeral] Error:`, error);
    throw error;
  }
}

/**
 * Dispatch a node to Replicate API
 */
async function dispatchReplicateNode(
  executionId: string,
  nodeId: string,
  nodeConfig: NodeConfig,
  inputs: Record<string, any>
): Promise<{ success: boolean; error?: string }> {
  
  console.log(`[Dispatch/Replicate] Dispatching node ${nodeId}`, { nodeConfig, inputs });
  
  try {
    // Build Replicate input from node config and upstream inputs
    const replicateInput = buildReplicateInput(nodeConfig, inputs);
    
    // Get model version from node config
    const model = nodeConfig.data.model || nodeConfig.data.version;
    
    if (!model) {
      throw new Error('No model specified in node configuration');
    }
    
    // Construct webhook URL with context parameters
    const webhookUrl = `${WEBHOOK_BASE_URL}/api/webhooks/replicate-v2?executionId=${executionId}&nodeId=${nodeId}`;
    
    // TIER 2 FIX: Detailed webhook URL logging for debugging
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('[Dispatch/Replicate] 🔔 WEBHOOK URL DEBUG:');
    console.log('  Environment WEBHOOK_BASE_URL:', WEBHOOK_BASE_URL);
    console.log('  Full webhook URL:', webhookUrl);
    console.log('  Execution ID:', executionId);
    console.log('  Node ID:', nodeId);
    console.log('  Model:', model);
    console.log('═══════════════════════════════════════════════════════════════');
    
    // Create prediction with webhook
    const prediction = await replicate.predictions.create({
      version: model,
      input: replicateInput,
      webhook: webhookUrl,
      webhook_events_filter: ['completed'],
    });
    
    console.log(`[Dispatch/Replicate] ✅ Prediction created:`, {
      predictionId: prediction.id,
      status: prediction.status,
    });
    
    // Update node state to running with prediction ID
    await updateNodeState(executionId, nodeId, {
      status: 'running',
      replicate_prediction_id: prediction.id,
      dispatched_at: new Date().toISOString(),
    });
    
    // Log event
    await logExecutionEvent(executionId, nodeId, 'dispatched', {
      replicate_prediction_id: prediction.id,
      model,
    });
    
    return { success: true };
    
  } catch (error) {
    console.error(`[Dispatch/Replicate] Error:`, error);
    throw error;
  }
}

/**
 * Build Replicate input from node config and upstream inputs
 */
function buildReplicateInput(
  nodeConfig: NodeConfig,
  upstreamInputs: Record<string, any>
): Record<string, any> {
  
  const baseInput = nodeConfig.data.input || {};
  
  // Merge upstream outputs into the input
  // For now, simple merge - later we'll add proper input mapping
  const input = {
    ...baseInput,
    ...upstreamInputs,
  };
  
  // Special handling for common fields
  if (nodeConfig.data.prompt) {
    input.prompt = nodeConfig.data.prompt;
  }
  
  console.log(`[Dispatch] Built Replicate input:`, input);
  
  return input;
}

/**
 * Update node state in the executions_v2 table
 */
async function updateNodeState(
  executionId: string,
  nodeId: string,
  state: Partial<NodeState>
): Promise<void> {
  
  const supabase = createServiceClient();
  
  // Fetch current execution
  const { data: execution, error: fetchError } = await supabase
    .from('executions_v2')
    .select('node_states, status')
    .eq('id', executionId)
    .single();
  
  if (fetchError || !execution) {
    throw new Error(`Failed to fetch execution ${executionId}: ${fetchError?.message}`);
  }
  
  // Update the specific node state
  const updatedNodeStates = {
    ...execution.node_states,
    [nodeId]: {
      ...(execution.node_states[nodeId] || {}),
      ...state,
    },
  };
  
  // Update execution status if needed
  let executionStatus = execution.status;
  if (state.status === 'running' && execution.status === 'pending') {
    executionStatus = 'running';
  }
  
  // Write back to database
  const { error: updateError } = await supabase
    .from('executions_v2')
    .update({
      node_states: updatedNodeStates,
      status: executionStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', executionId);
  
  if (updateError) {
    throw new Error(`Failed to update execution ${executionId}: ${updateError.message}`);
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
  
  const { error } = await supabase.rpc('log_execution_event', {
    p_execution_id: executionId,
    p_node_id: nodeId,
    p_event_type: eventType,
    p_payload: payload,
  });
  
  if (error) {
    console.error(`[Dispatch] Failed to log event:`, error);
    // Don't throw - logging errors shouldn't break the flow
  }
}

/**
 * Check if a node requires Replicate execution
 * 
 * DYNAMIC: Checks if node has a model field, not a hardcoded list.
 * Any node with model/version is considered a Replicate node.
 */
function isReplicateNode(nodeConfig: NodeConfig): boolean {
  // If node has model or version field, it needs Replicate
  return !!(nodeConfig.data?.model || nodeConfig.data?.version);
}
