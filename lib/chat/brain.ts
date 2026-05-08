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
  clarification: { options: string[] } | null;
}

export interface BrainInput {
  turns: ChatTurn[];
  workflow: Workflow | null | undefined;
  registry: RegistryContextInput;
  encoder: StreamEncoder;
  attachedImageUrls?: string[];
  /** Which Claude model to use. Defaults to 'sonnet' for backwards-compat. */
  model?: 'haiku' | 'sonnet';
}

export async function runBrain(input: BrainInput): Promise<BrainResult> {
  const baseWorkflow: Workflow =
    input.workflow && Array.isArray(input.workflow.nodes) && Array.isArray(input.workflow.edges)
      ? input.workflow
      : createEmptyWorkflow();

  // Build a model_id → input handle ids map so the tool handler can
  // validate ai_generator edges against the chosen model's actual
  // handles (rather than the static registry's fallback list).
  const aiModelHandles = new Map<number, string[]>();
  for (const m of input.registry.models) {
    const schema = (m as any).inputs_schema;
    if (!schema || !Array.isArray(schema.handles)) continue;
    const ids: string[] = [];
    for (const h of schema.handles) {
      const key = h?.api_mapping_key;
      if (typeof key === 'string' && key.length > 0) ids.push(key);
    }
    if (ids.length > 0) aiModelHandles.set(m.id, ids);
  }

  const state: ToolHandlerState = { workflow: baseWorkflow, idMap: new Map(), aiModelHandles };

  const system = buildSystemPrompt({
    workflow: baseWorkflow,
    registry: input.registry,
    attachedImageUrls: input.attachedImageUrls ?? [],
  });

  let finalText = '';
  let finalThinking = '';
  let accumulatedPatch: WorkflowPatch | null = null;
  let hadAnyOutput = false;
  let usage: BrainResult['usage'] = null;
  let clarification: BrainResult['clarification'] = null;

  // Trivial-message heuristic: if the user's last turn is short, has no
  // images, and doesn't look like a workflow change, skip extended thinking
  // entirely. This brings "hi", short Q&A, and simple updates back to
  // ~1s response time. False positives just waste a tiny bit of model
  // capability for one turn — false negatives (missing thinking on a
  // complex turn) cost more, so the heuristic is conservative.
  const lastTurn = input.turns.length > 0 ? input.turns[input.turns.length - 1] : null;
  const lastUserText = lastTurn && lastTurn.role === 'user' ? lastTurn.text : '';
  const lastUserImages = lastTurn && lastTurn.role === 'user' ? (lastTurn.images?.length ?? 0) : 0;
  const ACTION_VERBS = /\b(make|build|add|create|change|fix|update|remove|use|switch|replace|generate|set up|wire|connect|delete|rewire|swap|configure|customize)\b/i;
  const disableThinking =
    lastUserText.length > 0 &&
    lastUserText.length <= 80 &&
    lastUserImages === 0 &&
    !ACTION_VERBS.test(lastUserText);

  try {
    const stream = streamAnthropicTurn({ system, messages: input.turns, tools: TOOLS, disableThinking, model: input.model });

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

          if (name === 'ask_clarification') {
            // Validate options: must be an array of 2-4 strings (clip to 4 if more).
            const raw = Array.isArray(event.args?.options) ? event.args.options : [];
            const options = raw
              .filter((o: unknown): o is string => typeof o === 'string' && o.trim().length > 0)
              .slice(0, 4);
            if (options.length < 2) {
              input.encoder.send({
                type: 'error',
                message: 'ask_clarification needs 2-4 string options.',
                recoverable: true
              });
              break;
            }
            // First valid clarification wins; ignore any additional ones in this turn.
            if (!clarification) {
              clarification = { options };
              input.encoder.send({ type: 'clarification', options });
            }
            break;
          }

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

  return { finalText, finalThinking, finalWorkflow, accumulatedPatch, hadAnyOutput, usage, clarification };
}
