import type Anthropic from '@anthropic-ai/sdk';
import type { Workflow } from '@/lib/nodes/types';
import { createEmptyWorkflow, applyWorkflowPatch, mergeWorkflowPatches, type WorkflowPatch } from '@/lib/workflow/workflow-patch';
import { buildSystemPrompt } from './prompt/system';
import type { RegistryContextInput } from './prompt/registry-context';
import { TOOLS, type ToolName, type AnthropicTool } from './tools/definitions';
import { dispatchTool, validateBlueprint, validateTaskList, type ToolHandlerState } from './tools/handlers';
import type { PlanPayload, ClarificationQuestion } from './streaming/protocol';
import { streamAnthropicTurn, toAnthropicMessages, type ChatTurn } from './provider/anthropic';
import type { StreamEncoder } from './streaming/encoder';

export interface BrainResult {
  finalText: string;
  finalThinking: string;
  finalWorkflow: Workflow;
  accumulatedPatch: WorkflowPatch | null;
  hadAnyOutput: boolean;
  usage: { inputTokens: number; outputTokens: number; thinkingTokens: number; costUsd: number } | null;
  clarification: { questions: ClarificationQuestion[] } | null;
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
  // Set when a propose_plan call was malformed (no/invalid blueprint or tasks).
  // Instead of dumping the raw validation error on the user, we feed it back to
  // the model as a tool_result and let it retry with a complete plan.
  let planNeedsRetry = false;
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
    planNeedsRetry = false;

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

      // Some turns — especially thinking-disabled iterations — have the model
      // narrate its reasoning as literal <thinking>…</thinking> tags inside
      // TEXT instead of a native thinking block (the THINKING_VOICE few-shots
      // use that tag format, so the model mimics it). Strip those tags from the
      // visible reply and re-route their contents to the thinking stream, so
      // they show in the activity timeline rather than leaking into the bubble.
      // State is per-iteration; `textCarry` holds a tag possibly split across
      // stream chunks so it's never emitted half-rendered.
      let textCarry = '';
      let inTextThinking = false;
      const THINK_OPEN = '<thinking>';
      const THINK_CLOSE = '</thinking>';
      const feedText = (chunk: string) => {
        let buf = textCarry + chunk;
        textCarry = '';
        while (buf.length > 0) {
          if (!inTextThinking) {
            const at = buf.indexOf(THINK_OPEN);
            if (at === -1) {
              const [emit, hold] = splitTrailingPartial(buf, THINK_OPEN);
              if (emit) { finalText += emit; input.encoder.send({ type: 'text', text: emit }); }
              textCarry = hold;
              break;
            }
            const before = buf.slice(0, at);
            if (before) { finalText += before; input.encoder.send({ type: 'text', text: before }); }
            buf = buf.slice(at + THINK_OPEN.length);
            inTextThinking = true;
            input.encoder.send({ type: 'thinking_start' });
          } else {
            const at = buf.indexOf(THINK_CLOSE);
            if (at === -1) {
              const [emit, hold] = splitTrailingPartial(buf, THINK_CLOSE);
              if (emit) { finalThinking += emit; input.encoder.send({ type: 'thinking_delta', text: emit }); }
              textCarry = hold;
              break;
            }
            const inside = buf.slice(0, at);
            if (inside) { finalThinking += inside; input.encoder.send({ type: 'thinking_delta', text: inside }); }
            buf = buf.slice(at + THINK_CLOSE.length);
            inTextThinking = false;
            input.encoder.send({ type: 'thinking_end' });
          }
        }
      };
      const flushText = () => {
        if (textCarry) {
          if (inTextThinking) { finalThinking += textCarry; input.encoder.send({ type: 'thinking_delta', text: textCarry }); }
          else { finalText += textCarry; input.encoder.send({ type: 'text', text: textCarry }); }
          textCarry = '';
        }
        if (inTextThinking) { inTextThinking = false; input.encoder.send({ type: 'thinking_end' }); }
      };

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
            feedText(event.text);
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
              // New shape: questions[] (each { question, options }). Accept the
              // legacy flat `options` too, wrapping it as a single question.
              const cleanOptions = (raw: unknown): string[] =>
                (Array.isArray(raw) ? raw : [])
                  .filter((o: unknown): o is string => typeof o === 'string' && o.trim().length > 0)
                  .slice(0, 4);

              const rawQuestions = Array.isArray(event.args?.questions) ? event.args.questions : null;
              let questions: ClarificationQuestion[] = [];
              if (rawQuestions) {
                questions = rawQuestions
                  .map((q: any): ClarificationQuestion | null => {
                    const options = cleanOptions(q?.options);
                    if (options.length < 2) return null;
                    return {
                      question: typeof q?.question === 'string' ? q.question.trim() : '',
                      options,
                    };
                  })
                  .filter((q: ClarificationQuestion | null): q is ClarificationQuestion => q !== null)
                  .slice(0, 4);
              } else {
                const options = cleanOptions(event.args?.options);
                if (options.length >= 2) questions = [{ question: '', options }];
              }

              if (questions.length === 0) {
                input.encoder.send({
                  type: 'error',
                  message: 'ask_clarification needs at least one question with 2-4 string options.',
                  recoverable: true
                });
                break;
              }
              // First valid clarification wins; ignore any additional ones in this turn.
              if (!clarification) {
                clarification = { questions };
                input.encoder.send({ type: 'clarification', questions });
              }
              break;
            }

            if (name === 'propose_plan') {
              calledTerminalTool = true;
              const args = (event.args ?? {}) as Record<string, unknown>;

              // A malformed plan should self-correct, not surface a raw ⚠️ to
              // the user. failPlan re-routes the validation error back to the
              // model as a tool_result so it retries with a complete plan.
              const failPlan = (message: string) => {
                pendingTools.push({
                  id: event.id,
                  success: false,
                  error: `${message} Re-call propose_plan with a COMPLETE blueprint (or non-empty tasks[]) this time — do NOT build directly with add_node; the user is waiting on a plan to approve.`,
                });
                calledTerminalTool = false;
                planNeedsRetry = true;
              };

              const hasTasks = Array.isArray(args.tasks) && (args.tasks as any[]).length > 0;
              const hasBlueprint = !!args.blueprint && typeof args.blueprint === 'object';
              const blueprintObj: { nodes?: any[]; edges?: any[] } | null = hasBlueprint
                ? (args.blueprint as { nodes?: any[]; edges?: any[] })
                : null;
              const rawModels = args.models;

              // STRUCTURAL guards only — the card literally can't render, or
              // there's nothing to build. ONLY these self-correct via a silent
              // retry. (A missing display string or no blueprint+tasks at all.)
              let structuralError: string | null = null;
              for (const key of ['title', 'summary', 'arrows', 'detail']) {
                const v = args[key];
                if (typeof v !== 'string' || v.trim().length === 0) {
                  structuralError = `propose_plan requires non-empty string field "${key}".`;
                  break;
                }
              }
              if (!structuralError && hasTasks && hasBlueprint) {
                structuralError = 'propose_plan must use EITHER blueprint OR tasks — never both.';
              }
              if (!structuralError && !hasTasks && !hasBlueprint) {
                structuralError = 'propose_plan requires either a blueprint or a non-empty tasks[] array.';
              }
              if (structuralError) {
                failPlan(structuralError);
                break;
              }

              // CONTENT validation (per-node config / edge handles) is ADVISORY
              // at propose time. A single bad node config must NOT swallow the
              // whole plan — the user asked to SEE a plan, so we always show it.
              // The identical checks run again at Approve via dispatchTool, which
              // surfaces any real problem in context. (Previously a content
              // failure dropped the plan entirely → "I asked for a plan and got
              // nothing".)
              const contentIssue = hasTasks
                ? (() => {
                    const v = validateTaskList(state, args.tasks as any[]);
                    return v.ok ? null : `tasks (task ${v.taskIndex}): ${v.error}`;
                  })()
                : (() => {
                    const v = validateBlueprint(state, blueprintObj);
                    return v.ok ? null : v.error;
                  })();
              if (contentIssue) {
                console.warn('[chat] propose_plan content issue (showing plan anyway, re-checked at approve):', contentIssue);
              }

              const models = Array.isArray(rawModels)
                ? rawModels.filter((m): m is string => typeof m === 'string')
                : [];

              if (!plan) {
                plan = {
                  title: String(args.title).trim(),
                  summary: String(args.summary).trim(),
                  arrows: String(args.arrows).trim(),
                  models,
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

      // The stream ended; emit any text/thinking held back at a tag boundary,
      // and close an unterminated <thinking> run.
      flushText();
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
      (calledWorkflowTool || planNeedsRetry) &&
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

  // The model kept producing malformed plans until it ran out of retries.
  // Better to ask for a little more direction than to leave an empty bubble
  // or a raw validation error.
  if (finalText.length === 0 && !plan && planNeedsRetry) {
    const fallback = "I couldn't pull that plan together cleanly — tell me a bit more about what you'd like built and I'll lay it out.";
    finalText = fallback;
    input.encoder.send({ type: 'text', text: fallback });
  }

  const finalWorkflow = accumulatedPatch
    ? applyWorkflowPatch(baseWorkflow, accumulatedPatch)
    : baseWorkflow;

  return { finalText, finalThinking, finalWorkflow, accumulatedPatch, hadAnyOutput, usage, clarification, plan, model: modelKey, escalated };
}

/**
 * Split `buf` into [emit, hold] where `hold` is the longest suffix of `buf`
 * that could be the start of `tag`. Holding that suffix back means a tag split
 * across stream chunks (e.g. "…<think" then "ing>…") is never emitted as
 * half-rendered text. When no suffix matches, the whole buffer is safe to emit.
 */
function splitTrailingPartial(buf: string, tag: string): [string, string] {
  const max = Math.min(buf.length, tag.length - 1);
  for (let k = max; k > 0; k--) {
    if (buf.endsWith(tag.slice(0, k))) {
      return [buf.slice(0, buf.length - k), buf.slice(buf.length - k)];
    }
  }
  return [buf, ''];
}
