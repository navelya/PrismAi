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

/**
 * Shared schema fragment for nodes[] and edges[] arrays. Used by both
 * add_node (the live tool) and propose_plan.blueprint (the structured
 * payload approved into add_node verbatim). Keeping these in one place
 * prevents drift between the proposing-time validator and the apply-time
 * dispatch.
 */
const nodesEdgesSchema = {
  nodes: {
    type: 'array' as const,
    description: 'All nodes — same item shape as add_node.nodes[].',
    items: {
      type: 'object' as const,
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
          description: 'Legacy per-node edge list. Prefer top-level edges[].'
        }
      },
      required: ['id', 'type', 'position', 'data']
    },
    default: []
  },
  edges: {
    type: 'array' as const,
    items: topLevelEdgeSchema,
    default: [],
    description: 'Edges to add. Source/target may be temp ids or existing canvas UUIDs.'
  }
} as const;

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
        nodes: nodesEdgesSchema.nodes,
        edges: nodesEdgesSchema.edges
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
  {
    name: 'propose_plan',
    description:
      'Propose a workflow plan for the user to approve before building. ' +
      'Use ONLY for genuinely complex requests where guessing wrong would ' +
      'waste real work — multi-section pipelines, large rewrites, or builds ' +
      'with multiple model choices that affect creative direction. Do NOT ' +
      'use for simple single-node updates, trivial changes, or anything where ' +
      'the right answer is obvious. Do NOT use in the same turn as ' +
      'ask_clarification — clarify first, plan next turn. Do NOT also call ' +
      'add_node / update_node / remove_node in the same turn — the blueprint ' +
      'IS the build; the user approves it to apply.',
    input_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          maxLength: 60,
          description: 'Short title naming the workflow.'
        },
        summary: {
          type: 'string',
          maxLength: 240,
          description: 'One- or two-sentence "what it does" — plain prose, no list.'
        },
        arrows: {
          type: 'string',
          maxLength: 240,
          description: 'Compact arrow-style overview, one line.'
        },
        models: {
          type: 'array',
          items: { type: 'string', maxLength: 60 },
          maxItems: 6,
          description: 'Model names used. Empty array if none.'
        },
        detail: {
          type: 'string',
          maxLength: 1200,
          description:
            'Detailed plan: nodes used, creative direction, scene/look description, ' +
            'inputs, expected output appearance. Match length to plan complexity. ' +
            'Plain prose, no markdown headers.'
        },
        blueprint: {
          type: 'object',
          description: 'Structured workflow patch applied verbatim if user approves. Same shape as add_node input.',
          properties: {
            nodes: nodesEdgesSchema.nodes,
            edges: nodesEdgesSchema.edges
          },
          required: []
        }
      },
      required: ['title', 'summary', 'arrows', 'models', 'detail', 'blueprint']
    }
  },
];

export type ToolName = 'add_node' | 'update_node' | 'remove_node' | 'ask_clarification' | 'propose_plan';
