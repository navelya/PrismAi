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
  nodeId: string,
  sessionId?: string
): Promise<{ success: boolean; result_url?: string; error?: string }> {
  
  console.log(`[EphemeralExecutor] Processing node ${nodeId} in execution ${executionId} (Session: ${sessionId})`);
  
  const supabase = createServiceClient();
  let currentSessionId = sessionId;
  
  try {
    // 1. Fetch current execution state
    const { data: execution, error: fetchError } = await supabase
      .from('executions')
      .select('*')
      .eq('id', executionId)
      .single();
    
    if (fetchError || !execution) {
      throw new Error(`Execution ${executionId} not found`);
    }
    
    if (!currentSessionId) currentSessionId = execution.session_id;
    
    // V3: Graph is now in executions.graph_json (if added) or fetched from sessions
    // For now, we assume graph_json is added or we fallback to session
    let graph: GraphJson = execution.graph_json;
    
    if (!graph) {
      const { data: session } = await supabase
        .from('sessions')
        .select('canvas_state')
        .eq('id', execution.session_id)
        .single();
      graph = session?.canvas_state;
    }

    if (!graph) {
      throw new Error(`Graph not found for execution ${executionId}`);
    }

    // V3: Get node states from node_results table
    const { data: results } = await supabase
      .from('node_results')
      .select('*')
      .eq('execution_id', executionId);
    
    const nodeStates: Record<string, any> = {};
    (results || []).forEach(r => {
      nodeStates[r.node_id] = {
        status: r.status,
        result_url: r.result_url,
        error: r.error
      };
    });
    
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
    
    // 7. Update node state to completed in node_results
    const { error: updateError } = await supabase
      .from('node_results')
      .upsert({
        execution_id: executionId,
        node_id: nodeId,
        session_id: currentSessionId,
        status: 'completed',
        result_url: resultUrl,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'execution_id,node_id'
      });
    
    if (updateError) {
      throw new Error(`Failed to update node state: ${updateError.message}`);
    }
    
    console.log(`[EphemeralExecutor] Node ${nodeId} completed successfully`);
    
    return { success: true, result_url: resultUrl };
    
  } catch (error) {
    console.error(`[EphemeralExecutor] ❌ Error in node ${nodeId}:`, error);
    
    // Mark as failed in DB
    try {
      await supabase
        .from('node_results')
        .upsert({
          execution_id: executionId,
          node_id: nodeId,
          session_id: currentSessionId,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Execution failed',
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'execution_id,node_id'
        });
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
