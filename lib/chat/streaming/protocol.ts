import type { WorkflowPatch } from '@/lib/workflow/workflow-patch';

/**
 * Wire-format shape of a workflow plan proposed by the model. Mirrors
 * the `propose_plan` tool's input schema one-to-one.
 *
 * blueprint mirrors the existing `add_node` tool input — when the user
 * approves, the route applies it via dispatchTool('add_node', blueprint).
 */
export interface PlanPayload {
  title: string;
  summary: string;
  arrows: string;
  models: string[];
  detail: string;
  blueprint: {
    nodes?: any[];  // shape matches add_node.nodes[] item — kept loose here
    edges?: any[];  // shape matches add_node.edges[] item — kept loose here
  };
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
 *   [plan?]            ← B-2; never coexists with [tool] or [clarification]
 *                        in same turn (prompt-enforced, not protocol-enforced)
 *   [usage]
 *   [done]
 */
export type StreamEvent =
  | { type: 'thinking_start' }
  | { type: 'thinking_delta'; text: string }
  | { type: 'thinking_end' }
  | { type: 'text'; text: string }
  | { type: 'tool'; name: 'add_node' | 'update_node' | 'remove_node'; patch: WorkflowPatch }
  | { type: 'clarification'; options: string[] }
  | { type: 'plan'; plan: PlanPayload }
  | { type: 'usage'; inputTokens: number; outputTokens: number; thinkingTokens: number; costUsd: number }
  | { type: 'error'; message: string; recoverable: boolean }
  | { type: 'done' };

export type StreamEventType = StreamEvent['type'];
