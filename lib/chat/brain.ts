import type { Workflow } from '@/lib/nodes/types';
import { createEmptyWorkflow, applyWorkflowPatch, mergeWorkflowPatches, type WorkflowPatch } from '@/lib/workflow/workflow-patch';
import { buildSystemPrompt } from './prompt/system';
import type { RegistryContextInput } from './prompt/registry-context';
import { TOOLS, type ToolName } from './tools/definitions';
import { dispatchTool, type ToolHandlerState } from './tools/handlers';
import { streamAnthropicTurn, type ChatTurn } from './provider/anthropic';
import type { StreamEncoder } from './streaming/encoder';

export interface BrainResult {
  finalText: string;
  finalThinking: string;
  finalWorkflow: Workflow;
  accumulatedPatch: WorkflowPatch | null;
  hadAnyOutput: boolean;
  usage: { inputTokens: number; outputTokens: number; thinkingTokens: number; costUsd: number } | null;
}

export interface BrainInput {
  turns: ChatTurn[];
  workflow: Workflow | null | undefined;
  registry: RegistryContextInput;
  encoder: StreamEncoder;
}

export async function runBrain(input: BrainInput): Promise<BrainResult> {
  const baseWorkflow: Workflow =
    input.workflow && Array.isArray(input.workflow.nodes) && Array.isArray(input.workflow.edges)
      ? input.workflow
      : createEmptyWorkflow();

  const state: ToolHandlerState = { workflow: baseWorkflow, idMap: new Map() };

  const system = buildSystemPrompt({ workflow: baseWorkflow, registry: input.registry });

  let finalText = '';
  let finalThinking = '';
  let accumulatedPatch: WorkflowPatch | null = null;
  let hadAnyOutput = false;
  let usage: BrainResult['usage'] = null;

  try {
    const stream = streamAnthropicTurn({ system, messages: input.turns, tools: TOOLS });

    for await (const event of stream) {
      if (!input.encoder.isConnected()) break;
      hadAnyOutput = true;

      switch (event.kind) {
        case 'thinking_start':
          input.encoder.send({ type: 'thinking_start' });
          break;

        case 'thinking_delta':
          finalThinking += event.text;
          input.encoder.send({ type: 'thinking_delta', text: event.text });
          break;

        case 'thinking_end':
          input.encoder.send({ type: 'thinking_end' });
          break;

        case 'text_delta':
          finalText += event.text;
          input.encoder.send({ type: 'text', text: event.text });
          break;

        case 'tool_call': {
          const name = event.name as ToolName;
          if (name !== 'add_node' && name !== 'update_node' && name !== 'remove_node') {
            input.encoder.send({ type: 'error', message: `Unknown tool ${name}`, recoverable: true });
            break;
          }
          const result = dispatchTool(state, name, event.args);
          if (!result.success) {
            input.encoder.send({ type: 'error', message: result.error || `${name} failed`, recoverable: true });
            break;
          }
          if (result.patch) {
            accumulatedPatch = mergeWorkflowPatches(accumulatedPatch, result.patch);
            input.encoder.send({ type: 'tool', name, patch: result.patch });
          }
          break;
        }

        case 'usage':
          usage = {
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            thinkingTokens: event.thinkingTokens,
            costUsd: event.costUsd
          };
          input.encoder.send({
            type: 'usage',
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            thinkingTokens: event.thinkingTokens,
            costUsd: event.costUsd
          });
          break;
      }
    }
  } catch (err: any) {
    const message = err?.message || 'Anthropic stream failed.';
    const recoverable = !/auth|api[_ ]?key|invalid request/i.test(message);
    input.encoder.send({ type: 'error', message, recoverable });
  }

  // Safety net: if the model used tools but emitted no text, the message
  // bubble would render empty and feel "stuck." Synthesize a brief
  // confirmation so the user always sees something.
  if (finalText.length === 0 && accumulatedPatch) {
    const fallback = 'Done — applied the changes to the canvas.';
    finalText = fallback;
    input.encoder.send({ type: 'text', text: fallback });
  }

  const finalWorkflow = accumulatedPatch
    ? applyWorkflowPatch(baseWorkflow, accumulatedPatch)
    : baseWorkflow;

  return { finalText, finalThinking, finalWorkflow, accumulatedPatch, hadAnyOutput, usage };
}
