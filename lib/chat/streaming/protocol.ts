import type { WorkflowPatch } from '@/lib/workflow/workflow-patch';

/**
 * NDJSON stream events emitted by the new chat brain.
 * One JSON object per line, terminated by '\n'.
 *
 * Order guarantee per turn:
 *   [thinking_start] [thinking_delta]* [thinking_end]
 *   [text]*
 *   [tool]*
 *   [clarification?]
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
  | { type: 'usage'; inputTokens: number; outputTokens: number; thinkingTokens: number; costUsd: number }
  | { type: 'error'; message: string; recoverable: boolean }
  | { type: 'done' };

export type StreamEventType = StreamEvent['type'];
