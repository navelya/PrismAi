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
    
    // Determine which nodes to actually execute (The "Target Set")
    let nodesToExecute = [...allUniqueNodes];
    let edgesToInclude = [...(graph_json.edges || [])];

    if (targetNodeId) {
      const targetNode = allUniqueNodes.find(n => n.id === targetNodeId);
      if (!targetNode) {
        return NextResponse.json({ error: 'Target node not found' }, { status: 404 });
      }

      const relevantNodeIds = new Set<string>();
      
      if (mode === 'solo' || mode === 'chain') {
        // Mode 'solo' needs ancestors; Mode 'chain' needs ancestors AND descendants
        
        // 1. Always trace backwards to get required inputs (Ancestors)
        const ancestorQueue = [targetNodeId];
        relevantNodeIds.add(targetNodeId);
        
        while (ancestorQueue.length > 0) {
          const currentId = ancestorQueue.shift()!;
          const incomingEdges = edgesToInclude.filter(e => e.target === currentId);
          for (const edge of incomingEdges) {
            if (!relevantNodeIds.has(edge.source)) {
              const sourceNode = allUniqueNodes.find(n => n.id === edge.source);
              // In solo/chain mode, we pull in ephemeral ancestors automatically.
              // For AI ancestors, we only pull them in if we need their existing results.
              if (sourceNode) {
                relevantNodeIds.add(edge.source);
                ancestorQueue.push(edge.source);
              }
            }
          }
        }

        if (mode === 'chain') {
          // 2. Trace forwards to get descendants
          const descendantQueue = [targetNodeId];
          while (descendantQueue.length > 0) {
            const currentId = descendantQueue.shift()!;
            const outgoingEdges = edgesToInclude.filter(e => e.source === currentId);
            for (const edge of outgoingEdges) {
              if (!relevantNodeIds.has(edge.target)) {
                relevantNodeIds.add(edge.target);
                descendantQueue.push(edge.target);
              }
            }
          }
        }
      } else if (mode === 'ab_test') {
        relevantNodeIds.add(targetNodeId);
      }

      nodesToExecute = allUniqueNodes.filter(n => relevantNodeIds.has(n.id));
      edgesToInclude = edgesToInclude.filter(e => relevantNodeIds.has(e.source) && relevantNodeIds.has(e.target));
    }
    
    console.log(`[Execution/Start] Target Set: ${nodesToExecute.length} nodes, ${edgesToInclude.length} edges`);
    
    const supabase = createServiceClient();
    
    // Create execution record with a surgical snapshot of the TARGET subgraph
    const { data: execution, error: createError } = await supabase
      .from('executions')
      .insert({
        session_id,
        status: 'pending',
        graph_json: { nodes: nodesToExecute, edges: edgesToInclude },
      })
      .select()
      .single();
    
    if (createError || !execution) {
      console.error('[Execution/Start] Failed to create execution:', createError);
      return NextResponse.json({ error: `Failed to create execution: ${createError?.message}` }, { status: 500 });
    }
    
    console.log(`[Execution/Start] Created execution ${execution.id}`);
    
    const { origin } = new URL(request.url);
    
    // Initialize node_results for the entire target set
    const initialNodeResults = nodesToExecute.map((node: NodeConfig) => ({
        execution_id: execution.id,
        node_id: node.id,
        session_id: session_id,
        status: 'pending', // All start as pending
        updated_at: new Date().toISOString(),
    }));
    
    const { error: initError } = await supabase
      .from('node_results')
      .insert(initialNodeResults);
      
    if (initError) console.warn('[Execution/Start] Failed to initialize node_results:', initError);
    
    // IDENTIFY ROOT NODES: Nodes in the target set that have NO parents within the target set
    const rootNodes = nodesToExecute.filter(node => {
        const hasParentInSet = edgesToInclude.some(e => e.target === node.id);
        return !hasParentInSet;
    });
    
    console.log(`[Execution/Start] Kickoff: Dispatching ${rootNodes.length} root nodes: ${rootNodes.map(n => n.id).join(', ')}`);

    // We don't need a resultUrlMap here anymore because dispatchNode will now
    // internally fetch results from node_results via buildInputsFromParents or similar.
    // However, to keep it simple for the kickoff, we'll just dispatch with empty inputs
    // since root nodes by definition have no parents to provide inputs.

    const kickoffPromises = rootNodes.map(node => 
        dispatchNode(execution.id, node.id, node, {}, origin, session_id)
    );
    
    await Promise.all(kickoffPromises);
    
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
