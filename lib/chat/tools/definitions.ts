import { sharedRegistry } from '@/lib/nodes/core/shared-registry';

const NODE_TYPE_ENUM = Object.keys(sharedRegistry);

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

const inputEdgeSchema = {
  type: 'object',
  properties: {
    source: { type: 'string', description: 'Source node ID (existing canvas ID, or an ID from earlier in this same array).' },
    sourceHandle: { type: 'string' },
    targetHandle: { type: 'string' }
  },
  required: ['source']
};

export const TOOLS: AnthropicTool[] = [
  {
    name: 'add_node',
    description: `Add one OR MORE nodes to the canvas in a single call. Always batch every node for a workflow into ONE call.
Each node may reference earlier nodes in the same array, OR existing canvas IDs.
Topological order is mandatory: a node's inputs may only reference IDs that appear earlier in this array or that already exist on the canvas.`,
    input_schema: {
      type: 'object',
      properties: {
        nodes: {
          type: 'array',
          minItems: 1,
          description: 'All nodes to add — include every node for the request here.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Simple temporary node ID (e.g. "n1", "prompt_1").' },
              type: { type: 'string', enum: NODE_TYPE_ENUM, description: 'Base node type.' },
              node_type_id: { type: 'string', description: 'Required when type is ai_generator.' },
              model_id: { type: 'number', description: 'Optional model ID when relevant.' },
              position: {
                type: 'object',
                properties: { x: { type: 'number' }, y: { type: 'number' } },
                required: ['x', 'y'],
                description: 'Position hint — auto-calculated, any value is fine.'
              },
              data: {
                type: 'object',
                properties: { config: { type: 'object', additionalProperties: true } },
                required: ['config'],
                description: 'Node config matching the registry aiSchema for this type.'
              },
              inputs: {
                type: 'array',
                items: inputEdgeSchema,
                default: []
              }
            },
            required: ['id', 'type', 'position', 'data']
          }
        }
      },
      required: ['nodes']
    }
  },
  {
    name: 'update_node',
    description: 'Update one existing node. Can also replace all inbound edges via replace_inputs.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Existing node ID (canvas UUID or previously used temporary ID).' },
        data: {
          type: 'object',
          properties: { config: { type: 'object', additionalProperties: true } }
        },
        position: {
          type: 'object',
          properties: { x: { type: 'number' }, y: { type: 'number' } },
          required: ['x', 'y']
        },
        replace_inputs: {
          type: 'array',
          items: inputEdgeSchema
        }
      },
      required: ['id']
    }
  },
  {
    name: 'remove_node',
    description: 'Remove one node and all connected edges.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Existing node ID (canvas UUID or previously used temporary ID).' }
      },
      required: ['id']
    }
  }
];

export type ToolName = 'add_node' | 'update_node' | 'remove_node';
