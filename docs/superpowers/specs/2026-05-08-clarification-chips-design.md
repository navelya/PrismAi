# Clarification Chips — Design

**Date:** 2026-05-08
**Status:** Draft, pending user review
**Sub-project:** B-1. Pulled from the deferred list in `2026-05-07-chat-brain-rework-design.md`. First slice of a "plan-and-approve" family — covers clarifying questions only; full plan-and-approve, cost preview, and suggestion chips remain deferred.
**Approach:** New Anthropic tool `ask_clarification` + a single new NDJSON stream event. UI is an inline chip card inside the assistant bubble, with a built-in "write your own" input-chip.

---

## Goal

When the user's request is genuinely ambiguous, Prism asks one short question with 2–4 chip-style answer options plus a free-form input chip. Clicking a chip or submitting the input becomes the next user turn. The flow plugs into the existing brain + streaming protocol with one new tool, one new event, and two small JSONB additions on `messages.metadata`.

## Non-goals

- Full plan-and-approve flow (separate sub-project).
- Cost preview before run (separate sub-project).
- Suggestion chips below the input (separate sub-project; UI is similar but trigger and intent differ).
- Multi-select clarifications (single-select only in v1).
- Model-driven runtime guards against bad tool combinations (rely on prompt discipline; iterate if needed).
- DB schema changes — both new metadata blobs ride existing `messages.metadata` JSONB.

## Scope summary

In scope:
- New Anthropic tool `ask_clarification` carrying only the chip options.
- New NDJSON stream event `{type: 'clarification', options}`.
- New `ChipCard` component rendered inside `Message`, with built-in write-your-own input-chip.
- Client store: `Message.clarification` (pending/answered state derivation).
- Sidecar `clarificationAnswer` field on the next user POST to `/api/chat/stream`.
- Persistence: `metadata.clarification` on assistant messages, `metadata.clarification_answer` on user messages.
- Prompt updates: TOOL USAGE RULES subsection, one CAPABILITIES line, one new few-shot example.
- Manual test checklist additions.

DB schema changes: none.

---

## Section 1 — Wire format & data flow

### New tool

Added to `lib/chat/tools/definitions.ts`:

```ts
{
  name: 'ask_clarification',
  description:
    'Ask the user a clarifying question with 2-4 short option chips. ' +
    'Use ONLY when the request is genuinely ambiguous and guessing wrong ' +
    'would likely require redoing work. Do not use for trivial defaults — ' +
    'pick a reasonable one and proceed. The question text goes in your ' +
    'normal response body; this tool only carries the chip options.',
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
          'answer the user could send as their next message.'
      }
    },
    required: ['options']
  }
}
```

The model writes a one-line question in its normal text body and calls `ask_clarification` with `options`. There is no separate `question` field — the question is the assistant message's text content, same as any other assistant text.

`ToolName` widens to include `'ask_clarification'`.

### Brain handling (`lib/chat/brain.ts`)

In the `tool_call` switch, recognize `ask_clarification` and route it differently from workflow tools. It does NOT go through `dispatchTool` (no patch path).

Validation (defensive — bad model output should self-correct, not crash):
- `options` must be an array; non-string entries are filtered out.
- After filtering, length must be in [2, 4]; if `> 4`, trim to first 4. If `< 2`, emit an `error` event with `recoverable: true` and skip the clarification event entirely.

On success, emit one new event: `{type: 'clarification', options}`.

`BrainResult` extends:
```ts
clarification: { options: string[] } | null;
```

The route uses this to know whether to persist `metadata.clarification` on the assistant message. A turn either has a clarification or it does not — the brain only retains the first valid one if the model emits multiple in the same turn.

### New stream event (`lib/chat/streaming/protocol.ts`)

```ts
| { type: 'clarification'; options: string[] }
```

Per-turn order is now:

```
[thinking_*]
[text]*
[tool]*
[clarification?]
[usage]
[done]
```

Per the prompt rules in Section 3, a clarification turn typically has only `text` + `clarification` (no `tool`). The protocol does not enforce this — it permits either.

### Client reducer (`lib/hooks/use-chat-messages.ts`)

One new branch in `processStreamLine`:

```ts
else if (parsed.type === 'clarification') {
  useAppStore.getState().updateMessage(assistantMsgId, {
    clarification: { options: parsed.options }
  });
}
```

The store `Message` type gains:

```ts
clarification?: { options: string[] };
```

Note: the store does not carry a `status` field. Pending vs. answered is derived at render time by checking whether a following user message has a matching `clarification_answer` (see Section 4).

### User's answer round-trip

When the user clicks a chip or submits the inline write-your-own input, the existing `handleSend` is reused with one extra payload field:

```ts
// in the request body to /api/chat/stream
clarificationAnswer: {
  questionMessageId: string,    // the assistant message id
  chosenIndex: number | null    // number if a chip was clicked; null if typed
}
```

The text of the message (`messages[last].content`) carries the actual answer text — chip text for clicks, typed text for write-your-own.

If the user types a regular message in the main chat input while a clarification is pending, the client still sends `clarificationAnswer` with `chosenIndex: null` and `questionMessageId` set to the pending question's id. This collapses "ignored the chips and typed instead" into the same answered state.

### Route handler (`app/api/chat/stream/route.ts`)

Two small additions to the existing message-insert paths:
- Assistant insert gains `metadata.clarification = result.clarification` when the brain returned one.
- User insert gains `metadata.clarification_answer = body.clarificationAnswer` when the request carried one.

The model still sees the next turn as plain text via `toAnthropicMessages` — no special tool_result wiring (consistent with how the existing workflow tools already drop their tool_use blocks at history-flatten time).

---

## Section 2 — UI rendering

### Component additions

```
components/chat/
├─ ChipCard.tsx                NEW   the chips card itself
├─ Message.tsx                 EDIT  conditionally render <ChipCard/> below body
└─ ChatInput.tsx               KEEP  unchanged
```

`ChipCard` owns: chip layout, the inline write-your-own input, click handling, and the disabled-after-answer visual. It is rendered by `Message` whenever `message.clarification` is set on an assistant message.

### Card layout

```
┌─ Prism ─────────────────────────────────────────────┐
│  Two ways to read this — should the background be   │
│  the new image or replace the existing photo?       │
│                                                     │
│  ╭───────────────────────────────────────────────╮  │
│  │  [ Use as new background ]                    │  │
│  │  [ Replace the existing photo ]               │  │
│  │  [ Something else… ____________________ ↵ ]   │  │
│  ╰───────────────────────────────────────────────╯  │
└─────────────────────────────────────────────────────┘
```

- Bordered container inside the message bubble, below the streamed text.
- N chip buttons (2–4) followed by one inline write-your-own chip.
- Write-your-own chip is a single-line text input styled to match the chip buttons; placeholder ("Something else…"); a small enter/send glyph appears when there is text.
- Card appears in one render pass when the `clarification` event arrives — no per-chip animation. CSS fade-in on the whole card is fine for polish.

### Rendering states

| State | Trigger | Visual |
|-------|---------|--------|
| Hidden | No `message.clarification` | Card not rendered |
| Pending | `clarification.options` set, no following user message with matching `clarification_answer` | All chips clickable; write-your-own input focusable; hover affordance on each chip |
| Answered (chip pick) | Following user message has `clarification_answer.chosenIndex: number` | Chosen chip filled with accent color + checkmark glyph; other chips disabled (50% opacity, `pointer-events: none`); write-your-own input shows empty placeholder, disabled |
| Answered (typed) | Following user message has `clarification_answer.chosenIndex: null` | All chip buttons disabled; write-your-own input shows the typed text, filled with accent, read-only |

### Interactions

- **Click a chip** → `onAnswer({ chosenIndex: i, text: options[i] })`. Card flips to answered state immediately (optimistic). `handleSend` fires with the chip text and the sidecar `clarificationAnswer`.
- **Type + Enter (or send glyph) in write-your-own** → `onAnswer({ chosenIndex: null, text: typedText })`. Same path; `chosenIndex: null` signals "typed."
- **Type in the main chat input + send** while a clarification is pending → existing `handleSend` runs, but the client adds the `clarificationAnswer` sidecar (with `chosenIndex: null` and `questionMessageId` set to the pending question's id). The card transitions to answered with `chosenText: <typed>` and no chip highlight.
- **Stop button mid-stream** while the card is showing → standard abort. The pending clarification is preserved in the store (it landed before abort); user can answer it or send a new message later, same flow.

### Per-component contracts

| Component | Owns | Receives | Emits |
|-----------|------|----------|-------|
| `ChipCard` | local state of the write-your-own input value | `options`, `status` (derived: pending/answered-chip/answered-typed), `chosenIndex?`, `chosenText?`, `onAnswer(payload)` | `onAnswer({chosenIndex, text})` |
| `Message` | unchanged behavior, plus conditional render of `<ChipCard>` | `message` (now possibly with `clarification`) | unchanged |

`ChipCard`'s typed-text state is local; it is not lifted into the store. When `status` transitions to `answered`, the input freezes at whatever was typed (or empty).

### User bubble after answer

The user's answer renders as a normal user message bubble below the assistant question, containing the chip text or typed text. This is redundant with the highlighted chip but keeps every assistant turn paired with a user turn — consistent with the rest of the flow. Suppression is a possible follow-up if it feels noisy in practice; it is not in scope here.

### Reload behavior

On session reload, the chat history is reconstructed from `messages` rows. For each assistant message with `metadata.clarification.options`:
- Find the next user message chronologically. If it has `metadata.clarification_answer.questionMessageId === assistant.id`, render the card in answered state — `chosenIndex: number` → highlight chip i; `chosenIndex: null` → show the typed text in the write-your-own slot.
- If there is no following user message, render the card in pending state — chips clickable, write-your-own works. Lets the user resume an abandoned clarification on a later visit.

---

## Section 3 — System prompt rules

The clarification flow is governed by the prompt; the model decides when to ask. Three small additions to existing prompt modules.

### `lib/chat/prompt/system.ts` — extend TOOL USAGE RULES

Add a `Clarifying questions` subsection:

```
Clarifying questions:
- Use ask_clarification ONLY when the request is genuinely ambiguous and
  guessing wrong would likely require redoing work. Do not ask for trivial
  defaults — pick a sensible one and proceed.
- When you ask, write ONE short forward-question as the last line of your
  text body (this becomes the bubble's text). Then call ask_clarification
  with 2–4 options.
- Each option must be a complete, fully-formed answer the user could send
  as their next message. Keep each ≤ 40 chars. Make them mutually exclusive.
- Pure question turn: when you call ask_clarification, do NOT also call
  add_node / update_node / remove_node in the same turn. If you have a
  question, ask it first; act on the answer next turn.
- Phrase the question and the options in the user's language (if they
  wrote in Hebrew, the chips are in Hebrew).
- Do not re-ask something the user already answered in this session.
```

### `lib/chat/prompt/system.ts` — extend CAPABILITIES (one line)

```
- Can: …, ask short clarifying questions with chip options when a request
  is genuinely ambiguous, …
```

### `lib/chat/prompt/examples.ts` — add a third few-shot example

```
USER: edit the photo so it looks more cinematic

ASSISTANT (text): Cinematic can lean a few directions — which feel are
you going for?
[tool_use ask_clarification options=[
  "Warm, golden-hour color grade",
  "Cool, teal-and-orange contrast",
  "Moody low-key with film grain"
]]

USER (next turn): Warm, golden-hour color grade

ASSISTANT (text): Adding a color-grade pass tuned warm.
[tool_use add_node …]
```

The example shows the option-phrasing rule (each chip a fully-formed answer, ≤40 chars, mutually exclusive) and the pure-question-turn rule (no `add_node` in the question turn).

### `lib/chat/prompt/voice.ts` — no changes

The existing rule "End with a single forward question" already aligns: a clarification turn ends with a forward question; that question is paired with structured options.

### Risks the prompt accepts

- The model may occasionally call `ask_clarification` when it shouldn't (overcautious). Cost is one extra round-trip; not destructive.
- The model may write a multi-sentence preamble before the question. The card still renders correctly because we anchor on the tool input, not the text. A long preamble is a UX nit.
- The model may emit `ask_clarification` *and* a workflow tool in the same turn. The brain does not enforce mutual exclusion; both events fire, the client renders both, the user ends up with a card *and* a partial patch. This is a prompt-discipline issue. Iterate via prompt if it shows up; do not add a runtime guard.

---

## Section 4 — Persistence, edge cases, errors

### Persistence

Two metadata blobs, both on the existing `messages.metadata` JSONB column. No DB migration.

**Assistant message (the question turn):**
```json
"metadata": {
  "thinking": "...",
  "clarification": { "options": ["Imagen 4", "Flux", "I'll choose later"] }
}
```

**User message (the answer):**
```json
"metadata": {
  "clarification_answer": {
    "questionMessageId": "<assistant message id>",
    "chosenIndex": 0
  }
}
```

The answer text is the user message's own `content` field — no need to duplicate it in metadata.

There is no `status` field on the assistant. Pending vs. answered is derived at render time by checking whether the following user message has a matching `clarification_answer`.

The route handler persists both blobs in the existing message-insert paths:
- Assistant insert gains `metadata.clarification` from `BrainResult.clarification`.
- User insert gains `metadata.clarification_answer` from the request body's `clarificationAnswer` field.

Sequential clarifications are not a special case — each is its own assistant message + its own user-answer pair.

### Edge cases

| Case | Behavior |
|------|----------|
| Model emits invalid `options` (not an array, fewer than 2 strings, or non-strings) | Brain emits an `error` event ("ask_clarification needs 2-4 string options"), does NOT emit a `clarification` event. Next turn sees the error in history; model self-corrects. If `options.length > 4`, trim to first 4 silently. |
| Model emits `ask_clarification` AND a workflow tool in the same turn | Both events fire; card renders AND patch applies. Prompt-discipline violation, not a protocol violation. No runtime guard; iterate via prompt. |
| User sends a regular message in the main chat input while a card is pending | Client adds `clarificationAnswer` sidecar with `chosenIndex: null` and `questionMessageId` set to the pending question. Card transitions to answered with the typed text shown in the write-your-own slot. |
| Stream aborts after `clarification` event but before `done` | Card already renders. User can answer — that kicks off a new turn. No "resume" path needed. |
| Stream aborts before `clarification` event lands | No card; assistant message is `running`/`error` per existing flow. User retries via existing retry button. |
| Page reload mid-pending | Renderer reads from DB; finds assistant message with `metadata.clarification` and no following user message → card renders pending. User can answer; round-trip works exactly as the in-memory case. |
| Revert to a clarification message | Existing revert trims the user-answer message; the assistant clarification message remains, and its card flips back to pending (no following user message to pair). User answers again. |
| Revert to before a clarification | Standard revert behavior; no special handling. |
| Model asks the same question twice in a row | Allowed but discouraged by prompt rule. If it happens, the user answers again. |
| Multilingual | Question + chip labels honor the user's language (existing multilingual behavior; reinforced by prompt rule in Section 3). |

### Error semantics

The new `clarification` event has no error-recovery semantics of its own — it is a one-shot signal. Failures route through the existing `error` event:
- Malformed tool input → `error { recoverable: true }`, model self-corrects.
- Anthropic 429/5xx during a clarification turn → existing `error` handling; user retries; model usually re-asks.
- Auth/4xx → existing `error { recoverable: false }`; existing toast surfaces.

### Manual test checklist (additions to spec §8 of the chat-brain rework)

- Ambiguous request → chip card appears all at once → click chip → next turn proceeds with chosen direction.
- Same as above but user types in the write-your-own input chip → next turn proceeds with typed text.
- Same as above but user types in the *main* chat input while card is pending → that becomes the answer; card renders answered with typed text in the write-your-own slot, no chip highlighted.
- Page reload mid-pending → card re-appears, fully functional.
- Sequential clarifications: ambiguous request → answer → Prism asks another → answer → Prism executes. Two answered cards in history.
- Revert to a clarification message → card flips back to pending; re-answerable.
- Stop button during a clarification turn → if tool fired before abort, card still renders; user can answer to continue.
- Multilingual (Hebrew, Spanish) → question and chips in the user's language.
- Invalid options from the model (force via debug fixture) → error event; no card; model self-corrects on next turn.

---

## Files touched (summary)

```
lib/chat/tools/definitions.ts        EDIT  add ask_clarification tool;
                                            widen ToolName union
lib/chat/brain.ts                    EDIT  recognize ask_clarification in
                                            tool_call path; emit clarification
                                            event; validate options;
                                            extend BrainResult
lib/chat/streaming/protocol.ts       EDIT  add clarification StreamEvent variant
lib/chat/prompt/system.ts            EDIT  TOOL USAGE RULES + CAPABILITIES line
lib/chat/prompt/examples.ts          EDIT  third few-shot example

app/api/chat/stream/route.ts         EDIT  persist metadata.clarification on
                                            assistant insert; persist
                                            metadata.clarification_answer on
                                            user insert (from request sidecar)

lib/hooks/use-chat-messages.ts       EDIT  add 'clarification' branch in
                                            processStreamLine; add
                                            clarificationAnswer sidecar to
                                            request body; type extension on
                                            Message store
lib/store/app-store.ts               EDIT  Message.clarification field

components/chat/ChipCard.tsx         NEW   chip card + write-your-own input
components/chat/Message.tsx          EDIT  conditionally render <ChipCard/>
```

No DB migration. No changes to `dispatchTool` for workflow tools. No changes to the workflow patch pipeline.

---

## Open questions / risks

- **Voice tuning of chip options.** The model needs a few real samples to tune what "fully-formed answer ≤40 chars" feels like. Expect to iterate on the few-shot example.
- **Suppress redundant user bubble on chip click?** Currently keeping it for consistency. If reviewers find it noisy in practice, a follow-up render-time check on `Message` can suppress when the prior assistant message has a matching pending clarification and the user message text matches one of the chips.
- **Chip-card scroll anchoring.** When the card appears at the bottom of a long message, the existing scroll-pinning logic in `MessageList` should keep it visible. Verify during manual testing — if it does not, an extra `scrollIntoView` on card mount may be needed.

## What success looks like

- Asking an ambiguous request renders an inline chip card inside the assistant bubble; chips are clickable; the write-your-own input works.
- After answer, the card persists in history with the chosen state visible.
- Page reload mid-pending re-renders the card and lets the user answer.
- Sequential clarifications stack cleanly; each becomes its own answered card.
- No DB migration. No workflow-pipeline changes.
- Manual test checklist passes.

## Next step

After user review of this spec, invoke the `superpowers:writing-plans` skill to convert it into an implementation plan.
