# Run-intent re-architecture + four targeted fixes

**Date:** 2026-06-08
**Status:** Design — pending user review
**Author:** brainstormed with Claude

## Summary

Five issues surfaced from a single user session ("I asked for the simplest thing — add a
prompt connected to an image node — and instead it thought, added it, *wired a compositor I
never asked for*, and then ran everything"). They span four subsystems but share a theme:
**the system infers intent the user never expressed, and the prod execution result never makes
it back to the canvas.**

This spec folds all five into one design, sequenced so the production-breaking one ships first.

| # | Issue | Nature | Phase |
|---|-------|--------|-------|
| 4 | Prod runs finish on Replicate but the node hangs on "loading" forever | Prod-only realtime delivery break | 0 (first) |
| 1+5 | AI auto-runs nodes it only *added*; over-builds a compositor sink | Run-intent re-architecture + prompt | 1 |
| 3 | Running border indicator shows on non-leaf nodes (incl. live inputs) | UI gate | 2 |
| 2 | AI-added nodes land too tight, then visibly re-space ~1s later | Layout flash | 3 |

---

## Phase 0 — #4: Prod node stuck on "loading" (ship first)

### Observed symptoms (prod only)

- The **node** shows the result and stops "loading" **only after a full page refresh** — never
  live.
- The **chat result tile** never shows the image **at all**, even after refresh.
- Both work live in local/dev.

### Root cause (confirmed)

The backend is **correct in prod** — logs show the Replicate webhook arrives, signature
verifies, `node_results` is written `status: 'completed'` with the bucket URL, and the
orchestrator logs `Final Status: completed`. The failure is entirely on the **client delivery
side**, and only in prod. **The realtime channel is fully dead in prod** (high confidence — it's
the only explanation consistent with both symptoms above):

- **Why the node recovers only on refresh:** recovery comes from the **session-load path**, not
  realtime. `loadSession` → `getSessionExecutions` reads `node_results` over plain authenticated
  REST and writes `setNodeStatus`/`setNodeOutput`
  ([use-session.ts:143-150, 439-483](../../../lib/hooks/use-session.ts);
  [workflows.ts:229-233](../../../lib/db/workflows.ts)). This is independent of the realtime
  channel. The realtime `hydrateFromDb` does **not** restore it, because it is chained off a
  *successful* subscribe (below) — a dead channel skips it.
- **Why the chat tile never recovers:** the durable chat tile is `message.result`
  ([Message.tsx:376-380](../../../components/chat/Message.tsx)), frozen + persisted by the
  run-completion watcher **only when it sees `nodeStatuses → success` live**
  ([use-chat-messages.ts:89-131](../../../lib/hooks/use-chat-messages.ts)). With realtime dead,
  that transition never fires live, so `message.result` is never written/persisted. On refresh
  there's nothing to restore, and the live in-memory tile is suppressed (the proposal was
  rewritten `running → ready` on load).

The general mechanism:

- **Dev** finalizes synchronously. `ai_generator` executor checks
  `isLocal = appUrl.startsWith('http://localhost')`
  ([executor.server.ts:186](../../../lib/nodes/plugins/ai_generator/executor.server.ts)) and runs
  `replicate.run(...)` inline, updating the store in the same request — **no realtime needed**.
- **Prod** calls `replicate.predictions.create({ webhook })`, returns `pending`, sets the node
  `running`, and relies **solely on the Supabase realtime subscription** to learn the result
  (the webhook lands seconds later, async).

The realtime subscription is poisoned: [use-execution-channel.ts:213-233](../../../lib/hooks/use-execution-channel.ts)
puts **two** `postgres_changes` bindings — `node_results` (long-stable) and `node_predictions`
(new, added by commit `76797f2a`) — on **one shared channel**. Supabase validates every binding
at `subscribe()` time against the realtime publication + RLS. If the `node_predictions` binding
fails validation, Supabase returns `CHANNEL_ERROR` for the **entire channel**, so `node_results`
events are never delivered either. `node_predictions`'s realtime prerequisites come only from
`20260607_node_predictions_realtime.sql`, and **Vercel prod points at a different Supabase
project than local `.env.local`** — so "the migration is applied" is ambiguous and may not hold
in prod.

The hang is permanent because the only non-realtime catch-up, `hydrateFromDb`
([use-execution-channel.ts:112-143](../../../lib/hooks/use-execution-channel.ts)), is chained
**only off a successful subscribe** ([:239-243](../../../lib/hooks/use-execution-channel.ts)):
`subscribeWithRetry(...).then(hydrate).catch(log)`. On subscribe failure the catch only logs.
There is **no polling / status-reconcile fallback** anywhere in the codebase. One failed
subscribe ⇒ loading forever.

### Fix

**Code (in `lib/hooks/use-execution-channel.ts`):**

1. **(a) Split channels.** Move the `node_predictions` binding off the `node_results` channel
   onto its own channel (e.g. `session_predictions_${sessionId}`), subscribed independently.
   A `node_predictions` validation failure can then no longer take down `node_results` delivery.
   Worst case if `node_predictions` realtime is broken: we lose the per-iteration streaming
   tiles, **not** the final result.
2. **(b) Hydrate on failure too.** Run `hydrateFromDb` in the `.catch` of `subscribeWithRetry`
   (and the visibility-reconnect path), so a completed `node_results` row is always read from the
   DB and applied even when realtime never subscribes. This alone clears the stuck state.
3. **(c) Reconcile on focus.** Broaden the `visibilitychange → visible` handler to always run
   `hydrateFromDb` regardless of channel state (currently only fires on `closed`/`errored`).
   Lower priority; closes the gap for individually dropped events.

(a) prevents the poisoning; (b) guarantees recovery regardless of realtime health. Together they
fix the hang even if the prod DB question is never resolved.

**This single fix resolves both symptoms.** Once `node_results` events are delivered live, the
node updates without a refresh, and the chat-result freeze watcher
([use-chat-messages.ts:89-131](../../../lib/hooks/use-chat-messages.ts)) — gated on the same
`nodeStatuses → success` transition — fires, writing and persisting `message.result` so the chat
tile fills live and survives refresh. No separate final-result path is needed for the chat tile;
`node_predictions` realtime only drives the per-iteration streaming animation, and the live tile
already falls back to the final `nodeOutputs` when a terminal succeeds.

**Operator (user) — verification, not a fix:** confirm against the **prod** Supabase project
that `node_predictions` is in `pg_publication_tables` for `supabase_realtime`, has
`REPLICA IDENTITY FULL`, an authenticated `SELECT` grant, and its SELECT RLS policy. If absent,
re-apply `20260607_node_predictions_realtime.sql` to the prod project (restores the streaming
tiles; the code fix already prevents the hang).

### Verification

- Prod: run a generation, confirm the node flips `loading → result` within seconds of the
  webhook landing — **without a refresh**.
- Prod: confirm the **chat result tile** fills live in the same run, and still shows after a
  refresh (proves `message.result` was frozen + persisted).
- Temporarily simulate a `node_predictions` binding failure (or point at a project without it)
  and confirm `node_results` still delivers, the node clears, and the chat tile fills from the
  final `nodeOutputs` (proves channel isolation + hydrate-on-failure).

---

## Phase 1 — #1 + #5: Run-intent re-architecture (the core change)

### Root cause

The chat brain **never requests a run**. After it returns its workflow patch, the *frontend*
infers a run from `aiTurn.touchedNodeIds`
([use-chat-messages.ts](../../../lib/hooks/use-chat-messages.ts), buildRunPlan → if
`autoRunEnabled && cost <= maxAutoRunCredits` → `triggerRunSelection(preconfirmed)`). That
inference — "the AI touched nodes, so the user must want to run them" — is the bug: the user
asked to **add**, and got an **execution**.

Separately, the compositor over-build is a prompt issue: no rule says "show on screen," but
`USE_CASE_ARCHETYPES` ([system.ts:116-137](../../../lib/chat/prompt/system.ts)) tells the brain
to "compose the final cut with a compositor" — a *video* pattern over-applied to a simple image
request.

### Design — the brain owns run intent

Separate "edit" from "execute." The brain is the only component that knows whether the user's
message includes execution; the run signal must originate there.

1. **New `run_nodes` brain tool** (`lib/chat/tools/`): records explicit run intent (a list of
   node IDs). It does **not** mutate the workflow. The brain calls it *only* when the user's
   message implies execution ("generate…", "run it", "make me an image of X"). Pure add/edit
   emits no run signal.
2. **Stream the request** ([app/api/chat/stream/route.ts](../../../app/api/chat/stream/route.ts)):
   emit the run intent as a distinct event, `runRequest: { nodeIds }`, alongside the patch.
3. **Frontend acts only on `runRequest`** ([use-chat-messages.ts](../../../lib/hooks/use-chat-messages.ts)):
   - **Delete** the `touchedNodeIds` auto-run inference entirely.
   - On `runRequest`: build the run plan for the requested IDs.
     - `autoRunEnabled && cost <= maxAutoRunCredits && no missing models` →
       `triggerRunSelection(preconfirmed)` (unchanged execution path).
     - otherwise → attach a **`pendingRun`** payload to the chat message and render a
       **"Run (N credits)" button** in the reply; clicking it calls `triggerRunSelection`.
   - No `runRequest` → nothing runs; AI-added nodes simply carry their normal per-node canvas
     Run affordance.
4. **Prompt fixes** ([system.ts](../../../lib/chat/prompt/system.ts)):
   - Add `run_nodes` to the tool list with explicit guidance: *adding or editing nodes does NOT
     imply a run; call `run_nodes` only when the user asks to generate/run/execute.*
   - Scope the compositor archetype to genuine multi-scene **video** composition.
   - Add a **minimal-graph rule**: build exactly what was asked; do not append sinks
     (compositor / "on screen") the user did not request.

### Preferences are unchanged

`autoRunEnabled` / `maxAutoRunCredits` keep their current meaning and UI — they now gate the
**brain's** explicit request instead of the frontend's guess.

### Backward compatibility

Existing chat messages have no `pendingRun` field — they simply render no button. New behavior is
forward-only. No migration of stored chats.

### Verification

- "Add a prompt node connected to an image node" → nodes added, **no run**, no compositor.
- "Generate an image of a cat" → brain calls `run_nodes`; with auto-run on and under cap it runs;
  with auto-run off or over cap a "Run (N credits)" button appears in the chat reply and runs on
  click.

---

## Phase 2 — #3: Leaf-only running indicator

### Root cause

[BaseNode.tsx:662](../../../lib/nodes/core/canvas/BaseNode.tsx) renders `<GeneratingBorder/>`
for **every** node with `status === 'running'` — including intermediate nodes and the area around
their live-data inputs (e.g. a prompt feeding an `ai_generator`). The user wants the running
border only on **leaf/terminal** nodes. (The audit found the only per-input pulse is the
missing-mandatory-input highlight, which is unrelated and stays.)

### Fix

Gate `<GeneratingBorder/>` on the node being **terminal**. Reuse the existing terminal definition
from [run-plan.ts:80-87](../../../lib/billing/run-plan.ts): a node is terminal if it has no
outgoing edge to another running target. Edges are already in BaseNode via `useEdges()`. Result:
prompt and intermediate `ai_generator`/blur/levels nodes show no border while running; only the
run's leaf (e.g. the compositor, or a standalone `ai_generator` with no downstream) shows it.

### Verification

- Run `prompt → ai_generator → compositor`: border only on the compositor.
- Run a standalone `ai_generator`: it *is* a leaf, border shows.
- Confirm no separate per-input running animation exists; if one is found, gate it the same way.

---

## Phase 3 — #2: Layout flash

### Root cause

First placement is server-side in [handlers.ts:155](../../../lib/chat/tools/handlers.ts) via
`layoutPatchAsync`, which falls back to **registry dimensions**
([layout-utils.ts](../../../lib/workflow/layout-utils.ts)) because the server has no DOM
measurements. Those fallbacks are far too small (prompt registered 185px vs ~440px rendered), so
ELK packs nodes tight. The client then re-runs the layout with **measured** sizes once React Flow
has measured the DOM ([AiAddedZoom.tsx](../../../components/editor/AiAddedZoom.tsx)), producing the
visible ~1s jump. The two-step is structural (server can't know rendered sizes), but the *visible*
flash is avoidable.

### Fix (both halves)

1. **Accurate registry sizes** ([layout-utils.ts](../../../lib/workflow/layout-utils.ts)): update
   the fallback dimensions to match real rendered sizes so the first server pass already lands
   close.
2. **Reveal-on-settle** ([AiAddedZoom.tsx](../../../components/editor/AiAddedZoom.tsx)): keep nodes
   in `aiTurn.addedNodeIds` visually hidden (e.g. opacity 0 / hidden flag) until the measured
   relayout completes, then reveal in place — no visible jump. Scope strictly to the new turn's
   added nodes; existing nodes stay anchored and visible throughout.

### Verification

- AI adds several nodes: they appear once, at correct spacing, with no tight-then-spread jump.
- Existing nodes never flicker or move.

---

## Sequencing & risk

1. **Phase 0** ships first and standalone — it's prod-breaking and low-risk (channel split +
   DB-catch-up fallback). No dependency on the others.
2. **Phase 1** is the largest change (brain tool + stream event + frontend run path + prompt). It
   touches the chat/execution boundary; the main risk is missing a run-trigger the old inference
   covered — mitigated by the explicit `run_nodes` tool and keeping `triggerRunSelection`
   unchanged downstream.
3. **Phases 2 and 3** are small, isolated UI fixes with no backend impact; either can land
   independently at any time.

## Files touched (anticipated)

- Phase 0: `lib/hooks/use-execution-channel.ts`
- Phase 1: `lib/chat/tools/` (new `run_nodes`), `lib/chat/prompt/system.ts`,
  `app/api/chat/stream/route.ts`, `lib/hooks/use-chat-messages.ts`, chat message model +
  message-render component (for the `pendingRun` "Run" button)
- Phase 2: `lib/nodes/core/canvas/BaseNode.tsx` (reusing `lib/billing/run-plan.ts` terminal logic)
- Phase 3: `lib/workflow/layout-utils.ts`, `components/editor/AiAddedZoom.tsx`

## Open operator items (user, not code)

- Verify `node_predictions` realtime objects exist in the **prod** Supabase project; re-apply
  `20260607_node_predictions_realtime.sql` there if missing (restores streaming tiles).
