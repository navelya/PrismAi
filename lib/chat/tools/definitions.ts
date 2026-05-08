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

const topLevelEdgeSchema = {
  type: 'object',
  properties: {
    source: { type: 'string', description: 'ID of the source node (temp id from nodes[] or existing canvas UUID).' },
    target: { type: 'string', description: 'ID of the target node (temp id from nodes[] or existing canvas UUID).' },
    sourceHandle: { type: 'string' },
    targetHandle: { type: 'string' }
  },
  required: ['source', 'target']
};

export const TOOLS: AnthropicTool[] = [
  {
    name: 'add_node',
    description: `Add one or more nodes AND/OR edges to the canvas in a single call. Always batch every node for a workflow into ONE call.
Edges can connect any pair of nodes — new ones added here, existing canvas nodes by UUID, or a mix (new→existing, existing→new, existing→existing).
Either side of an edge can be a temp id used in this same call's nodes[] array, or an existing canvas UUID.
Topological order is mandatory for nodes: a node's inputs may only reference IDs that appear earlier in this array or that already exist on the canvas.`,
    input_schema: {
      type: 'object',
      properties: {
        nodes: {
          type: 'array',
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
                default: [],
                description: 'Legacy per-node edge list (edges INTO this node). Prefer top-level edges[] for new calls.'
              }
            },
            required: ['id', 'type', 'position', 'data']
          },
          default: []
        },
        edges: {
          type: 'array',
          items: topLevelEdgeSchema,
          default: [],
          description: 'Edges to add. Each edge can connect any two nodes — temp ids from nodes[] above, existing canvas UUIDs, or a mix.'
        }
      },
      required: []
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
  },
  {
    name: 'ask_clarification',
    description:
      'Ask the user a clarifying question with 2-4 short option chips. ' +
      'Use ONLY when the request is genuinely ambiguous and guessing wrong ' +
      'would likely require redoing work. Do not use for trivial defaults — ' +
      'pick a reasonable one and proceed. The question text goes in your ' +
      'normal response body; this tool only carries the chip options. Do NOT ' +
      'call this in the same turn as add_node / update_node / remove_node — ' +
      'ask first, act on the answer next turn.',
    input_schema: {
      type: 'object',
      properties: {
        options: {
          type: 'array',
          items: { type: 'string', maxLength: 40 },
          minItems: 2,
          maxItems: 4,
          description:
            'Short chip labels (≤40 chars each). Each must be a fully-formed ' +
            'answer the user could send as their next message. Mutually exclusive.'
        }
      },
      required: ['options']
    }
  },
];

export type ToolName = 'add_node' | 'update_node' | 'remove_node' | 'ask_clarification';
