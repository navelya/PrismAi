/**
 * Workflow Engine v2 - DAG Orchestrator
 * Core reactive engine that resolves dependencies and triggers child nodes
 */

import { createServiceClient } from '@/lib/supabase/service';
import { GraphJson, NodeConfig } from './types-v2';
import { dispatchNode } from './dispatch-v2';

/**
 * Triggered when a node completes. Checks if its children are ready and dispatches them.
 * This is the core "Chain Reaction" logic.
 */
export async function checkAndDispatchChildren(
  executionId: string,
  completedNodeId: string,
  baseUrl?: string
): Promise<void> {
  console.log(`[Orchestrator] Node ${completedNodeId} finished. Checking for children in execution ${executionId}...`);
  
  const supabase = createServiceClient();
  
  try {
    // 1. Fetch the immutable graph snapshot for this execution
    const { data: execution, error: execError } = await supabase
      .from('executions')
      .select('graph_json, session_id')
      .eq('id', executionId)
      .single();
      
    if (execError || !execution) {
      console.error(`[Orchestrator] Failed to fetch execution snapshot:`, execError);
      return;
    }
    
    const graph: GraphJson = execution.graph_json as any;
    const sessionId = execution.session_id;
    
    // 2. Identify all direct successors (children) of the completed node
    const outgoingEdges = (graph.edges || []).filter(edge => edge.source === completedNodeId);
    
    if (outgoingEdges.length === 0) {
      console.log(`[Orchestrator] Node ${completedNodeId} has no children. Checking if workflow is finished.`);
      await updateExecutionFinalStatus(executionId);
      return;
    }
    
    // 3. For each successor, check if all ITS parents are completed
    const successorIds = Array.from(new Set(outgoingEdges.map(edge => edge.target)));
    
    console.log(`[Orchestrator] Found ${successorIds.length} potential successors: ${successorIds.join(', ')}`);
    
    for (const childId of successorIds) {
      const childNode = graph.nodes.find(n => n.id === childId);
      if (!childNode) continue;
      
      // Readiness Check: Are all parents of this child completed?
      const parentEdges = (graph.edges || []).filter(edge => edge.target === childId);
      const parentIds = parentEdges.map(edge => edge.source);
      
      const { data: parentResults, error: resultsError } = await supabase
        .from('node_results')
        .select('node_id, status')
        .eq('execution_id', executionId)
        .in('node_id', parentIds);
        
      if (resultsError) {
        console.error(`[Orchestrator] Failed to check parent results for child ${childId}:`, resultsError);
        continue;
      }
      
      const allParentsCompleted = parentIds.every(pid => 
        parentResults?.some(r => r.node_id === pid && r.status === 'completed')
      );
      
      if (allParentsCompleted) {
        console.log(`[Orchestrator] ✅ All parents completed for child ${childId}. DISPATCHING.`);
        
        // Build inputs for the child from its completed parents
        const inputs = await buildInputsFromParents(executionId, childId, graph);
        
        // Dispatch child node
        await dispatchNode(executionId, childId, childNode, inputs, baseUrl, sessionId);
      } else {
        const incomplete = parentIds.filter(pid => 
          !parentResults?.some(r => r.node_id === pid && r.status === 'completed')
        );
        console.log(`[Orchestrator] ⏳ Child ${childId} is still waiting for parents: ${incomplete.join(', ')}`);
      }
    }
    
  } catch (error) {
    console.error(`[Orchestrator] Unexpected error in checkAndDispatchChildren:`, error);
  }
}

/**
 * Builds an input object for a node by gathering result_urls from its parents
 */
async function buildInputsFromParents(
  executionId: string,
  nodeId: string,
  graph: GraphJson
): Promise<Record<string, any>> {
  const supabase = createServiceClient();
  const inputs: Record<string, any> = {};
  
  const incomingEdges = (graph.edges || []).filter(e => e.target === nodeId);
  const parentIds = incomingEdges.map(e => e.source);
  
  const { data: results } = await supabase
    .from('node_results')
    .select('node_id, result_url')
    .eq('execution_id', executionId)
    .in('node_id', parentIds)
    .eq('status', 'completed');
    
  if (!results) return inputs;
  
  for (const edge of incomingEdges) {
    const parentResult = results.find(r => r.node_id === edge.source);
    if (parentResult?.result_url) {
      const sourceNode = graph.nodes.find(n => n.id === edge.source);
      const inputKey = edge.targetHandle || edge.sourceHandle || 'image';
      
      // Special mapping for prompt nodes
      if (sourceNode?.type === 'prompt') {
        inputs['prompt'] = parentResult.result_url;
      } else {
        inputs[inputKey] = parentResult.result_url;
        // Fallback for nodes that expect 'prompt' but receive it via a generic 'output' handle
        if (inputKey.toLowerCase().includes('prompt')) {
          inputs['prompt'] = parentResult.result_url;
        }
      }
    }
  }
  
  return inputs;
}

/**
 * Checks if the entire execution (target set) is finished and updates the status.
 */
export async function updateExecutionFinalStatus(executionId: string): Promise<void> {
  const supabase = createServiceClient();
  
  try {
    // 1. Fetch graph snapshot to see all nodes that were supposed to run
    const { data: execution } = await supabase
      .from('executions')
      .select('graph_json')
      .eq('id', executionId)
      .single();
      
    if (!execution) return;
    const graph: GraphJson = execution.graph_json as any;
    const targetNodeIds = graph.nodes.map(n => n.id);
    
    // 2. Check current status of all nodes in target set
    const { data: results } = await supabase
      .from('node_results')
      .select('status')
      .eq('execution_id', executionId)
      .in('node_id', targetNodeIds);
      
    if (!results) return;
    
    const anyRunning = results.some(r => r.status === 'running' || r.status === 'pending');
    if (anyRunning) {
      console.log(`[Orchestrator] Execution ${executionId} still has active nodes. Staying in 'running'.`);
      return;
    }
    
    // 3. All finished! Determine if overall success or failure
    const anyFailed = results.some(r => r.status === 'failed');
    const finalStatus = anyFailed ? 'failed' : 'completed';
    
    console.log(`[Orchestrator] 🏁 All nodes finished in execution ${executionId}. Final Status: ${finalStatus}`);
    
    await supabase
      .from('executions')
      .update({
        status: finalStatus,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', executionId);
      
  } catch (error) {
    console.error(`[Orchestrator] Error updating final status:`, error);
  }
}
