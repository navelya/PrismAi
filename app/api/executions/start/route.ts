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
    const { session_id, workflow, user_id, targetNodeId, mode } = body;
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
    const allUniqueNodes = Array.from(uniqueNodesMap.values());
    
    // Determine which nodes to actually execute
    let nodesToExecute = [...allUniqueNodes];
    if (targetNodeId && mode === 'solo') {
        nodesToExecute = allUniqueNodes.filter(n => n.id === targetNodeId);
    } else if (targetNodeId && mode === 'chain') {
        // Simple BFS to find descendants
        const descendants = new Set<string>();
        const queue = [targetNodeId];
        while (queue.length > 0) {
            const current = queue.shift()!;
            const outgoingEdges = (graph_json.edges || []).filter(e => e.source === current);
            for (const edge of outgoingEdges) {
                if (!descendants.has(edge.target)) {
                    descendants.add(edge.target);
                    queue.push(edge.target);
                }
            }
        }
        nodesToExecute = allUniqueNodes.filter(n => n.id === targetNodeId || descendants.has(n.id));
    } else if (targetNodeId && mode === 'ab_test') {
        nodesToExecute = allUniqueNodes.filter(n => n.id === targetNodeId);
    }
    
    console.log(`[Execution/Start] Starting execution for session ${session_id} with ${nodesToExecute.length} execution nodes (from ${graph_json.nodes.length} total)`);
    
    const supabase = createServiceClient();
    
    // Create execution record with graph snapshot
    const { data: execution, error: createError } = await supabase
      .from('executions')
      .insert({
        session_id,
        status: 'pending',
        graph_json: { ...graph_json, nodes: allUniqueNodes }, // Save full deduplicated graph for context
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
    
    // Initialize node_results for execution nodes so the UI sees them as pending
    const initialNodeResults = nodesToExecute.map((node: NodeConfig) => ({
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
    
    
    // Create map for node results, seeded with historical successful results
    // so chained API requests can access upstream outputs from previous executions
    const resultUrlMap = new Map();
    
    const { data: previousExecutions } = await supabase
        .from('executions')
        .select('id')
        .eq('session_id', session_id)
        .order('created_at', { ascending: false });
        
    if (previousExecutions && previousExecutions.length > 0) {
        const pExecIds = previousExecutions.map(e => e.id);
        const { data: previousResults } = await supabase
            .from('node_results')
            .select('node_id, result_url')
            .in('execution_id', pExecIds)
            .eq('status', 'completed')
            .order('created_at', { ascending: true }); // Ascending so newest overrides older
            
        if (previousResults) {
            previousResults.forEach(r => {
                if (r.result_url) resultUrlMap.set(r.node_id, r.result_url);
            });
        }
    }
    
    console.log(`[Execution/Start] Seeded ${resultUrlMap.size} historical result URLs for AI chaining`);

    // SIMPLE V3 SEQUENTIAL DISPATCH:
    // 1. Dispatch ephemeral nodes (like prompts) and wait for them to finish.
    // 2. Fetch their results.
    // 3. Dispatch Replicate nodes with the resolved inputs.
    
    const ephemeralNodes = nodesToExecute.filter(node => isEphemeralNode(node.type));
    const aiNodes = nodesToExecute.filter(node => !isEphemeralNode(node.type));
    
    // Step 1: Run ephemeral nodes sequentially
    for (const node of ephemeralNodes) {
        try {
            const dispatchResult = await dispatchNode(execution.id, node.id, node, {}, origin);
            if (dispatchResult.success && dispatchResult.data !== undefined) {
                resultUrlMap.set(node.id, dispatchResult.data);
            }
        } catch (err) {
            console.error(`[Execution/Start] Error dispatching ephemeral node ${node.id}:`, err);
        }
    }
    
    // Step 3: Dispatch AI nodes with resolved inputs
    console.log(`[Execution/Start] Graph edges:`, JSON.stringify(graph_json.edges, null, 2));
    
    const aiDispatchPromises = aiNodes.map(async (node: NodeConfig) => {
        // Build inputs based on edges targeting this node
        const inputs: Record<string, any> = {};
        const incomingEdges = (graph_json.edges || []).filter((e: any) => e.target === node.id);
        
        for (const edge of incomingEdges) {
            const result = resultUrlMap.get(edge.source);
            if (result) {
                const sourceNode = allUniqueNodes.find(n => n.id === edge.source);
                const inputKey = edge.targetHandle || edge.sourceHandle || 'image';
                
                // If the source is a prompt node, map its result directly to the 'prompt' input
                if (sourceNode?.type === 'prompt') {
                    inputs['prompt'] = result;
                } else {
                    inputs[inputKey] = result;
                    if (inputKey.toLowerCase().includes('prompt')) {
                        inputs['prompt'] = result;
                    }
                }
            }
        }
        
        console.log(`[Execution/Start] Mapped inputs for AI node ${node.id}:`, inputs);
        
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
