/**
 * Workflow Engine v2 - STEP 5: Dispatch Ephemeral Node
 * 
 * Handles server-side ephemeral node execution
 * Called by dispatch-v2.ts when node type is ephemeral
 * 
 * POST /api/executions/dispatch-ephemeral
 * Body: { execution_id: string, node_id: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { EPHEMERAL_HANDLERS } from '@/lib/workflow/handlers';
import { GraphJson, NodeState } from '@/lib/workflow/types-v2';

export async function POST(request: NextRequest) {
  console.log('[API/Dispatch-Ephemeral] Received request');
  
  try {
    // Parse request body
    const body = await request.json();
    const { execution_id, node_id } = body;
    
    if (!execution_id || !node_id) {
      return NextResponse.json(
        { error: 'Missing execution_id or node_id' },
        { status: 400 }
      );
    }
    
    console.log(`[API/Dispatch-Ephemeral] Processing node ${node_id} in execution ${execution_id}`);
    
    const supabase = createServiceClient();
    
    // Fetch execution
    const { data: execution, error: fetchError } = await supabase
      .from('executions_v2')
      .select('*')
      .eq('id', execution_id)
      .single();
    
    if (fetchError || !execution) {
      console.error('[API/Dispatch-Ephemeral] Execution not found:', fetchError);
      return NextResponse.json(
        { error: 'Execution not found' },
        { status: 404 }
      );
    }
    
    const graph: GraphJson = execution.graph_json;
    const nodeStates: Record<string, NodeState> = execution.node_states;
    
    // Find the node
    const node = graph.nodes.find(n => n.id === node_id);
    if (!node) {
      console.error(`[API/Dispatch-Ephemeral] Node ${node_id} not found in graph`);
      return NextResponse.json(
        { error: 'Node not found in graph' },
        { status: 404 }
      );
    }
    
    // Get handler for this node type
    const handler = EPHEMERAL_HANDLERS[node.type];
    if (!handler) {
      console.error(`[API/Dispatch-Ephemeral] No handler found for node type: ${node.type}`);
      return NextResponse.json(
        { error: `No handler for node type: ${node.type}` },
        { status: 400 }
      );
    }
    
    // Build inputs from upstream nodes
    const inputs = await buildNodeInputs(node_id, graph, nodeStates, supabase);
    
    console.log(`[API/Dispatch-Ephemeral] Executing handler for ${node.type}`);
    
    // Execute handler
    const output = await handler(node.data || {}, inputs);
    
    // Determine output type
    const isBuffer = Buffer.isBuffer(output);
    const isString = typeof output === 'string';
    
    let resultUrl: string | undefined;
    
    if (isBuffer) {
      // Upload to ephemeral storage
      console.log(`[API/Dispatch-Ephemeral] Uploading ${output.length} bytes to ephemeral storage`);
      
      const filename = `${execution_id}/${node_id}/${Date.now()}.png`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('workflow-ephemeral-tmp')
        .upload(filename, output, {
          contentType: 'image/png',
          cacheControl: '3600',
        });
      
      if (uploadError) {
        console.error('[API/Dispatch-Ephemeral] Upload failed:', uploadError);
        throw new Error(`Upload failed: ${uploadError.message}`);
      }
      
      // Get public URL
      const { data: urlData } = supabase.storage
        .from('workflow-ephemeral-tmp')
        .getPublicUrl(filename);
      
      resultUrl = urlData.publicUrl;
      console.log(`[API/Dispatch-Ephemeral] Uploaded to: ${resultUrl}`);
      
    } else if (isString) {
      // For text outputs (like prompt node), store directly
      resultUrl = output;
      console.log(`[API/Dispatch-Ephemeral] Text output: "${output.substring(0, 50)}..."`);
    }
    
    // Update node state to completed
    const updatedNodeStates = {
      ...nodeStates,
      [node_id]: {
        ...nodeStates[node_id],
        status: 'completed',
        result_url: resultUrl,
        completed_at: new Date().toISOString(),
      },
    };
    
    await supabase
      .from('executions_v2')
      .update({
        node_states: updatedNodeStates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', execution_id);
    
    // Log completion event
    await supabase.rpc('log_execution_event', {
      p_execution_id: execution_id,
      p_node_id: node_id,
      p_event_type: 'completed',
      p_payload: { 
        result_url: resultUrl,
        handler: node.type,
        output_type: isBuffer ? 'buffer' : 'string',
      },
    });
    
    console.log(`[API/Dispatch-Ephemeral] Node ${node_id} completed successfully`);
    
    // Return success (trigger will handle downstream dispatch)
    return NextResponse.json({
      success: true,
      node_id,
      result_url: resultUrl,
    });
    
  } catch (error) {
    console.error('[API/Dispatch-Ephemeral] Error:', error);
    
    // Try to mark node as failed
    try {
      const body = await request.json();
      const { execution_id, node_id } = body;
      
      if (execution_id && node_id) {
        const supabase = createServiceClient();
        
        const { data: execution } = await supabase
          .from('executions_v2')
          .select('node_states')
          .eq('id', execution_id)
          .single();
        
        if (execution) {
          const updatedNodeStates = {
            ...execution.node_states,
            [node_id]: {
              ...execution.node_states[node_id],
              status: 'failed',
              error: error instanceof Error ? error.message : 'Unknown error',
              completed_at: new Date().toISOString(),
            },
          };
          
          await supabase
            .from('executions_v2')
            .update({
              node_states: updatedNodeStates,
              updated_at: new Date().toISOString(),
            })
            .eq('id', execution_id);
        }
      }
    } catch (markError) {
      console.error('[API/Dispatch-Ephemeral] Failed to mark node as failed:', markError);
    }
    
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Build inputs for a node from its upstream dependencies
 */
async function buildNodeInputs(
  nodeId: string,
  graph: GraphJson,
  nodeStates: Record<string, NodeState>,
  supabase: any
): Promise<Record<string, any>> {
  
  const inputs: Record<string, any> = {};
  
  // Find all incoming edges
  const incomingEdges = (graph.edges || []).filter(edge => edge.target === nodeId);
  
  for (const edge of incomingEdges) {
    const sourceNodeState = nodeStates[edge.source];
    
    if (sourceNodeState?.status === 'completed') {
      // Use targetHandle as the input key, or default to 'image'
      const inputKey = edge.targetHandle || edge.sourceHandle || 'image';
      
      // Get the output from the source node
      if (sourceNodeState.result_url) {
        inputs[inputKey] = sourceNodeState.result_url;
      } else if (sourceNodeState.output) {
        inputs[inputKey] = sourceNodeState.output;
      }
    }
  }
  
  console.log(`[API/Dispatch-Ephemeral] Built inputs for node ${nodeId}:`, Object.keys(inputs));
  
  return inputs;
}