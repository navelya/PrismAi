import type Anthropic from '@anthropic-ai/sdk';
import type { Workflow } from '@/lib/nodes/types';
import { createEmptyWorkflow, applyWorkflowPatch, mergeWorkflowPatches, type WorkflowPatch } from '@/lib/workflow/workflow-patch';
import { buildSystemPrompt } from './prompt/system';
import type { RegistryContextInput } from './prompt/registry-context';
import { TOOLS, type ToolName, type AnthropicTool } from './tools/definitions';
import { dispatchTool, validateBlueprint, validateTaskList, type ToolHandlerState } from './tools/handlers';
import type { PlanPayload } from './streaming/protocol';
import { streamAnthropicTurn, toAnthropicMessages, type ChatTurn } from './provider/anthropic';
import type { StreamEncoder } from './streaming/encoder';

export interface BrainResult {
  finalText: string;
  finalThinking: string;
  finalWorkflow: Workflow;
  accumulatedPatch: WorkflowPatch | null;
  hadAnyOutput: boolean;
  usage: { inputTokens: number; outputTokens: number; thinkingTokens: number; costUsd: number } | null;
  clarification: { options: string[] } | null;
  plan: PlanPayload | null;
  /** The model that actually ran this brain pass ('haiku' | 'sonnet'). */
  model: 'haiku' | 'sonnet';
  /** True if the fast lane called `escalate`; the caller re-runs on Sonnet. */
  escalated: boolean;
}

export interface BrainInput {
  turns: ChatTurn[];
  workflow: Workflow | null | undefined;
  registry: RegistryContextInput;
  encoder: StreamEncoder;
  attachedImageUrls?: string[];
  /** Which Claude model to use. Defaults to 'sonnet' for backwards-compat. */
  model?: 'haiku' | 'sonnet';
  /** Nodes the user has selected on the canvas this turn. Surfaced to the
   *  model as a focus hint; does NOT restrict scope. Consumed in a later change. */
  nodeRefs?: import('@/lib/utils/selection-refs').NodeRef[];
  /** Characters the user @-mentioned this turn, resolved server-side from the
   *  DB. Threaded to the tool layer for node hydration and to the system
   *  prompt for wiring instructions. */
  characterRefs?: import('@/lib/utils/character-refs').CharacterSnapshot[];
  /** Tool set for this pass. Defaults to TOOLS (full set). The fast lane
   *  passes FAST_LANE_TOOLS (no propose_plan, plus escalate). */
  tools?: AnthropicTool[];
  /** When true, an `escalate` tool call (before any edit) stops the pass and
   *  sets result.escalated so the caller can re-run on Sonnet. */
  allowEscalate?: boolean;
  /** Thinking control. 'off' = never think (fast lane); 'on' = think on
   *  iteration 1 (heavy lane); 'heuristic' = legacy short-message heuristic
   *  (free lane / default). */
  thinkingMode?: 'off' | 'on' | 'heuristic';
}

/**
 * Continuation loop bound. After each Anthropic turn that called workflow
 * tools, the brain echoes the assistant message + tool_result back and
 * re-prompts. This cap prevents runaway loops; 6 is enough for the
 * largest realistic ask (plan → add → batch-update → batch-remove → cleanup)
 * and small enough that a confused model can't burn dollars.
 */
const MAX_ITERATIONS = 6;

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

  const characterRefMap = new Map<string, import('@/lib/utils/character-refs').CharacterSnapshot>();
  for (const c of input.characterRefs ?? []) {
    if (c && typeof c.characterId === 'string') characterRefMap.set(c.characterId, c);
  }
  state.characterRefs = characterRefMap;

  const system = buildSystemPrompt({
    workflow: baseWorkflow,
    registry: input.registry,
    attachedImageUrls: input.attachedImageUrls ?? [],
    nodeRefs: input.nodeRefs ?? [],
    characterRefs: input.characterRefs ?? [],
  });

  let finalText = '';
  let finalThinking = '';
  let accumulatedPatch: WorkflowPatch | null = null;
  let hadAnyOutput = false;
  let usage: BrainResult['usage'] = null;
  let clarification: BrainResult['clarification'] = null;
  let plan: BrainResult['plan'] = null;
  let escalated = false;
  const modelKey: 'haiku' | 'sonnet' = input.model ?? 'sonnet';

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
  const disableThinkingFirstTurn =
    lastUserText.length > 0 &&
    lastUserText.length <= 80 &&
    lastUserImages === 0 &&
    !ACTION_VERBS.test(lastUserText);

  // Resolve the per-pass base thinking decision from thinkingMode.
  const thinkingMode = input.thinkingMode ?? 'heuristic';
  const baseDisableThinking =
    thinkingMode === 'off' ? true :
    thinkingMode === 'on' ? false :
    disableThinkingFirstTurn; // 'heuristic'

  // Build the Anthropic message array once. We MUTATE this array across
  // continuation iterations by appending the assistant's response and a
  // synthetic user message carrying tool_result blocks. The original
  // input.turns is never modified.
  const messages: Anthropic.MessageParam[] = toAnthropicMessages(input.turns);

  let iteration = 0;
  let continueLoop = true;

  while (continueLoop && iteration < MAX_ITERATIONS) {
    if (!input.encoder.isConnected()) break;
    iteration++;
    continueLoop = false;

    // Track this iteration's workflow tool results so we can build the
    // synthetic tool_result user message that re-prompts Claude. Terminal
    // tools (ask_clarification, propose_plan) end the loop and do not need
    // a tool_result — the brain returns and the next user turn restarts.
    type PendingTool = { id: string; success: boolean; error?: string };
    const pendingTools: PendingTool[] = [];
    let calledWorkflowTool = false;
    let calledTerminalTool = false;
    let turnAssistantContent: Anthropic.ContentBlock[] | null = null;

    // Iteration 1 uses the user's thinking heuristic; iterations 2+ always
    // disable thinking. Without the interleaved-thinking-2025-05-14 beta
    // header, thinking can only happen before the first tool use anyway —
    // and tool-result follow-ups don't benefit from a fresh think pass for
    // our use case (deterministic workflow mutations).
    const iterationDisableThinking = iteration === 1 ? baseDisableThinking : true;

    try {
      const stream = streamAnthropicTurn({
        system,
        messages,
        tools: input.tools ?? TOOLS,
        disableThinking: iterationDisableThinking,
        model: input.model,
      });

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

          case 'tool_start': {
            const startName = event.name as ToolName;
            if (
              startName === 'add_node' ||
              startName === 'update_node' ||
              startName === 'update_compositor_layer' ||
              startName === 'remove_node' ||
              startName === 'ask_clarification' ||
              startName === 'propose_plan'
            ) {
              input.encoder.send({ type: 'tool_start', name: startName });
            }
            break;
          }

          case 'tool_call': {
            const name = event.name as ToolName;

            if (name === 'ask_clarification') {
              calledTerminalTool = true;
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

            if (name === 'propose_plan') {
              calledTerminalTool = true;
              const args = (event.args ?? {}) as Record<string, unknown>;

              const requireString = (key: string): string | null => {
                const v = args[key];
                if (typeof v !== 'string' || v.trim().length === 0) {
                  return `propose_plan requires non-empty string field "${key}".`;
                }
                return null;
              };
              for (const key of ['title', 'summary', 'arrows', 'detail']) {
                const err = requireString(key);
                if (err) {
                  input.encoder.send({ type: 'error', message: err, recoverable: true });
                  break;
                }
              }
              const rawModels = args.models;
              if (!Array.isArray(rawModels) || !rawModels.every(m => typeof m === 'string')) {
                input.encoder.send({
                  type: 'error',
                  message: 'propose_plan.models must be an array of strings (may be empty).',
                  recoverable: true,
                });
                break;
              }

              const hasTasks = Array.isArray(args.tasks) && (args.tasks as any[]).length > 0;
              const hasBlueprint = !!args.blueprint && typeof args.blueprint === 'object';

              const blueprintObj: { nodes?: any[]; edges?: any[] } | null = hasBlueprint
                ? (args.blueprint as { nodes?: any[]; edges?: any[] })
                : null;

              if (hasTasks && hasBlueprint) {
                input.encoder.send({
                  type: 'error',
                  message: 'propose_plan must use EITHER blueprint OR tasks — never both.',
                  recoverable: true,
                });
                break;
              }
              if (!hasTasks && !hasBlueprint) {
                input.encoder.send({
                  type: 'error',
                  message: 'propose_plan requires either a blueprint or a non-empty tasks[] array.',
                  recoverable: true,
                });
                break;
              }

              if (hasTasks) {
                const validation = validateTaskList(state, args.tasks as any[]);
                if (!validation.ok) {
                  input.encoder.send({
                    type: 'error',
                    message: `propose_plan tasks invalid (task ${validation.taskIndex}): ${validation.error}`,
                    recoverable: true,
                  });
                  break;
                }
              } else {
                const validation = validateBlueprint(state, blueprintObj);
                if (!validation.ok) {
                  input.encoder.send({
                    type: 'error',
                    message: `propose_plan blueprint invalid: ${validation.error}`,
                    recoverable: true,
                  });
                  break;
                }
              }

              if (!plan) {
                plan = {
                  title: String(args.title).trim(),
                  summary: String(args.summary).trim(),
                  arrows: String(args.arrows).trim(),
                  models: rawModels as string[],
                  detail: String(args.detail).trim(),
                  blueprint: hasBlueprint
                    ? {
                        nodes: Array.isArray(blueprintObj?.nodes) ? blueprintObj.nodes : [],
                        edges: Array.isArray(blueprintObj?.edges) ? blueprintObj.edges : [],
                      }
                    : undefined,
                  tasks: hasTasks ? (args.tasks as any[]) : undefined,
                };
                input.encoder.send({ type: 'plan', plan });
              }
              break;
            }

            if (name === 'escalate') {
              // Only the fast lane offers this tool. Honor it only before any
              // edit has been applied this turn, so we never discard committed
              // patches. Silent to the client — no event is emitted.
              if (input.allowEscalate && accumulatedPatch === null) {
                escalated = true;
                calledTerminalTool = true; // stop the loop; caller re-runs on Sonnet
                break;
              }
              // Not honored (escalate came AFTER an edit, or this lane can't
              // escalate). The model still emitted an escalate tool_use block,
              // so we must satisfy it or the continuation turn is malformed
              // (Anthropic 400: tool_use without matching tool_result). Mark it
              // done and let the model finish the turn itself.
              pendingTools.push({ id: event.id, success: true });
              break;
            }

            if (name !== 'add_node' && name !== 'update_node' && name !== 'update_compositor_layer' && name !== 'remove_node') {
              input.encoder.send({ type: 'error', message: `Unknown tool ${name}`, recoverable: true });
              pendingTools.push({ id: event.id, success: false, error: `Unknown tool ${name}` });
              break;
            }

            calledWorkflowTool = true;
            const result = await dispatchTool(state, name, event.args);
            if (!result.success) {
              input.encoder.send({ type: 'error', message: result.error || `${name} failed`, recoverable: true });
              // Surface the error to Claude on the next iteration so it can
              // self-correct rather than the user seeing a half-applied edit.
              pendingTools.push({ id: event.id, success: false, error: result.error || `${name} failed` });
              break;
            }
            if (result.patch) {
              accumulatedPatch = mergeWorkflowPatches(accumulatedPatch, result.patch);
              input.encoder.send({ type: 'tool', name, patch: result.patch });
            }
            pendingTools.push({ id: event.id, success: true });
            break;
          }

          case 'turn_end':
            turnAssistantContent = event.assistantContent;
            break;

          case 'usage': {
            // Accumulate usage across iterations. The cost UI in the client
            // reads the LAST usage event, so we sum manually and re-emit the
            // running total each iteration.
            const prev: BrainResult['usage'] = usage;
            const newInputTokens: number = (prev ? prev.inputTokens : 0) + event.inputTokens;
            const newOutputTokens: number = (prev ? prev.outputTokens : 0) + event.outputTokens;
            const newThinkingTokens: number = (prev ? prev.thinkingTokens : 0) + event.thinkingTokens;
            const newCostUsd: number = (prev ? prev.costUsd : 0) + event.costUsd;
            usage = {
              inputTokens: newInputTokens,
              outputTokens: newOutputTokens,
              thinkingTokens: newThinkingTokens,
              costUsd: newCostUsd,
            };
            input.encoder.send({
              type: 'usage',
              inputTokens: newInputTokens,
              outputTokens: newOutputTokens,
              thinkingTokens: newThinkingTokens,
              costUsd: newCostUsd,
            });
            break;
          }
        }
      }
    } catch (err: any) {
      const message = err?.message || 'Anthropic stream failed.';
      const recoverable = !/auth|api[_ ]?key|invalid request/i.test(message);
      input.encoder.send({ type: 'error', message, recoverable });
      break;
    }

    // Decide whether to continue iterating. Continue only when:
    //   1. A workflow tool was called this turn (there's something to react to)
    //   2. No terminal tool was called (terminal tools = wait for the user)
    //   3. We captured the assistant content (needed to echo back)
    //   4. We have headroom under MAX_ITERATIONS
    if (
      calledWorkflowTool &&
      !calledTerminalTool &&
      turnAssistantContent &&
      iteration < MAX_ITERATIONS &&
      pendingTools.length > 0
    ) {
      messages.push({ role: 'assistant', content: turnAssistantContent as Anthropic.ContentBlockParam[] });
      messages.push({
        role: 'user',
        content: pendingTools.map(t => ({
          type: 'tool_result' as const,
          tool_use_id: t.id,
          content: t.success ? 'ok' : (t.error || 'tool failed'),
          is_error: !t.success,
        })),
      });
      continueLoop = true;
    }
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

  return { finalText, finalThinking, finalWorkflow, accumulatedPatch, hadAnyOutput, usage, clarification, plan, model: modelKey, escalated };
}
