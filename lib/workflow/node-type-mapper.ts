/**
 * Node Type Mapper - V1 to V2 Transformation
 * Transforms V1 workflow format to V2 graph_json format
 */

import { NodeConfig, EdgeConfig, GraphJson } from './types-v2';

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
 * Map V1 node types to V2 types
 * V1 and V2 types should be mostly identical, but this provides a place for any differences
 */
export function mapNodeTypeV1ToV2(v1Type: string): string {
  const mapping: Record<string, string> = {
    // Most types map directly
    'ai_generate_image': 'ai_generate_image',
    'flux_schnell': 'flux_schnell',
    'ai_upscale': 'ai_upscale',
    'stable_diffusion': 'stable_diffusion',
    
    // Ephemeral nodes
    'blur': 'blur',
    'brightness': 'brightness',
    'contrast': 'contrast',
    'grayscale': 'grayscale',
    'invert': 'invert',
    'rotate': 'rotate',
    'resize': 'resize',
    'levels': 'levels',
    'prompt': 'prompt',
    
    // Other nodes
    'image_input': 'image_input',
    'text_input': 'text_input',
    'output': 'output',
  };
  
  return mapping[v1Type] || v1Type; // Default: use original type
}

/**
 * Transform V1 node to V2 NodeConfig format
 */
export function transformNodeV1ToV2(v1Node: V1Node): NodeConfig {
  // Sanitize data: remove execution-specific fields
  const { output, outputMetadata, status, error, ...cleanData } = v1Node.data || {};
  
  return {
    id: v1Node.id,
    type: mapNodeTypeV1ToV2(v1Node.type),
    data: {
      ...cleanData,
      // Normalize common fields
      label: cleanData.label,
      model: cleanData.model || cleanData.config?.model,
      version: cleanData.version || cleanData.config?.version,
      prompt: cleanData.prompt || cleanData.config?.prompt,
      input: cleanData.input || cleanData.config || {},
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
export function transformWorkflowV1ToV2(v1Workflow: { nodes: V1Node[]; edges?: V1Edge[] }): GraphJson {
  return {
    nodes: v1Workflow.nodes.map(transformNodeV1ToV2),
    edges: (v1Workflow.edges || []).map(transformEdgeV1ToV2),
  };
}
