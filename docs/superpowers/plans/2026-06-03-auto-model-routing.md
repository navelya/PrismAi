# Auto Model Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual chat model picker with automatic routing — every ordinary turn starts on Haiku with thinking off (fast lane), and complex turns escalate to Sonnet with thinking on via a new `escalate` tool.

**Architecture:** A capability flag (`canEscalate`, currently `isPaid`) gates routing. Paid turns start in the fast lane (Haiku, no thinking, `escalate` tool, no `propose_plan`); if Haiku calls `escalate` the route re-runs the same turn on the heavy lane (Sonnet, thinking on, full tools) into the same response stream. Plan-feedback turns deterministically skip straight to the heavy lane. Free users keep today's exact behavior (Haiku, full tools, legacy thinking heuristic), minus the picker.

**Tech Stack:** Next.js (route handlers, `nodejs` runtime), Anthropic SDK streaming, Zustand store, React.

**Spec:** [docs/superpowers/specs/2026-06-03-auto-model-routing-design.md](../specs/2026-06-03-auto-model-routing-design.md)

**Testing note:** This repo has **no test runner** (see CLAUDE.md). Verification per task is `npx tsc --noEmit` (lint/build are unreliable here — see the [verification-commands](../../../CLAUDE.md) note). The final task is manual in-app E2E.

---

## File Structure

| File | Change |
|------|--------|
| `lib/chat/tools/definitions.ts` | Add `escalate` tool def + `FAST_LANE_TOOLS` array; extend `ToolName`. |
| `lib/chat/streaming/protocol.ts` | Add `switching` and `model` stream events. |
| `lib/chat/prompt/system.ts` | Add `ESCALATE_GUIDANCE` to the cached stable block. |
| `lib/chat/brain.ts` | `BrainInput`: `tools`, `allowEscalate`, `thinkingMode`. `BrainResult`: `escalated`, `model`. Handle `escalate`; drive thinking by mode; use `input.tools`. |
| `app/api/chat/stream/route.ts` | Replace model derivation with lane routing + escalation re-run; emit `model`; persist `model`. |
| `lib/hooks/use-chat-messages.ts` | Stop sending `selectedModel`; handle `switching` + `model` stream events. |
| `lib/store/app-store.ts` | Add `model?` to the chat message type. |
| `components/chat/Message.tsx` | Render the model badge. |
| `components/chat/ChatInput.tsx` | Replace `ModelPicker` with a static "Auto" pill; drop `selectedModel`/`onModelSelect`. |
| `components/chat/ChatInterface.tsx` | Drop the `selectedModel`/`onModelSelect` props passed to `ChatInput`. |
| `lib/hooks/use-session.ts` | Map persisted `metadata.model` onto the loaded message (badge survives reload). |

---

## Task 1: Define the `escalate` tool and the fast-lane toolset

**Files:**
- Modify: `lib/chat/tools/definitions.ts:341` (the `ToolName` type) and append after the `TOOLS` array.

- [ ] **Step 1: Add the `escalate` tool + `FAST_LANE_TOOLS` after the `TOOLS` array**

Append at the end of `lib/chat/tools/definitions.ts` (after the `TOOLS` array closes at line 339, before the `ToolName` export):

```ts
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
  ...TOOLS.filter(t => t.name !== 'propose_plan'),
  ESCALATE_TOOL,
];
```

- [ ] **Step 2: Extend `ToolName` to include `escalate`**

In `lib/chat/tools/definitions.ts:341`, change:

```ts
export type ToolName = 'add_node' | 'update_node' | 'update_compositor_layer' | 'remove_node' | 'ask_clarification' | 'propose_plan';
```

to:

```ts
export type ToolName = 'add_node' | 'update_node' | 'update_compositor_layer' | 'remove_node' | 'ask_clarification' | 'propose_plan' | 'escalate';
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no new errors).

- [ ] **Step 4: Commit**

```bash
git add lib/chat/tools/definitions.ts
git commit -m "feat(chat): add escalate tool + fast-lane toolset"
```

---

## Task 2: Add `switching` and `model` stream events

**Files:**
- Modify: `lib/chat/streaming/protocol.ts:58-72` (the `StreamEvent` union).

- [ ] **Step 1: Add the two events to the `StreamEvent` union**

In `lib/chat/streaming/protocol.ts`, inside the `StreamEvent` union (before `| { type: 'done' }` at line 72), add:

```ts
  | { type: 'switching' }
  | { type: 'model'; model: 'haiku' | 'sonnet' }
```

The relevant region becomes:

```ts
  | { type: 'usage'; inputTokens: number; outputTokens: number; thinkingTokens: number; costUsd: number }
  | { type: 'error'; message: string; recoverable: boolean }
  | { type: 'switching' }
  | { type: 'model'; model: 'haiku' | 'sonnet' }
  | { type: 'done' };
```

- [ ] **Step 2: Document the new events in the header comment (optional but DRY)**

In the same file, under the "Order guarantee per turn" comment block (around line 42-57), append a line noting:

```
 *   [switching?]       ← emitted once if the fast lane escalates to the heavy lane
 *   [model]            ← final model that produced the answer ('haiku' | 'sonnet')
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/chat/streaming/protocol.ts
git commit -m "feat(chat): add switching + model stream events"
```

---

## Task 3: Add escalate guidance to the cached prompt

**Files:**
- Modify: `lib/chat/prompt/system.ts` — add a constant and include it in the `stable` array at line 257-273.

- [ ] **Step 1: Define the `ESCALATE_GUIDANCE` constant**

In `lib/chat/prompt/system.ts`, near the other prompt-section constants (e.g. just above `TOOL_RULES`), add:

```ts
const ESCALATE_GUIDANCE = `## When to escalate
If — and only if — you have the \`escalate\` tool available:
- Call \`escalate\` as your FIRST action (before any text or other tool) when the request needs multi-step reasoning, a plan the user should approve, or a large/ambiguous multi-node build.
- Do NOT escalate for simple work you can do directly: a single node add, a config tweak, a model swap, a rename, a removal, or answering a question. Just do it.
- You will not always have this tool. When you don't, proceed normally — never mention escalation to the user.`;
```

- [ ] **Step 2: Include it in the cached stable block**

In `buildSystemPrompt` (line 257), add `ESCALATE_GUIDANCE` to the `stable` array immediately after `TOOL_RULES`:

```ts
  const stable = [
    IDENTITY,
    VOICE_RULES,
    THINKING_VOICE,
    CAPABILITIES,
    CRITICAL_RULES,
    formatRegistryContext(input.registry),
    TOOL_RULES,
    ESCALATE_GUIDANCE,
    GROUPING,
    TASK_SPLITTING,
    USE_CASE_ARCHETYPES,
    PROMPT_CRAFT,
    EDITING_RESULTS,
    MULTI_SUBJECT,
    RESPONSE_FORMAT,
    FEWSHOT_EXAMPLES,
  ].join('\n\n');
```

> Note: kept in the stable (cached) block unconditionally so the 1h prompt cache stays a single prefix per model. The "only if you have the tool" phrasing makes it a no-op for the heavy/free lanes that lack `escalate`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/chat/prompt/system.ts
git commit -m "feat(chat): add escalate guidance to cached system prompt"
```

---

## Task 4: Teach the brain to route tools, thinking, and escalation

**Files:**
- Modify: `lib/chat/brain.ts` — `BrainResult` (12-21), `BrainInput` (23-38), thinking decision (94-139), `tools` arg (145), `escalate` handling (after 306), return (407).

- [ ] **Step 1: Extend `BrainResult` with `escalated` and `model`**

In `lib/chat/brain.ts`, add two fields to `BrainResult` (after `plan` at line 20):

```ts
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
```

- [ ] **Step 2: Extend `BrainInput` with `tools`, `allowEscalate`, `thinkingMode`**

Add the import for the tool type and the new fields. At the top, the existing import is `import { TOOLS, type ToolName } from './tools/definitions';` — extend it:

```ts
import { TOOLS, type ToolName, type AnthropicTool } from './tools/definitions';
```

Then add to `BrainInput` (after `characterRefs` at line 37):

```ts
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
```

- [ ] **Step 3: Add `escalated` + `modelKey` locals and drive thinking by mode**

Replace the block computing `disableThinkingFirstTurn` (lines 104-108) so the heuristic result is folded into a base thinking decision. After the existing `const disableThinkingFirstTurn = ...` assignment (line 104-108), add:

```ts
  // Resolve the per-pass base thinking decision from thinkingMode.
  const thinkingMode = input.thinkingMode ?? 'heuristic';
  const baseDisableThinking =
    thinkingMode === 'off' ? true :
    thinkingMode === 'on' ? false :
    disableThinkingFirstTurn; // 'heuristic'
```

Then, in the loop, change the per-iteration thinking line (currently line 139):

```ts
    const iterationDisableThinking = iteration === 1 ? baseDisableThinking : true;
```

Also add an `escalated` local alongside the other `let` declarations (near line 92, after `let plan`):

```ts
  let escalated = false;
  const modelKey: 'haiku' | 'sonnet' = input.model ?? 'sonnet';
```

- [ ] **Step 4: Pass the per-pass tools to the provider**

Change the `streamAnthropicTurn` call (line 145) from `tools: TOOLS,` to:

```ts
        tools: input.tools ?? TOOLS,
```

- [ ] **Step 5: Handle the `escalate` tool call**

In the `case 'tool_call':` block, immediately AFTER the `propose_plan` handling closes (after line 306, before the `if (name !== 'add_node' ...)` unknown-tool check at line 308), insert:

```ts
            if (name === 'escalate') {
              // Only the fast lane offers this tool. Honor it only before any
              // edit has been applied this turn, so we never discard committed
              // patches. Silent to the client — no event is emitted.
              if (input.allowEscalate && accumulatedPatch === null) {
                escalated = true;
                calledTerminalTool = true; // stop the loop; caller re-runs on Sonnet
              }
              break;
            }
```

- [ ] **Step 6: Return `model` and `escalated`**

Change the final return (line 407) to include the two new fields:

```ts
  return { finalText, finalThinking, finalWorkflow, accumulatedPatch, hadAnyOutput, usage, clarification, plan, model: modelKey, escalated };
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/chat/brain.ts
git commit -m "feat(chat): brain routes tools/thinking + handles escalate"
```

---

## Task 5: Wire lane routing and escalation into the route handler

**Files:**
- Modify: `app/api/chat/stream/route.ts` — model derivation (452-458), runBrain call (573-582), assistant persistence metadata (631-636).
- Import `FAST_LANE_TOOLS` from definitions.

- [ ] **Step 1: Import the fast-lane tools**

At the top of `app/api/chat/stream/route.ts`, find the import of `runBrain` / chat internals and add `FAST_LANE_TOOLS`. If tools aren't already imported there, add:

```ts
import { FAST_LANE_TOOLS } from '@/lib/chat/tools/definitions';
```

- [ ] **Step 2: Replace the model derivation with the capability flag**

Replace lines 452-458 (the `isPaid` / `requestedModel` / `model` block):

```ts
  const isPaid = planId !== 'free';
  const requestedModel =
    body.selectedModel === 'sonnet' || body.selectedModel === 'haiku'
      ? (body.selectedModel as 'haiku' | 'sonnet')
      : undefined;
  const model: 'haiku' | 'sonnet' =
    isPaid && requestedModel ? requestedModel : isPaid ? 'sonnet' : 'haiku';
```

with:

```ts
  const isPaid = planId !== 'free';
  // Capability flag for the heavy lane. Today this is exactly isPaid; the
  // future free-tier Sonnet quota will OR in `hasRemainingSonnetQuota` here.
  // The client no longer chooses a model — body.selectedModel is ignored.
  const canEscalate = isPaid;
```

- [ ] **Step 3: Route the brain pass(es)**

Replace the single `runBrain` call (lines 573-582) inside `waitUntil`:

```ts
        const result = await runBrain({
          turns,
          workflow: previousWorkflow,
          registry,
          encoder,
          attachedImageUrls,
          model,
          nodeRefs,
          characterRefs,
        });
```

with lane routing:

```ts
        const commonInput = {
          turns,
          workflow: previousWorkflow,
          registry,
          encoder,
          attachedImageUrls,
          nodeRefs,
          characterRefs,
        };

        let result;
        if (!canEscalate) {
          // Free tier: unchanged behavior — Haiku, full tools, legacy heuristic.
          result = await runBrain({
            ...commonInput,
            model: 'haiku',
            allowEscalate: false,
            thinkingMode: 'heuristic',
          });
        } else if (planAnswer?.action === 'feedback') {
          // Plan refinement needs propose_plan + reasoning → straight to heavy lane.
          result = await runBrain({
            ...commonInput,
            model: 'sonnet',
            allowEscalate: false,
            thinkingMode: 'on',
          });
        } else {
          // Fast lane: Haiku, no thinking, fast tools + escalate.
          result = await runBrain({
            ...commonInput,
            model: 'haiku',
            tools: FAST_LANE_TOOLS,
            allowEscalate: true,
            thinkingMode: 'off',
          });
          if (result.escalated) {
            // Hand off to the heavy lane in the SAME response stream.
            encoder.send({ type: 'switching' });
            result = await runBrain({
              ...commonInput,
              model: 'sonnet',
              allowEscalate: false,
              thinkingMode: 'on',
            });
          }
        }

        // Tell the client which model actually produced the answer (for the badge).
        encoder.send({ type: 'model', model: result.model });
```

> Note: passes that omit `tools` default to the full `TOOLS` set inside the brain. The free + feedback + escalated-Sonnet passes all want the full set, so they correctly omit it.

- [ ] **Step 4: Persist the final model on the assistant row**

In the assistant `messages.insert` metadata object (lines 631-636), add `model`:

```ts
                metadata: {
                  thinking: result.finalThinking || null,
                  usage: result.usage || null,
                  clarification: result.clarification || null,
                  plan: result.plan || null,
                  model: result.model,
                },
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. (If `result` is flagged as "used before assigned", confirm every branch assigns it — the three-branch `if/else if/else` is exhaustive; declare with `let result;` as shown.)

- [ ] **Step 6: Commit**

```bash
git add app/api/chat/stream/route.ts
git commit -m "feat(chat): auto-route Haiku fast lane with escalate to Sonnet"
```

---

## Task 6: Handle the new stream events on the client + stop sending model

**Files:**
- Modify: `lib/hooks/use-chat-messages.ts` — request body (406), stream switch (492-621 region).

- [ ] **Step 1: Stop sending `selectedModel`**

In `lib/hooks/use-chat-messages.ts`, remove line 406 from the fetch body:

```ts
                    selectedModel: useAppStore.getState().selectedChatModel,
```

(The server ignores it now. Leaving the store field in place is fine; it's simply no longer transmitted.)

- [ ] **Step 2: Handle the `model` event — store it on the assistant message**

In `processStreamLine`, add a new branch. Place it right after the `usage` branch (after line 501):

```ts
                else if (parsed.type === 'model') {
                    useAppStore.getState().updateMessage(assistantMsgId, {
                        model: parsed.model === 'haiku' || parsed.model === 'sonnet' ? parsed.model : undefined,
                    });
                }
```

- [ ] **Step 3: Handle the `switching` event — show "Thinking deeper…"**

Add another branch right after the `model` branch:

```ts
                else if (parsed.type === 'switching') {
                    setStatusMessage('Thinking deeper…');
                }
```

(`setStatusMessage` is already in scope — it's called in `renderLoop` at line 456 and cleared on `done`.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: one expected error — `model` is not a known field on the chat message type. Fixed in Task 7. If you want a green checkpoint now, do Task 7 first; otherwise proceed and commit after Task 7.

- [ ] **Step 5: Commit (after Task 7 makes tsc green)**

```bash
git add lib/hooks/use-chat-messages.ts
git commit -m "feat(chat): handle switching + model stream events, drop selectedModel send"
```

---

## Task 7: Add `model` to the chat message type

**Files:**
- Modify: `lib/store/app-store.ts` — the chat message interface (the type holding `usage`, `clarification`, `plan`, `thinking`).

- [ ] **Step 1: Locate the chat message interface**

Run: `npx tsc --noEmit` is not how you find it — grep the field that already exists:

```bash
git grep -n "clarification?" lib/store/app-store.ts
```

Expected: a line inside the chat message interface (e.g. `ChatMessage`/`Message`) declaring `clarification?: ...`.

- [ ] **Step 2: Add the `model` field**

In that interface, next to `usage?` / `clarification?`, add:

```ts
  /** Which model produced this assistant message ('haiku' = fast, 'sonnet' = deep). */
  model?: 'haiku' | 'sonnet';
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (this clears the Task 6 error too).

- [ ] **Step 4: Commit**

```bash
git add lib/store/app-store.ts
git commit -m "feat(chat): add model field to chat message type"
```

---

## Task 8: Render the model badge

**Files:**
- Modify: `components/chat/Message.tsx` — imports + assistant render (around 326-332).

- [ ] **Step 1: Ensure icon imports**

At the top of `components/chat/Message.tsx`, ensure `Zap` and `Sparkles` are imported from `lucide-react` (add to the existing lucide import line):

```ts
import { Zap, Sparkles } from 'lucide-react';
```

(Merge into the existing `lucide-react` import if one exists — do not create a duplicate import statement.)

- [ ] **Step 2: Render a subtle badge for assistant messages**

In `components/chat/Message.tsx`, immediately after the `ThinkingPanel` block (after line 332), add:

```tsx
                    {message.type === 'assistant' && message.model && (
                        <div
                            className="flex items-center gap-1 mb-1 text-[10px] text-content-tertiary select-none"
                            title={message.model === 'sonnet' ? 'Handled by Sonnet (deep)' : 'Handled by Haiku (fast)'}
                        >
                            {message.model === 'sonnet'
                                ? <Sparkles className="w-3 h-3 text-accent-primary" />
                                : <Zap className="w-3 h-3 text-content-tertiary" />}
                            <span>{message.model === 'sonnet' ? 'Deep' : 'Fast'}</span>
                        </div>
                    )}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/chat/Message.tsx
git commit -m "feat(chat): show fast/deep model badge on assistant messages"
```

---

## Task 9: Replace the ModelPicker with a static "Auto" pill

**Files:**
- Modify: `components/chat/ChatInput.tsx` — imports (24), props (81-82, 107-108), render (510-520).
- Modify: `components/chat/ChatInterface.tsx` — drop the `selectedModel`/`onModelSelect` props passed to `ChatInput`.

- [ ] **Step 1: Remove the ModelPicker import**

In `components/chat/ChatInput.tsx`, delete line 24:

```ts
import { ModelPicker } from './ModelPicker';
```

- [ ] **Step 2: Drop the model props from `ChatInputProps`**

Remove lines 81-82 from the interface:

```ts
    selectedModel?: 'haiku' | 'sonnet';
    onModelSelect?: (m: 'haiku' | 'sonnet') => void;
```

And remove them from the destructured params (lines 107-108):

```ts
            selectedModel = 'sonnet',
            onModelSelect,
```

- [ ] **Step 3: Replace the ModelPicker render with a static Auto pill**

Replace the conditional `ModelPicker` block (lines 510-520):

```tsx
                            {/* Model picker — same Select dropdown, controlled */}
                            {onModelSelect && (
                                <ModelPicker
                                    selectedModel={selectedModel}
                                    onSelect={onModelSelect}
                                    isPaid={isPaid}
                                    open={openMenu === 'model'}
                                    onOpenChange={handleModelOpenChange}
                                    onPointerDownOutside={handleModelOutside}
                                    triggerRef={modelTriggerRef}
                                />
                            )}
```

with:

```tsx
                            {/* Model is chosen automatically server-side. */}
                            <Tooltip content="Model is selected automatically" position="top">
                                <span
                                    className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-surface-secondary text-content-tertiary text-xs select-none"
                                    aria-label="Automatic model selection"
                                >
                                    <Sparkles className="w-3.5 h-3.5 text-accent-primary" />
                                    Auto
                                </span>
                            </Tooltip>
```

(`Tooltip` and `Sparkles` are already imported in this file — lines 22 and 21.)

- [ ] **Step 4: Remove now-dead model-menu plumbing (optional cleanup)**

The `modelTriggerRef`, `handleModelOutside`, `handleModelOpenChange`, and the `'model'` arm of `openMenu` are no longer used. Remove `modelTriggerRef` (line 122), `handleModelOutside` (159-164), `handleModelOpenChange` (169-172), and narrow the `openMenu` state type (line 120) from `'none' | 'plus' | 'model'` to `'none' | 'plus'`. Leave `handlePlusOutside` intact — but note it referenced `modelTriggerRef`; simplify its body to a no-op switch target since there's no sibling dropdown anymore:

```ts
        const [openMenu, setOpenMenu] = useState<'none' | 'plus'>('none');
        const plusTriggerRef = useRef<HTMLButtonElement>(null);
```

And `handlePlusOutside` (lines 153-158) becomes unnecessary (no sibling to switch to) — pass `undefined` for `onPointerDownOutside` on the plus `Select`, or leave a no-op. Simplest: delete `handlePlusOutside` and remove the `onPointerDownOutside={handlePlusOutside}` prop on the plus `Select` (line 504).

> If this cleanup risks touching too much at once, it is safe to SKIP Step 4 entirely — the unused handlers are harmless. Prefer correctness over churn.

- [ ] **Step 5: Stop passing model props from `ChatInterface.tsx`**

In `components/chat/ChatInterface.tsx`, find where `<ChatInput ... />` is rendered and remove the `selectedModel={...}` and `onModelSelect={...}` props. (Grep: `git grep -n "onModelSelect\|selectedModel" components/chat/ChatInterface.tsx`.) Leave `isPaid` — it's still used for other gating.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. If `ModelPicker.tsx` is now unreferenced, that's fine — leave the file in place (it's harmless and may be reused when free-tier Sonnet metering ships).

- [ ] **Step 7: Commit**

```bash
git add components/chat/ChatInput.tsx components/chat/ChatInterface.tsx
git commit -m "feat(chat): replace model picker with static Auto indicator"
```

---

## Task 10: Persist the badge across reload

**Files:**
- Modify: `lib/hooks/use-session.ts` — the message-load mapping that reads `metadata.usage` / `metadata.plan`.

- [ ] **Step 1: Map `metadata.model` onto the loaded message**

In `lib/hooks/use-session.ts`, find where assistant messages are reconstructed from DB rows (grep: `git grep -n "metadata?.usage\|metadata.usage\|\.plan" lib/hooks/use-session.ts`). Wherever `usage`/`plan` are pulled off `metadata` onto the in-memory message, add the model:

```ts
            model: row.metadata?.model === 'haiku' || row.metadata?.model === 'sonnet'
                ? row.metadata.model
                : undefined,
```

(Match the exact object-construction style already used there — this is one more field alongside `usage`, `thinking`, `plan`, `clarification`.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/hooks/use-session.ts
git commit -m "feat(chat): restore model badge from persisted metadata on reload"
```

---

## Task 11: Manual end-to-end verification

No automated tests exist. Run the app (`npm run dev`) and verify each routing path. Watch the server console for `[chat:cache]` lines to confirm which model ran.

- [ ] **Step 1: Fast lane (paid)** — Send *"generate me an image"* as a paid user on an empty/simple canvas.
  - Expected: no "Thinking deeper…" indicator; assistant streams almost immediately; nodes appear; badge shows **⚡ Fast**; `[chat:cache]` shows `"model":"claude-haiku-4-5","thinking":false`.

- [ ] **Step 2: Escalation (paid)** — Send *"build a full pipeline: generate a portrait, remove its background, then composite it over a generated landscape with a title"*.
  - Expected: brief **"Thinking deeper…"**, then a plan card (`propose_plan`); badge shows **✦ Deep**; console shows a Haiku line (the attempt) followed by a `"claude-sonnet-4-6","thinking":true` line.

- [ ] **Step 3: Plan feedback (paid)** — On the plan from Step 2, submit feedback text (not Approve).
  - Expected: goes **straight to Sonnet** (no Haiku attempt line in console first); plan is revised; badge **✦ Deep**.

- [ ] **Step 4: Plan approval (paid)** — Approve a plan.
  - Expected: unchanged behavior — workflow builds, no model invoked (no new `[chat:cache]` line), no badge change for the approval action.

- [ ] **Step 5: Free user** — As a free-plan user, send any message.
  - Expected: behaves exactly as before (Haiku); the input shows the static **Auto** pill; no escalation ever occurs; badge shows **⚡ Fast**.

- [ ] **Step 6: Reload persistence** — Refresh the page on a thread containing both a Fast and a Deep message.
  - Expected: both badges reappear correctly from persisted metadata.

- [ ] **Step 7: Final typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

---

## Self-Review Notes (coverage check)

- **Spec §"two lanes" + toolsets** → Tasks 1, 4, 5.
- **Spec §escalate tool + escalate-first contract** → Tasks 1 (def), 3 (prompt), 4 (handling).
- **Spec §deterministic feedback pre-route** → Task 5 Step 3 (`planAnswer.action === 'feedback'`).
- **Spec §free vs paid (`canEscalate` seam)** → Task 5 Step 2-3.
- **Spec §UI ModelPicker → Auto + drop selectedModel** → Tasks 6 (send), 9 (UI).
- **Spec §observability badge + persist** → Tasks 2, 5 (emit+persist), 6-8, 10.
- **Spec §escalation UX (no false start, "Thinking deeper…")** → Task 4 (escalate-first, silent), Task 6 Step 3.
- **Out of scope (Flash, free Sonnet metering)** → not implemented; `canEscalate` seam left for the latter.
