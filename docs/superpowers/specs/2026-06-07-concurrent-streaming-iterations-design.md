# Concurrent iterations with streaming results — Design

**Date:** 2026-06-07
**Status:** Approved (pending spec review)

## Problem

When an `ai_generator` node is configured with N iterations, the dispatcher creates
the N Replicate predictions in a serial `for...await` loop, the node stays `running`
until **every** prediction resolves, and only then does a single realtime event
deliver all N results to the chat at once. The user sees nothing until the slowest
iteration finishes.

Desired behavior:

1. All iterations run **concurrently**, not one after another.
2. Each iteration's result appears in the chat results grid **the moment it is ready**,
   without waiting for the others.

## Scope

`iterations` is a field that exists **only** on the `ai_generator` node
([definition.ts:19](../../../lib/nodes/plugins/ai_generator/definition.ts#L19),
clamped 1–10 by `clampIterations` in [cost.ts](../../../lib/billing/cost.ts)).

This design covers the case where the `ai_generator` node is the **terminal/leaf**
node whose media surfaces in the chat results grid — the common "generate N images"
chat flow.

**Out of scope:** streaming partial iteration results *into downstream consumer nodes*
(e.g. a compositor that reads the generator's output). Downstream children continue to
dispatch exactly once, after all iterations finish. Graph execution semantics are
unchanged; this feature only changes the timing/granularity of how the terminal node's
own results reach the chat grid.

## Current architecture (as-is)

- **Dispatch:** [dispatch-v2.ts:208–291](../../../lib/workflow/dispatch-v2.ts#L208)
  `dispatchReplicateNode`. For `iterations > 1` it runs a serial
  `for (i...) { await aiGeneratorExecutor(...) }` loop (line 217), then for the
  production async path marks the node `running` once and inserts N rows into
  `node_predictions` (one per `prediction_index`).
- **Per-prediction tracking:** `node_predictions` table
  ([20260523_add_node_predictions.sql](../../../supabase/migrations/20260523_add_node_predictions.sql)),
  unique on `(execution_id, node_id, prediction_index)`. Each row carries
  `replicate_id`, `status` (`pending`/`completed`/`failed`), `result_data`, `error`.
  **Each webhook writes only its own row** — already race-free.
- **Webhook:** [replicate-v2/route.ts](../../../app/api/webhooks/replicate-v2/route.ts).
  On each prediction it mirrors media to storage, updates that prediction's row, then
  calls `finalizeFanOutIfReady` (line 71), which returns early while any prediction is
  still `pending`. Once all resolve, it aggregates successful `result_data` in
  `prediction_index` order and, via an atomic "claim" UPDATE
  (`...eq('status','running')`), transitions `node_results` to `completed`/`failed`
  exactly once and dispatches children.
- **Client realtime:** [use-execution-channel.ts](../../../lib/hooks/use-execution-channel.ts)
  subscribes to `node_results` (no server-side filter; filters client-side by
  session). `applyNodeResult` maps `completed` → `nodeStatuses[id]='success'` +
  `setNodeOutput` + `appendAiGeneratorRun`.
- **Chat grid:** [InlineRunResults.tsx](../../../components/chat/InlineRunResults.tsx)
  renders a terminal's media only when `nodeStatuses[id] === 'success'`. Skeleton count
  = `expectedResultCount` (Σ terminal iterations, from
  [run-plan.ts](../../../lib/billing/run-plan.ts)).
- **Billing:** `/api/executions/start` debits `base_cost × iterations` upfront via
  `debit_tokens` (idempotency `exec:{execution.id}`). `refund_tokens(execution_id)`
  refunds the **entire** execution debit (idempotency `refund:{execution_id}`) — it
  **cannot** do a partial per-iteration refund.

## Decisions (from brainstorming)

- **Failure handling:** stream successes; a failed iteration shows an error tile in
  its grid slot. The node overall completes (partial success) as long as ≥1 iteration
  succeeds.
- **Refund:** a failed iteration refunds its share of the upfront debit.
- **Grid ordering:** completion order — first-finished image fills the first slot, etc.

## Design

### Part 1 — Concurrent dispatch

In [dispatch-v2.ts:217](../../../lib/workflow/dispatch-v2.ts#L217), replace the serial
`for...await` loop with `Promise.allSettled` over N `aiGeneratorExecutor(config, inputs, ctx)`
calls so all predictions are created concurrently. Map results back to the existing
shape: a fulfilled value is the executor result; a rejected promise becomes the same
`{ success:false, status:'error', error }` row the current `catch` records. Everything
downstream of the loop (the `anyPending` branch, the `node_predictions` upsert, the
all-failed short-circuit) stays unchanged.

**Risk to verify in plan:** `aiGeneratorExecutor` must hold no per-call shared mutable
state that breaks under concurrency. Seed is already random-per-image (per the seed
auto-toggle work), so concurrent calls should not collide — confirm during
implementation.

### Part 2 — Stream each result via `node_predictions` realtime (Approach A)

The per-iteration rows already exist and are written race-free. Expose them to the
client and let the grid render partials.

**Server / DB:**
- Add `node_predictions` to the `supabase_realtime` publication
  (`ALTER PUBLICATION supabase_realtime ADD TABLE node_predictions;`).
- Add an RLS `SELECT` policy on `node_predictions` allowing a user to read predictions
  for executions they own (join `node_predictions → executions → sessions.user_id =
  auth.uid()`), mirroring the existing ownership policy on `node_results`. Realtime
  authorizes the subscriber via RLS, so this policy is required for the client to
  receive events.
- No change to `finalizeFanOutIfReady` or the aggregation/claim logic.

**Client:**
- In [use-execution-channel.ts](../../../lib/hooks/use-execution-channel.ts), add a
  second `.on('postgres_changes', { table: 'node_predictions' }, ...)` handler on the
  existing channel. Filter client-side to the active session (resolve session via the
  `execution_id` already tracked, or include the needed context).
- Add a store map for partials, e.g. `partialIterationResults[nodeId] = { executionId,
  items: Array<{ index, status:'completed'|'failed', media? }> }`, accumulated in
  **arrival (completion) order**. A `completed` prediction pushes its media; a `failed`
  prediction pushes an error marker. Tag with `execution_id` so a stale prior run's
  partials are ignored.
- Clearing: when the run starts (execution-start reset) and when the node's
  `node_results` row reaches `completed`/`failed`, drop that node's partials so the
  canonical aggregated `node_results` output is the single source afterward (no
  duplicates).

**Grid ([InlineRunResults.tsx](../../../components/chat/InlineRunResults.tsx)):**
- While a terminal node is `running`, render from `partialIterationResults[id]` (for the
  active execution): success tiles (completion order) + error tiles for failed
  iterations + skeletons for the remainder up to `expectedResultCount`.
- When the node flips to `success`, render from `nodeOutputs[id]` as today (canonical),
  with partials already cleared.

### Part 3 — Per-iteration failure + refund

- **Display:** covered by Part 2 — failed predictions render error tiles; the node
  completes as partial success via the existing `finalize` (`anySuccess` →
  `completed`).
- **Refund:** in the webhook, whenever a prediction is recorded as `failed` — the
  Replicate `failed`/`canceled` branch
  ([route.ts:390](../../../app/api/webhooks/replicate-v2/route.ts#L390)) **and** the two
  storage-failure branches that mark a prediction failed
  ([route.ts:295](../../../app/api/webhooks/replicate-v2/route.ts#L295),
  [route.ts:328](../../../app/api/webhooks/replicate-v2/route.ts#L328)) — issue a
  partial refund:
  - Use `credit_tokens(user_id, amount, reason, idempotency_key, execution_id, ...)`
    (already granted to `service_role`) — **not** `refund_tokens`, which refunds the
    whole execution.
  - `idempotency_key = refund:{executionId}:{nodeId}:{predIndex}` so webhook retries
    never double-refund.
  - `amount` = the node's **single-iteration** cost. Source it drift-free from the
    `execution_debit` ledger row's `metadata.cost_by_node[nodeId]` (the per-node total
    *including* iterations, persisted at debit time by
    [start/route.ts:538](../../../app/api/executions/start/route.ts#L538)) divided by
    `clampIterations(node.config.iterations)`. This is the per-node cost ÷ its own
    iteration count — exact, and not a divide of the whole-execution total, so it stays
    correct in multi-node graphs.
  - `reason` = a partial-refund reason (e.g. `execution_partial_refund`).

## Files touched (anticipated)

| File | Change |
|------|--------|
| [lib/workflow/dispatch-v2.ts](../../../lib/workflow/dispatch-v2.ts) | serial loop → `Promise.allSettled` |
| `supabase/migrations/<new>.sql` | add `node_predictions` to realtime publication + RLS select policy |
| [lib/hooks/use-execution-channel.ts](../../../lib/hooks/use-execution-channel.ts) | subscribe to `node_predictions`; accumulate partials; clear on start/finalize |
| store slice (execution-slice / types) | `partialIterationResults` map + setters |
| [components/chat/InlineRunResults.tsx](../../../components/chat/InlineRunResults.tsx) | render partials (success/error/skeleton) for running terminal nodes |
| [app/api/webhooks/replicate-v2/route.ts](../../../app/api/webhooks/replicate-v2/route.ts) | per-iteration partial refund on each failed prediction |

## Alternative considered — Approach B (rejected)

Append each prediction's mirrored media to `node_results.result_data` while keeping the
node `running` (new atomic jsonb-append RPC for concurrency safety), reusing the
existing `node_results` subscription. Rejected because: (1) `result_data` holds only
successes, so failed slots can't be marked until the whole node finalizes — weakening
the chosen "mark failed slot" UX; (2) it forces changes to the battle-tested `finalize`
to avoid reshuffling completion-order into `prediction_index` order. Approach A keeps
server aggregation untouched and surfaces per-iteration success **and** failure live,
at the cost of one publication line + one RLS policy.

## Verification

- `npx tsc --noEmit` (lint/build are unreliable in this repo).
- In-app E2E: run an `ai_generator` node with iterations=4 from chat; confirm images
  pop in one-by-one in completion order; force one iteration to fail and confirm an
  error tile appears and a partial refund lands in `token_ledger`.
