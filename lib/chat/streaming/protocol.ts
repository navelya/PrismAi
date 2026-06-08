import type { WorkflowPatch } from '@/lib/workflow/workflow-patch';

/** One clarifying question with its chip options. A clarification turn may
 *  carry several of these; the UI presents them one at a time. */
export interface ClarificationQuestion {
  question: string;     // the question text, ≤140 chars
  options: string[];    // 2-4 chip labels, ≤40 chars each
}

export interface TaskGroup {
  label: string;        // ≤40 chars
  icon: string;         // Lucide PascalCase name; falls back to 'Folder' if unknown
  color?: 'neutral' | 'indigo' | 'emerald' | 'rose' | 'amber' | 'sky';
}

/**
 * A blueprint is a full workflow PATCH, not just an insert. Besides adding
 * `nodes`/`edges`, it can MODIFY (`updatedNodes`) and DELETE (`removedNodeIds`)
 * nodes that already exist on the canvas — referenced by their real canvas
 * UUIDs. This is what lets an approved plan edit a complex workflow in place
 * instead of rebuilding it beside the original (which left the old graph
 * orphaned). Mirrors the live add_node + update_node + remove_node vocabulary.
 */
export interface BlueprintPayload {
  nodes?: any[];                 // adds — same item shape as add_node.nodes[]
  edges?: any[];                 // adds — same item shape as add_node.edges[]
  updatedNodes?: any[];          // edits — same item shape as update_node.updates[]
  removedNodeIds?: string[];     // deletes — existing canvas node UUIDs
}

export interface TaskBlueprint {
  id: string;           // model-supplied, scoped to this plan (e.g. 'scene_1')
  title: string;        // ≤60 chars
  summary: string;      // ≤140 chars
  group?: TaskGroup;    // optional — present when this task is a logical section
  nodes: any[];         // same item shape as add_node.nodes[]
  edges: any[];         // same item shape as add_node.edges[]
  updatedNodes?: any[];      // edits — same item shape as update_node.updates[]
  removedNodeIds?: string[]; // deletes — existing canvas node UUIDs
}

/**
 * Wire-format shape of a workflow plan proposed by the model. Mirrors
 * the `propose_plan` tool's input schema one-to-one.
 *
 * blueprint is a full workflow patch (add + update + remove) — when the user
 * approves, the route applies it via applyBlueprintWithRepair, which dispatches
 * remove_node → add_node → update_node in order against the live canvas.
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
  blueprint?: BlueprintPayload;
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
  | { type: 'clarification'; questions: ClarificationQuestion[] }
  | { type: 'plan'; plan: PlanPayload }
  | { type: 'task_start'; taskId: string; index: number; total: number }
  | { type: 'task_complete'; taskId: string; index: number; total: number }
  | { type: 'tasks_complete'; total: number }
  | { type: 'usage'; inputTokens: number; outputTokens: number; thinkingTokens: number; costUsd: number }
  | { type: 'error'; message: string; recoverable: boolean }
  | { type: 'switching' }
  | { type: 'model'; model: 'haiku' | 'sonnet' }
  | { type: 'runRequest'; nodeIds: string[] }
  | { type: 'done' };

export type StreamEventType = StreamEvent['type'];
