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
import { serverRegistry } from '@/lib/nodes/core/server-registry';
import type { ExecutionContext, NodeExecutionResult } from '@/lib/nodes/types';
import { GraphJson, NodeState } from '@/lib/workflow/types-v2';
import {
  NodeResultType,
  getPrimaryInputValue,
  inferResultTypeFromValue,
  normalizeNodeResultType,
  toResultDataForType,
} from '@/lib/workflow/result-format';

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
      .from('executions')
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
    
    // V3: Get node states from node_results table
    const { data: results } = await supabase
      .from('node_results')
      .select('*')
      .eq('execution_id', execution_id);
    
    const nodeStates: Record<string, any> = {};
    (results || []).forEach(r => {
      nodeStates[r.node_id] = {
        status: r.status,
        result_type: r.result_type,
        result_data: r.result_data,
        error: r.error
      };
    });
    
    // Find the node
    const node = graph.nodes.find(n => n.id === node_id);
    if (!node) {
      console.error(`[API/Dispatch-Ephemeral] Node ${node_id} not found in graph`);
      return NextResponse.json(
        { error: 'Node not found in graph' },
        { status: 404 }
      );
    }
    
    // Get registry entry for this node type
    const def = serverRegistry[node.type];
    if (!def) {
      console.error(`[API/Dispatch-Ephemeral] No registry entry for node type: ${node.type}`);
      return NextResponse.json(
        { error: `No registry entry for node type: ${node.type}` },
        { status: 400 }
      );
    }

    // Build inputs from upstream nodes
    const inputs = await buildNodeInputs(node_id, graph, nodeStates, supabase);

    console.log(`[API/Dispatch-Ephemeral] Executing ${node.type} via serverRegistry`);

    // Execute via serverRegistry
    const config = (node.data as any)?.config ?? node.data ?? {};
    const ctx: ExecutionContext = {
      workflowId: (graph as any).id || '',
      executionId: execution_id,
      sessionId: execution.session_id,
      userId: execution.user_id,
      nodeId: node_id,
      data: {},
    };
    const result: NodeExecutionResult = await def.executor(config, inputs || {}, ctx);
    if (!result?.success) {
      throw new Error(result?.error || 'Executor returned failure');
    }
    const output = result.data; // remainder reads `output` to derive result_type/result_data

    // Determine output type
    let resultType: NodeResultType = 'json';
    let resultData: any[] = [];

    if (Array.isArray(output)) {
      const first = output[0];
      if (first && typeof first === 'object' && typeof (first as any).url === 'string') {
        resultType = 'image';
        resultData = output.map((d: any) => d.url);
      } else if (typeof first === 'string') {
        resultType = 'text';
        resultData = output;
      } else {
        resultType = inferResultTypeFromValue(output);
        resultData = toResultDataForType(resultType, output);
      }
    } else if (typeof output === 'string') {
      resultType = 'text';
      resultData = [output];
    } else if (output !== null && output !== undefined) {
      resultType = inferResultTypeFromValue(output);
      resultData = toResultDataForType(resultType, output);
    }
    
    // Update node state to completed
    await supabase
      .from('node_results')
      .upsert({
        execution_id: execution_id,
        node_id: node_id,
        session_id: execution.session_id,
        status: 'completed',
        result_type: resultType,
        result_data: resultData,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'execution_id,node_id'
      });
    
    // Log completion event
    await supabase.rpc('log_execution_event', {
      p_execution_id: execution_id,
      p_node_id: node_id,
      p_event_type: 'completed',
      p_payload: {
        result_type: resultType,
        result_data: resultData,
        node_type: node.type,
      },
    });
    
    console.log(`[API/Dispatch-Ephemeral] Node ${node_id} completed successfully`);
    
    // Return success (trigger will handle downstream dispatch)
    return NextResponse.json({
      success: true,
      node_id,
      result_type: resultType,
      result_data: resultData,
    });
    
  } catch (error) {
    console.error('[API/Dispatch-Ephemeral] Error:', error);
    
    // Try to mark node as failed
    try {
      const body = await request.json();
      const { execution_id, node_id } = body;
      
      if (execution_id && node_id) {
        const supabase = createServiceClient();
        
        const { data: result } = await supabase
          .from('node_results')
          .select('status')
          .eq('execution_id', execution_id)
          .eq('node_id', node_id)
          .single();
        
        if (result) {
          await supabase
            .from('node_results')
            .update({
              status: 'failed',
              error: error instanceof Error ? error.message : 'Unknown error',
              updated_at: new Date().toISOString(),
            })
            .eq('execution_id', execution_id)
            .eq('node_id', node_id);
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
      let value: any;
      if (sourceNodeState.result_type && sourceNodeState.result_data) {
        value = getPrimaryInputValue(
          normalizeNodeResultType(sourceNodeState.result_type),
          sourceNodeState.result_data
        );
      } else if (sourceNodeState.result_url) {
        value = sourceNodeState.result_url;
      } else if (sourceNodeState.output) {
        value = sourceNodeState.output;
      } else {
        continue;
      }

      // Key by BOTH the target handle id AND the edge id. Compositor layers
      // store `layer.sourceHandleId = edge.id` because every layer edge shares
      // the same static `layers` target handle, so per-edge id is the only way
      // to disambiguate which upstream value belongs to which layer. Mirrors
      // browser-side input map in lib/hooks/use-node-auto-compute.ts.
      inputs[inputKey] = value;
      if (edge.id) inputs[edge.id] = value;
    }
  }
  
  console.log(`[API/Dispatch-Ephemeral] Built inputs for node ${nodeId}:`, Object.keys(inputs));
  
  return inputs;
}
