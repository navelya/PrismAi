/**
 * Database utilities for atomic node state updates
 * Provides concurrent-safe updates to node states within canvas_state JSONB
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { WorkflowNode } from '@/lib/nodes/types';

export interface NodeStateUpdate {
  status?: 'idle' | 'pending' | 'running' | 'success' | 'error';
  output?: any;
  outputMetadata?: {
    thumbnailUrls?: string[];
    resultUrls?: string[];
    previewUrls?: string[];
    computedHash?: string;
    [key: string]: any;
  };
  error?: string;
}

/**
 * Atomically update a specific node's state in the database
 * Uses Postgres RPC to prevent race conditions from concurrent updates
 * 
 * @param supabase - Supabase client (should be admin client for execution)
 * @param sessionId - UUID of the session
 * @param nodeId - ID of the node to update
 * @param updates - Partial node data to merge
 * @returns Updated canvas_state or null if error
 */
export async function updateNodeState(
  supabase: SupabaseClient,
  sessionId: string,
  nodeId: string,
  updates: NodeStateUpdate
): Promise<any | null> {
  try {
    // First, fetch the current node data to merge with updates
    const { data: session, error: fetchError } = await supabase
      .from('sessions')
      .select('canvas_state')
      .eq('id', sessionId)
      .single();

    if (fetchError || !session) {
      console.error(`[updateNodeState] Failed to fetch session ${sessionId}:`, fetchError);
      return null;
    }

    // Find the node in canvas_state
    const canvasState = session.canvas_state as any;
    const nodes = canvasState?.nodes || [];
    const node = nodes.find((n: any) => n.id === nodeId);

    if (!node) {
      console.error(`[updateNodeState] Node ${nodeId} not found in canvas_state`);
      return null;
    }

    // Merge updates with existing node data
    const updatedNodeData = {
      ...node.data,
      ...updates,
      // Ensure outputMetadata is merged, not replaced
      outputMetadata: {
        ...(node.data?.outputMetadata || {}),
        ...(updates.outputMetadata || {})
      }
    };

    // Call the RPC function for atomic update
    const { data, error } = await supabase.rpc('update_node_in_canvas', {
      p_session_id: sessionId,
      p_node_id: nodeId,
      p_node_data: updatedNodeData
    });

    if (error) {
      console.error(`[updateNodeState] RPC error for node ${nodeId}:`, error);
      return null;
    }

    return data;
  } catch (err) {
    console.error(`[updateNodeState] Exception:`, err);
    return null;
  }
}

/**
 * Batch update multiple nodes' states in sequence
 * Useful for pre-flight initialization (setting all nodes to 'idle')
 * 
 * @param supabase - Supabase client
 * @param sessionId - UUID of the session
 * @param nodeUpdates - Array of { nodeId, updates }
 * @returns Success boolean
 */
export async function batchUpdateNodeStates(
  supabase: SupabaseClient,
  sessionId: string,
  nodeUpdates: Array<{ nodeId: string; updates: NodeStateUpdate }>
): Promise<boolean> {
  try {
    // Execute updates sequentially to maintain consistency
    for (const { nodeId, updates } of nodeUpdates) {
      const result = await updateNodeState(supabase, sessionId, nodeId, updates);
      if (!result) {
        console.error(`[batchUpdateNodeStates] Failed to update node ${nodeId}`);
        return false;
      }
    }
    return true;
  } catch (err) {
    console.error(`[batchUpdateNodeStates] Exception:`, err);
    return false;
  }
}

/**
 * Initialize all target nodes to 'idle' status before execution starts
 * This provides immediate UI feedback that workflow is starting
 * 
 * @param supabase - Supabase client
 * @param sessionId - UUID of the session
 * @param nodeIds - Array of node IDs to initialize
 * @returns Success boolean
 */
export async function initializeNodesForExecution(
  supabase: SupabaseClient,
  sessionId: string,
  nodeIds: string[]
): Promise<boolean> {
  const updates = nodeIds.map(nodeId => ({
    nodeId,
    updates: {
      status: 'pending' as const,  // Changed from 'idle' - signals execution started
      output: undefined,
      error: undefined
    }
  }));

  return batchUpdateNodeStates(supabase, sessionId, updates);
}
