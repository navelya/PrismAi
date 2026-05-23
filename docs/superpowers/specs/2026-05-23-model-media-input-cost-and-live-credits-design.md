# Per-image / per-video model cost + instant optimistic credit balance

**Date:** 2026-05-23
**Status:** Approved design, pending implementation plan

## Problem

Two related billing/credits gaps:

1. **No cost for connected media.** An `ai_generator` model is billed only by its
   `credit_cost` plus per-control modifiers ([lib/billing/cost.ts](../../../lib/billing/cost.ts)).
   When a user wires images or videos into a model's input handles, that costs nothing
   today. We want each connected media item to add to the run cost, at an admin-configured
   per-image / per-video rate set on the model.

2. **Laggy credit balance.** The credit balance in the UI only reflects
   `profiles.token_balance` via a Supabase realtime subscription
   ([lib/billing/use-balance.ts](../../../lib/billing/use-balance.ts)). So both the
   decrement-on-run and the restore-on-failure visibly lag a DB round-trip. We want the
   balance to drop the instant a run starts and pop back up the instant a run fails,
   then reconcile to the authoritative value.

## Decisions (confirmed)

- Per-image/video cost lives on the **ai_generator model** (not the media_input node).
- Counting is **per uploaded item**: a media_input holding 3 images wired into an image
  input bills 3 × `cost_per_image`.
- Admin form fields are shown **only when the model declares an image/video input handle**.
- Image vs video is bucketed by **handle type** (an image-type handle bills at the image
  rate). v1 simplification: a video file dropped into an image handle still bills at the
  image rate. Per-item media-type classification is a future refinement.
- Counting is computed from the **full graph** on both client and server (see below).

---

## Part 1 — Per-image / per-video model cost

### 1.1 Storage (DB + types)

New migration `supabase/migrations/<ts>_add_media_input_cost_to_models.sql`:

```sql
ALTER TABLE public.ai_models
  ADD COLUMN IF NOT EXISTS cost_per_image NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_per_video NUMERIC NOT NULL DEFAULT 0;
```

Add to the `AiModel` interface in [lib/nodes/types.ts](../../../lib/nodes/types.ts):

```ts
cost_per_image: number;
cost_per_video: number;
```

### 1.2 Persistence wiring

- **`/api/models/list`** ([app/api/models/list/route.ts](../../../app/api/models/list/route.ts))
  uses `select('*')` — new columns flow to the client store automatically. No change.
- **Admin PATCH** ([app/api/admin/models/[id]/route.ts](../../../app/api/admin/models/[id]/route.ts))
  destructures an explicit field list — **add** `cost_per_image`, `cost_per_video` to the
  destructure and the `.update({...})` object (mirroring the `credit_cost: x !== undefined ? Number(x) : undefined` pattern).
- **Admin POST/create** ([app/api/admin/models/route.ts](../../../app/api/admin/models/route.ts))
  — same: include both columns in the insert (default 0).

### 1.3 Admin form UI

In [components/admin/ModelForm.tsx](../../../components/admin/ModelForm.tsx), "Cost & Status"
`FormSection`, beside the existing "Credit Cost" `NumberInput`, add:

- "Cost per connected image" → `cost_per_image` (suffix `CR`), shown only when the model has
  an image-type input handle.
- "Cost per connected video" → `cost_per_video` (suffix `CR`), shown only when the model has
  a video-type input handle.

Visibility predicate reads the in-form handle list (the same `inputs_schema.handles` the form
already edits): an image handle is one whose `type` contains `"image"`; a video handle's `type`
contains `"video"`. Wire both into the existing `form` state object so they POST/PATCH with the
rest of the model.

### 1.4 Counting connected media (the careful part)

**Why full-graph counting.** The client sends the complete `nodes`+`edges` to
`/api/executions/start` ([SharedWorkflowEditor.tsx:383](../../../components/editor/SharedWorkflowEditor.tsx#L383)),
and the server trims it into an execution set. The pre-run modal estimate and the
authoritative server debit are guarded by a 5% drift tolerance (`COST_DRIFT_TOLERANCE`,
[lib/billing/cost.ts](../../../lib/billing/cost.ts)) — if they disagree by more than that, the
run is rejected. To keep them in lockstep we count connected media from the **full graph** on
both sides (both have it), never from the trimmed set or live `node_results`.

**`computeExecutionCost` signature change.** Add an optional graph context so existing callers
that don't pass it keep their current behavior:

```ts
interface CostGraphContext {
  allNodes: CostNode[];   // every node in the workflow (for source lookup)
  edges: { source: string; target: string; targetHandle?: string | null }[];
}

export function computeExecutionCost(
  nodes: CostNode[],                 // nodes being charged (the target set)
  modelsById: Map<number, AiModel>,
  graph?: CostGraphContext,          // NEW — when present, adds connected-media cost
): ExecutionCostResult
```

`CostNode.config` must expose enough to resolve a media_input's item count — i.e. the raw
`config` including `images` for media_input sources. Callers already build `CostNode` from
`node.data.config`; ensure `images` survives for media_input nodes.

**Per-node media cost.** For each charged `ai_generator` node with model `M`:

1. Build a handle-type map for `M`: from `M.inputs_schema.handles` keyed by `api_mapping_key`,
   plus the static `image` handle the ai_generator always declares
   ([lib/nodes/plugins/ai_generator/definition.ts](../../../lib/nodes/plugins/ai_generator/definition.ts)).
   Classify each handle id as `"image"`, `"video"`, or neither (by `type` substring).
2. `imageUnits = videoUnits = 0`. For each edge in `graph.edges` with `target === node.id`:
   - resolve the handle type for `edge.targetHandle`; skip if neither image nor video.
   - `units = unitsFromSource(edge.source)`:
     - source node (looked up in `graph.allNodes`) is `media_input` → `config.images?.length ?? 0`
     - any other source → `1`
   - add `units` to `imageUnits` or `videoUnits` per handle type.
3. `mediaCost = imageUnits * (M.cost_per_image ?? 0) + videoUnits * (M.cost_per_video ?? 0)`.
4. Add `mediaCost` to that node's existing `computeAiNodeCost` total (still subject to
   `MAX_EXECUTION_COST` and `Math.max(0, …)`).

Keep this logic inside `lib/billing/cost.ts` (pure, shared) so the single source of truth is
preserved.

**Callers to update:**

- **Client estimate** — `calculateExecutionCost` ([SharedWorkflowEditor.tsx:474](../../../components/editor/SharedWorkflowEditor.tsx#L474)):
  pass `graph = { allNodes: <all workflow nodes as CostNode>, edges }`. It already closes over
  the full `nodes` and `edges`.
- **Server debit** — `/api/executions/start` ([app/api/executions/start/route.ts:385](../../../app/api/executions/start/route.ts#L385)):
  build `graph.allNodes` from the **full** request `workflow.nodes` (not `nodesToExecute`) and
  `graph.edges` from the full `allEdges`; the charged `nodes` arg stays `nodesToExecute`. Add
  `cost_per_image, cost_per_video` to the `.select(...)` on `ai_models` (currently
  `'id, credit_cost, inputs_schema'`), and to the validation-block select if that model object
  is reused for cost.

**Modal display.** The `CreditConfirmModal` cost already comes from `calculateExecutionCost`, so
the connected-media cost shows up in the estimate automatically once the client caller passes
the graph context.

---

## Part 2 — Instant optimistic credit balance

### 2.1 Mechanism

Add an ephemeral, **non-persisted** signed accumulator to the app-store (execution slice,
[lib/store/slices/execution-slice.ts](../../../lib/store/slices/execution-slice.ts)):

```ts
optimisticCreditDelta: number;                       // default 0
pendingCharges: Record<string, number>;              // executionId -> optimistically-charged cost
applyOptimisticCharge: (executionId: string, cost: number) => void;   // delta -= cost; record
refundOptimisticCharge: (executionId: string) => void;                // delta += recorded; drop record
clearOptimisticCredits: () => void;                  // delta = 0; pendingCharges = {}
```

Confirm both new fields are excluded from the persisted slice (same exclusion list that already
drops `nodeStatuses`/`activeExecutionId` — these are runtime-only trigger/▸state, per the
CLAUDE.md note about not rehydrating run state).

### 2.2 Display integration

`useTokenBalance` ([lib/billing/use-balance.ts](../../../lib/billing/use-balance.ts)) returns a
**display balance** = authoritative `balance + optimisticCreditDelta`:

- Subscribe to `useAppStore(s => s.optimisticCreditDelta)` and return
  `balance == null ? null : balance + delta` as the `balance` field consumers read (toolbar,
  modal). Keep a separate raw value internally if needed.
- **Reconcile on authoritative update:** in both the initial fetch and the realtime UPDATE
  handler, after `setBalance(serverValue)`, call `clearOptimisticCredits()`. Once the server's
  number arrives it is truth; the optimistic guess is discarded, preventing double-counting.

### 2.3 Lifecycle hooks (mirror the server exactly)

- **On run** — in `commitExecution` ([SharedWorkflowEditor.tsx:285](../../../components/editor/SharedWorkflowEditor.tsx#L285)),
  after validation passes and the optimistic node statuses are seeded, compute the cost **inside
  `commitExecution`** via `calculateExecutionCost(targetNodeId, mode, selectionIds)` and call
  `applyOptimisticCharge(executionId, cost)`. Computing it here (not reading the modal's
  `pendingCost`) covers every entry point — the modal-confirmed run *and* the `runFromNodeId`
  effect that fires solo/chain/selection runs without a modal. It is the same pure function the
  modal estimate uses, so the number matches. Skip when `cost === 0`. Balance drops immediately.
- **On start-request failure** — in the `catch` block (and on non-ok responses, incl. 402),
  call `refundOptimisticCharge(executionId)` so the decrement is undone (no debit happened, or
  it will be server-refunded).
- **On execution failure during run** — mirror the orchestrator's whole-execution, all-or-
  nothing rule ([orchestrator.ts:286](../../../lib/workflow/orchestrator.ts#L286)): when the
  active execution **settles** (no node in `pending`/`running` among the run's node set) and at
  least one of those nodes is in `error`, call `refundOptimisticCharge(executionId)`. Balance
  pops back up before the refund realtime arrives. The realtime refund then resets the delta to 0.

  Detection point: the execution channel ([lib/hooks/use-execution-channel.ts](../../../lib/hooks/use-execution-channel.ts))
  already maps failed node_results to `error` status. Evaluate the settle+failed condition there
  (or in a small effect watching `nodeStatuses` + `activeExecutionId`). Track the run's node-id
  set so "settled" is scoped to this execution, not the global status map.

`refundOptimisticCharge` uses the recorded `pendingCharges[executionId]` and drops the record,
so it is idempotent — a second failure signal for the same execution is a no-op.

### 2.4 Trace (correctness)

- **Success:** run → `delta=-C` (balance shows `bal-C`). Debit realtime → `setBalance(bal-C)` +
  `clearOptimisticCredits()` → `delta=0`, shows `bal-C`. Nodes succeed → no refund. ✔
- **Failure (debit already reflected):** run → `delta=-C`. Debit realtime → shows `bal-C`,
  `delta=0`. Node fails, execution settles failed → `refundOptimisticCharge` → `delta=+C` →
  shows `bal`. Refund realtime → `setBalance(bal)` + clear → shows `bal`. ✔
- **Failure (fast, before debit realtime):** run → `delta=-C`, shows `bal-C`. Settle failed →
  `delta=0`, shows `bal`. Later debit+refund realtimes converge to `bal`. Brief, self-correcting. ✔

---

## Out of scope

- Per-item media-type classification (video-in-image-handle billed at image rate for now).
- Multiple simultaneous independent executions beyond the single `activeExecutionId` the store
  tracks today (the per-execution `pendingCharges` map is forward-compatible but untested for
  true concurrency).
- Changing media_input itself — it remains a free input node; cost is owned by the consuming
  model.

## Verification

- `npx tsc --noEmit` (the reliable check here; `npm run lint`/`build` are unreliable per repo notes).
- Manual: set a model's `cost_per_image=5` in admin; wire a media_input with 3 images → model;
  confirm the Run modal estimate increases by 15 and matches the server debit (no drift
  rejection); confirm balance drops on run and restores on a forced failure without waiting for
  a DB refresh.
