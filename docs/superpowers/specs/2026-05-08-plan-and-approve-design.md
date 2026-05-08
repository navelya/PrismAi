# Plan-and-Approve — Design

**Date:** 2026-05-08
**Status:** Draft, pending user review
**Sub-project:** B-2. Pulled from the deferred list in `2026-05-07-chat-brain-rework-design.md`. Builds on B-1 (clarification chips, already shipped). Covers plan-proposal-and-approval only — multi-task execution / progress UI is deferred to B-3.
**Approach:** New Anthropic tool `propose_plan` carrying both prose (title, summary, arrows, models, detail) and a structured workflow blueprint. New NDJSON stream event `plan`. Approve goes through the existing `/api/chat/stream` endpoint with a `planAnswer.action: 'approve' | 'feedback'` sidecar — server bypasses the model on approve and applies the stored blueprint via the existing `dispatchTool` handlers. UI is an inline plan card inside the assistant bubble, with a primary `[Approve & Build]` button and a collapsible feedback textarea.

---

## Goal

When the user requests a genuinely complex workflow build (multi-section pipelines, large rewrites, builds with multiple model choices that affect creative direction), Prism proposes a plan card showing the title, a one- to two-sentence summary, a compact arrow overview, the models involved, and an expandable detailed plan covering creative direction. The user clicks Approve to build, or submits feedback to revise. Approve applies the stored blueprint without a second model call. The flow plugs into the existing brain + streaming protocol with one new tool, one new event, and two small JSONB additions on `messages.metadata`.

## Non-goals

- Multi-task execution / progress panel after Approve (deferred to B-3).
- Cost preview inside the plan card (sub-project C).
- Plan revision history beyond the live state per pair (each plan is its own message; old plans render in their final state).
- Plans that span multiple turns (each plan is one turn, one tool call).
- Agentic execution loops.
- Auto-revert of canvas state on chat revert (revert remains chat-history-only).
- DB schema changes — both new metadata blobs ride existing `messages.metadata` JSONB.
- Multi-select feedback options (feedback is free-form prose only).

## Scope summary

In scope:
- New Anthropic tool `propose_plan` with prose fields + structured blueprint (same shape as `add_node` input).
- Extract shared `nodesEdgesSchema` so `add_node` and `propose_plan` blueprint share one source of truth.
- New NDJSON stream event `{ type: 'plan', plan }`.
- Brain: dry-run blueprint validation via a new `validateBlueprint` helper before emitting the plan event; first valid plan per turn wins.
- Approve branch in `app/api/chat/stream/route.ts`: when sidecar `planAnswer.action === 'approve'`, skip `runBrain`, apply the stored blueprint via `dispatchTool`, emit `tool` + `usage` (zero) + `done`.
- Feedback path: standard chat turn with `metadata.plan_answer` persisted on the user message; the model emits a revised `propose_plan` next turn.
- New `PlanCard` component rendered inside `Message`. Pending / approved / feedback-given / approve-failed states.
- Client store: `Message.plan` field (status derived at render time from history pairing, mirroring B-1).
- Sidecar `planAnswer` field on the next POST to `/api/chat/stream`.
- Persistence: `metadata.plan` on assistant messages, `metadata.plan_answer` on user messages.
- Prompt updates: new `PLAN PROPOSAL` subsection in TOOL USAGE RULES, one CAPABILITIES line, one new CRITICAL RULES rule (7), one new few-shot example (plan + revision).
- Suppress the synthetic "Approved" user bubble in `Message`.
- Manual test checklist additions.

DB schema changes: none.

---

## Section 1 — End-to-end flow

```
User sends ambiguous request
     │
     ▼
[B-1] ask_clarification → user picks a chip / types
     │
     ▼
Model judges: complex enough to plan?
     │
     ├── No  → calls add_node directly (existing path, unchanged)
     │
     └── Yes → calls propose_plan with prose + blueprint
                      │
                      ▼
              brain validates blueprint (dry-run via validateBlueprint)
                      │
                      ├── Invalid → emits 'error' event, no 'plan' event,
                      │              model self-corrects next turn
                      │
                      └── Valid → emits 'plan' event with full payload
                                  │
                                  ▼
                        PlanCard renders inline (pending state)
                                  │
        ┌─────────────────────────┴──────────────────────┐
        ▼                                                ▼
   User clicks Approve                              User submits feedback
        │                                                │
        ▼                                                ▼
   POST /api/chat/stream                            POST /api/chat/stream
   sidecar: { planMessageId,                        sidecar: { planMessageId,
              action: 'approve' }                              action: 'feedback',
        │                                                      feedbackText }
        ▼                                                │
   Server bypasses runBrain                              ▼
   Reads metadata.plan.blueprint                    Standard streaming turn:
   dispatchTool('add_node', blueprint)              model sees prior plan +
   Persists user message + canvas_state             feedback in history,
   Emits 'tool' + 'usage'(zero) + 'done'            emits NEW propose_plan
        │                                            with revisions
        ▼                                                │
   Client reducer applies patch                          ▼
   Card locks to 'approved' state                  First card locks to
                                                   'feedback-given' state.
                                                   New PlanCard renders
                                                   pending below it.
```

DB schema changes: none. Both new metadata blobs ride the existing `messages.metadata` JSONB column.

---

## Section 2 — Wire format & data flow

### New tool: `propose_plan`

Added to `lib/chat/tools/definitions.ts`:

```ts
{
  name: 'propose_plan',
  description:
    'Propose a workflow plan for the user to approve before building. ' +
    'Use ONLY for genuinely complex requests where guessing wrong would ' +
    'waste real work — multi-section pipelines, large rewrites, or builds ' +
    'with multiple model choices that affect creative direction. Do NOT ' +
    'use for simple single-node updates, trivial changes, or anything where ' +
    'the right answer is obvious. Do NOT use in the same turn as ' +
    'ask_clarification — clarify first, plan next turn. Do NOT also call ' +
    'add_node / update_node / remove_node in the same turn — the blueprint ' +
    'IS the build; the user approves it to apply.',
  input_schema: {
    type: 'object',
    properties: {
      title:   { type: 'string', maxLength: 60,
                 description: 'Short title naming the workflow.' },
      summary: { type: 'string', maxLength: 240,
                 description: 'One- or two-sentence "what it does" — plain prose, no list.' },
      arrows:  { type: 'string', maxLength: 240,
                 description: 'Compact arrow-style overview, one line.' },
      models:  { type: 'array', items: { type: 'string', maxLength: 60 }, maxItems: 6,
                 description: 'Model names used. Empty array if none.' },
      detail:  { type: 'string', maxLength: 1200,
                 description: 'Detailed plan: nodes used, creative direction, scene/look description, inputs, expected output appearance. Match length to plan complexity. Plain prose, no markdown headers.' },
      blueprint: {
        type: 'object',
        description: 'Structured workflow patch applied verbatim if user approves. Same shape as add_node input.',
        properties: {
          nodes: { type: 'array', items: nodesEdgesSchema.nodes },
          edges: { type: 'array', items: nodesEdgesSchema.edges }
        },
        required: []
      }
    },
    required: ['title', 'summary', 'arrows', 'models', 'detail', 'blueprint']
  }
}
```

Refactor: extract the existing `add_node` `nodes[]` and `edges[]` item schemas into a shared `nodesEdgesSchema` constant in `definitions.ts`. Both `add_node` and `propose_plan.blueprint` reference it. Single source of truth for blueprint structure.

`ToolName` widens to `'add_node' | 'update_node' | 'remove_node' | 'ask_clarification' | 'propose_plan'`.

### Brain handling (`lib/chat/brain.ts`)

In the `tool_call` switch, recognize `propose_plan`:

1. Parse the tool args. Required fields must be present and non-empty (after trim).
2. Run **dry-run validation** of the blueprint via a new `validateBlueprint(state, blueprint)` helper in `lib/chat/tools/handlers.ts`. This helper applies the same checks `dispatchTool('add_node', ...)` does — config schema validation, model-handle resolution, edge target validity — but operates on a cloned state and returns `{ ok: boolean; error?: string }` without mutating `state.workflow`.
3. On validation failure: emit `{ type: 'error', message, recoverable: true }`. No `plan` event, no DB write. The model self-corrects on the next turn (sees the error in history).
4. On success: store `plan` in the brain result and emit `{ type: 'plan', plan }`.
5. First valid plan per turn wins; any subsequent `propose_plan` calls in the same turn are ignored.

`BrainResult` extends:
```ts
plan: PlanPayload | null;
```

`PlanPayload` mirrors the tool input shape one-to-one.

### New stream event (`lib/chat/streaming/protocol.ts`)

```ts
| { type: 'plan'; plan: PlanPayload }

export interface PlanPayload {
  title: string;
  summary: string;
  arrows: string;
  models: string[];
  detail: string;
  blueprint: { nodes?: WorkflowPatchNode[]; edges?: WorkflowPatchEdge[] };
}
```

Per-turn ordering becomes:
```
[thinking_*]
[text]*
[tool]*           ← workflow tools (when no plan)
[clarification?]  ← B-1
[plan?]           ← NEW; never co-exists with [tool] or [clarification] in same turn (prompt-enforced)
[usage]
[done]
```

The protocol does NOT enforce mutual exclusion with `tool` / `clarification`. The prompt does. Violations render both UIs; we iterate via prompt, not runtime guard.

### Approve path (route handler)

A new branch at the top of `handleWithNewBrain` in `app/api/chat/stream/route.ts`:

```ts
const planAnswer: { planMessageId: string; action: 'approve' | 'feedback'; feedbackText?: string } | undefined =
  body?.planAnswer && typeof body.planAnswer === 'object'
    ? { /* parsed and validated */ }
    : undefined;

if (planAnswer?.action === 'approve') {
  return handlePlanApprove({ supabase, sessionId, planAnswer, userMessageId, lastUserMsg });
}
```

`handlePlanApprove` (new function, ~80 lines, in `route.ts`):

1. Reads the assistant DB row by `planAnswer.planMessageId` (service client; verifies `session_id === sessionId` for an explicit ownership check on top of RLS bypass).
2. Reads `metadata.plan.blueprint`. If missing or null → emit `{ type: 'error', message: 'Plan not found, please retry the request.', recoverable: false }` + `{ type: 'done' }`. Close stream.
3. **Idempotency check:** queries `messages` for an existing user row in the same session whose `metadata.plan_answer.planMessageId === planMessageId` and `action === 'approve'`. If found, the plan was already approved — emit `{ type: 'done' }` and close stream without re-applying. (Client-side state is already showing approved; this just no-ops the server side. Prevents duplicate-node creation on double-click, two-tab races, or retry-after-network-blip.)
4. Loads the current `canvas_state` from the `sessions` row.
5. Builds a fresh `ToolHandlerState` (workflow + idMap + aiModelHandles), exactly like the brain does. The `aiModelHandles` map is rebuilt from a fresh registry-cache lookup — at-approve-time validation, not at-emit-time.
6. Calls `dispatchTool(state, 'add_node', blueprint)`. On failure → emit `{ type: 'error', message: result.error, recoverable: true }` + `{ type: 'done' }`. Canvas unchanged (dispatchTool is all-or-nothing).
7. Persists user message with `content: 'Approved'`, `metadata.plan_answer = { planMessageId, action: 'approve' }`. Persists `canvas_state` update.
8. Emits `{ type: 'tool', name: 'add_node', patch: result.patch }` + `{ type: 'usage', inputTokens: 0, outputTokens: 0, thinkingTokens: 0, costUsd: 0 }` + `{ type: 'done' }`. Closes stream.

No model call. No thinking. ~50ms target latency (excluding the idempotency query).

### Feedback path (route handler — same endpoint)

When `planAnswer?.action === 'feedback'`, the route runs the existing `runBrain` path with one addition: it persists `metadata.plan_answer = { planMessageId, action: 'feedback', feedbackText }` on the user message insert (alongside the normal user content).

The model sees the prior assistant plan in history (rendered into the chat window via the existing flow — assistant `content` carries the prose intro that preceded the tool call) plus the new user message containing the feedback text. The model emits a new `propose_plan` with revisions. No special history flattening required for the plan tool result; the prose is already in the assistant message.

### Chat window filtering for approve markers

The synthetic `'Approved'` user message inserted by the approve path is a DB-only marker for state derivation on reload. It MUST NOT be sent to Anthropic — it's not a real user turn, and back-to-back user roles (the prior `'Approved'` plus the next real user message) would break Anthropic's alternating-role requirement.

The route's `chatWindow` filtering excludes any user message where `metadata.plan_answer?.action === 'approve'` AND the content is exactly `'Approved'`. The model's history view jumps from the assistant plan turn straight to the user's next real message after approval. The model treats this as: "the user approved my plan, then said this next thing" — which is the natural mental model.

Feedback markers do NOT get filtered. The feedback user message IS the user's real input; the model needs to see it.

### Persistence

No DB migration. Both new blobs ride existing `messages.metadata` JSONB.

**Assistant message (the proposing turn):**
```json
{
  "metadata": {
    "thinking": "...",
    "usage": { "...": "..." },
    "plan": {
      "title": "Beach composite from portrait",
      "summary": "...",
      "arrows": "photo → bg-remove → composite ← imagen-4 ← prompt → output",
      "models": ["Imagen 4", "BG-remover"],
      "detail": "...",
      "blueprint": { "nodes": [...], "edges": [...] }
    }
  }
}
```

**User message (approve):**
```json
{
  "content": "Approved",
  "metadata": {
    "plan_answer": {
      "planMessageId": "<assistant message id>",
      "action": "approve"
    }
  }
}
```

**User message (feedback):**
```json
{
  "content": "<the user's feedback text>",
  "metadata": {
    "plan_answer": {
      "planMessageId": "<assistant message id>",
      "action": "feedback",
      "feedbackText": "<same as content>"
    }
  }
}
```

`feedbackText` duplicates `content` for symmetry with B-1's `clarification_answer.text` convention and so the renderer can derive plan-card state purely from `metadata.plan_answer` without joining to the message body.

### Client reducer (`lib/hooks/use-chat-messages.ts`)

One new branch in `processStreamLine`:

```ts
else if (parsed.type === 'plan') {
  useAppStore.getState().updateMessage(assistantMsgId, {
    plan: parsed.plan
  });
}
```

The store `Message` type gains:

```ts
plan?: PlanPayload;
```

Sidecar additions to the request body:
- On Approve click: `planAnswer: { planMessageId, action: 'approve' }`. Synthetic user message with `content: 'Approved'`.
- On feedback Send: `planAnswer: { planMessageId, action: 'feedback', feedbackText }`. User message `content` = the feedback text.
- On main-input send while plan pending: existing `handleSend` adds the same `feedback` sidecar, `feedbackText` = the typed input. Mirrors B-1's main-input fallback.

---

## Section 3 — UI rendering

### Component additions

```
components/chat/
├─ PlanCard.tsx               NEW   the plan card itself
├─ Message.tsx                EDIT  conditionally render <PlanCard/> below body;
│                                    suppress 'Approved' user bubble
├─ ChipCard.tsx               KEEP  unchanged from B-1
└─ ChatInput.tsx              KEEP  unchanged
```

`PlanCard` owns: card layout, the detailed-view expand/collapse toggle, the `[Provide feedback]` expand/collapse toggle, the feedback textarea state, and click handling.

### Card layout — collapsed (default pending state)

```
┌─ Prism ──────────────────────────────────────────────┐
│  Here's how I'd build the beach composite.           │  ← assistant text (intro)
│                                                      │
│  ╭────────────────────────────────────────────────╮  │
│  │  Beach composite from portrait                 │  │  ← title (font-medium)
│  │                                                │  │
│  │  Replaces the photo's background with an       │  │  ← summary (~2 lines)
│  │  AI-generated golden-hour beach scene.         │  │
│  │                                                │  │
│  │  photo → bg-remove → composite ← imagen-4      │  │  ← arrows (mono, muted)
│  │     ← prompt → output                          │  │
│  │                                                │  │
│  │  Models: Imagen 4 · BG-remover                 │  │  ← models pill row
│  │                                                │  │
│  │  ▸ Detailed plan                               │  │  ← expand button (small, muted)
│  │                                                │  │
│  │  ┌──────────────────┐  ┌────────────────────┐  │  │
│  │  │ Approve & Build  │  │  Provide feedback  │  │  │  ← buttons (primary + secondary)
│  │  └──────────────────┘  └────────────────────┘  │  │
│  ╰────────────────────────────────────────────────╯  │
└──────────────────────────────────────────────────────┘
```

### Card layout — detail expanded

The `▸ Detailed plan` toggle reveals the `detail` prose with `whitespace-pre-wrap`. The model decides paragraphing. Card body grows; buttons stay at the bottom.

### Card layout — feedback expanded

`[Provide feedback]` expands an inline textarea below the buttons. Approve button stays clickable. A `[Cancel]` button collapses back to the buttons row. `[Send ↵]` is disabled until the textarea has non-whitespace text. Pressing Enter (without Shift) submits.

### Card layout — approved state (locked)

```
│  │  ✓ Approved & built                            │  │  ← accent badge
│  │  Beach composite from portrait                 │  │
│  │  Replaces the photo's background with an       │  │
│  │  AI-generated golden-hour beach scene.         │  │
│  │  ...                                           │  │
│  │  ▸ Detailed plan                               │  │  ← still expandable
│  │  (no buttons; card is read-only)               │  │
```

### Card layout — feedback-given state (locked)

```
│  │  ↻ Revising — see new plan below               │  │
│  │  Beach composite from portrait                 │  │
│  │  ...                                           │  │
│  │  Your feedback: "Use Flux instead of Imagen"   │  │  ← shown below summary
│  │  ▸ Detailed plan                               │  │
│  │  (no buttons; card is read-only)               │  │
```

### Card layout — approve-failed state (locked)

```
│  │  ✗ Approve failed — try feedback               │  │  ← error-tinted badge
│  │  Beach composite from portrait                 │  │
│  │  ...                                           │  │
│  │  Error: <reason from dispatchTool>             │  │  ← inline, single line
│  │  ▸ Detailed plan                               │  │
│  │  (no buttons)                                  │  │
```

User submits feedback to re-prompt. Approve-failed is a transient render state — derived from a pending plan whose latest approve attempt returned a recoverable error. The error message is held client-side (not persisted) since the user message wasn't created. If they reload the page, the card returns to pending and they can try again.

### Rendering states

| State | Trigger | Visual |
|-------|---------|--------|
| **Hidden** | No `message.plan` | Card not rendered |
| **Pending** | `plan` set, no following user message with matching `plan_answer` | Buttons clickable; detail expandable; feedback textarea expandable |
| **Approved** | Following user message has `plan_answer.action === 'approve'` | "✓ Approved & built" header, no buttons, detail expandable |
| **Feedback-given** | Following user message has `plan_answer.action === 'feedback'` | "↻ Revising" header, feedback text shown, no buttons, detail expandable |
| **Approve-failed** | Pending state + last approve attempt returned a recoverable error (held in client state) | "✗ Approve failed" header, error message shown, no buttons; reverts to pending on reload |

State derivation: at render time, `Message` looks at the next chronological message in the session for a matching `plan_answer.planMessageId`. Same pattern as B-1's clarification answer derivation.

### Per-component contracts

| Component | Owns | Receives | Emits |
|-----------|------|----------|-------|
| `PlanCard` | `detailOpen`, `feedbackOpen`, `feedbackDraft` (all local) | `plan: PlanPayload`, `status`, `feedbackText?`, `approveError?`, `onApprove()`, `onFeedback(text)` | `onApprove`, `onFeedback(text)` |
| `Message` | unchanged behavior + conditional render of `<PlanCard>`; suppression of `'Approved'` user bubbles | `message` (now possibly with `plan`) | unchanged |

`feedbackDraft` is local. When `status` transitions to `feedback-given`, the local draft is cleared (the persisted text comes from the `feedbackText` prop instead).

### Interactions

- **Click [Approve & Build]** → `onApprove()`. Optimistic: card flips to `approved` immediately. Client POSTs to `/api/chat/stream` with sidecar `{ planMessageId, action: 'approve' }` and a synthetic user message `{ role: 'user', content: 'Approved' }`. Server applies blueprint, persists, returns `tool` + `usage` + `done`. Client reducer applies the patch event to the canvas store as normal. If the server returns a recoverable `error` instead of `tool`, the optimistic transition rolls back to pending + approve-failed visual.
- **Click [Provide feedback]** → expands the textarea inline. Approve button stays clickable.
- **Type + Send (or Enter)** → `onFeedback(text)`. Card flips to `feedback-given`. Client POSTs with the feedback text as user message content + sidecar `{ planMessageId, action: 'feedback', feedbackText }`. Standard streaming turn — model emits a new `propose_plan`.
- **Type in main chat input + send while plan pending** → existing `handleSend` runs; client adds `planAnswer` sidecar with `action: 'feedback'`, `feedbackText` = typed input, `planMessageId` = pending plan id. Card flips to `feedback-given`.
- **Stop button mid-stream during the proposing turn** → standard abort. If `plan` event already landed before abort, card renders pending; user can approve or feedback. If not, no card; user retries.
- **Click ▸ Detailed plan** → expands inline. Independent of card state; works in pending, approved, feedback-given, approve-failed.

### Reload behavior

On session reload, history is reconstructed from `messages` rows. For each assistant message with `metadata.plan`:
- Find the next user message chronologically.
- If `metadata.plan_answer.planMessageId === assistant.id`:
  - `action === 'approve'` → render approved.
  - `action === 'feedback'` → render feedback-given (shows `feedbackText`).
- If no matching following user message → render pending. User can approve or feedback later.

Approve-failed never persists across reload (no user message exists for a failed approve). It re-renders as pending.

### User bubble after approve / feedback

- **Approve:** the synthetic user message has `content: 'Approved'`. Render it suppressed in `MessageList` when `metadata.plan_answer.action === 'approve'`. The locked card already shows "Approved & built"; a literal "Approved" bubble below would be redundant noise. The DB row remains for audit/reload.
- **Feedback:** the user bubble renders normally with the feedback text. The card above shows the feedback excerpt; the bubble shows the full text. Slight redundancy is fine — feedback may be longer than the inline excerpt.

This is the one place we deliberately differ from B-1's clarification flow (which shows the user bubble unconditionally). Rationale: B-1's chip click produces a 1–4 word answer that reads as conversation; "Approved" by itself is empty noise.

---

## Section 4 — System prompt rules

The plan flow is governed by the prompt; the model decides when to emit `propose_plan`. Three small additions to existing prompt modules — same pattern as B-1.

### `lib/chat/prompt/system.ts` — extend `TOOL USAGE RULES`

Add a `PLAN PROPOSAL` subsection between `CLARIFYING QUESTIONS` and the existing rules end:

```
PLAN PROPOSAL:
- Use propose_plan ONLY for genuinely complex builds where guessing wrong
  would waste real work: multi-section pipelines, large rewrites, builds
  with multiple model choices that affect creative direction, or workflows
  that combine 4+ nodes spanning different functional roles
  (input → generation → composition → post-process).
- Do NOT use propose_plan for: single-node updates, swapping one model for
  another, trivial config edits, or anything where the right answer is
  obvious from the user's request.
- Do NOT use propose_plan in the same turn as ask_clarification — clarify
  first, plan next turn after the answer.
- Do NOT call add_node / update_node / remove_node in the same turn as
  propose_plan. The blueprint IS the build; the user approves it to apply.
- The blueprint must be complete and apply-ready: every node fully
  configured per its aiSchema, every edge valid. The same validation that
  runs on add_node runs on the blueprint when the user approves — an
  invalid blueprint surfaces as an error after Approve, which is a poor UX.
- Phrase title, summary, arrows, models, and detail in the user's language
  (Hebrew request → Hebrew plan content).
- Match detail length to plan complexity. Short pipeline → short detail.
  Complex pipeline → fuller detail. Do not pad.
- Detail should cover: what each node contributes, the creative direction
  (look, feel, scene), the inputs the workflow consumes, and what the
  user can expect to see at the end. Plain prose, no markdown headers.
- After feedback, emit a NEW propose_plan that ADDRESSES the feedback.
  Do not just re-emit the same plan. Acknowledge the change in the new
  summary or detail so the user can see what shifted.
- Do NOT propose_plan again immediately after the user approves a plan —
  approval means the build happened; the next user message starts a fresh
  exchange.
```

### `lib/chat/prompt/system.ts` — extend `CAPABILITIES` (one line)

```
You can: build new workflows, modify existing ones, answer questions about
the system, see images attached to the conversation, reason about the
current canvas state, ask short clarifying questions with chip options
when a request is genuinely ambiguous, propose a workflow plan for the
user to approve before complex builds.
```

### `lib/chat/prompt/system.ts` — extend `CRITICAL RULES`

Add rule 7:

```
7. When you call propose_plan, the blueprint must be a complete, apply-
   ready workflow patch — same node/edge structure rules as add_node,
   same fully-populated configs, same model_id requirements. The blueprint
   is what builds the canvas after Approve; an invalid blueprint becomes
   a user-visible error.
```

### `lib/chat/prompt/examples.ts` — add a fourth few-shot example

Shows: when to use `propose_plan`, the prose-and-blueprint structure, voice tone, the no-other-tools-in-same-turn rule, and how a feedback round-trip looks.

```
USER: build me a workflow that takes my photo and puts me in a cyberpunk
neon-lit Tokyo street at night, plus add color grading

ASSISTANT (text): Here's how I'd build the cyberpunk Tokyo composite.

[tool_use propose_plan
  title="Cyberpunk Tokyo composite"
  summary="Drops the user's portrait into an AI-generated neon-lit Tokyo
           street, then runs a teal-orange color grade over the result."
  arrows="photo → bg-remove → composite ← flux-pro ← prompt → grade → output"
  models=["Flux Pro", "BG-remover", "Color grade"]
  detail="The photo gets background-removed to isolate you. Flux Pro
          generates a wide cyberpunk Tokyo scene — wet streets, neon
          signage, vapor, shallow depth-of-field — sized to match.
          The compositor places you in the foreground at street level.
          A color-grade pass tunes the whole frame teal-and-orange for
          the cinematic neon feel. Inputs: your portrait. Output: a
          1024×1024 photographic composite."
  blueprint={ ... apply-ready nodes + edges ... }
]

USER (next turn, content="Approved", planAnswer.action=approve):
[server applies blueprint, no model call]

----- separately, a feedback example -----

USER (next turn, content="Use Imagen 4 instead of Flux and skip the color grade"):
[planAnswer.action=feedback, planAnswer.feedbackText=...]

ASSISTANT (text): Switched to Imagen 4 and dropped the grade pass.

[tool_use propose_plan
  title="Cyberpunk Tokyo composite"
  summary="Drops the user's portrait into an Imagen 4-generated cyberpunk
           Tokyo street. Color grading removed per your feedback."
  arrows="photo → bg-remove → composite ← imagen-4 ← prompt → output"
  models=["Imagen 4", "BG-remover"]
  detail="..."
  blueprint={ ... revised nodes + edges ... }
]
```

One example only — adding 2-3 plan examples would balloon the system prompt. One concrete plan + one revision shows the discipline; the model generalizes. Iterate if real plans drift.

### `lib/chat/prompt/voice.ts` — no changes

Existing voice rules already align: terse intro before tool calls, plain prose, no padding, end with a forward question. The plan's `summary` and `detail` follow the same voice naturally.

### Risks the prompt accepts

- **Model under-uses propose_plan** (just calls add_node directly for complex requests). Cost: lost approval gate. The framing intentionally errs toward "don't over-plan" since a plan adds latency to every triggering turn — better to mis-skip than to mis-plan. Iterate prompt/examples if real complex builds slip past.
- **Model over-uses propose_plan** (proposes for trivial single-node tweaks). Cost: extra step + extra latency. Mitigation: same; iterate. The few-shot example shows a complex case, biasing the model toward "this kind of complexity = propose_plan."
- **Model proposes a plan AND calls add_node in the same turn** (prompt-discipline violation). Both events fire; client renders both; user sees a card AND a partial build. No runtime guard. Mitigation: prompt phrasing; iterate.
- **Blueprint is invalid at approve time** (model generated a config that fails aiSchema validation, or model_id no longer exists). The approve route catches it via `dispatchTool`, returns a recoverable `error`. Card flips to approve-failed state. Recovery: user submits feedback to re-prompt. We do NOT auto-rollback any partial application because `dispatchTool` is all-or-nothing per call.
- **Feedback drift**: model emits a "revised" plan that's identical to the prior one. Wastes a round-trip. Mitigation: prompt rule "ADDRESS the feedback; don't just re-emit." Iterate.

---

## Section 5 — Edge cases, errors, manual test checklist

### Edge cases

| Case | Behavior |
|------|----------|
| Model emits invalid `propose_plan` input (missing prose fields, blueprint validation fails dry-run) | Brain emits `error { recoverable: true }` describing the failure. No `plan` event, no DB write. Model self-corrects on next turn. |
| Model emits `propose_plan` AND `add_node` (or other workflow tool) in the same turn | Both events fire; canvas patch applies; plan card also renders. Pure prompt-discipline violation. No runtime guard. Iterate via prompt if observed. |
| Model emits `propose_plan` AND `ask_clarification` in the same turn | Both events fire; both cards render. Confusing but not destructive. Prompt says don't do this; iterate. |
| Model emits two `propose_plan` calls in the same turn | Brain keeps the first valid one, ignores the rest. Same pattern as B-1's `ask_clarification` "first valid wins." |
| User clicks Approve but the blueprint fails aiSchema validation at approve time (e.g. `model_id` was deleted between emit and approve) | Approve route returns `error { recoverable: true }` + `done`. Client reverts the optimistic approved transition; card flips to approve-failed state showing the error. User can submit feedback to re-prompt. Canvas unchanged. |
| User clicks Approve but the planMessageId DB row is missing or `metadata.plan` is null | Approve route returns `error { recoverable: false }` + `done` — "Plan not found, please retry the request." Card stays pending. User has to re-ask the original question. Very unlikely. |
| User types in main chat input while plan card is pending | Client adds `planAnswer` sidecar `{ action: 'feedback', planMessageId, feedbackText: <typed> }`. Card flips to feedback-given. Mirror of B-1's clarification fallback. |
| User clicks Approve twice (double-click, network retry, two tabs) | The approve route's idempotency check (Section 2 step 3) finds the prior approval user message and short-circuits — no second blueprint application, no duplicate nodes. Client-side both clicks transition to approved; the second is a silent no-op on the server. |
| User clicks Approve, server applies blueprint, but Supabase persistence fails for the user message | Patch event already streamed and applied client-side. Server returns `error { recoverable: false }` — "Saved partially — refresh to confirm." On refresh, canvas reflects the patch (persisted via `canvas_state` update); user message missing → card stays pending in history. User re-approves; the canvas already has the nodes so re-approving creates duplicates. **Edge case acceptable for v1** — partial-persist failures are rare; user can hand-clean the duplicates if it happens. Revisit if observed in practice. |
| User clicks Approve, server applies blueprint, but `canvas_state` persistence fails after user message persists | Inverse case. Canvas client-side has the patch; server canvas_state stale. On refresh, canvas reverts; card shows approved. User can re-approve to re-apply. |
| Stream aborts after `plan` event but before `done` | Card renders pending. User can approve or feedback — both fire fresh requests. No "resume" path. |
| Stream aborts before `plan` event lands | No card; assistant message marked `running`/`error` per existing flow. User retries. |
| Page reload mid-pending | Renderer reads `metadata.plan` from DB; finds no following user message with matching `plan_answer` → renders pending. User can approve or feedback. |
| Page reload after approve | Renderer finds following user message with `plan_answer.action === 'approve'` → renders locked approved. Canvas already reflects the build (persisted via `canvas_state`). |
| Page reload after feedback (revised plan emitted) | First plan card renders feedback-given (locked, with feedback text shown), new plan card renders pending below. Stack of plans, each in its own state. |
| Revert chat to a plan message (existing revert) | Existing revert trims subsequent messages. The plan card flips back to pending. The canvas is NOT auto-reverted — revert remains chat-history-only (consistent with existing behavior). User answers again. |
| Revert to before a plan message | Standard revert; no special handling. |
| Multilingual | Title/summary/arrows/models/detail honor the user's language. Reinforced by prompt rule. UI button labels (`[Approve & Build]`, `[Provide feedback]`) stay in app language — they're chrome, not model output. |
| Two browser tabs open same session, tab A approves | Existing realtime subscription delivers the new user message + canvas update to tab B; PlanCard transitions to approved automatically. Existing infra; no new wiring. |

### Error semantics

The new `plan` event has no error-recovery semantics of its own — it's a one-shot signal. Failures route through the existing `error` event:
- Invalid plan input from model → `error { recoverable: true }`, model self-corrects.
- Approve-time blueprint failure → `error { recoverable: true }`, card flips to approve-failed state, user submits feedback.
- Approve-time DB or auth failure → `error { recoverable: false }`, existing toast surfaces.
- Anthropic 429/5xx during a `propose_plan` turn → existing handling; user retries; model usually re-proposes.

Approve and feedback never share a turn — each is its own request — so there's no compound-error case.

### Observability

Per-turn structured log additions in `lib/chat/brain.ts`:
```
[chat] turn { sessionId, ..., propose_plan: boolean, plan_blueprint_node_count: number? }
```

Approve-path log in `app/api/chat/stream/route.ts`:
```
[chat] plan_approve { sessionId, planMessageId, blueprintNodeCount, latencyMs, status, errorKind? }
```

Both land in the existing log pipeline (Vercel logs). No new vendor.

### Manual test checklist

(There is no test runner per `CLAUDE.md`; primary gate is manual.)

1. **Complex create → plan appears.** "Build a workflow that takes my photo, puts me on a beach, and adds golden-hour lighting" → plan card renders with title/summary/arrows/models/details. Click Approve → workflow appears on canvas. Card locks to approved.
2. **Simple update → no plan.** "Change Imagen to Flux" → no plan card; `update_node` fires directly. (Verifies no over-proposing.)
3. **Plan after clarification.** Ambiguous request → chip card → answer → plan card next turn. (Verifies plan and clarification compose.)
4. **Feedback round-trip.** Plan → click [Provide feedback] → type "Use Imagen 4 not Flux" → Send → first card locks to feedback-given (shows feedback text), new plan card renders pending below with the revised plan. Click Approve on the new card → workflow builds with Imagen 4.
5. **Main-input feedback fallback.** Plan pending → user types in main chat input → first card locks to feedback-given showing the typed text, new plan emits.
6. **Detail expand.** Click ▸ Detailed plan → detail prose appears. Click again → collapses. Works in pending, approved, feedback-given, approve-failed.
7. **Reload mid-pending.** Refresh while plan pending → card re-renders fully functional. Approve and feedback still work.
8. **Reload after approve.** Refresh after approving → card renders locked approved; canvas reflects the build.
9. **Reload after feedback chain.** Plan → feedback → new plan → feedback → new plan → reload. All three cards render correctly (feedback-given, feedback-given, pending).
10. **Revert to a plan.** Revert chat to a plan message → card flips back to pending; canvas unchanged (revert is chat-history-only).
11. **Approve-time validation fail.** Force a corrupt blueprint via debug fixture → click Approve → error message inline, card stays pending in approve-failed visual; canvas unchanged.
12. **Stop button during plan turn.** Click Stop mid-stream → if `plan` event already fired, card renders pending; if not, no card.
13. **Multilingual.** Send a Hebrew or Spanish complex request → plan content in user's language; UI buttons stay in app language.
14. **Two-tab realtime.** Open two tabs of the same session. Approve in tab A → tab B's canvas updates and the card transitions to approved within the realtime debounce window.
15. **Suppressed approve user bubble.** After clicking Approve, verify there's no "Approved" user bubble below the plan card.
16. **Double-click Approve idempotency.** Click Approve twice rapidly → workflow is built once, not duplicated. Verify the canvas has the expected node count (not 2× the blueprint).
17. **Approve-then-next-message turn alternation.** Approve a plan, then send a follow-up message ("now make it black-and-white"). Verify the model responds correctly — no Anthropic 400 from back-to-back user roles. (Validates that the synthetic "Approved" user message is filtered from the chat window.)

---

## Files touched (summary)

```
lib/chat/tools/definitions.ts        EDIT  add propose_plan tool;
                                            extract shared nodesEdgesSchema;
                                            widen ToolName union
lib/chat/tools/handlers.ts           EDIT  add validateBlueprint() helper
                                            (dry-run version of dispatchTool
                                            for add_node)
lib/chat/brain.ts                    EDIT  recognize propose_plan in
                                            tool_call path; emit plan event;
                                            validate via dry-run; extend
                                            BrainResult
lib/chat/streaming/protocol.ts       EDIT  add 'plan' StreamEvent variant;
                                            export PlanPayload type
lib/chat/prompt/system.ts            EDIT  PLAN PROPOSAL subsection;
                                            CAPABILITIES line; CRITICAL
                                            RULES rule 7
lib/chat/prompt/examples.ts          EDIT  fourth few-shot (plan + revision)

app/api/chat/stream/route.ts         EDIT  approve-branch handler
                                            (skip brain, idempotency
                                            check, dispatchTool applies
                                            blueprint); chatWindow filter
                                            to exclude synthetic 'Approved'
                                            user messages; persist
                                            metadata.plan on assistant
                                            insert; persist
                                            metadata.plan_answer on user
                                            insert (from request sidecar)

lib/hooks/use-chat-messages.ts       EDIT  add 'plan' branch in
                                            processStreamLine; add
                                            planAnswer sidecar to request
                                            body for approve and feedback;
                                            type extension on Message store
lib/store/app-store.ts               EDIT  Message.plan field

components/chat/PlanCard.tsx         NEW   plan card + collapsible detail
                                            + collapsible feedback textarea
                                            + locked states (approved /
                                            feedback-given / approve-failed)
components/chat/Message.tsx          EDIT  conditionally render <PlanCard>;
                                            suppress 'Approved' user bubble
                                            when plan_answer.action ===
                                            'approve'
```

No DB migration. No changes to `dispatchTool` for workflow tools. No changes to the workflow patch pipeline. Reuses every existing safety net (auth, RLS, persistence, abort, realtime).

---

## Open questions / risks

- **Model judgment on when to plan.** The trigger is prompt-driven; quality depends on prompt + few-shot example tuning. Expect to iterate after real traffic.
- **Approve-failed UX.** The transient error state (held client-side, reverts to pending on reload) is the simplest design but means a user who failed approve, reloaded, and tried again gets no memory of the prior failure. Acceptable for v1; revisit if recovery becomes confusing.
- **Plan blueprint size in tool input.** A complex plan with 6-8 nodes including config + edges might push the tool input toward ~2k tokens. Prompt caching covers static parts; the blueprint is dynamic per turn. Acceptable; monitor in telemetry.
- **Optimistic approve transition.** The card flips to approved before server confirms. If the server returns an error, we revert to pending + approve-failed. This is the standard optimistic UI tradeoff — fast happy path, requires a clear failure visual.
- **Locked card vertical density.** A long history of approved plans makes the chat scroll long. Detail collapses by default, which helps. If real sessions feel cluttered, consider a "compact mode" for older approved cards as a follow-up.

## What success looks like

- A complex create request renders a plan card inline; chips/buttons work; Approve builds the workflow; feedback revises it.
- After approve, the card persists in history with the locked approved state visible; canvas reflects the build.
- Page reload mid-pending re-renders the card and lets the user answer.
- Feedback round-trips stack cleanly; each becomes its own answered card.
- Approve adds ~50ms latency (no model call) vs. the ~2s today's add_node turn takes.
- No DB migration. No workflow-pipeline changes.
- Manual test checklist passes.

## Next step

After user review of this spec, invoke the `superpowers:writing-plans` skill to convert it into an implementation plan.
