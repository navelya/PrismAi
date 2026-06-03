# Auto Model Routing for the Chat Brain

**Date:** 2026-06-03
**Status:** Approved (design) — ready for implementation plan
**Author:** brainstormed with Claude

## Problem

Simple chat turns feel slow. The user's canonical complaint: *"generate me an image"* takes noticeable time **just to create the workflow**, because the turn goes through extended thinking.

Root cause is **mis-classification, not model horsepower**. The thinking heuristic in
[`lib/chat/brain.ts:94-108`](../../../lib/chat/brain.ts) disables thinking only when the
message is short, image-free, **and contains no action verb**. The verb list includes
`generate|build|add|create|...`, so *"generate me an image"* — a trivially simple
single-node build — is forced down the slow thinking path. The heuristic conflates
*"is a build request"* with *"is complex"*.

Secondary goal: cost. Routing the easy ~90% to Haiku (instead of Sonnet) is a real
saving, but it is **not** the primary driver. Latency is.

## Goal

Replace the manual model picker with **automatic routing**:

- Every ordinary turn **starts on Haiku with thinking OFF** (the fast lane) — streaming
  begins in ~1s, sharing the warm prompt cache, tools, and handler validation.
- Genuinely-complex turns escalate to **Sonnet with thinking ON** (the heavy lane) via a
  new `escalate` tool — i.e. the model itself is the classifier, replacing the fragile
  regex.
- The user no longer chooses a model. The picker becomes a non-interactive **"Auto"**
  indicator.

## Non-goals (explicitly out of scope for now)

- **Gemini Flash.** Routing is Haiku ↔ Sonnet only. Flash remains a possible future
  engine swap for the fast lane, to be de-risked separately (can Flash emit tool calls
  that survive [`handlers.ts`](../../../lib/chat/tools/handlers.ts) validation?).
- **Sonnet metering for free users.** Later, free users get N Sonnet runs + unlimited
  Haiku. Not now. The design leaves a clean seam (`canEscalate`).

## Design

### Capability tiers

Routing is decided by a `canEscalate` capability, currently derived as `isPaid`
(`planId !== 'free'`). This is the single seam through which future free-tier Sonnet
metering will flow (it becomes `isPaid || hasRemainingSonnetQuota`).

| Tier | Default lane | Escalation | Toolset notes |
|------|--------------|-----------|---------------|
| **Paid** (`canEscalate = true`) | Haiku, **no thinking** | Haiku → Sonnet via `escalate` | Fast lane omits `propose_plan`; heavy lane has full set |
| **Free** (`canEscalate = false`) | Haiku, **existing thinking heuristic** | none | Full toolset incl. `propose_plan` (unchanged from today) |

**Free users keep today's exact behavior** (Haiku + current heuristic + full tools), minus
the manual picker. They can't escalate, so the fast-lane/escalate machinery doesn't apply;
changing their behavior would risk regressing plan quality for no requested benefit. When
metered Sonnet ships, they move onto the paid path behind the quota gate.

### The two lanes (paid)

**Fast lane** — Haiku, thinking OFF.
- Tools: `add_node`, `update_node`, `update_compositor_layer`, `remove_node`,
  `ask_clarification`, **`escalate`**.
- **No `propose_plan`** — if a plan or deep reasoning is needed, Haiku escalates instead.

**Heavy lane** — Sonnet, thinking ON.
- Full toolset incl. `propose_plan`. **No `escalate`** (already at the top).

### The `escalate` tool

A new tool available only in the paid fast lane.

- **Signature:** `escalate({ reason: string })` — `reason` is a short human-readable
  justification, used for logs/observability only.
- **Contract (prompt instruction):** *"If the request needs multi-step reasoning, a
  plan, or a large/ambiguous build, call `escalate` as your **very first action**, before
  emitting any text or other tool call."* Requiring escalate-first guarantees there is **no
  partial Haiku message to discard** — the handoff is clean.
- **Effect:** The turn is re-run from the same message history on **Sonnet + thinking ON +
  full toolset**. The client shows a transient **"Thinking deeper…"** indicator, then
  streams the Sonnet turn as the single assistant message.

### Deterministic pre-routes (skip the wasted Haiku attempt)

Two 100%-reliable signals in the request body bypass the fast lane and go **straight to the
heavy lane** for paid users:

1. **`planAnswer.action === 'feedback'`** — the user is refining a proposed plan. Revising
   a plan requires `propose_plan`, which the fast lane lacks. Go directly to Sonnet.
   (Plan *approval*, `action === 'approve'`, never reaches a model — it short-circuits to
   `handlePlanApprove`, so no routing needed.)

That is the only deterministic pre-route. Everything else — including
`clarificationAnswer` replies — starts on the fast lane and escalates if needed.

### Routing decision (pseudocode, top of `handleWithNewBrain`)

```ts
// canEscalate replaces today's isPaid-based manual model selection.
const canEscalate = isPaid; // future: || hasRemainingSonnetQuota

let lane;
if (!canEscalate) {
  // Free: unchanged behavior, no manual picker.
  lane = { model: 'haiku', thinking: legacyThinkingHeuristic(...), tools: FULL };
} else if (planAnswer?.action === 'feedback') {
  // Plan refinement needs propose_plan + reasoning.
  lane = { model: 'sonnet', thinking: true, tools: FULL };
} else {
  // Fast lane: the latency win.
  lane = { model: 'haiku', thinking: false, tools: FAST_WITH_ESCALATE };
}
```

On `escalate` from the fast lane, re-run with `{ model: 'sonnet', thinking: true, tools: FULL }`.

### Escalation orchestration (implementation seam)

The route handler owns the response stream. Two viable seams (decide in the plan):

- **(A) Route-handler orchestration:** run `runBrain` on Haiku; if it returns an
  `escalated` signal (escalate was the first tool call), emit a `switching` stream event,
  then run `runBrain` again on Sonnet into the **same** response stream.
- **(B) In-`runBrain` swap:** pass both lane configs; on seeing `escalate`, `runBrain`
  swaps model/thinking/tools and continues the loop into the same stream.

Either keeps it one assistant message. (A) keeps `runBrain` single-model and is the
default recommendation; (B) is tighter for streaming continuity. The plan will pick one.

### UI: ModelPicker → "Auto"

[`components/chat/ModelPicker.tsx`](../../../components/chat/ModelPicker.tsx) currently
renders a gear-icon `Select` (sonnet/haiku for paid; Automatic/Upgrade for free). Replace
with a single **non-interactive "Auto" pill** for everyone.

- Remove the `selectedModel` state and the picker from
  [`components/chat/ChatInput.tsx`](../../../components/chat/ChatInput.tsx) and the
  `selectedModel` plumbing through
  [`lib/hooks/use-chat-messages.ts`](../../../lib/hooks/use-chat-messages.ts).
- Stop sending `body.selectedModel`. The server **decides the model**; it ignores any
  incoming `selectedModel` (backward-compatible — old clients' field is simply unused).
- Paid users can **no longer force Sonnet** on a simple turn — routing is automatic for
  everyone. (Accepted.)

### Observability: post-turn model badge

Add a subtle indicator on each assistant message showing which model actually produced it
— `⚡` (Haiku, fast) vs `✦` (Sonnet, deep) — muted/small, primarily for verifying the
router during rollout.

- Thread the **final** model that produced the answer (post-escalation) from server →
  client via the existing `usage`/`done` stream event, and persist it on the message
  (e.g. `metadata.model`).
- Extend the `[chat:cache]` log
  ([`lib/chat/provider/anthropic.ts:208-226`](../../../lib/chat/provider/anthropic.ts))
  so an escalated turn is identifiable (e.g. an `escalated: true` field or a paired log
  line for the Haiku attempt + Sonnet run).

## Affected files (survey, not a task list)

- [`app/api/chat/stream/route.ts`](../../../app/api/chat/stream/route.ts) — routing
  decision (replaces L452-458); escalation orchestration; thread final model to stream.
- [`lib/chat/brain.ts`](../../../lib/chat/brain.ts) — per-lane thinking/tools; handle
  `escalate`; emit escalation signal; remove/retire the old action-verb thinking heuristic
  for the paid path.
- [`lib/chat/tools/definitions.ts`](../../../lib/chat/tools/definitions.ts) — define
  `escalate`; build per-lane tool arrays (fast vs full).
- [`lib/chat/tools/handlers.ts`](../../../lib/chat/tools/handlers.ts) — `escalate` handler
  (no-op on the workflow; signals the brain).
- [`lib/chat/prompt/system.ts`](../../../lib/chat/prompt/system.ts) — fast-lane prompt
  guidance on when to escalate (keep registry/rules in the cached stable block).
- [`lib/chat/provider/anthropic.ts`](../../../lib/chat/provider/anthropic.ts) — log
  escalation; ensure both Haiku and Sonnet calls report model for the badge.
- [`components/chat/ModelPicker.tsx`](../../../components/chat/ModelPicker.tsx) → "Auto"
  pill.
- [`components/chat/ChatInput.tsx`](../../../components/chat/ChatInput.tsx),
  [`lib/hooks/use-chat-messages.ts`](../../../lib/hooks/use-chat-messages.ts) — drop
  `selectedModel`.
- [`components/chat/Message.tsx`](../../../components/chat/Message.tsx) — render the model
  badge.

## Risks & mitigations

- **Haiku misjudges complexity (plows ahead instead of escalating).** Mitigation: clear,
  example-driven escalate guidance in the prompt; escalate-first contract. Cost of a wrong
  guess is one cheap Haiku turn, not a bad final answer (Sonnet redoes it).
- **Escalation latency for the complex 10%** (Haiku attempt + Sonnet run). Accepted — the
  user explicitly agreed complex turns being slower is fine; the deterministic feedback
  pre-route removes the most common avoidable double-turn.
- **Prompt cache churn.** Keep registry/rules/few-shot in the cached stable block for both
  lanes; only the tool list and per-turn dynamic block differ. Haiku and Sonnet maintain
  separate caches (expected); the fast lane is the common path and stays warm.
- **False-start UI flash on escalate.** Prevented by the escalate-first contract — nothing
  is streamed before the decision.

## Verification

Per [verification-commands](../../../CLAUDE.md): use `npx tsc --noEmit` (lint/build are
unreliable here). Manual E2E in-app:

1. *"generate me an image"* (paid) → fast lane, no "Thinking deeper…", badge `⚡`,
   streams in ~1s.
2. *"build a full multi-stage pipeline with bg removal + compositing"* (paid) → Haiku
   escalates → "Thinking deeper…" → Sonnet → `propose_plan`, badge `✦`.
3. Plan feedback turn (paid) → straight to Sonnet (no Haiku attempt), can revise plan.
4. Plan approval → unchanged (no model, applies blueprint).
5. Free user → behaves exactly as today; picker shows "Auto".
