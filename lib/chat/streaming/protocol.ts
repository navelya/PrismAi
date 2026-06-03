import type { WorkflowPatch } from '@/lib/workflow/workflow-patch';

export interface TaskGroup {
  label: string;        // ≤40 chars
  icon: string;         // Lucide PascalCase name; falls back to 'Folder' if unknown
  color?: 'neutral' | 'indigo' | 'emerald' | 'rose' | 'amber' | 'sky';
}

export interface TaskBlueprint {
  id: string;           // model-supplied, scoped to this plan (e.g. 'scene_1')
  title: string;        // ≤60 chars
  summary: string;      // ≤140 chars
  group?: TaskGroup;    // optional — present when this task is a logical section
  nodes: any[];         // same item shape as add_node.nodes[]
  edges: any[];         // same item shape as add_node.edges[]
}

/**
 * Wire-format shape of a workflow plan proposed by the model. Mirrors
 * the `propose_plan` tool's input schema one-to-one.
 *
 * blueprint mirrors the existing `add_node` tool input — when the user
 * approves, the route applies it via dispatchTool('add_node', blueprint).
 * tasks is an ordered array of TaskBlueprint items executed sequentially
 * on plan approval. Exactly one of blueprint or tasks must be present.
 */
export interface PlanPayload {
  title: string;
  summary: string;
  arrows: string;
  models: string[];
  detail: string;
  // Exactly one of:
  blueprint?: { nodes?: any[]; edges?: any[] };
  tasks?: TaskBlueprint[];
}

/**
 * NDJSON stream events emitted by the new chat brain.
 * One JSON object per line, terminated by '\n'.
 *
 * Order guarantee per turn:
 *   [thinking_start] [thinking_delta]* [thinking_end]
 *   [text]*
 *   [tool]*
 *   [clarification?]
 *   [plan?]            ← never coexists with [tool] or [clarification]
 *
 * Plan-approve branch (sequential tasks):
 *   for each task i:
 *     [task_start]
 *     [tool]
 *     [task_complete]
 *   [tasks_complete]
 *   [usage]
 *   [done]
 *
 *   [switching?]       ← emitted once if the fast lane escalates to the heavy lane
 *   [model]            ← final model that produced the answer ('haiku' | 'sonnet')
 */
export type StreamEvent =
  | { type: 'thinking_start' }
  | { type: 'thinking_delta'; text: string }
  | { type: 'thinking_end' }
  | { type: 'text'; text: string }
  | { type: 'tool_start'; name: 'add_node' | 'update_node' | 'update_compositor_layer' | 'remove_node' | 'ask_clarification' | 'propose_plan' }
  | { type: 'tool'; name: 'add_node' | 'update_node' | 'update_compositor_layer' | 'remove_node'; patch: WorkflowPatch }
  | { type: 'clarification'; options: string[] }
  | { type: 'plan'; plan: PlanPayload }
  | { type: 'task_start'; taskId: string; index: number; total: number }
  | { type: 'task_complete'; taskId: string; index: number; total: number }
  | { type: 'tasks_complete'; total: number }
  | { type: 'usage'; inputTokens: number; outputTokens: number; thinkingTokens: number; costUsd: number }
  | { type: 'error'; message: string; recoverable: boolean }
  | { type: 'switching' }
  | { type: 'model'; model: 'haiku' | 'sonnet' }
  | { type: 'done' };

export type StreamEventType = StreamEvent['type'];
