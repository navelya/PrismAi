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
  // V1 nodes have data nested under "config"
  const config = v1Node.data?.config || v1Node.data || {};
  const cleanData = { ...v1Node.data };
  
  // Remove execution-specific fields (these shouldn't be in graph_json)
  delete cleanData.output;
  delete cleanData.outputMetadata;
  delete cleanData.status;
  delete cleanData.error;
  
  // For nodes with model_id, resolve to replicate_model_id string
  // This is needed because V2 dispatch needs the actual model string, not a database ID
  let modelVersion = config.model || config.version;
  
  if (config.model_id && !modelVersion) {
    try {
      const supabase = createServiceClient();
      const { data: modelData } = await supabase
        .from('ai_models')
        .select('replicate_model_id')
        .eq('id', config.model_id)
        .single();
      
      if (modelData?.replicate_model_id) {
        modelVersion = modelData.replicate_model_id;
        console.log(`[NodeMapper] Resolved model_id ${config.model_id} to ${modelVersion}`);
      } else {
        console.error(`[NodeMapper] Model with ID ${config.model_id} not found in database`);
      }
    } catch (err) {
      console.error(`[NodeMapper] Failed to resolve model_id ${config.model_id}:`, err);
    }
  }
  
  // Extract control values (prompt, etc.)
  const controlValues = config.control_values || {};
  const prompt = controlValues.prompt || config.prompt;
  
  // Return normalized V2 format
  // KEEP ORIGINAL TYPE - don't change node types!
  return {
    id: v1Node.id,
    type: v1Node.type, // Keep original type - nodes are dynamic!
    data: {
      ...cleanData,
      // Normalize fields for V2 execution
      label: cleanData.label,
      model: modelVersion,
      version: modelVersion,
      prompt: prompt,
      input: controlValues,
      control_values: controlValues, // Keep original for compatibility
    },
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
