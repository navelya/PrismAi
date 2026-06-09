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
 * One in-place node edit — same item shape as update_node.updates[]. Shared so
 * a propose_plan blueprint/task can MODIFY existing canvas nodes (by their real
 * UUID), not only add new ones. Without this a plan could only insert nodes, so
 * "modify this complex workflow" rebuilt the whole graph beside the original.
 */
const updateNodeItemSchema = {
  type: 'object' as const,
  properties: {
    id: { type: 'string', description: 'EXISTING canvas node UUID to update (or a temp id created earlier in THIS blueprint).' },
    data: {
      type: 'object',
      properties: {
        label: { type: 'string', maxLength: 40, description: 'Optional custom label override (same rules as add_node).' },
        config: { type: 'object', additionalProperties: true },
      },
    },
    position: {
      type: 'object',
      properties: { x: { type: 'number' }, y: { type: 'number' } },
      required: ['x', 'y'],
    },
    replace_inputs: { type: 'array', items: inputEdgeSchema },
  },
  required: ['id'],
} as const;

/** The two modification arrays a blueprint/task may carry beyond nodes/edges. */
const blueprintMutationSchema = {
  updatedNodes: {
    type: 'array' as const,
    items: updateNodeItemSchema,
    description: 'In-place edits to nodes that ALREADY exist on the canvas. Reference each by its real canvas UUID (from EXISTING WORKFLOW). Use this to change config/label/wiring instead of re-adding a fresh node.',
  },
  removedNodeIds: {
    type: 'array' as const,
    items: { type: 'string' as const },
    description: 'Real canvas UUIDs of existing nodes to DELETE (their edges go too). Use when a modification replaces or drops nodes — so the old graph is not left orphaned beside the new one.',
  },
} as const;

/**
 * Shared schema fragment for the additive nodes[] and edges[] arrays. Used by
 * both add_node (the live tool) and propose_plan.blueprint/tasks (which on
 * approval dispatch the same add_node, plus update_node/remove_node for the
 * blueprint's updatedNodes/removedNodeIds). Keeping these in one place prevents
 * drift between the proposing-time validator and the apply-time dispatch.
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
          properties: {
            label: {
              type: 'string',
              maxLength: 40,
              description: 'Optional custom label for this node — overrides the default label. Use only when a custom name materially aids comprehension. Same language as the user.',
            },
            config: { type: 'object', additionalProperties: true },
          },
          required: ['config'],
          description: 'Node config matching the registry aiSchema. Optional `label` overrides the default node title.',
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

const taskGroupSchema = {
  type: 'object' as const,
  properties: {
    label: { type: 'string', maxLength: 40 },
    icon:  { type: 'string', description: 'Lucide PascalCase name (Folder, Film, Camera, ...). Falls back to Folder if unknown.' },
    color: { type: 'string', enum: ['neutral', 'indigo', 'emerald', 'rose', 'amber', 'sky'] },
  },
  required: ['label', 'icon'],
} as const;

const taskSchema = {
  type: 'object' as const,
  properties: {
    id: { type: 'string', description: 'Model-supplied id scoped to this plan (e.g. "scene_1").' },
    title: { type: 'string', maxLength: 60, description: 'Shown in the task checklist.' },
    summary: { type: 'string', maxLength: 140, description: 'One-line description.' },
    group: taskGroupSchema,
    nodes: nodesEdgesSchema.nodes,
    edges: nodesEdgesSchema.edges,
    updatedNodes: blueprintMutationSchema.updatedNodes,
    removedNodeIds: blueprintMutationSchema.removedNodeIds,
  },
  required: ['id', 'title', 'summary', 'nodes', 'edges'],
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
    description: `Update one or more existing nodes in a single call. Always batch every update for a request into ONE call — do not emit multiple update_node calls when one will do.
Each item in updates[] targets one node by id and may change data.config, position, and/or replace_inputs (the full inbound edge list for that node).`,
    input_schema: {
      type: 'object',
      properties: {
        updates: {
          type: 'array',
          minItems: 1,
          description: 'One entry per node to update. Bundle every update for this turn into this single array.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Existing node ID (canvas UUID or previously used temporary ID).' },
              data: {
                type: 'object',
                properties: {
                  label: {
                    type: 'string',
                    maxLength: 40,
                    description: 'Optional custom label override (same rules as add_node).',
                  },
                  config: { type: 'object', additionalProperties: true },
                },
              },
              position: {
                type: 'object',
                properties: { x: { type: 'number' }, y: { type: 'number' } },
                required: ['x', 'y'],
              },
              replace_inputs: {
                type: 'array',
                items: inputEdgeSchema,
              },
            },
            required: ['id'],
          },
        },
      },
      required: ['updates'],
    },
  },
  {
    name: 'update_compositor_layer',
    description: `Update one or more existing layers on one or more compositor nodes. Use this AFTER the canvas has auto-created layers (every edge into a compositor produces one layer with the edge's id as layer.sourceHandleId and a layer id like \`layer_<edge-uuid>\`). Do NOT use update_node to set config.layers — that does a shallow replace and silently drops fields. This tool is the ONLY safe way to mutate compositor layers.
Patches are deep-merged on the server: top-level fields you omit stay unchanged; \`transform\` and \`transition\` get one level of deep-merge so changing transform.x doesn't wipe transform.opacity/blendMode/etc.
Always batch every layer update for this request into ONE call's updates[] array.`,
    input_schema: {
      type: 'object',
      properties: {
        updates: {
          type: 'array',
          minItems: 1,
          description: 'One entry per (compositor, layer) pair to update. Bundle every update for this turn into this single array.',
          items: {
            type: 'object',
            properties: {
              nodeId: { type: 'string', description: 'Compositor node ID (existing canvas UUID).' },
              layerId: { type: 'string', description: 'Layer ID inside that compositor. Read from the workflow context — each layer has a stable id in config.layers[*].id.' },
              patch: {
                type: 'object',
                additionalProperties: true,
                description: 'Partial layer fields to set. Only `transform` and `transition` get one-level deep-merge; every other key is a full replace at the layer level.',
                properties: {
                  name:          { type: 'string', description: 'User-facing layer name (shown in the editor).' },
                  visible:       { type: 'boolean' },
                  locked:        { type: 'boolean' },
                  selectedIndex: { type: 'number', description: 'Which item to pick when the source emits an array.' },
                  startTime:     { type: 'number', description: 'Seconds from t=0 when the layer first appears on the timeline.' },
                  duration:      { type: ['number', 'null'], description: 'How long the layer stays visible. null = full source for video, full timeline for image/text.' },
                  trimIn:        { type: 'number', description: 'Seconds trimmed from the start of the source clip (stored; not yet executed).' },
                  trimOut:       { type: ['number', 'null'], description: 'Source-relative end time; null = full source (stored; not yet executed).' },
                  speed:         { type: 'number', description: 'Playback rate multiplier (stored; not yet executed).' },
                  muted:         { type: 'boolean', description: 'Mute the layer audio (stored; not yet executed).' },
                  transition: {
                    type: 'object',
                    description: 'Outgoing transition into the next layer (stored; not yet executed).',
                    properties: {
                      type:     { type: 'string', enum: ['none', 'crossfade', 'fade'] },
                      duration: { type: 'number', description: 'Transition duration in seconds.' },
                    },
                  },
                  transform: {
                    type: 'object',
                    description: 'Visual placement on the compositor canvas. Deep-merged: omit fields to keep them.',
                    properties: {
                      x:        { type: 'number', description: 'Left position in pixels (canvas coordinates, 0 = left edge).' },
                      y:        { type: 'number', description: 'Top position in pixels (canvas coordinates, 0 = top edge).' },
                      width:    { type: 'number', description: 'Rendered width in pixels.' },
                      height:   { type: 'number', description: 'Rendered height in pixels.' },
                      rotation: { type: 'number', description: 'Degrees, 0–360.' },
                      opacity:  { type: 'number', description: '0.0 (fully transparent) to 1.0 (fully opaque).' },
                      flipX:    { type: 'boolean' },
                      flipY:    { type: 'boolean' },
                      blendMode: { type: 'string', description: 'Konva GlobalCompositeOperation. Valid values: source-over (default), multiply, screen, overlay, darken, lighten, color-dodge, color-burn, hard-light, soft-light, difference, exclusion, hue, saturation, color, luminosity.' },
                      fontFamily:    { type: 'string', description: 'Text layer typography.' },
                      fontWeight:    { type: 'string' },
                      fontStyle:     { type: 'string' },
                      fontSize:      { type: 'number' },
                      lineHeight:    { type: 'number' },
                      letterSpacing: { type: 'number' },
                      textAlign:     { type: 'string', enum: ['left', 'center', 'right', 'justify'] },
                      fillColor:     { type: 'string', description: 'Hex color for text fill (e.g. #ffffff).' },
                      crop: {
                        type: ['object', 'null'],
                        description: 'Source-side crop box, or null for no crop. Provide all four numbers when setting; the whole crop value is replaced (not merged).',
                        properties: {
                          x:      { type: 'number' },
                          y:      { type: 'number' },
                          width:  { type: 'number' },
                          height: { type: 'number' },
                        },
                      },
                    },
                  },
                },
              },
            },
            required: ['nodeId', 'layerId', 'patch'],
          },
        },
      },
      required: ['updates'],
    },
  },
  {
    name: 'remove_node',
    description: 'Remove one or more nodes and all their connected edges. Always batch every removal for a request into ONE call.',
    input_schema: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          minItems: 1,
          items: { type: 'string' },
          description: 'Node IDs to remove (canvas UUIDs or previously used temporary IDs). Bundle every removal for this turn into this single array.',
        },
      },
      required: ['ids'],
    },
  },
  {
    name: 'run_nodes',
    description: 'Request that the given nodes be RUN (executed) now. Call this ONLY when the user explicitly asks to generate / run / make / produce a result this turn. Adding or editing nodes does NOT imply a run — never call run_nodes just because you added nodes. Pass the node ids whose output the user wants (usually the generator(s) or final node); the system automatically runs everything downstream. You MAY reference ids you created earlier this same turn with add_node. The user still controls whether it auto-runs or shows a Run button — your job is only to signal that a run was requested.',
    input_schema: {
      type: 'object',
      properties: {
        nodeIds: {
          type: 'array',
          minItems: 1,
          items: { type: 'string' },
          description: 'Node IDs to run (canvas UUIDs or temporary IDs you used in this turn). Bundle every node to run into this single array.',
        },
      },
      required: ['nodeIds'],
    },
  },
  {
    name: 'ask_clarification',
    description:
      'Ask the user 1-4 clarifying questions, each with 2-4 short option chips. ' +
      'The UI shows the questions one at a time — the user answers one, the next ' +
      'appears, until all are answered. Use ONLY when the request is genuinely ' +
      'ambiguous and guessing wrong would likely require redoing work. Do not use ' +
      'for trivial defaults — pick a reasonable one and proceed. Put the actual ' +
      'question text in each question (NOT only in your prose), and NEVER list ' +
      'example answers in prose — they belong in options. Do NOT call this in the ' +
      'same turn as add_node / update_node / remove_node — ask first, act next turn.',
    input_schema: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          minItems: 1,
          maxItems: 4,
          description:
            'The clarifying questions, in the order to ask them. Each independent ' +
            'thing you need to know is its own entry — do not cram two questions ' +
            'into one. Ask only what you genuinely need to scope the work.',
          items: {
            type: 'object',
            properties: {
              question: {
                type: 'string',
                maxLength: 140,
                description: 'The question text shown above its chips. One question only.'
              },
              options: {
                type: 'array',
                items: { type: 'string', maxLength: 40 },
                minItems: 2,
                maxItems: 4,
                description:
                  'Short chip labels (≤40 chars each). Each a fully-formed answer the ' +
                  'user could send. Mutually exclusive.'
              }
            },
            required: ['question', 'options']
          }
        }
      },
      required: ['questions']
    }
  },
  {
    name: 'search_templates',
    description:
      'Search the workflow-template library for a SKELETON that roughly matches ' +
      'what the user wants to build from scratch. Call this BEFORE propose_plan, ' +
      'and ONLY when the user is asking to BUILD A NEW WORKFLOW that is complex ' +
      'enough to warrant a plan. Do NOT call this for: updates to an existing ' +
      'workflow (the canvas already provides the skeleton), trivial requests, ' +
      'single-node changes, model swaps, renames, or removals. The matcher returns ' +
      'at most one template, and may return none — never assume a result. On a ' +
      'hit, treat the template as STRUCTURAL INSPIRATION only: keep the topology ' +
      'as a starting point, but rename, swap models, rewrite prompts, and add/drop ' +
      'nodes to fit the user\'s actual request. On no match, proceed to build from ' +
      'scratch with propose_plan as normal — never mention the search to the user.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          maxLength: 600,
          description:
            'A short natural-language description of what the user wants to build. ' +
            'Phrase it like a template name or use-case, NOT like a question. The ' +
            'matcher reads it against template names, descriptions, tags, and ' +
            'categories — keywords beat full sentences here.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'propose_plan',
    description:
      'Propose a workflow plan for the user to approve before building. ' +
      'Use ONLY for genuinely complex requests where guessing wrong would ' +
      'waste real work. The plan can be a single blueprint (default) OR a ' +
      'sequential list of tasks for multi-section workflows. Use tasks ONLY ' +
      'when the workflow has 2+ logically independent sections — each task ' +
      'is one recognizable build chunk. A blueprint is a full PATCH: when the ' +
      'plan MODIFIES an existing workflow, edit/delete its nodes in place via ' +
      'updatedNodes/removedNodeIds (real canvas UUIDs) rather than re-adding the ' +
      'whole graph. Do NOT use propose_plan in the same ' +
      'turn as ask_clarification or add_node/update_node/remove_node.',
    input_schema: {
      type: 'object',
      properties: {
        title:   { type: 'string', maxLength: 60 },
        summary: { type: 'string', maxLength: 240 },
        arrows:  { type: 'string', maxLength: 240 },
        models: {
          type: 'array',
          items: { type: 'string', maxLength: 60 },
          maxItems: 6,
        },
        detail:  { type: 'string', maxLength: 1200 },
        blueprint: {
          type: 'object',
          description: 'Single-blueprint mode (a full workflow PATCH, not just an insert). Omit when using tasks. When MODIFYING an existing workflow, edit/delete its nodes via updatedNodes/removedNodeIds (by real canvas UUID) — do NOT re-add the whole graph as new nodes, which orphans the original.',
          properties: {
            nodes: nodesEdgesSchema.nodes,
            edges: nodesEdgesSchema.edges,
            updatedNodes: blueprintMutationSchema.updatedNodes,
            removedNodeIds: blueprintMutationSchema.removedNodeIds,
          },
        },
        tasks: {
          type: 'array',
          description: 'Sequential task list. Use ONLY when the workflow has 2+ logically independent sections. Omit for single-blueprint plans.',
          items: taskSchema,
          minItems: 1,
        },
      },
      required: ['title', 'summary', 'arrows', 'models', 'detail'],
    },
  },
];

/**
 * The cheap "fast lane" (Haiku) offers this tool instead of propose_plan.
 * Calling it hands the turn off to Sonnet+thinking. It must be the model's
 * FIRST action — see ESCALATE_GUIDANCE in prompt/system.ts. The `reason` is
 * for logs/observability only; it is never shown to the user.
 */
export const ESCALATE_TOOL: AnthropicTool = {
  name: 'escalate',
  description:
    'Hand this turn to a more capable model. Call this — as your FIRST and ONLY ' +
    'action, before any text or other tool — when the request needs multi-step ' +
    'reasoning, a plan/approval, or a large or ambiguous build. Do NOT call it for ' +
    'simple single-node adds, config tweaks, model swaps, or removals — just do those.',
  input_schema: {
    type: 'object',
    properties: {
      reason: { type: 'string', maxLength: 200, description: 'Why this needs deeper reasoning (one short phrase).' },
    },
    required: ['reason'],
  },
};

/**
 * Fast-lane toolset: the workflow-mutation + clarification tools, plus
 * `escalate`, MINUS `propose_plan` (planning is a heavy-lane job — the model
 * escalates instead of planning on the cheap tier).
 */
export const FAST_LANE_TOOLS: AnthropicTool[] = [
  ...TOOLS.filter(t => t.name !== 'propose_plan' && t.name !== 'search_templates'),
  ESCALATE_TOOL,
];

export type ToolName = 'add_node' | 'update_node' | 'update_compositor_layer' | 'remove_node' | 'ask_clarification' | 'propose_plan' | 'escalate' | 'run_nodes' | 'search_templates';
