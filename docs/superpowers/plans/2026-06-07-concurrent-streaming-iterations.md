# Concurrent Streaming Iterations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run an `ai_generator` node's N iterations concurrently and stream each finished image into the chat results grid the moment it lands (completion order), instead of waiting for all N and showing them at once.

**Architecture:** Dispatch fans out the N Replicate predictions concurrently (`Promise.allSettled`). Each prediction's per-iteration row in `node_predictions` is exposed to the client via Supabase realtime (new RLS select policy + publication). A new store map accumulates completed/failed predictions per node in arrival order; the chat grid renders them as success/error tiles while the node is still `running`, then switches to the canonical aggregated `node_results` output once the node finalizes. A failed iteration refunds its share of the upfront debit via `credit_tokens`.

**Tech Stack:** Next.js (App Router), TypeScript, Zustand, Supabase (Postgres + Realtime + RLS), Replicate webhooks.

**Spec:** [docs/superpowers/specs/2026-06-07-concurrent-streaming-iterations-design.md](../specs/2026-06-07-concurrent-streaming-iterations-design.md)

**Repo note — NO TEST RUNNER:** This repo has no unit-test framework (CLAUDE.md). "Verification" steps therefore use `npx tsc --noEmit` (the reliable check here — `npm run lint`/`build` are flaky per project memory) and, for DB/billing changes, a throwaway `node scripts/<name>.js` against live Supabase. The final task is a manual in-app E2E. Commit after each task.

---

## File Structure

| File | Create/Modify | Responsibility |
|------|---------------|----------------|
| `supabase/migrations/20260607_node_predictions_realtime.sql` | Create | Expose `node_predictions` to realtime: add to publication, RLS select policy, grant, replica identity |
| [lib/workflow/dispatch-v2.ts](../../../lib/workflow/dispatch-v2.ts) | Modify | Serial iteration loop → concurrent `Promise.allSettled` |
| [app/api/webhooks/replicate-v2/route.ts](../../../app/api/webhooks/replicate-v2/route.ts) | Modify | Refund one iteration's cost whenever a prediction is marked `failed` |
| [lib/store/types.ts](../../../lib/store/types.ts) | Modify | Types for `partialIterationResults` map + its setters |
| [lib/store/slices/execution-slice.ts](../../../lib/store/slices/execution-slice.ts) | Modify | State + `addPartialIterationResult` / `clearPartialIterationResults` |
| [lib/hooks/use-execution-channel.ts](../../../lib/hooks/use-execution-channel.ts) | Modify | Subscribe to `node_predictions`; apply partials; clear a node's partials on its `node_results` finalize |
| [components/chat/InlineRunResults.tsx](../../../components/chat/InlineRunResults.tsx) | Modify | Build ordered gallery cells from partials (running) or canonical output (success) |
| [components/chat/RunMediaGallery.tsx](../../../components/chat/RunMediaGallery.tsx) | Modify | Accept a typed `cells` array (media \| error) and render an error tile |

---

## Task 1: DB migration — expose `node_predictions` to realtime

**Files:**
- Create: `supabase/migrations/20260607_node_predictions_realtime.sql`

The `node_predictions` table currently has RLS enabled with **no policies** (server-only — see [20260523_add_node_predictions.sql:25-27](../../../supabase/migrations/20260523_add_node_predictions.sql#L25)). To let the browser receive realtime row events, it needs: a SELECT policy scoped to the owning user, `GRANT SELECT` to `authenticated`, `REPLICA IDENTITY FULL`, and membership in the `supabase_realtime` publication. This mirrors exactly what `node_results` already has ([20260322_atomic_v3_setup.sql:65-83](../../../supabase/migrations/20260322_atomic_v3_setup.sql#L65), [20260322_fix_node_results_realtime.sql:6-11](../../../supabase/migrations/20260322_fix_node_results_realtime.sql#L6)). `node_predictions` has no `session_id` column, so the policy joins through `executions → sessions`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260607_node_predictions_realtime.sql`:

```sql
-- Expose node_predictions to client realtime so per-iteration results stream to
-- the chat as each prediction completes (concurrent-streaming-iterations feature).
-- The table was previously server-only (RLS enabled, no policies). We add a
-- user-scoped SELECT policy (via execution → session ownership), grant SELECT to
-- authenticated, set REPLICA IDENTITY FULL (so UPDATE payloads carry the row),
-- and add it to the realtime publication. The service role still bypasses RLS for
-- all writes from the dispatcher/webhook.

-- 1. User-scoped read access (realtime authorizes the subscriber via RLS).
DROP POLICY IF EXISTS "Users can view predictions of their own executions" ON public.node_predictions;
CREATE POLICY "Users can view predictions of their own executions" ON public.node_predictions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.executions
      JOIN public.sessions ON sessions.id = executions.session_id
      WHERE executions.id = node_predictions.execution_id
        AND sessions.user_id = auth.uid()
    )
  );

-- 2. Service role keeps full write access (explicit, matches node_results).
DROP POLICY IF EXISTS "Service Role can manage predictions" ON public.node_predictions;
CREATE POLICY "Service Role can manage predictions" ON public.node_predictions
  FOR ALL USING (auth.role() = 'service_role');

-- 3. RLS-with-realtime requires the role to hold table SELECT too.
GRANT SELECT ON public.node_predictions TO authenticated;

-- 4. Full row image in change payloads (required for non-PK realtime).
ALTER TABLE public.node_predictions REPLICA IDENTITY FULL;

-- 5. Add to the realtime publication (guarded — ADD TABLE errors if present).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'node_predictions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.node_predictions;
  END IF;
END $$;
```

- [ ] **Step 2: Apply the migration to live Supabase**

This repo applies migrations against live Supabase (no local stack). Apply the SQL via the Supabase SQL editor or `psql`. Then verify it took:

Run a throwaway check, `node scripts/verify-node-predictions-realtime.js`:

```js
// scripts/verify-node-predictions-realtime.js — throwaway; delete after.
const { createClient } = require('@supabase/supabase-js');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
(async () => {
  const db = createClient(url, svc);
  const { data, error } = await db.rpc('exec_sql', { /* if no exec_sql RPC, run the SELECTs below in the SQL editor instead */ });
  // Fallback: just print guidance.
  console.log('Verify in SQL editor:');
  console.log("  select * from pg_publication_tables where pubname='supabase_realtime' and tablename='node_predictions';  -- expect 1 row");
  console.log("  select polname from pg_policies where tablename='node_predictions';  -- expect the two policies");
})();
```

Expected: the publication query returns one row for `node_predictions`; `pg_policies` lists both policies. (Running the two `select`s directly in the SQL editor is the simplest verification.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260607_node_predictions_realtime.sql
git commit -m "feat(db): expose node_predictions to client realtime (RLS select + publication)"
```

---

## Task 2: Concurrent dispatch

**Files:**
- Modify: [lib/workflow/dispatch-v2.ts:216-223](../../../lib/workflow/dispatch-v2.ts#L216)

Today the fan-out runs a serial `for (i...) { await aiGeneratorExecutor(...) }`. Replace with `Promise.allSettled` so all N executor calls (each creates one Replicate prediction) fire concurrently. The downstream code (`anyPending` branch, `node_predictions` upsert, all-failed short-circuit) consumes the same `results` array shape, so only the loop changes. A rejected promise maps to the exact `{ success:false, status:'error', data:null, error }` row the current `catch` produced.

- [ ] **Step 1: Replace the serial loop**

In [lib/workflow/dispatch-v2.ts](../../../lib/workflow/dispatch-v2.ts), replace this block (currently lines 216-223):

```typescript
    const results: Awaited<ReturnType<typeof aiGeneratorExecutor>>[] = [];
    for (let i = 0; i < iterations; i++) {
        try {
            results.push(await aiGeneratorExecutor(config, inputs, ctx));
        } catch (err) {
            results.push({ success: false, status: 'error', data: null, error: err instanceof Error ? err.message : 'Prediction create threw' } as any);
        }
    }
```

with:

```typescript
    // Fan out concurrently: kick off all N predictions at once rather than
    // awaiting each in turn. Each executor call just CREATES one Replicate
    // prediction (the heavy generation runs async on Replicate and returns via
    // webhook), so concurrent creation removes the serial latency and, in the
    // local synchronous path, runs the generations in parallel. allSettled keeps
    // a single failed creation from aborting the rest; a rejection maps to the
    // same shape the previous per-iteration catch produced.
    const settled = await Promise.allSettled(
        Array.from({ length: iterations }, () => aiGeneratorExecutor(config, inputs, ctx))
    );
    const results: Awaited<ReturnType<typeof aiGeneratorExecutor>>[] = settled.map((s) =>
        s.status === 'fulfilled'
            ? s.value
            : ({ success: false, status: 'error', data: null, error: s.reason instanceof Error ? s.reason.message : 'Prediction create threw' } as any)
    );
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no new errors). The `results` array type is unchanged, so the rest of `dispatchReplicateNode` still compiles.

- [ ] **Step 3: Sanity-check executor concurrency safety**

Read [lib/nodes/plugins/ai_generator/executor.server.ts](../../../lib/nodes/plugins/ai_generator/executor.server.ts) and confirm the executor holds no per-call shared mutable module state that breaks when N calls overlap (it builds `replicateInputs` locally and calls `replicate.predictions.create`). Seed is random-per-image, so concurrent calls don't collide on seed. Note in the commit body that this was confirmed. No code change expected; if shared mutable state IS found, stop and surface it before proceeding.

- [ ] **Step 4: Commit**

```bash
git add lib/workflow/dispatch-v2.ts
git commit -m "feat(workflow): fan out ai_generator iterations concurrently (allSettled)"
```

---

## Task 3: Per-iteration refund on a failed prediction

**Files:**
- Modify: [app/api/webhooks/replicate-v2/route.ts](../../../app/api/webhooks/replicate-v2/route.ts)

When a single fan-out iteration fails, its share of the upfront debit must be refunded. There are **three** spots that mark a fan-out prediction `failed`: the storage-upload failure ([route.ts:295](../../../app/api/webhooks/replicate-v2/route.ts#L295)), the "couldn't permanently store" branch ([route.ts:328](../../../app/api/webhooks/replicate-v2/route.ts#L328)), and the Replicate `failed`/`canceled` branch ([route.ts:390](../../../app/api/webhooks/replicate-v2/route.ts#L390)). Add one helper and call it from all three. The amount is sourced drift-free from the persisted debit metadata: `metadata.cost_by_node[nodeId]` (per-node total, includes iterations) ÷ `clampIterations(node.config.iterations)`. Idempotency key `refund:{executionId}:{nodeId}:{predIndex}` makes webhook retries safe.

- [ ] **Step 1: Add the refund helper**

Near the top of [app/api/webhooks/replicate-v2/route.ts](../../../app/api/webhooks/replicate-v2/route.ts) (after the existing imports), add the import for `clampIterations`:

```typescript
import { clampIterations } from '@/lib/billing/cost';
```

Then add this helper above `export async function POST` (alongside `finalizeFanOutIfReady`):

```typescript
/**
 * Refund a single failed fan-out iteration. The upfront debit charged
 * cost_by_node[nodeId] (which already includes the iteration multiplier), so one
 * iteration's share is that value / iterations. Sourced from the persisted
 * execution_debit ledger metadata so it can't drift from what was charged.
 * Idempotent per (execution, node, prediction_index) via the credit_tokens key.
 */
async function refundFailedIteration(
  supabase: ReturnType<typeof createServiceClient>,
  executionId: string,
  nodeId: string,
  predictionIndex: number
): Promise<void> {
  // The execution_debit ledger row holds user_id + the per-node cost map.
  const { data: debitRow } = await supabase
    .from('token_ledger')
    .select('user_id, metadata')
    .eq('execution_id', executionId)
    .eq('reason', 'execution_debit')
    .maybeSingle();
  if (!debitRow?.user_id) return; // nothing was charged (cost 0) → nothing to refund

  const costByNode = (debitRow.metadata as any)?.cost_by_node ?? {};
  const nodeTotal = Number(costByNode[nodeId]);
  if (!Number.isFinite(nodeTotal) || nodeTotal <= 0) return;

  // Resolve this node's iteration count from the execution graph to divide correctly.
  const { data: exec } = await supabase
    .from('executions')
    .select('graph_json')
    .eq('id', executionId)
    .single();
  const graphNodes = (exec?.graph_json as any)?.nodes ?? [];
  const node = graphNodes.find((n: any) => n.id === nodeId);
  const iterations = clampIterations(node?.data?.config?.iterations ?? node?.config?.iterations);
  const perIteration = nodeTotal / iterations;
  if (!(perIteration > 0)) return;

  const { error } = await supabase.rpc('credit_tokens', {
    p_user_id: debitRow.user_id,
    p_amount: perIteration,
    p_reason: 'execution_partial_refund',
    p_idempotency_key: `refund:${executionId}:${nodeId}:${predictionIndex}`,
    p_execution_id: executionId,
    p_stripe_event_id: null,
    p_metadata: { node_id: nodeId, prediction_index: predictionIndex, reason: 'iteration_failed' },
  });
  if (error) {
    // Don't fail the webhook over a refund hiccup — log and continue so the
    // node can still finalize. A missed refund is recoverable; a stuck node is not.
    console.error(`[Webhook/Replicate-v2] Partial refund failed for ${nodeId}#${predictionIndex}:`, error.message);
  }
}
```

- [ ] **Step 2: Call it from the three fan-out failure spots**

`predRow` (from [route.ts:269-275](../../../app/api/webhooks/replicate-v2/route.ts#L269)) carries `prediction_index`. In each of the three `isFanOut` failure branches, after the `node_predictions` update marks the row `failed` and **before** the `finalizeFanOutIfReady` call, add:

```typescript
          await refundFailedIteration(supabase, executionId, nodeId, predRow!.prediction_index);
```

Concretely, the three branches are: the upload-error branch ([route.ts:295-304](../../../app/api/webhooks/replicate-v2/route.ts#L295)), the could-not-store branch ([route.ts:328-337](../../../app/api/webhooks/replicate-v2/route.ts#L328)), and the `failed`/`canceled` branch ([route.ts:391-401](../../../app/api/webhooks/replicate-v2/route.ts#L391)). Each already does `update(... status:'failed' ...)` then `finalizeFanOutIfReady(...)`; insert the refund call between them.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Verify refund math + idempotency against live DB**

Write a throwaway `node scripts/verify-partial-refund.js` that, against a recent real fan-out execution that had a failed iteration (or a synthetic ledger row), confirms: (a) `cost_by_node[nodeId]/iterations` equals the `execution_partial_refund` amount in `token_ledger`, and (b) calling the refund path twice with the same key inserts only one ledger row.

```js
// scripts/verify-partial-refund.js — throwaway; delete after.
const { createClient } = require('@supabase/supabase-js');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const EXEC = process.argv[2]; // pass an execution_id known to have a partial refund
  const { data: debit } = await db.from('token_ledger').select('metadata').eq('execution_id', EXEC).eq('reason','execution_debit').maybeSingle();
  const { data: refunds } = await db.from('token_ledger').select('amount, idempotency_key, metadata').eq('execution_id', EXEC).eq('reason','execution_partial_refund');
  console.log('cost_by_node:', debit?.metadata?.cost_by_node);
  console.log('partial refunds:', refunds);
  // Manually confirm each refund.amount === cost_by_node[node_id] / iterations,
  // and each idempotency_key is unique (no duplicates).
})();
```

Expected: refund amount matches the per-iteration share; one ledger row per failed iteration. Delete the script after.

- [ ] **Step 5: Commit**

```bash
git add app/api/webhooks/replicate-v2/route.ts
git commit -m "feat(billing): refund a failed fan-out iteration's share of the debit"
```

---

## Task 4: Store — `partialIterationResults` map

**Files:**
- Modify: [lib/store/types.ts](../../../lib/store/types.ts) (ExecutionSlice interface, ~line 350-365)
- Modify: [lib/store/slices/execution-slice.ts](../../../lib/store/slices/execution-slice.ts)

Add a map keyed by `nodeId` holding the in-flight iteration outcomes for one execution, accumulated in arrival (completion) order. Successful predictions carry their renderable media; failed ones carry an error marker. Re-applying the same `prediction_index` updates in place (webhook retries don't duplicate). A new execution for the same node replaces the entry.

- [ ] **Step 1: Add the types**

In [lib/store/types.ts](../../../lib/store/types.ts), add near the top-level type exports (above the `ExecutionSlice` interface):

```typescript
import type { RenderableMediaItem } from '@/lib/workflow/result-format';

/** One iteration's outcome while a fan-out ai_generator node is still running. */
export interface PartialIterationItem {
    index: number;
    status: 'completed' | 'failed';
    /** Renderable media for a completed iteration; empty for a failed one. */
    media: RenderableMediaItem[];
}

/** Per-node accumulator of streaming iteration results for the active run. */
export interface PartialIterationEntry {
    executionId: string;
    /** Outcomes in arrival (completion) order. */
    items: PartialIterationItem[];
}
```

(If `lib/store/types.ts` already imports from other `@/lib` modules, keep imports grouped at the top; do not import `RenderableMediaItem` twice.)

Then inside the `ExecutionSlice` interface (where `setNodeOutput`, `clearNodeOutputs` etc. are declared, ~lines 355-364), add:

```typescript
    partialIterationResults: Record<string, PartialIterationEntry>;
    addPartialIterationResult: (
        nodeId: string,
        executionId: string,
        item: PartialIterationItem,
    ) => void;
    clearPartialIterationResults: (nodeId: string) => void;
```

- [ ] **Step 2: Implement in the slice**

In [lib/store/slices/execution-slice.ts](../../../lib/store/slices/execution-slice.ts), add `partialIterationResults: {},` to the initial state (next to `nodeOutputs: {},` at line 9), then add the two actions (e.g. after `clearNodeOutputs` at line 93):

```typescript
    addPartialIterationResult: (nodeId, executionId, item) =>
        set((state) => {
            const prev = state.partialIterationResults[nodeId];
            // A new execution for this node supersedes any stale partials.
            const base: PartialIterationEntry =
                prev && prev.executionId === executionId
                    ? prev
                    : { executionId, items: [] };
            // Update in place if this prediction_index already arrived (webhook
            // retry); otherwise append in arrival (completion) order.
            const existingIdx = base.items.findIndex((it) => it.index === item.index);
            const items =
                existingIdx >= 0
                    ? base.items.map((it, i) => (i === existingIdx ? item : it))
                    : [...base.items, item];
            return {
                partialIterationResults: {
                    ...state.partialIterationResults,
                    [nodeId]: { executionId, items },
                },
            };
        }),

    clearPartialIterationResults: (nodeId) =>
        set((state) => {
            if (!state.partialIterationResults[nodeId]) return state;
            const next = { ...state.partialIterationResults };
            delete next[nodeId];
            return { partialIterationResults: next };
        }),
```

Add the `PartialIterationEntry` import at the top of the slice file:

```typescript
import { RootState, ExecutionSlice, PartialIterationEntry } from '../types';
```

- [ ] **Step 3: Clear partials in the existing wipe paths**

So stale partials never linger, also delete a node's entry in `cleanupNodeMetadata` and `invalidateNodes` (both already wipe per-node maps at [execution-slice.ts:95-137](../../../lib/store/slices/execution-slice.ts#L95)). In `cleanupNodeMetadata`, alongside `delete newStatuses[nodeId];` etc., add handling; simplest is to also spread+delete from `partialIterationResults`. Add to `cleanupNodeMetadata`:

```typescript
        const newPartials = { ...get().partialIterationResults };
        delete newPartials[nodeId];
```

and include `partialIterationResults: newPartials,` in its `set({...})`. Do the analogous addition in `invalidateNodes` (loop `delete newPartials[id]` over `nodeIds`).

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/store/types.ts lib/store/slices/execution-slice.ts
git commit -m "feat(store): partialIterationResults accumulator for streaming iterations"
```

---

## Task 5: Subscribe to `node_predictions` + clear on finalize

**Files:**
- Modify: [lib/hooks/use-execution-channel.ts](../../../lib/hooks/use-execution-channel.ts)

Add a second `postgres_changes` handler (on the same channel) for `node_predictions`. On each `completed`/`failed` row, convert its `result_data` into renderable media and push a `PartialIterationItem` into the store. RLS already scopes received rows to the user; display gating by `activeExecutionId` happens in Task 6, so the handler stores everything it receives. Also: when a `node_results` row finalizes (`completed`/`failed`), clear that node's partials so the grid switches to the canonical aggregated output without double-counting.

- [ ] **Step 1: Add a partials handler**

In [lib/hooks/use-execution-channel.ts](../../../lib/hooks/use-execution-channel.ts), add a function near `applyNodeResult`:

```typescript
function applyPredictionResult(record: any) {
    const store = useAppStore.getState();
    const { node_id: nodeId, execution_id: executionId, prediction_index: index, status, result_data: resultData } = record;
    if (!nodeId || !executionId || typeof index !== 'number') return;

    if (status === 'completed') {
        const type = inferResultTypeFromValue(resultData);
        const media = extractRenderableMedia(toOutputEnvelope(type, coerceResultDataArray(resultData ?? [])))
            .filter((m) => m.type === 'image' || m.type === 'video');
        store.addPartialIterationResult(nodeId, executionId, { index, status: 'completed', media });
    } else if (status === 'failed') {
        store.addPartialIterationResult(nodeId, executionId, { index, status: 'failed', media: [] });
    }
    // 'pending' rows carry no result yet — ignore.
}
```

Update the imports at the top of the file to include the helpers used (extend the existing import from `@/lib/workflow/result-format`):

```typescript
import { coerceResultDataArray, extractRenderableMedia, inferResultTypeFromValue, normalizeNodeResultType, toOutputEnvelope } from '@/lib/workflow/result-format';
```

- [ ] **Step 2: Clear partials when the node finalizes**

In `applyNodeResult`, in BOTH the `status === 'completed'` and `status === 'failed'` branches, after updating node status/output, clear the node's partials so the canonical result is the only source afterward. Add this line at the end of the `completed` branch (after the `appendAiGeneratorRun` block) and at the end of the `failed` branch:

```typescript
        store.clearPartialIterationResults(nodeId);
```

- [ ] **Step 3: Wire the subscription**

In the `buildChannel` factory ([use-execution-channel.ts:195-207](../../../lib/hooks/use-execution-channel.ts#L195)), chain a second `.on(...)` for `node_predictions` onto the channel:

```typescript
        const buildChannel = () =>
            supabase
                .channel(`session_results_${sessionId}`)
                .on(
                    'postgres_changes',
                    { event: '*', schema: 'public', table: 'node_results' },
                    handleResultChange
                )
                .on(
                    'postgres_changes',
                    { event: '*', schema: 'public', table: 'node_predictions' },
                    (payload: any) => {
                        const record = payload.new;
                        if (record) applyPredictionResult(record);
                    }
                );
```

(`hydrateFromDb` does not need a predictions catch-up: any partial missed during the subscribe window is reconciled when the node's `node_results` row finalizes and the canonical output replaces partials.)

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS. Confirm `extractRenderableMedia`, `toOutputEnvelope`, `coerceResultDataArray`, `inferResultTypeFromValue` are all exported from `@/lib/workflow/result-format` (they are used elsewhere in this file / `InlineRunResults`).

- [ ] **Step 5: Commit**

```bash
git add lib/hooks/use-execution-channel.ts
git commit -m "feat(realtime): stream node_predictions into partial results; clear on finalize"
```

---

## Task 6: Render streaming cells in the chat grid

**Files:**
- Modify: [components/chat/RunMediaGallery.tsx](../../../components/chat/RunMediaGallery.tsx)
- Modify: [components/chat/InlineRunResults.tsx](../../../components/chat/InlineRunResults.tsx)

Teach the gallery to render an ordered list of cells (each `media` or `error`), padded with skeletons to `skeletonCount`. `InlineRunResults` builds those cells: for a terminal that has finalized to `success`, from its canonical `nodeOutputs`; for a terminal still running, from its `partialIterationResults` entry (only when its `executionId` matches the active run). Successes render as image/video tiles in completion order, failures as error tiles, the rest as skeletons.

- [ ] **Step 1: Add a `cells` prop to RunMediaGallery**

In [components/chat/RunMediaGallery.tsx](../../../components/chat/RunMediaGallery.tsx), add an exported cell type and an optional `cells` prop that supersedes `items` for cell content:

```typescript
export type GalleryCell =
    | { kind: 'media'; item: RenderableMediaItem }
    | { kind: 'error' };
```

Extend `RunMediaGalleryProps` with:

```typescript
    /** Ordered cells (media | error). When provided, supersedes `items` for cell
     *  content; the grid still pads to `skeletonCount` with skeletons. Used by the
     *  live run to interleave streamed successes and failed-iteration tiles. */
    cells?: GalleryCell[];
```

In the component body, derive a normalized base array and use it for layout + lightbox. Replace the `list`/`total`/`lightboxMedia` derivation (currently [RunMediaGallery.tsx:44-57](../../../components/chat/RunMediaGallery.tsx#L44)) so it honors `cells` when present:

```typescript
    const base: GalleryCell[] =
        cells && cells.length > 0
            ? cells
            : (Array.isArray(items) ? items : [])
                  .filter((i) => i && typeof i.url === 'string' && i.url.length > 0)
                  .map((item) => ({ kind: 'media', item }));

    const total = Math.max(base.length, skeletonCount, 1);

    // Lightbox spans only the media cells (errors/skeletons aren't openable).
    const mediaCells = base.filter((c): c is { kind: 'media'; item: RenderableMediaItem } => c.kind === 'media');
    const lightboxMedia = mediaCells.map((c) => ({ url: c.item.url }));
```

Update the cell render loop ([RunMediaGallery.tsx:143-161](../../../components/chat/RunMediaGallery.tsx#L143)) to switch on the cell kind. The lightbox index must map to the media-only list, so compute each media cell's position among media cells:

```typescript
                {Array.from({ length: total }).map((_, i) => {
                    const cell = base[i];
                    if (!cell) {
                        return (
                            <div
                                key={`sk-${i}`}
                                className="w-full rounded-xl border border-stroke-subtle/40 bg-surface-tertiary/40 animate-pulse"
                                style={{ aspectRatio: '3 / 2' }}
                            />
                        );
                    }
                    if (cell.kind === 'error') {
                        return (
                            <div
                                key={`err-${i}`}
                                className="grid w-full place-items-center rounded-xl border border-red-500/30 bg-red-500/5 text-red-400/80"
                                style={{ aspectRatio: '3 / 2' }}
                                title="This image failed to generate and was refunded."
                            >
                                <ImageOff className="h-5 w-5" />
                            </div>
                        );
                    }
                    const mediaIndex = mediaCells.indexOf(cell);
                    return (
                        <MediaTile
                            key={`${cell.item.url}-${i}`}
                            item={cell.item}
                            onOpen={() => setLightboxIndex(mediaIndex)}
                        />
                    );
                })}
```

Add `ImageOff` to the lucide import at the top: `import { Maximize2, ImageOff } from 'lucide-react';`. (`MediaTile` is unchanged.)

- [ ] **Step 2: Build cells in InlineRunResults**

Rewrite [components/chat/InlineRunResults.tsx](../../../components/chat/InlineRunResults.tsx) to assemble `GalleryCell[]` from canonical (success) and partial (running) terminals:

```typescript
'use client';

import { useMemo } from 'react';
import { useAppStore } from '@/lib/store/app-store';
import { extractRenderableMedia } from '@/lib/workflow/result-format';
import { RunMediaGallery, type GalleryCell } from './RunMediaGallery';

interface InlineRunResultsProps {
    terminalIds: string[];
    isCanvasMode?: boolean;
    /** Expected media count for this run (Σ terminal iterations). Sets how many
     *  skeleton tiles the grid shows up front; falls back to the terminal count. */
    expectedResultCount?: number;
}

export function InlineRunResults({ terminalIds, isCanvasMode, expectedResultCount }: InlineRunResultsProps) {
    const nodeOutputs = useAppStore((s) => s.nodeOutputs);
    const nodeStatuses = useAppStore((s) => s.nodeStatuses);
    const partials = useAppStore((s) => s.partialIterationResults);
    const activeExecutionId = useAppStore((s) => s.activeExecutionId);

    // Assemble ordered cells across terminals. A finalized ('success') terminal
    // contributes its canonical media; a still-running terminal contributes its
    // streamed per-iteration outcomes (completion order) — successes as media,
    // failures as error tiles. Partials are only trusted for the active run so a
    // stale prior run's leftovers never show.
    const cells = useMemo(() => {
        const out: GalleryCell[] = [];
        for (const id of terminalIds) {
            if (nodeStatuses?.[id] === 'success') {
                for (const m of extractRenderableMedia(nodeOutputs?.[id])) {
                    if (m.type === 'image' || m.type === 'video') out.push({ kind: 'media', item: m });
                }
                continue;
            }
            const entry = partials?.[id];
            if (entry && (!activeExecutionId || entry.executionId === activeExecutionId)) {
                for (const it of entry.items) {
                    if (it.status === 'failed') {
                        out.push({ kind: 'error' });
                    } else {
                        for (const m of it.media) out.push({ kind: 'media', item: m });
                    }
                }
            }
        }
        return out;
    }, [terminalIds, nodeOutputs, nodeStatuses, partials, activeExecutionId]);

    const skeletonCount = Math.max(1, expectedResultCount ?? terminalIds.length);
    return (
        <div className="mt-2">
            <RunMediaGallery
                cells={cells}
                isCanvasMode={isCanvasMode}
                skeletonCount={skeletonCount}
            />
        </div>
    );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS. (`RunMediaGallery` still accepts `items` for the frozen-result caller in `Message.tsx`; `InlineRunResults` now passes `cells` instead.)

- [ ] **Step 4: Verify the frozen-result path still compiles**

Confirm the other `RunMediaGallery` usage in [components/chat/Message.tsx:17](../../../components/chat/Message.tsx#L17) still passes `items` (unchanged) — the `cells` prop is optional and additive, so that caller is unaffected. No edit needed; just confirm via the passing `tsc`.

- [ ] **Step 5: Commit**

```bash
git add components/chat/RunMediaGallery.tsx components/chat/InlineRunResults.tsx
git commit -m "feat(chat): stream iteration results into the grid (success + error cells)"
```

---

## Task 7: Manual in-app E2E

**Files:** none (verification only)

No automated runner exists, so validate behavior in the running app.

- [ ] **Step 1: Start the app**

Run: `npm run dev` and open the chat.

- [ ] **Step 2: Concurrent + streaming happy path**

Ask the chat to generate with an `ai_generator` node set to `iterations = 4`. Expected:
- Images pop into the grid **one at a time in completion order** (not all at once at the end).
- Skeletons shrink as each lands; total tiles = 4 throughout.
- When the node finalizes, the grid shows the same 4 images (no flicker/dup) — partials were replaced by the canonical output.

- [ ] **Step 3: Partial-failure path**

Force one iteration to fail (e.g. a model/input that intermittently errors, or temporarily make one prediction fail). Expected:
- The 3 successes still stream in; the failed slot shows the red error tile.
- The node completes (partial success), not a whole-node failure.
- A `execution_partial_refund` row appears in `token_ledger` for that execution with amount = per-iteration cost; balance increases accordingly.

- [ ] **Step 4: Clean up throwaway scripts**

Run: delete `scripts/verify-node-predictions-realtime.js` and `scripts/verify-partial-refund.js` if they were created.

```bash
git add -A
git commit -m "chore: remove throwaway verification scripts"
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** Part 1 (concurrent) → Task 2. Part 2 (streaming via node_predictions realtime) → Tasks 1, 4, 5, 6. Part 3 (failure UX + refund) → Tasks 3, 6. Verification → Task 7.
- **Out of scope (do not implement):** per-iteration streaming *into downstream consumer nodes* — children still dispatch once at finalize; `finalizeFanOutIfReady` is unchanged.
- **Naming consistency:** the slice actions are `addPartialIterationResult` / `clearPartialIterationResults`; the map is `partialIterationResults`; the gallery prop is `cells` of type `GalleryCell[]`. Use these exact names across tasks.
- **Don't touch** `finalizeFanOutIfReady`, the aggregation/claim logic, or `expectedResultCount` (run-plan) — they already do the right thing.
