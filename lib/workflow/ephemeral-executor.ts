/**
 * Workflow Engine v2 - Ephemeral Node Executor
 * Core logic for executing non-AI transformation nodes
 */

import { createServiceClient } from '@/lib/supabase/service';
import { EPHEMERAL_HANDLERS } from './handlers';
import { GraphJson, NodeState, NodeConfig } from './types-v2';

/**
 * Execute an ephemeral node directly on the server
 */
export async function executeEphemeralNode(
  executionId: string, 
  nodeId: string
): Promise<{ success: boolean; result_url?: string; error?: string }> {
  
  console.log(`[EphemeralExecutor] Processing node ${nodeId} in execution ${executionId}`);
  
  const supabase = createServiceClient();
  
  try {
    // 1. Fetch current execution state
    const { data: execution, error: fetchError } = await supabase
      .from('executions_v2')
      .select('*')
      .eq('id', executionId)
      .single();
    
    if (fetchError || !execution) {
      throw new Error(`Execution ${executionId} not found`);
    }
    
    const graph: GraphJson = execution.graph_json;
    const nodeStates: Record<string, NodeState> = execution.node_states;
    
    // 2. Find the node configuration
    const node = graph.nodes.find(n => n.id === nodeId);
    if (!node) {
      throw new Error(`Node ${nodeId} not found in graph`);
    }
    
    // 3. Get handler for this node type
    const handler = EPHEMERAL_HANDLERS[node.type];
    if (!handler) {
      throw new Error(`No handler found for node type: ${node.type}`);
    }
    
    // 4. Build inputs from upstream nodes
    const inputs = buildNodeInputs(nodeId, graph, nodeStates);
    
    console.log(`[EphemeralExecutor] Executing ${node.type} handler`);
    
    // 5. Execute handler logic
    const output = await handler(node.data || {}, inputs);
    
    // 6. Handle output (Upload if buffer, store directly if string)
    const isBuffer = Buffer.isBuffer(output);
    const isString = typeof output === 'string';
    
    let resultUrl: string | undefined;
    
    if (isBuffer) {
      console.log(`[EphemeralExecutor] Uploading buffer output (${output.length} bytes)`);
      
      const filename = `${executionId}/${nodeId}/${Date.now()}.png`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('workflow-ephemeral-tmp')
        .upload(filename, output, {
          contentType: 'image/png',
          cacheControl: '3600',
        });
      
      if (uploadError) {
        throw new Error(`Storage upload failed: ${uploadError.message}`);
      }
      
      const { data: urlData } = supabase.storage
        .from('workflow-ephemeral-tmp')
        .getPublicUrl(filename);
      
      resultUrl = urlData.publicUrl;
      
    } else if (isString) {
      resultUrl = output;
      console.log(`[EphemeralExecutor] Text output stored`);
    }
    
    // 7. Update node state to completed
    const updatedNodeStates = {
      ...nodeStates,
      [nodeId]: {
        ...nodeStates[nodeId],
        status: 'completed',
        result_url: resultUrl,
        completed_at: new Date().toISOString(),
      },
    };
    
    const { error: updateError } = await supabase
      .from('executions_v2')
      .update({
        node_states: updatedNodeStates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', executionId);
    
    if (updateError) {
      throw new Error(`Failed to update node state: ${updateError.message}`);
    }
    
    // 8. Log completion event
    await supabase.rpc('log_execution_event', {
      p_execution_id: executionId,
      p_node_id: nodeId,
      p_event_type: 'completed',
      p_payload: { 
        result_url: resultUrl,
        handler: node.type,
        output_type: isBuffer ? 'buffer' : 'string',
      },
    });
    
    console.log(`[EphemeralExecutor] Node ${nodeId} completed successfully`);
    
    // 9. TRIGGER NEXT DISPATCH
    // We NO LONGER call checkAndDispatch directly here.
    // Instead, we rely on the Supabase Database Webhook to trigger the next step.
    // This is the "Durable Handover" pattern used by companies like Weavy.
    console.log(`[EphemeralExecutor] Node ${nodeId} finished. Handing over to Database Webhook for next dispatch.`);
    
    return { success: true, result_url: resultUrl };
    
  } catch (error) {
    console.error(`[EphemeralExecutor] ❌ Error in node ${nodeId}:`, error);
    
    // Mark as failed in DB
    try {
      const { data: current } = await supabase.from('executions_v2').select('node_states').eq('id', executionId).single();
      if (current) {
        const failedStates = {
          ...current.node_states,
          [nodeId]: {
            ...current.node_states[nodeId],
            status: 'failed',
            error: error instanceof Error ? error.message : 'Execution failed',
            completed_at: new Date().toISOString(),
          }
        };
        await supabase.from('executions_v2').update({ node_states: failedStates }).eq('id', executionId);
      }
    } catch (dbErr) {
       console.error('[EphemeralExecutor] Could not update failed status:', dbErr);
    }
    
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Internal server error' 
    };
  }
}

/**
 * Build inputs helper
 */
function buildNodeInputs(
  nodeId: string,
  graph: GraphJson,
  nodeStates: Record<string, NodeState>
): Record<string, any> {
  const inputs: Record<string, any> = {};
  const incomingEdges = (graph.edges || []).filter(edge => edge.target === nodeId);
  
  for (const edge of incomingEdges) {
    const sourceNodeState = nodeStates[edge.source];
    if (sourceNodeState?.status === 'completed') {
      const inputKey = edge.targetHandle || edge.sourceHandle || 'image';
      inputs[inputKey] = sourceNodeState.result_url || sourceNodeState.output;
    }
  }
  return inputs;
}
