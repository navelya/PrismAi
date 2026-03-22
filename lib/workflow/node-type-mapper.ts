/**
 * Node Type Mapper - V1 to V2 Transformation
 * 
 * This is a TRANSLATION LAYER that converts V1 storage format to V2 execution format.
 * It does NOT define node types - all nodes are dynamic based on database configuration.
 * 
 * Why this exists:
 * - Frontend stores workflows using V1 structure in sessions.canvas_state
 * - V2 execution needs normalized format with resolved model strings
 * - Can't migrate all existing workflows instantly
 */

import { NodeConfig, EdgeConfig, GraphJson } from './types-v2';
import { createServiceClient } from '@/lib/supabase/service';

interface V1Node {
  id: string;
  type: string;
  data: any;
  position?: { x: number; y: number };
}

interface V1Edge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

/**
 * Transform V1 node to V2 NodeConfig format
 * 
 * IMPORTANT: This does NOT change node types or behavior.
 * It only normalizes the data structure and resolves database references.
 */
export async function transformNodeV1ToV2(v1Node: V1Node): Promise<NodeConfig> {
  console.log(`[NodeMapper] Transforming node ${v1Node.id} of type ${v1Node.type}`);

  // V1 nodes have data nested under "config"
  const cleanData = { ...v1Node.data };
  
  // Remove execution-specific fields (these shouldn't be in graph_json)
  delete cleanData.output;
  delete cleanData.outputMetadata;
  delete cleanData.status;
  delete cleanData.error;
  
  // Keep the exact original data structure from the UI.
  // The UI stores its config in `data.config`, `data.control_values`, etc.
  // We should NOT flatten this, because the execution engine handlers 
  // (like aiGeneratorExecutor) expect exactly this structure.
  
  return {
    id: v1Node.id,
    type: v1Node.type, 
    data: cleanData, // Preserve the exact structure!
    position: v1Node.position,
  };
}

/**
 * Transform V1 edge to V2 EdgeConfig format
 */
export function transformEdgeV1ToV2(v1Edge: V1Edge): EdgeConfig {
  return {
    id: v1Edge.id,
    source: v1Edge.source,
    target: v1Edge.target,
    sourceHandle: v1Edge.sourceHandle || undefined,
    targetHandle: v1Edge.targetHandle || undefined,
  };
}

/**
 * Transform V1 workflow to V2 graph_json
 */
export async function transformWorkflowV1ToV2(v1Workflow: { nodes: V1Node[]; edges?: V1Edge[] }): Promise<GraphJson> {
  // Transform nodes (awaiting promises)
  const transformedNodes = await Promise.all(
    v1Workflow.nodes.map(node => transformNodeV1ToV2(node))
  );
  
  return {
    nodes: transformedNodes,
    edges: (v1Workflow.edges || []).map(transformEdgeV1ToV2),
  };
}
