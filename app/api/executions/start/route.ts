/**
 * Workflow Engine v2 - Start Execution Endpoint
 * API route to initialize and start a workflow execution
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { GraphJson, NodeConfig } from '@/lib/workflow/types-v2';
import { transformWorkflowV1ToV2 } from '@/lib/workflow/node-type-mapper';
import { dispatchNode } from '@/lib/workflow/dispatch-v2';
import { isEphemeralNode } from '@/lib/workflow/handlers';

export async function POST(request: NextRequest) {
  console.log('[Execution/Start] Received start execution request');
  
  try {
    const body = await request.json();
    const { session_id, workflow, user_id } = body;
    let graph_json: GraphJson = body.graph_json;
    
    // Validate required fields
    if (!session_id || (!graph_json && !workflow)) {
      return NextResponse.json(
        { error: 'Missing required fields: session_id, and either graph_json or workflow' },
        { status: 400 }
      );
    }

    // If workflow is provided (V1 format), transform it to graph_json (V2 format)
    if (workflow && !graph_json) {
      console.log('[Execution/Start] Transforming V1 workflow to V2 graph_json on server');
      try {
        graph_json = await transformWorkflowV1ToV2(workflow);
      } catch (transformError) {
        console.error('[Execution/Start] Transformation failed:', transformError);
        return NextResponse.json(
          { error: `Workflow transformation failed: ${transformError instanceof Error ? transformError.message : 'Unknown error'}` },
          { status: 500 }
        );
      }
    }
    
    // Validate graph structure
    if (!graph_json || !graph_json.nodes || !Array.isArray(graph_json.nodes)) {
      return NextResponse.json(
        { error: 'Invalid graph_json: must contain nodes array' },
        { status: 400 }
      );
    }
    
    // Deduplicate nodes by ID to prevent database constraint violations
    const uniqueNodesMap = new Map<string, NodeConfig>();
    graph_json.nodes.forEach((node: NodeConfig) => {
      uniqueNodesMap.set(node.id, node);
    });
    const uniqueNodes = Array.from(uniqueNodesMap.values());
    
    console.log(`[Execution/Start] Starting execution for session ${session_id} with ${uniqueNodes.length} unique nodes (from ${graph_json.nodes.length} total)`);
    
    const supabase = createServiceClient();
    
    // Create execution record with graph snapshot
    const { data: execution, error: createError } = await supabase
      .from('executions')
      .insert({
        session_id,
        status: 'pending',
        graph_json: { ...graph_json, nodes: uniqueNodes }, // Save deduplicated nodes
      })
      .select()
      .single();
    
    if (createError || !execution) {
      console.error('[Execution/Start] Failed to create execution:', createError);
      return NextResponse.json(
        { error: `Failed to create execution: ${createError?.message}` },
        { status: 500 }
      );
    }
    
    console.log(`[Execution/Start] Created execution ${execution.id}`);
    
    // Get the origin for webhook construction
    const { origin } = new URL(request.url);
    console.log(`[Execution/Start] Using origin for webhooks: ${origin}`);
    
    // Initialize node_results for all unique nodes so the UI sees them as pending
    const initialNodeResults = uniqueNodes.map((node: NodeConfig) => ({
      execution_id: execution.id,
      node_id: node.id,
      status: 'pending',
      updated_at: new Date().toISOString(),
    }));
    
    const { error: initError } = await supabase
      .from('node_results')
      .insert(initialNodeResults);
      
    if (initError) {
      console.warn('[Execution/Start] Failed to initialize node_results:', initError);
      // Non-critical, continue with dispatch
    }
    
    // SIMPLE V3 SEQUENTIAL DISPATCH:
    // 1. Dispatch ephemeral nodes (like prompts) and wait for them to finish.
    // 2. Fetch their results.
    // 3. Dispatch Replicate nodes with the resolved inputs.
    
    const ephemeralNodes = uniqueNodes.filter(node => isEphemeralNode(node.type));
    const aiNodes = uniqueNodes.filter(node => !isEphemeralNode(node.type));
    
    // Step 1: Run ephemeral nodes sequentially
    for (const node of ephemeralNodes) {
        try {
            await dispatchNode(execution.id, node.id, node, {}, origin);
        } catch (err) {
            console.error(`[Execution/Start] Error dispatching ephemeral node ${node.id}:`, err);
        }
    }
    
    // Step 2: Fetch results to build inputs for AI nodes
    const { data: currentResults } = await supabase
      .from('node_results')
      .select('*')
      .eq('execution_id', execution.id);
      
    const resultUrlMap = new Map();
    (currentResults || []).forEach(r => {
        if (r.status === 'completed' && r.result_url) {
            resultUrlMap.set(r.node_id, r.result_url);
        }
    });
    
    // Step 3: Dispatch AI nodes with resolved inputs
    const aiDispatchPromises = aiNodes.map(async (node: NodeConfig) => {
        // Build inputs based on edges targeting this node
        const inputs: Record<string, any> = {};
        const incomingEdges = (graph_json.edges || []).filter((e: any) => e.target === node.id);
        
        for (const edge of incomingEdges) {
            const result = resultUrlMap.get(edge.source);
            if (result) {
                const inputKey = edge.targetHandle || edge.sourceHandle || 'image';
                inputs[inputKey] = result;
                
                // Special mapping: if the edge is a prompt connection, ensure it maps to 'prompt'
                if (inputKey.toLowerCase().includes('prompt')) {
                    inputs['prompt'] = result;
                }
            }
        }
        
        return dispatchNode(execution.id, node.id, node, inputs, origin);
    });
    
    try {
        await Promise.all(aiDispatchPromises);
    } catch (err) {
        console.error('[Execution/Start] ❌ AI Dispatch error:', err);
    }
    
    // Return execution details
    return NextResponse.json({
      success: true,
      execution_id: execution.id,
      status: 'pending',
    });
    
  } catch (error) {
    console.error('[Execution/Start] Unexpected error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
