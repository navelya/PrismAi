/**
 * Workflow Engine v2 - Check and Dispatch
 * Analyzes execution state and dispatches ready nodes
 */

import { createServiceClient } from '@/lib/supabase/service';
import { GraphJson, NodeState } from './types-v2';
import { dispatchNode } from './dispatch-v2';

/**
 * Main check-and-dispatch function
 * Analyzes current execution state and dispatches all ready nodes
 */
export async function checkAndDispatch(executionId: string): Promise<void> {
  console.log(`[Check-and-Dispatch] Starting for execution ${executionId}`);
  
  const supabase = createServiceClient();
  
  try {
    // Fetch current execution state
    const { data: execution, error: fetchError } = await supabase
      .from('executions_v2')
      .select('*')
      .eq('id', executionId)
      .single();
    
    if (fetchError || !execution) {
      console.error(`[Check-and-Dispatch] Execution ${executionId} not found:`, fetchError);
      return;
    }
    
    // Don't dispatch if execution is already completed/failed/cancelled
    if (['completed', 'failed', 'cancelled'].includes(execution.status)) {
      console.log(`[Check-and-Dispatch] Execution ${executionId} is ${execution.status}, skipping`);
      return;
    }
    
    const graph: GraphJson = execution.graph_json;
    const nodeStates: Record<string, NodeState> = execution.node_states;
    
    // Find all pending nodes
    const pendingNodes = graph.nodes.filter(node => 
      nodeStates[node.id]?.status === 'pending'
    );
    
    console.log(`[Check-and-Dispatch] Found ${pendingNodes.length} pending nodes`);
    
    if (pendingNodes.length === 0) {
      // Check if execution is complete
      await checkExecutionComplete(executionId, nodeStates);
      return;
    }
    
    // Build dependency map
    const dependencyMap = buildDependencyMap(graph);
    
    // Find ready nodes (pending nodes with all dependencies completed)
    const readyNodes = pendingNodes.filter(node => {
      const dependencies = dependencyMap.get(node.id) || [];
      
      // Check if all dependencies are completed
      const allDepsCompleted = dependencies.every(depId => 
        nodeStates[depId]?.status === 'completed'
      );
      
      if (allDepsCompleted && dependencies.length > 0) {
        console.log(`[Check-and-Dispatch] Node ${node.id} is ready (${dependencies.length} dependencies completed)`);
      } else if (allDepsCompleted && dependencies.length === 0) {
        console.log(`[Check-and-Dispatch] Node ${node.id} is ready (root node)`);
      }
      
      return allDepsCompleted;
    });
    
    console.log(`[Check-and-Dispatch] ${readyNodes.length} nodes ready to dispatch`);
    
    // Dispatch ready nodes
    for (const node of readyNodes) {
      // Build inputs from upstream nodes
      const inputs = await buildNodeInputs(node.id, graph, nodeStates);
      
      // Atomically update node state to 'running' if still 'pending'
      const claimed = await claimNodeForDispatch(executionId, node.id);
      
      if (claimed) {
        console.log(`[Check-and-Dispatch] Claimed node ${node.id} for dispatch`);
        
        try {
          // AWAIT the dispatch (crucial for serverless environments)
          await dispatchNode(executionId, node.id, node, inputs);
          console.log(`[Check-and-Dispatch] ✅ Node ${node.id} dispatched successfully`);
        } catch (error) {
          console.error(`[Check-and-Dispatch] ❌ Failed to dispatch node ${node.id}:`, error);
        }
      } else {
        console.log(`[Check-and-Dispatch] Node ${node.id} was already claimed by another process`);
      }
    }
    
  } catch (error) {
    console.error(`[Check-and-Dispatch] Error:`, error);
  }
}

/**
 * Build dependency map: node_id -> [list of dependency node_ids]
 */
function buildDependencyMap(graph: GraphJson): Map<string, string[]> {
  const map = new Map<string, string[]>();
  
  // Initialize all nodes with empty dependencies
  for (const node of graph.nodes) {
    map.set(node.id, []);
  }
  
  // Add dependencies from edges
  for (const edge of graph.edges || []) {
    const deps = map.get(edge.target) || [];
    deps.push(edge.source);
    map.set(edge.target, deps);
  }
  
  return map;
}

/**
 * Build inputs for a node from its upstream dependencies
 */
async function buildNodeInputs(
  nodeId: string,
  graph: GraphJson,
  nodeStates: Record<string, NodeState>
): Promise<Record<string, any>> {
  
  const inputs: Record<string, any> = {};
  
  // Find all incoming edges
  const incomingEdges = (graph.edges || []).filter(edge => edge.target === nodeId);
  
  for (const edge of incomingEdges) {
    const sourceNodeState = nodeStates[edge.source];
    
    if (sourceNodeState?.status === 'completed') {
      // Use sourceHandle as the input key, or default to 'image'
      const inputKey = edge.targetHandle || edge.sourceHandle || 'image';
      
      // Get the output from the source node
      if (sourceNodeState.result_url) {
        inputs[inputKey] = sourceNodeState.result_url;
      } else if (sourceNodeState.output) {
        inputs[inputKey] = sourceNodeState.output;
      }
    }
  }
  
  console.log(`[Check-and-Dispatch] Built inputs for node ${nodeId}:`, inputs);
  
  return inputs;
}

/**
 * Atomically claim a node for dispatch
 * Returns true if successfully claimed, false if already claimed
 */
async function claimNodeForDispatch(
  executionId: string,
  nodeId: string
): Promise<boolean> {
  
  const supabase = createServiceClient();
  
  try {
    // Attempt atomic update: only update if status is still 'pending'
    const { data, error } = await supabase.rpc('claim_node_for_dispatch', {
      p_execution_id: executionId,
      p_node_id: nodeId,
    });
    
    if (error) {
      // If function doesn't exist yet, fall back to regular update
      // This is for backwards compatibility during deployment
      console.warn('[Check-and-Dispatch] claim_node_for_dispatch function not found, using fallback');
      return await claimNodeFallback(executionId, nodeId);
    }
    
    return data === true;
    
  } catch (error) {
    console.error('[Check-and-Dispatch] Error claiming node:', error);
    return false;
  }
}

/**
 * Fallback method for claiming a node (non-atomic, but works)
 */
async function claimNodeFallback(
  executionId: string,
  nodeId: string
): Promise<boolean> {
  
  const supabase = createServiceClient();
  
  // Fetch current state
  const { data: execution, error: fetchError } = await supabase
    .from('executions_v2')
    .select('node_states')
    .eq('id', executionId)
    .single();
  
  if (fetchError || !execution) {
    return false;
  }
  
  // Check if still pending
  if (execution.node_states[nodeId]?.status !== 'pending') {
    return false;
  }
  
  // Update to 'dispatching' (temporary state)
  const updatedNodeStates = {
    ...execution.node_states,
    [nodeId]: {
      ...execution.node_states[nodeId],
      status: 'dispatching',
    },
  };
  
  const { error: updateError } = await supabase
    .from('executions_v2')
    .update({
      node_states: updatedNodeStates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', executionId);
  
  return !updateError;
}

/**
 * Check if execution is complete and update status
 */
async function checkExecutionComplete(
  executionId: string,
  nodeStates: Record<string, NodeState>
): Promise<void> {
  
  const allStates = Object.values(nodeStates);
  
  // Check if all nodes are in terminal state
  const allTerminal = allStates.every(state => 
    ['completed', 'failed'].includes(state.status)
  );
  
  if (!allTerminal) {
    return;
  }
  
  // Check if any failed
  const anyFailed = allStates.some(state => state.status === 'failed');
  
  const supabase = createServiceClient();
  
  const finalStatus = anyFailed ? 'failed' : 'completed';
  
  console.log(`[Check-and-Dispatch] All nodes terminal, marking execution as ${finalStatus}`);
  
  await supabase
    .from('executions_v2')
    .update({
      status: finalStatus,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', executionId);
}
