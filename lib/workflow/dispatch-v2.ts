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
  baseUrl?: string
): Promise<{ success: boolean; error?: string }> {
  const currentBaseUrl = baseUrl || WEBHOOK_BASE_URL;
  console.log(`[Dispatch] Starting dispatch for node ${nodeId} in execution ${executionId} (BaseURL: ${currentBaseUrl})`);
  
  const supabase = createServiceClient();
  
  try {
    // STEP 5: Check if this is an ephemeral node
    const nodeType = nodeConfig.type;
    
    if (isEphemeralNode(nodeType)) {
      return await dispatchEphemeralNode(executionId, nodeId, nodeConfig, inputs);
    }
    
    // Check if this is a Replicate-based node (dynamic check based on model field)
    if (isReplicateNode(nodeConfig)) {
      return await dispatchReplicateNode(executionId, nodeId, nodeConfig, inputs, currentBaseUrl);
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
  
  console.log(`[Dispatch/Ephemeral] Executing node ${nodeId} DIRECTLY`, { nodeType: nodeConfig.type });
  
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
      execution_mode: 'direct'
    });
    
    // CALL DIRECTLY (This fixes the ECONNREFUSED localhost:3000 error)
    const result = await executeEphemeralNode(executionId, nodeId);
    
    if (!result.success) {
      throw new Error(result.error || 'Ephemeral execution failed');
    }
    
    console.log(`[Dispatch/Ephemeral] ✅ Successfully executed node ${nodeId} directly`);
    
    return { success: true };
    
  } catch (error) {
    console.error(`[Dispatch/Ephemeral] ❌ Error:`, error);
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
  inputs: Record<string, any>,
  baseUrl: string
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
    const webhookUrl = `${baseUrl}/api/webhooks/replicate-v2?executionId=${executionId}&nodeId=${nodeId}`;
    
    // TIER 2 FIX: Detailed webhook URL logging for debugging
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('[Dispatch/Replicate] 🔔 WEBHOOK URL DEBUG:');
    console.log('  Using BaseURL:', baseUrl);
    console.log('  Full webhook URL:', webhookUrl);
    console.log('  Execution ID:', executionId);
    console.log('  Node ID:', nodeId);
    console.log('  Model:', model);
    console.log('═══════════════════════════════════════════════════════════════');
    
    // Create prediction with webhook
    // SDK handles 'version' as a 64-char string or 'model' as 'owner/name'
    const isVersionHash = /^[a-f0-9]{64}$/.test(model);
    
    const predictionOptions: any = {
      input: replicateInput,
      webhook: webhookUrl,
      webhook_events_filter: ['completed'],
    };

    if (isVersionHash) {
      predictionOptions.version = model;
    } else {
      predictionOptions.model = model;
    }

    console.log(`[Dispatch/Replicate] Calling Replicate API with:`, {
      ...predictionOptions,
      input: { ...replicateInput, prompt: (replicateInput.prompt as string)?.substring(0, 50) + '...' }
    });

    const prediction = await replicate.predictions.create(predictionOptions);
    
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
  
  // Extract all possible static inputs and control values from the UI
  const baseInput = nodeConfig.data.input || {};
  const controlValues = nodeConfig.data.control_values || {};
  
  // Dynamically concatenate options and edge inputs at the same level.
  // Upstream edge inputs OVERRIDE the default static UI control values.
  const input = {
    ...controlValues,
    ...baseInput,
    ...upstreamInputs,
  };
  
  // Clean up any empty strings or nulls from the static config that might 
  // accidentally override valid upstream data (e.g. prompt: "")
  for (const key in input) {
    if (input[key] === "" || input[key] === null || input[key] === undefined) {
      delete input[key];
    }
  }

  // Ensure prompt exists if we specifically extracted it in the mapper
  if (!input.prompt && nodeConfig.data.prompt) {
    input.prompt = nodeConfig.data.prompt;
  }
  
  console.log(`[Dispatch] Built Replicate input keys:`, Object.keys(input));
  
  return input;
}

/**
 * Update node state in the node_results table
 */
async function updateNodeState(
  executionId: string,
  nodeId: string,
  state: Partial<NodeState>
): Promise<void> {
  
  const supabase = createServiceClient();
  
  // V3: Update node_results table
  const { error: upsertError } = await supabase
    .from('node_results')
    .upsert({
      execution_id: executionId,
      node_id: nodeId,
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
  // If node has model or version field, it needs Replicate
  return !!(nodeConfig.data?.model || nodeConfig.data?.version);
}
