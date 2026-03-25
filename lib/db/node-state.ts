/**
 * ⚠️ DEPRECATED - Workflow Engine v3.1 ⚠️
 * 
 * This file (lib/db/node-state.ts) and the 'update_node_in_canvas' RPC 
 * are NO LONGER USED for live execution status updates.
 * 
 * New Architecture:
 * - Live State: Stored in 'node_results' table for high performance and history.
 * - Source of Truth: lib/workflow/dispatch-v2.ts (updateNodeState).
 * - UI Sync: lib/hooks/use-execution-channel.ts (subscribes to 'node_results').
 * 
 * Why?
 * Updating the large JSONB 'canvas_state' in the 'sessions' table for every 
 * status change was causing database bloat and performance bottlenecks.
 * 
 * Keep this file only for legacy reference or non-execution canvas updates 
 * (like changing node labels or configurations).
 */

import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Legacy update function. Use lib/workflow/dispatch-v2.ts instead for execution.
 */
export async function updateNodeState(
  supabase: SupabaseClient,
  sessionId: string,
  nodeId: string,
  updates: any
): Promise<any | null> {
  console.warn('[DEPRECATED] updateNodeState called. Use the new DAG engine instead.');
  return null;
}
