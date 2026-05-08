# Clarification Chips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`docs/superpowers/specs/2026-05-08-clarification-chips-design.md`](../specs/2026-05-08-clarification-chips-design.md)

**Goal:** Add an inline chip card to the chat that lets the model ask a 2–4 option clarifying question (plus a "write your own" inline input) when the user's request is ambiguous. The user's chip pick or typed answer becomes the next user turn; answered cards stay in history with the chosen state visible.

**Architecture:** One new Anthropic tool (`ask_clarification`) carrying just the options array, recognized in the brain's tool dispatch and translated into a single new NDJSON `clarification` stream event. UI is a new `ChipCard` component rendered inside the existing `Message` bubble. Persistence rides on the existing `messages.metadata` JSONB column — `metadata.clarification` on the assistant question turn, `metadata.clarification_answer` on the user's answer turn. No DB migration. The brain's flatten-to-text behavior in `toAnthropicMessages` means no `tool_result` round-trip is needed; the user's answer is sent on the next turn as ordinary text.

**Tech Stack:** Next.js 15 (Node runtime for the chat route), React 19, TypeScript, Supabase (service-role insert in the chat route, RLS-bound select in the messages list route), `@anthropic-ai/sdk` (existing), `zustand` (existing). No test runner per `CLAUDE.md` — verification is `npx tsc --noEmit` for type checks plus manual smoke tests against `npm run dev`.

**Conventions used in this plan:**
- All paths are relative to repo root (`C:\Projects\Prisfol\PrismAi`).
- Type check command everywhere: `npx tsc --noEmit`. Run after every code-writing step.
- The dev server (`npm run dev`) needs to be running for any browser smoke test. `ANTHROPIC_API_KEY` must be set in `.env.local` (already required by the existing brain).
- Commits go on a feature branch — see Task 0.

**File map:**

```
NEW   components/chat/ChipCard.tsx                  chip card UI

EDIT  lib/chat/streaming/protocol.ts                +clarification StreamEvent
EDIT  lib/chat/tools/definitions.ts                 +ask_clarification tool, ToolName widened
EDIT  lib/chat/brain.ts                             dispatch ask_clarification → event;
                                                    validate options; extend BrainResult
EDIT  lib/chat/prompt/system.ts                     +Clarifying questions rules; extend CAPABILITIES
EDIT  lib/chat/prompt/examples.ts                   +third few-shot example

EDIT  lib/store/types.ts                            Message: +clarification, +clarificationAnswer
EDIT  lib/hooks/use-session.ts                      hydrate the two new metadata blobs from DB
EDIT  lib/hooks/use-chat-messages.ts                handle clarification event;
                                                    auto-attach sidecar in handleSend

EDIT  app/api/chat/stream/route.ts                  persist metadata.clarification on assistant
                                                    insert; persist metadata.clarification_answer
                                                    on user insert (from request sidecar)

EDIT  components/chat/Message.tsx                   render <ChipCard/> below body when present
EDIT  components/chat/MessageList.tsx               (props pass-through only — onAnswer)
EDIT  components/chat/ChatInterface.tsx             pass onAnswer = wrapper around handleSend
```

No DB migration. No package installs.

---

## Task 0: Branch setup

**Files:**
- (no files modified — branching only)

- [ ] **Step 1: Create the feature branch**

```bash
git checkout -b feat/clarification-chips
git status
```

Expected: clean tree on `feat/clarification-chips`.

- [ ] **Step 2: Verify the build is clean before any edits**

```bash
npx tsc --noEmit
```

Expected: no errors.

---

## Task 1: Streaming protocol — add `clarification` event

**Files:**
- Modify: `lib/chat/streaming/protocol.ts`

- [ ] **Step 1: Add the new StreamEvent variant**

Open `lib/chat/streaming/protocol.ts`. The current `StreamEvent` union (lines 14–22) lists `thinking_start | thinking_delta | thinking_end | text | tool | usage | error | done`. Add a `clarification` variant immediately after `tool`:

```ts
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
```

Also update the order-guarantee block comment at the top of the file (lines 7–11) to include the new event:

```ts
/**
 * Order guarantee per turn:
 *   [thinking_start] [thinking_delta]* [thinking_end]
 *   [text]*
 *   [tool]*
 *   [clarification?]
 *   [usage]
 *   [done]
 */
```

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit
```

Expected: no errors. (`StreamEventType` is computed from the union, so it picks up the new variant automatically.)

- [ ] **Step 3: Commit**

```bash
git add lib/chat/streaming/protocol.ts
git commit -m "feat(chat): add clarification stream event variant"
```

---

## Task 2: Tool definitions — add `ask_clarification`

**Files:**
- Modify: `lib/chat/tools/definitions.ts`

- [ ] **Step 1: Add the new tool to the `TOOLS` array**

Open `lib/chat/tools/definitions.ts`. Append a fourth entry to the `TOOLS` array (after the existing `remove_node` entry near line 122, before the closing `]`):

```ts
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
```

- [ ] **Step 2: Widen the `ToolName` type**

At the bottom of the file (line 126):

```ts
export type ToolName = 'add_node' | 'update_node' | 'remove_node' | 'ask_clarification';
```

- [ ] **Step 3: Type check**

```bash
npx tsc --noEmit
```

Expected: errors in `lib/chat/brain.ts` and `lib/chat/tools/handlers.ts` because `dispatchTool`'s exhaustive switch now misses the new case. We fix those next task.

- [ ] **Step 4: Commit**

```bash
git add lib/chat/tools/definitions.ts
git commit -m "feat(chat): add ask_clarification Anthropic tool definition"
```

---

## Task 3: Brain — handle `ask_clarification`, validate, emit event

**Files:**
- Modify: `lib/chat/brain.ts`
- Modify: `lib/chat/tools/handlers.ts`

- [ ] **Step 1: Make `dispatchTool`'s switch tolerate `ask_clarification`**

Open `lib/chat/tools/handlers.ts`. The switch in `dispatchTool` (around line 224) currently handles `add_node` / `update_node` / `remove_node` then falls through to a `_exhaustive: never` branch. Adding the new case to the union without wiring it here gives a TS error.

Add a no-op case before the default:

```ts
export function dispatchTool(state: ToolHandlerState, name: ToolName, args: any): ToolResult {
  switch (name) {
    case 'add_node':    return runAddNode(state, args);
    case 'update_node': return runUpdateNode(state, args);
    case 'remove_node': return runRemoveNode(state, args);
    case 'ask_clarification':
      // Handled directly by the brain (see brain.ts) — never patch the workflow.
      // Reached only if the brain forwards it here by mistake; treat as a no-op.
      return { success: true };
    default: {
      const _exhaustive: never = name;
      return { success: false, error: `Unknown tool: ${_exhaustive}` };
    }
  }
}
```

The brain will short-circuit before calling `dispatchTool` for `ask_clarification`. This branch is purely so the exhaustive switch type-checks.

- [ ] **Step 2: Extend `BrainResult` and `BrainInput` for clarification output**

Open `lib/chat/brain.ts`. Update the `BrainResult` interface (lines 10–17) — add the `clarification` field:

```ts
export interface BrainResult {
  finalText: string;
  finalThinking: string;
  finalWorkflow: Workflow;
  accumulatedPatch: WorkflowPatch | null;
  hadAnyOutput: boolean;
  usage: { inputTokens: number; outputTokens: number; thinkingTokens: number; costUsd: number } | null;
  clarification: { options: string[] } | null;
}
```

- [ ] **Step 3: Initialize `clarification` and route the tool call**

In `runBrain`, add the variable initialization next to `usage` (around line 62):

```ts
  let usage: BrainResult['usage'] = null;
  let clarification: BrainResult['clarification'] = null;
```

Then in the `tool_call` event branch (around lines 106–122), insert a clarification path BEFORE the existing `add_node | update_node | remove_node` validation. The full updated branch:

```ts
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
```

- [ ] **Step 4: Return `clarification` in the result**

The return statement at the end of `runBrain` (around line 160) currently returns 6 fields. Add `clarification`:

```ts
  return { finalText, finalThinking, finalWorkflow, accumulatedPatch, hadAnyOutput, usage, clarification };
```

- [ ] **Step 5: Type check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/chat/brain.ts lib/chat/tools/handlers.ts
git commit -m "feat(chat): handle ask_clarification in brain — emit clarification event"
```

---

## Task 4: Prompt rules — `Clarifying questions` subsection + capability line

**Files:**
- Modify: `lib/chat/prompt/system.ts`

- [ ] **Step 1: Extend the `CAPABILITIES` constant**

Open `lib/chat/prompt/system.ts`. Replace the `CAPABILITIES` constant (lines 19–21) with:

```ts
const CAPABILITIES = `CAPABILITIES:
You can: build new workflows, modify existing ones, answer questions about the system, see images attached to the conversation, reason about the current canvas state, ask short clarifying questions with chip options when a request is genuinely ambiguous.
You cannot: run workflows yourself (the user clicks Run), see runtime outputs from past runs unless they are in the conversation history, access files outside of the user's attachments.`;
```

- [ ] **Step 2: Extend `TOOL_RULES` with a `Clarifying questions` block**

Replace the `TOOL_RULES` constant (lines 23–30) with:

```ts
const TOOL_RULES = `TOOL USAGE RULES:
- Use tools whenever the user asks for a workflow change. Don't use them for pure questions or explanations.
- Explain in 1-2 sentences before the tool call. Do not output numbered plans before tool calls.
- BATCHING: For any workflow creation, include ALL new nodes in a SINGLE add_node call.
- TOPOLOGICAL ORDER (mandatory): a node may only be added after every node it lists in inputs already exists in the same call (earlier in the array) or in the existing canvas.
- ID rules: for new nodes generate simple IDs like "n1", "n2", "prompt_1"; reuse those IDs in later tool calls in the same turn.
- Positions: pass any position — they are auto-calculated. Focus on types, connections, config.
- After tool calls, do not restate every node added — the UI shows the diff.

CLARIFYING QUESTIONS:
- Use ask_clarification ONLY when the request is genuinely ambiguous and guessing wrong would likely require redoing work. Do not ask for trivial defaults — pick a sensible one and proceed.
- When you ask, write ONE short forward-question as the last line of your text body (this becomes the bubble's text). Then call ask_clarification with 2-4 options.
- Each option must be a complete, fully-formed answer the user could send as their next message. Keep each ≤ 40 chars. Make them mutually exclusive.
- Pure question turn: when you call ask_clarification, do NOT also call add_node / update_node / remove_node in the same turn. If you have a question, ask it first; act on the answer next turn.
- Phrase the question and the options in the user's language (if they wrote in Hebrew, the chips are in Hebrew).
- Do not re-ask something the user already answered earlier in this session.`;
```

- [ ] **Step 3: Type check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/chat/prompt/system.ts
git commit -m "feat(chat): system prompt rules for ask_clarification"
```

---

## Task 5: Few-shot example for clarifications

**Files:**
- Modify: `lib/chat/prompt/examples.ts`

- [ ] **Step 1: Add the third example**

Replace the entire file contents:

```ts
/**
 * Three short few-shot examples included unconditionally. Total ~250 tokens.
 * Sonnet 4.6 follows tone instructions well without heavy fewshot — keep
 * this minimal. If voice consistency drifts in real traffic, tune here.
 */
export const FEWSHOT_EXAMPLES = `EXAMPLES OF VOICE:

User: make me a workflow that puts a person on a beach
Assistant: Got it. I'll use Imagen 4 for the beach (strong photographic backgrounds), background-removal on your photo, then composite.
[calls add_node with 3 nodes (input, generator, compositor) and 2 edges in the same call]
Workflow ready. Run it or tweak first?

User: what does the background_remover node do?
Assistant: It runs your input image through a segmentation model and outputs the subject as a transparent PNG. Useful before compositing.

User: edit the photo so it looks more cinematic
Assistant: Cinematic can lean a few directions — which feel are you going for?
[calls ask_clarification with options=["Warm, golden-hour color grade", "Cool, teal-and-orange contrast", "Moody low-key with film grain"]]
(no other tools in this turn — wait for the answer)`;
```

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/chat/prompt/examples.ts
git commit -m "feat(chat): few-shot example for ask_clarification"
```

---

## Task 6: Store types — extend `Message`

**Files:**
- Modify: `lib/store/types.ts`

- [ ] **Step 1: Add the two new optional fields**

Open `lib/store/types.ts`. The `Message` interface (lines 5–26) currently ends at the `usage` field. Add two new optional fields just before the closing brace:

```ts
export interface Message {
    id: string;
    type: 'user' | 'assistant';
    content: string;
    result?: any;
    images?: string[];
    timestamp: Date;
    sessionId?: string;
    status?: 'running' | 'completed' | 'error';
    workflow?: any;
    // Thinking / extended-brain fields (new brain only)
    thinking?: string;
    isThinking?: boolean;
    thinkingStartedAt?: number;
    thinkingDurationMs?: number;
    usage?: {
        inputTokens: number;
        outputTokens: number;
        thinkingTokens: number;
        costUsd: number;
    };
    // Clarification chip card (assistant turn): set when the brain emits
    // a `clarification` stream event for this message.
    clarification?: { options: string[] };
    // Set on the assistant message once the user has answered the clarification
    // (either via chip click or by typing). chosenIndex is null for typed answers.
    // text mirrors the user's reply text; used to render the answered chip card.
    clarificationAnswer?: { chosenIndex: number | null; text: string };
}
```

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/store/types.ts
git commit -m "feat(chat): Message type fields for clarification + answer"
```

---

## Task 7: Route handler — persist clarification metadata

**Files:**
- Modify: `app/api/chat/stream/route.ts`

- [ ] **Step 1: Read the `clarificationAnswer` sidecar from the body**

Open `app/api/chat/stream/route.ts`. The body destructure (line 29) currently reads:

```ts
const { messages, sessionId, previousWorkflow, attachedImages } = body ?? {};
```

Extend it to also pull the sidecar:

```ts
const { messages, sessionId, previousWorkflow, attachedImages } = body ?? {};
const clarificationAnswer: { questionMessageId: string; chosenIndex: number | null } | undefined =
  body?.clarificationAnswer && typeof body.clarificationAnswer === 'object'
    ? {
        questionMessageId: String(body.clarificationAnswer.questionMessageId ?? ''),
        chosenIndex:
          typeof body.clarificationAnswer.chosenIndex === 'number'
            ? body.clarificationAnswer.chosenIndex
            : null,
      }
    : undefined;
```

(Defensive parsing keeps the route resilient if a stale client posts a malformed sidecar — invalid shapes are ignored.)

- [ ] **Step 2: Persist `metadata.clarification_answer` on the user message insert**

The user-message insert (lines 110–119) currently has no `metadata`. Add it conditionally:

```ts
if (lastUserMsg.role === 'user' || lastUserMsg.type === 'user') {
  const userMetadata =
    clarificationAnswer && clarificationAnswer.questionMessageId.length > 0
      ? { clarification_answer: clarificationAnswer }
      : null;
  dbOps.push(
    Promise.resolve(supabase.from('messages').insert({
      session_id: sessionId,
      role: 'user',
      content: lastUserMsg.content,
      status: 'completed',
      metadata: userMetadata,
      created_at: new Date().toISOString()
    }) as any)
  );
}
```

- [ ] **Step 3: Persist `metadata.clarification` on the assistant message insert**

The assistant-message insert (lines 122–133) currently sets `metadata: { thinking, usage }`. Add `clarification`:

```ts
if (result.finalText) {
  dbOps.push(
    Promise.resolve(supabase.from('messages').insert({
      session_id: sessionId,
      role: 'assistant',
      content: result.finalText,
      metadata: {
        thinking: result.finalThinking || null,
        usage: result.usage || null,
        clarification: result.clarification || null,
      },
      status: 'completed',
      created_at: new Date(Date.now() + 1000).toISOString()
    }) as any)
  );
}
```

Note: a clarification turn typically has `result.finalText` populated (the model's question text), so this insert path runs.

- [ ] **Step 4: Type check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/api/chat/stream/route.ts
git commit -m "feat(chat): persist clarification metadata on assistant + user messages"
```

---

## Task 8: Hydration — map metadata blobs to in-memory `Message`

**Files:**
- Modify: `lib/hooks/use-session.ts`

- [ ] **Step 1: Read both metadata fields and pair the answer onto the question**

Open `lib/hooks/use-session.ts`. The hydration loop maps DB rows to `Message` objects (lines 130–168). Two changes:

(a) Widen the `metadata` destructure shape (around line 155) to include the two new fields.

(b) After the `.map(...)` produces `formattedMessages`, walk the array once to attach each user message's `clarification_answer` onto the immediately-preceding assistant message as `clarificationAnswer`.

Replace the entire `formattedMessages` block (lines 130–168) with:

```ts
            // Hydrate Messages
            const formattedMessages: any[] = messages
                // Filter out 'processing' placeholder messages ONLY IF they have absolutely no content and no workflow
                .filter((msg: any) => !(msg.status === 'processing' && !msg.content && !msg.workflow && !msg.canvas_state))
                .map((msg: any) => {
                    // Restore image paths to URLs
                    const images = msg.images?.map((path: string) => getStoragePublicUrl(path));

                    let result = undefined;
                    if (msg.role === 'assistant') {
                        if (msg.metadata?.execution_result) {
                            result = msg.metadata.execution_result;
                        } else if (images && images.length > 0) {
                            // Fallback to old behavior for legacy messages
                            result = images.map((url: string, idx: number) => ({
                                url,
                                resolution: { width: 800, height: 600 },
                                metadata: { title: `Image ${idx + 1}` }
                            }));
                        }
                    }

                    // Read from `workflow` column (written by background worker)
                    // Fall back to `canvas_state` for backwards compat with old messages
                    const messageWorkflow = msg.workflow || msg.canvas_state || undefined;

                    const metadata = (msg.metadata ?? {}) as {
                        thinking?: string | null;
                        usage?: any;
                        clarification?: { options: string[] } | null;
                        clarification_answer?: { questionMessageId: string; chosenIndex: number | null } | null;
                    };

                    const formatted: any = {
                        id: msg.id,
                        type: msg.role, // 'user' | 'assistant'
                        content: msg.content || '',
                        timestamp: new Date(msg.created_at),
                        images: msg.role === 'user' ? images : undefined, // Only user messages show inline images
                        result: result, // Assistant messages use result for image display
                        workflow: messageWorkflow, // Attach snapshot if available
                        thinking: metadata.thinking ?? '',
                        usage: metadata.usage ?? null,
                    };

                    if (msg.role === 'assistant' && metadata.clarification?.options) {
                        formatted.clarification = { options: metadata.clarification.options };
                    }

                    // Stash the raw answer payload on the user message; we lift it
                    // onto the prior assistant message in a second pass below.
                    if (msg.role === 'user' && metadata.clarification_answer?.questionMessageId) {
                        formatted.__clarificationAnswerRaw = metadata.clarification_answer;
                    }

                    return formatted;
                });

            // Second pass: pair each user message's clarification_answer onto its
            // matching assistant question message as `clarificationAnswer`. The
            // user message's `content` is the answer text.
            for (const msg of formattedMessages) {
                const raw = msg.__clarificationAnswerRaw;
                if (!raw) continue;
                const target = formattedMessages.find((m: any) => m.id === raw.questionMessageId);
                if (target && target.type === 'assistant' && target.clarification) {
                    target.clarificationAnswer = {
                        chosenIndex: typeof raw.chosenIndex === 'number' ? raw.chosenIndex : null,
                        text: msg.content || '',
                    };
                }
                delete msg.__clarificationAnswerRaw;
            }
```

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/hooks/use-session.ts
git commit -m "feat(chat): hydrate clarification metadata from DB into store"
```

---

## Task 9: Client reducer — handle event + auto-attach sidecar

**Files:**
- Modify: `lib/hooks/use-chat-messages.ts`

This task does three things:
1. Adds a `clarification` branch to `processStreamLine` so the in-flight assistant message picks up `message.clarification.options`.
2. Extends `handleSend` with an optional `clarificationAnswer` parameter, AND also auto-detects when the user is answering a pending clarification via the main chat input (no chip click, no explicit param).
3. Stamps the prior assistant message's `clarificationAnswer` field optimistically so the chip card flips to "answered" state immediately.

- [ ] **Step 1: Extend `handleSend`'s signature with an optional sidecar**

Open `lib/hooks/use-chat-messages.ts`. Update the `handleSend` declaration (around line 120) to accept a 6th optional argument:

```ts
    const handleSend = async (
        trimmedInput: string,
        attachedBlobs: Blob[],
        attachedImages: string[],
        clearAttachments: () => void,
        setInput: (val: string) => void,
        clarificationAnswerOverride?: { questionMessageId: string; chosenIndex: number | null }
    ) => {
```

- [ ] **Step 2: Resolve the clarification answer at the start of `handleSend`**

Right after the early `if (!trimmedInput && attachedImages.length === 0) return;` line, before the `historySnapshot` capture, add:

```ts
        // Resolve clarification answer: explicit override (from a chip click) OR
        // implicit (the most recent assistant message has a pending clarification
        // and the user is responding via the main chat input).
        const allChatMessages = useAppStore.getState().chatMessages;
        let resolvedClarificationAnswer: { questionMessageId: string; chosenIndex: number | null } | undefined =
            clarificationAnswerOverride;
        if (!resolvedClarificationAnswer) {
            for (let i = allChatMessages.length - 1; i >= 0; i--) {
                const m = allChatMessages[i];
                if (m.type === 'assistant') {
                    if (m.clarification?.options && !m.clarificationAnswer) {
                        resolvedClarificationAnswer = { questionMessageId: m.id, chosenIndex: null };
                    }
                    break; // only inspect the most recent assistant
                }
            }
        }
```

- [ ] **Step 3: Stamp the prior assistant message's answered state optimistically**

Just before `setIsLoading(true);` (around line 194), add the optimistic stamp:

```ts
        if (resolvedClarificationAnswer) {
            useAppStore.getState().updateMessage(resolvedClarificationAnswer.questionMessageId, {
                clarificationAnswer: {
                    chosenIndex: resolvedClarificationAnswer.chosenIndex,
                    text: trimmedInput,
                },
            });
        }
```

- [ ] **Step 4: Include the sidecar in the POST body**

Find the `fetch('/api/chat/stream', ...)` call (around line 216–226). Update the body to include `clarificationAnswer` when present:

```ts
            const response = await fetch('/api/chat/stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: fullHistory,
                    sessionId: activeSessionId,
                    previousWorkflow: useAppStore.getState().currentWorkflow,
                    attachedImages: imagesToSend,
                    selectedModel: useAppStore.getState().selectedChatModel,
                    clarificationAnswer: resolvedClarificationAnswer,
                }),
            });
```

(`JSON.stringify` drops `undefined` values, so absent answers don't pollute the body.)

- [ ] **Step 5: Add a `clarification` branch in `processStreamLine`**

The `processStreamLine` function (around line 287) is a chain of `if`/`else if` on `parsed.type`. After the `usage` branch (around line 315–324), add a new branch for clarification — place it before the `tool` branch so the order matches the protocol comment:

```ts
                else if (parsed.type === 'clarification') {
                    useAppStore.getState().updateMessage(assistantMsgId, {
                        clarification: { options: Array.isArray(parsed.options) ? parsed.options : [] },
                    });
                }
```

- [ ] **Step 6: Type check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/hooks/use-chat-messages.ts
git commit -m "feat(chat): handle clarification event and auto-attach answer sidecar"
```

---

## Task 10: ChipCard component

**Files:**
- Create: `components/chat/ChipCard.tsx`

- [ ] **Step 1: Create the file**

Create `components/chat/ChipCard.tsx` with the following content:

```tsx
'use client';

import React, { useState } from 'react';
import { Check, ArrowRight } from 'lucide-react';

interface ChipCardProps {
    /** Chip labels from message.clarification.options */
    options: string[];
    /**
     * Answered state. When set, the card renders disabled with the chosen
     * chip highlighted (chosenIndex >= 0) or the typed text shown in the
     * write-your-own slot (chosenIndex === null).
     */
    answer?: { chosenIndex: number | null; text: string };
    /** Called when the user picks a chip or submits the write-your-own input. */
    onAnswer: (payload: { chosenIndex: number | null; text: string }) => void;
}

/**
 * Inline chip card rendered inside the assistant message bubble for a
 * clarification turn. Shows N chip buttons + a write-your-own text-input chip.
 *
 * Pending state: chips clickable, input focusable.
 * Answered state: chips disabled, chosen one filled with accent + checkmark.
 *                 Or, if answered by typing, the input shows the typed text.
 */
export function ChipCard({ options, answer, onAnswer }: ChipCardProps) {
    const [draft, setDraft] = useState('');
    const isAnswered = !!answer;

    const handleChipClick = (index: number) => {
        if (isAnswered) return;
        onAnswer({ chosenIndex: index, text: options[index] });
    };

    const handleSubmitTyped = () => {
        const trimmed = draft.trim();
        if (isAnswered || trimmed.length === 0) return;
        onAnswer({ chosenIndex: null, text: trimmed });
    };

    const typedDisplay = isAnswered && answer?.chosenIndex === null ? answer.text : draft;
    const typedFilled = isAnswered && answer?.chosenIndex === null;

    return (
        <div className="mt-3 rounded-xl border border-stroke-subtle bg-surface-secondary/40 p-2.5 space-y-1.5 animate-fade-in">
            {options.map((opt, i) => {
                const isChosen = isAnswered && answer?.chosenIndex === i;
                const isDimmed = isAnswered && !isChosen;
                return (
                    <button
                        key={i}
                        type="button"
                        onClick={() => handleChipClick(i)}
                        disabled={isAnswered}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all border
                            ${isChosen
                                ? 'bg-accent-primary/15 border-accent-primary/40 text-content-primary font-medium'
                                : isDimmed
                                    ? 'bg-surface-tertiary/30 border-stroke-subtle/50 text-content-tertiary opacity-50 cursor-not-allowed'
                                    : 'bg-surface-tertiary/60 border-stroke-subtle text-content-primary hover:bg-accent-primary/10 hover:border-accent-primary/30 cursor-pointer'}`}
                    >
                        <span className="flex items-center justify-between gap-2">
                            <span>{opt}</span>
                            {isChosen && <Check className="w-4 h-4 text-accent-primary flex-shrink-0" />}
                        </span>
                    </button>
                );
            })}

            {/* Write-your-own input chip */}
            <div
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all
                    ${typedFilled
                        ? 'bg-accent-primary/15 border-accent-primary/40 text-content-primary font-medium'
                        : isAnswered
                            ? 'bg-surface-tertiary/30 border-stroke-subtle/50 opacity-50'
                            : 'bg-surface-tertiary/60 border-stroke-subtle hover:border-accent-primary/30 focus-within:border-accent-primary/50'}`}
            >
                <input
                    type="text"
                    value={typedDisplay}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            handleSubmitTyped();
                        }
                    }}
                    placeholder="Something else…"
                    disabled={isAnswered}
                    className="flex-1 bg-transparent focus:outline-none text-sm placeholder-content-tertiary disabled:cursor-not-allowed"
                />
                {!isAnswered && draft.trim().length > 0 && (
                    <button
                        type="button"
                        onClick={handleSubmitTyped}
                        className="flex-shrink-0 p-1 rounded-md text-accent-primary hover:bg-accent-primary/10 transition-colors"
                        aria-label="Submit answer"
                    >
                        <ArrowRight className="w-4 h-4" />
                    </button>
                )}
                {typedFilled && <Check className="w-4 h-4 text-accent-primary flex-shrink-0" />}
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/chat/ChipCard.tsx
git commit -m "feat(chat): ChipCard component for inline clarification chips"
```

---

## Task 11: Wire `ChipCard` through `Message` → `MessageList` → `ChatInterface`

**Files:**
- Modify: `components/chat/Message.tsx`
- Modify: `components/chat/MessageList.tsx`
- Modify: `components/chat/ChatInterface.tsx`

- [ ] **Step 1: Extend the local `Message` interface in `Message.tsx`**

Open `components/chat/Message.tsx`. The local `Message` interface (lines 15–28) is a subset of the store's `Message`. Add the two new optional fields so TypeScript accepts what we pass in:

```ts
interface Message {
    id: string;
    type: 'user' | 'assistant';
    content: string;
    images?: string[];
    result?: any;
    workflow?: Workflow;
    timestamp: Date;
    status?: 'running' | 'completed' | 'error';
    executionResult?: any;
    thinking?: string;
    isThinking?: boolean;
    thinkingDurationMs?: number;
    clarification?: { options: string[] };
    clarificationAnswer?: { chosenIndex: number | null; text: string };
}
```

- [ ] **Step 2: Add `onClarificationAnswer` prop and render the card**

Import `ChipCard` at the top of `Message.tsx`:

```ts
import { ChipCard } from './ChipCard';
```

Extend the props of the memoized `Message` component (around line 121–143) to accept an `onClarificationAnswer` callback:

```ts
export const Message = React.memo(function Message({
    message,
    onRevert,
    onEdit,
    undoSnapshotId,
    isDisabled,
    isEditing,
    serverStatus,
    isCanvasMode = false,
    isGenerating,
    onRetry,
    onClarificationAnswer,
}: {
    message: Message;
    onRevert?: (id: string, skipConfirmation?: boolean) => void;
    onEdit?: (message: Message) => void;
    undoSnapshotId?: string;
    isDisabled?: boolean;
    isEditing?: boolean;
    serverStatus?: string | null;
    isCanvasMode?: boolean;
    isGenerating?: boolean;
    onRetry?: () => void;
    onClarificationAnswer?: (payload: {
        questionMessageId: string;
        chosenIndex: number | null;
        text: string;
    }) => void;
}) {
```

In the JSX, render `ChipCard` immediately after the `message.result` block (around line 240, just before the `message.type === 'user'` timestamp/edit/revert block). Add:

```tsx
                    {message.type === 'assistant' && message.clarification && (
                        <ChipCard
                            options={message.clarification.options}
                            answer={message.clarificationAnswer}
                            onAnswer={(payload) =>
                                onClarificationAnswer?.({
                                    questionMessageId: message.id,
                                    chosenIndex: payload.chosenIndex,
                                    text: payload.text,
                                })
                            }
                        />
                    )}
```

- [ ] **Step 3: Pass the prop through `MessageList`**

Open `components/chat/MessageList.tsx`. Add `onClarificationAnswer` to `MessageListProps` and forward it to each rendered `<Message>`. Locate the props interface (around line 23) and the place where each `Message` is rendered.

Add to `MessageListProps`:

```ts
    onClarificationAnswer?: (payload: {
        questionMessageId: string;
        chosenIndex: number | null;
        text: string;
    }) => void;
```

Add `onClarificationAnswer` to the function's destructured args alongside the other handlers, and pass it to each `<Message>`:

```tsx
<Message
    /* ...existing props... */
    onClarificationAnswer={onClarificationAnswer}
/>
```

- [ ] **Step 4: Wire it in `ChatInterface.tsx`**

Open `components/chat/ChatInterface.tsx`. Find the `<MessageList>` JSX (line 392). Add an `onClarificationAnswer` prop that calls `handleSend` with the override sidecar:

```tsx
            <MessageList
                messages={messages}
                editingMessageId={editingMessageId}
                /* ...existing props... */
                onClarificationAnswer={(payload) => {
                    handleSend(
                        payload.text,
                        [],
                        [],
                        () => {},
                        () => {},
                        { questionMessageId: payload.questionMessageId, chosenIndex: payload.chosenIndex }
                    );
                }}
            />
```

(Find the existing `<MessageList ... />` invocation and add the new prop alongside its current ones — keep the existing props intact.)

- [ ] **Step 5: Type check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/chat/Message.tsx components/chat/MessageList.tsx components/chat/ChatInterface.tsx
git commit -m "feat(chat): wire ChipCard through MessageList and ChatInterface"
```

---

## Task 12: Manual smoke test pass

**Files:**
- (no code changes — verification only)

The repo has no automated test runner per `CLAUDE.md`. This task is the manual gate before the feature ships.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

Expected: server up on port 3000. Confirm `ANTHROPIC_API_KEY` is in `.env.local`.

- [ ] **Step 2: Smoke — happy path (chip click)**

Open `http://localhost:3000`, sign in. In a new chat session, send: `edit the photo so it looks more cinematic`.

Expected: Prism replies with a brief framing question; a chip card with 2–4 short options appears below the question text inside the assistant bubble. No workflow patches in this turn.

Click the first chip.

Expected: card flips to disabled state instantly with the chosen chip highlighted (filled accent + checkmark). A new user message appears with the chip's text. Prism's next assistant turn proceeds with that direction (likely calls `add_node` for a color-grade node).

- [ ] **Step 3: Smoke — write-your-own input chip**

Start a fresh session. Send: `make this image more interesting` (or similar ambiguous prompt).

When the chip card appears, type a custom phrase into the bottom write-your-own slot and press Enter.

Expected: the input-chip flips to filled accent style with the typed text + checkmark; other chips disable. A user message appears with the typed text. Prism's next turn proceeds.

- [ ] **Step 4: Smoke — answer via main chat input (bypass chips)**

Start a fresh session. Send an ambiguous prompt to trigger a clarification.

When the card appears, type your answer into the **main** chat input at the bottom (not the input-chip) and send.

Expected: the chip card flips to answered state with the input-chip slot showing your typed text (no chip highlighted). User bubble below shows the typed text. Prism's next turn proceeds.

- [ ] **Step 5: Smoke — page reload while pending**

Trigger a clarification. Before clicking anything, refresh the page.

Expected: the card re-appears in the assistant bubble in pending state. Click a chip or type to answer; the round-trip works exactly as the in-memory case.

- [ ] **Step 6: Smoke — sequential clarifications**

In one session, force two clarifications back-to-back: ambiguous request → answer one chip → ambiguous follow-up → answer another chip → execution.

Expected: two answered chip cards visible in history, each with its chosen state preserved. The second clarification's card opens after the first is answered, not before.

- [ ] **Step 7: Smoke — multilingual**

Send (in Hebrew, copy-paste): `תערוך את התמונה שתיראה יותר קולנועית`.

Expected: Prism's question text and the chip labels are in Hebrew. The flow is otherwise identical.

- [ ] **Step 8: Smoke — invalid options handling**

This case is hard to trigger from real usage; if you want to verify the brain's validation, temporarily make the system prompt encourage a 1-option clarification (e.g., add to `lib/chat/prompt/system.ts` "DEBUG: emit ask_clarification with exactly 1 option for any message"). Send any message.

Expected in terminal logs: an `error` event with message `ask_clarification needs 2-4 string options.` is sent. No chip card appears. The conversation continues; the next turn (if any) self-corrects. Revert the debug prompt change.

- [ ] **Step 9: Type check + lint**

```bash
npx tsc --noEmit
npm run lint
```

Expected: both clean.

- [ ] **Step 10: Final commit (if any small fixes)**

If any of the smoke tests required tweaks, commit them:

```bash
git add -- .
git commit -m "fix(chat): clarification chip card adjustments from smoke testing"
```

If everything passed, no commit needed.

---

## Open follow-ups (NOT in scope here)

- Suppress the redundant user bubble when the user clicked a chip (text would mirror the highlighted chip exactly). Render-time check on `Message`; ~5 lines. Defer until reviewers see real traffic.
- Card scroll anchoring: if the card lands below the viewport on long messages, an `scrollIntoView` on first render of the card may be needed. Verify in Step 2 of the smoke test; only add if the card lands hidden.
- Voice tuning of chip options. After a few real samples, refine the few-shot example or add a second example.
- Revert-to-mid-clarification: if the user reverts to a target between a clarification question and its answer, the in-memory `clarificationAnswer` on the assistant is not cleared (the existing `handleRevert` re-adds the existing in-memory messages without re-deriving). Reload re-derives correctly. Reaching this from the UI is uncommon (Revert buttons only render on workflow-snapshot turns; clarification turns have no snapshot). Fix when needed: in `handleRevert`, after `newMessages.forEach(msg => addMessage(msg))`, walk the array and clear `clarificationAnswer` on any assistant whose following message lacks a matching answer.
