# AI Node Iterations — Implementation Plan (Plan B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give every AI generator node an **iterations** count (default 1, range 1–8) in the properties panel. A run with iterations=N fires N independent generations, costs N× this node's per-run credit cost (shown live), is settable by the chat brain, and appends all N outputs to the node's collection (Plan A).

**Architecture:** `iterations` is a node-level config field (`config.iterations`), never sent to the model. Cost multiplies at the single `computeExecutionCost` boundary (client estimate + server debit stay in lockstep). Execution fans out into N separate Replicate predictions. In local dev (synchronous `replicate.run`) the N calls run in a loop and aggregate inline. In production (async webhooks) each prediction is tracked in a new `node_predictions` row; the webhook writes each prediction's mirrored output to its row and, once no predictions remain pending, aggregates all of them into the single `node_results` row and dispatches children — with a race-safe "single dispatcher" election. N=1 keeps the existing single-prediction path completely unchanged (zero regression surface).

**Tech Stack:** Next.js (App Router), React, Zustand, Supabase (Postgres + realtime), Replicate, TypeScript.

**Depends on:** Plan A (the `config.outputs` collection + `appendAiGeneratorRun`). Already merged on this branch.

---

## Testing & verification note (READ FIRST)

No test runner in this repo. Authoritative gate: `npx tsc --noEmit`. Do NOT trust `npm run lint`/`next build`. Each task has a manual checklist; treat it as the task's tests. The DB migration must be applied to the dev Supabase before the execution tasks can be manually verified (`supabase db push` or apply the SQL in the Supabase dashboard) — note this when handing off. Local dev (`npm run dev`, localhost) executes Replicate **synchronously** (no webhook); production uses async webhooks — so the fan-out has two code paths and both must be reasoned about.

**Commit after every task.** Branch: `feat/ai-node-iterations-multi-output` (current).

---

## File Structure

**Create:**
- `supabase/migrations/20260523_add_node_predictions.sql` — the per-prediction tracking table.

**Modify:**
- `lib/billing/cost.ts` — `clampIterations` helper + apply the iterations multiplier in `computeExecutionCost`.
- `lib/nodes/plugins/ai_generator/definition.ts` — add `iterations?: number` to `AIGeneratorConfig`.
- `lib/nodes/plugins/ai_generator/properties.tsx` — the iterations slider + multiplied cost in the footer.
- `lib/nodes/plugins/ai_generator/component.tsx` — multiply the node run-badge cost by iterations.
- `lib/chat/prompt/registry-context.ts` — expose `iterations` to the chat brain.
- `lib/workflow/dispatch-v2.ts` — fan-out dispatch (local loop + production N-prediction setup).
- `app/api/webhooks/replicate-v2/route.ts` — per-prediction aggregation path for fan-out runs.

---

## Task B1: `node_predictions` tracking table (migration)

**Files:**
- Create: `supabase/migrations/20260523_add_node_predictions.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260523_add_node_predictions.sql`:

```sql
-- Tracks each individual Replicate prediction of a fan-out run (iterations > 1).
-- One row per (execution_id, node_id, prediction_index). The webhook updates the
-- row matching the completed prediction's replicate_id, then aggregates all rows
-- for the node into node_results once none remain 'pending'. iterations <= 1 runs
-- do NOT use this table (legacy single-prediction path is unchanged).
CREATE TABLE IF NOT EXISTS public.node_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID NOT NULL REFERENCES public.executions(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  prediction_index INT NOT NULL,
  replicate_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | completed | failed
  result_data JSONB NOT NULL DEFAULT '[]'::jsonb,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (execution_id, node_id, prediction_index)
);

CREATE INDEX IF NOT EXISTS idx_node_predictions_exec_node
  ON public.node_predictions (execution_id, node_id);
CREATE INDEX IF NOT EXISTS idx_node_predictions_replicate
  ON public.node_predictions (replicate_id);

-- Server-only table (service-role webhook/dispatch). Enable RLS with no policies
-- so anon/authenticated clients are denied; the service role bypasses RLS.
ALTER TABLE public.node_predictions ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Apply it to the dev database**

Run: `npx supabase db push` (or paste the SQL into the Supabase SQL editor). If the Supabase CLI is not linked, apply via the dashboard. Confirm the table exists (e.g. `select * from node_predictions limit 1;` returns 0 rows, no error).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260523_add_node_predictions.sql
git commit -m "feat(ai-node): node_predictions table for iteration fan-out"
```

---

## Task B2: `iterations` config field + properties slider

**Files:**
- Modify: `lib/nodes/plugins/ai_generator/definition.ts` (`AIGeneratorConfig`)
- Modify: `lib/nodes/plugins/ai_generator/properties.tsx`

- [ ] **Step 1: Add the config field**

In `lib/nodes/plugins/ai_generator/definition.ts`, add to the `AIGeneratorConfig` interface (alongside the Plan A fields):

```ts
    /** Number of independent generations per run (1–8). Multiplies cost. Never sent to the model. */
    iterations?: number;
```

- [ ] **Step 2: Render the slider in the properties panel**

In `lib/nodes/plugins/ai_generator/properties.tsx`: the component already reads `config` and calls `onUpdate(nextConfig)` (see `handleControlChange`). The `AIGeneratorPropertiesProps.config` type lists known fields — add `iterations?: number` to that inline type (next to `model_id`, `control_values`, `ui_state`).

Then add an Iterations control. Place it in the scrollable body, AFTER the Model `Select` block and BEFORE the `{editMode && ...}` curation block (so it always shows when a model is selected). Insert:

```tsx
                {/* Iterations — node-level (not a model control); multiplies cost. */}
                {selectedModel && (
                    <div className="space-y-1">
                        <div className="flex items-center justify-between">
                            <label className="text-[8px] font-bold text-content-tertiary uppercase tracking-[0.1em] pl-0.5 leading-none opacity-80">
                                Iterations
                            </label>
                            <span className="text-[9px] font-mono font-semibold text-accent-primary tracking-tight tabular-nums">
                                {Math.min(Math.max(Number(config.iterations ?? 1), 1), 8)}×
                            </span>
                        </div>
                        <input
                            type="range"
                            min={1}
                            max={8}
                            step={1}
                            value={Math.min(Math.max(Number(config.iterations ?? 1), 1), 8)}
                            onChange={(e) => onUpdate({ ...config, iterations: parseInt(e.target.value, 10) })}
                            className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-accent-primary"
                        />
                        <div className="flex justify-between text-[8px] font-mono text-content-tertiary/40 tabular-nums px-0.5">
                            <span>1</span>
                            <span>8</span>
                        </div>
                    </div>
                )}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit` → clean.

- [ ] **Step 4: Manual verification**

`npm run dev`, open an ai_generator node's properties. The Iterations slider appears (1–8), defaults to 1, shows "N×", and persists across reload (it writes `config.iterations` via `onUpdate`).

- [ ] **Step 5: Commit**

```bash
git add lib/nodes/plugins/ai_generator/definition.ts lib/nodes/plugins/ai_generator/properties.tsx
git commit -m "feat(ai-node): iterations slider in properties panel"
```

---

## Task B3: Cost multiplier (client estimate + server debit)

**Files:**
- Modify: `lib/billing/cost.ts`
- Modify: `lib/nodes/plugins/ai_generator/properties.tsx` (footer cost)
- Modify: `lib/nodes/plugins/ai_generator/component.tsx` (run-badge cost)

- [ ] **Step 1: Add `clampIterations` and apply it in `computeExecutionCost`**

In `lib/billing/cost.ts`, add an exported helper near the top (after the `CostGraphContext` interface):

```ts
/** Iterations are clamped to [1, 8]; non-numeric/empty → 1. Multiplies a node's cost. */
export function clampIterations(value: any): number {
    const n = Math.trunc(Number(value));
    if (!Number.isFinite(n)) return 1;
    return Math.max(1, Math.min(8, n));
}
```

Then in `computeExecutionCost`, where each ai_generator node's cost is computed, multiply by its iterations. The current code is:

```ts
        let nodeCost = computeAiNodeCost(node.config?.control_values, model);

        if (graph) {
            nodeCost += computeConnectedInputCost(node, model, graph);
        }

        cost += Math.max(0, nodeCost);
        generativeCount++;
```

Change it to multiply the per-node cost by iterations (read from `node.config`):

```ts
        let nodeCost = computeAiNodeCost(node.config?.control_values, model);

        if (graph) {
            nodeCost += computeConnectedInputCost(node, model, graph);
        }

        nodeCost *= clampIterations(node.config?.iterations);

        cost += Math.max(0, nodeCost);
        generativeCount++;
```

(`CostNode.config` is typed with an index signature `[key: string]: any`, so `node.config?.iterations` is already valid.)

- [ ] **Step 2: Verify the server reads iterations from the snapshot**

In `app/api/executions/start/route.ts`, the `costNodes` mapping (the array passed to `computeExecutionCost`) currently copies `model_id` and `control_values` into each node's `config`. Add `iterations` so the server multiplier matches the client. Find:

```ts
        config: {
          model_id: inner.model_id ?? data.model_id,
          control_values: inner.control_values ?? data.control_values,
        },
```

(there are TWO such mappings — the `costNodes` map AND the `graphForCost.allNodes` map). In BOTH, add `iterations`:

```ts
        config: {
          model_id: inner.model_id ?? data.model_id,
          control_values: inner.control_values ?? data.control_values,
          iterations: inner.iterations ?? data.iterations,
          images: inner.images ?? data.images, // keep existing field if present in that mapping
        },
```

(Only add `images` where it already exists — the `graphForCost.allNodes` map has it; the `costNodes` map does not. Do not introduce `images` where it wasn't.)

- [ ] **Step 3: Multiply the two single-node display costs by iterations**

These are UI estimates (not the drift-checked value), but should match.

In `lib/nodes/plugins/ai_generator/properties.tsx`, the footer cost:

```ts
    const totalCost = selectedModel
        ? Number(computeAiNodeCost(config.control_values, selectedModel).toFixed(2))
        : 0;
```

becomes:

```ts
    const totalCost = selectedModel
        ? Number((computeAiNodeCost(config.control_values, selectedModel) * clampIterations(config.iterations)).toFixed(2))
        : 0;
```

Add `clampIterations` to the existing `import { computeAiNodeCost } from '@/lib/billing/cost';` line.

In `lib/nodes/plugins/ai_generator/component.tsx`, the run-badge cost:

```ts
                        const dynamicCost = computeAiNodeCost(data.config?.control_values, selectedModel);
```

becomes:

```ts
                        const dynamicCost = computeAiNodeCost(data.config?.control_values, selectedModel) * clampIterations(data.config?.iterations);
```

Add `clampIterations` to the existing `import { computeAiNodeCost, formatCredits } from '@/lib/billing/cost';` line.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit` → clean.

- [ ] **Step 5: Manual verification**

`npm run dev`. With an ai_generator node: set iterations to 3 → the properties footer cost and the node's Run-badge cost both show 3× the iterations=1 value. Set back to 1 → original cost. (Server parity is verified in B7 by actually running.)

- [ ] **Step 6: Commit**

```bash
git add lib/billing/cost.ts app/api/executions/start/route.ts lib/nodes/plugins/ai_generator/properties.tsx lib/nodes/plugins/ai_generator/component.tsx
git commit -m "feat(ai-node): iterations cost multiplier (client estimate + server snapshot)"
```

---

## Task B4: Expose `iterations` to the chat brain

**Files:**
- Modify: `lib/chat/prompt/registry-context.ts`

- [ ] **Step 1: Read first**

Open `lib/chat/prompt/registry-context.ts`. Find the ai_generator section that lists, per model, its `config keys (set inside data.config.control_values): ...`. Note that `control_values` keys are documented as nested under `data.config.control_values`, whereas `iterations` is a TOP-LEVEL `data.config` field. Confirm where the per-model lines are emitted (the loop the earlier exploration placed around the model list).

- [ ] **Step 2: Add an iterations instruction**

In the ai_generator section (once, not per-model — e.g. in the same place the section explains how to set `data.config` for ai_generator, near where `control_values` nesting is described), add a line telling the LLM about iterations. Add this sentence to that section's text:

```
`iterations` (integer 1–8, default 1): set at `data.config.iterations` (a TOP-LEVEL config field, NOT inside control_values). It runs the model that many times in one execution, producing that many output variations, and multiplies the node's credit cost by the same factor. Only raise it when the user explicitly wants multiple variations.
```

(Match the surrounding string-building style — if the file builds a template string array, push this as a line; if it interpolates, insert it into the ai_generator block. Keep it in the ai_generator-specific section so non-generative nodes aren't affected.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit` → clean.

- [ ] **Step 4: Manual verification**

Grep the built context or add a temporary `console.log` of the registry context for an ai_generator and confirm the iterations instruction appears once. (No model round-trip needed.)

- [ ] **Step 5: Commit**

```bash
git add lib/chat/prompt/registry-context.ts
git commit -m "feat(ai-node): expose iterations to the chat brain"
```

---

## Task B5: Fan-out dispatch (local loop + production N predictions)

**Files:**
- Modify: `lib/workflow/dispatch-v2.ts` (`dispatchReplicateNode`)

Context: `dispatchReplicateNode` currently calls `aiGeneratorExecutor(config, inputs, ctx)` ONCE. The executor returns `{ status: 'success', data }` for local synchronous runs (`replicate.run`) and `{ status: 'pending', data: { id } }` for production async runs (a created prediction). `updateNodeState(...,'completed', resultData)` triggers `checkAndDispatchChildren`; `updateNodeState(...,'running', replicate_prediction_id)` marks the node running.

- [ ] **Step 1: Read first**

Read `lib/workflow/dispatch-v2.ts` `dispatchReplicateNode` (and `updateNodeState`). Confirm: `config = nodeConfig.data.config || nodeConfig.data || {}`; the success branch builds `resultType`/`resultData` via `inferResultTypeFromValue` + `toResultDataForType`; the pending branch stores `replicate_prediction_id`. Confirm `inferResultTypeFromValue`, `toResultDataForType` are imported.

- [ ] **Step 2: Branch on iterations**

Replace the body of `dispatchReplicateNode` (the part after `const config = ...`) so that `iterations <= 1` keeps the EXACT current single-call behavior, and `iterations > 1` fans out. Add the import at the top of the file:

```ts
import { clampIterations } from '@/lib/billing/cost';
```

New body (keep the surrounding `try/catch` and signature):

```ts
    const config = nodeConfig.data.config || nodeConfig.data || {};
    const iterations = clampIterations(config.iterations);

    // ── iterations === 1: unchanged single-prediction path ──────────────────
    if (iterations <= 1) {
        const result = await aiGeneratorExecutor(config, inputs, {
            sessionId: sessionId || 'server-execution',
            executionId,
            nodeId,
            workflowId: executionId,
            data: nodeConfig.data,
        });
        if (!result.success) throw new Error(result.error || 'AI Generator Executor failed');

        if (result.status === 'success') {
            const rawData = result.data;
            const resultType = inferResultTypeFromValue(rawData);
            const resultData = toResultDataForType(resultType, rawData);
            await updateNodeState(executionId, nodeId, {
                status: 'completed',
                result_type: resultType,
                result_data: resultData,
                dispatched_at: new Date().toISOString(),
                completed_at: new Date().toISOString(),
            }, sessionId, baseUrl);
        } else {
            await updateNodeState(executionId, nodeId, {
                status: 'running',
                replicate_prediction_id: (result.data as any)?.id,
                dispatched_at: new Date().toISOString(),
            }, sessionId, baseUrl);
        }
        return { success: true, data: result.data };
    }

    // ── iterations > 1: fan out into N independent generations ───────────────
    const ctx = {
        sessionId: sessionId || 'server-execution',
        executionId,
        nodeId,
        workflowId: executionId,
        data: nodeConfig.data,
    };
    const results = [];
    for (let i = 0; i < iterations; i++) {
        results.push(await aiGeneratorExecutor(config, inputs, ctx));
    }

    const isLocalSync = results.some((r) => r.status === 'success');

    if (isLocalSync) {
        // Local dev: replicate.run returned outputs synchronously. Aggregate all
        // successful iterations into one result and complete the node.
        let resultType = 'json' as ReturnType<typeof inferResultTypeFromValue>;
        const aggregated: any[] = [];
        for (const r of results) {
            if (!r.success || r.status !== 'success') continue;
            const t = inferResultTypeFromValue(r.data);
            resultType = t;
            aggregated.push(...toResultDataForType(t, r.data));
        }
        if (aggregated.length === 0) throw new Error('All iterations failed');
        await updateNodeState(executionId, nodeId, {
            status: 'completed',
            result_type: resultType,
            result_data: aggregated,
            dispatched_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
        }, sessionId, baseUrl);
        return { success: true, data: aggregated };
    }

    // Production: each iteration created an async prediction. Track them in
    // node_predictions so the webhook can aggregate once all resolve. Mark the
    // node running first so the UI shows progress and the webhook has a row to
    // transition.
    await updateNodeState(executionId, nodeId, {
        status: 'running',
        dispatched_at: new Date().toISOString(),
    }, sessionId, baseUrl);

    const supabase = createServiceClient();
    const rows = results.map((r, i) => ({
        execution_id: executionId,
        node_id: nodeId,
        prediction_index: i,
        replicate_id: r.success ? (r.data as any)?.id ?? null : null,
        status: r.success ? 'pending' : 'failed',
        error: r.success ? null : (r.error || 'Prediction create failed'),
        updated_at: new Date().toISOString(),
    }));
    const { error: insErr } = await supabase
        .from('node_predictions')
        .upsert(rows, { onConflict: 'execution_id,node_id,prediction_index' });
    if (insErr) throw new Error(`Failed to record predictions: ${insErr.message}`);

    // If every iteration failed to even create, finalize as failed now.
    if (rows.every((r) => r.status === 'failed')) {
        await updateNodeState(executionId, nodeId, {
            status: 'failed',
            error: 'All iterations failed to start',
            completed_at: new Date().toISOString(),
        }, sessionId, baseUrl);
    }

    return { success: true, data: { iterations, pending: rows.filter((r) => r.status === 'pending').length } };
```

Add `import { createServiceClient } from '@/lib/supabase/service';` at the top if not already imported (it is used elsewhere in this file — confirm and reuse).

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit` → clean. (`results` element type comes from `aiGeneratorExecutor`'s `NodeExecutionResult`; if TS needs help, type it `const results: Awaited<ReturnType<typeof aiGeneratorExecutor>>[] = [];`.)

- [ ] **Step 4: Manual verification (LOCAL fan-out)**

`npm run dev` (localhost = synchronous). Set iterations=3 on an ai_generator node and run it. Expect: the node completes once, and the Plan A collection gains 3 new outputs (carousel shows 3, newest on front). Credits debited = 3× single cost (check balance). This exercises the `isLocalSync` path.

- [ ] **Step 5: Commit**

```bash
git add lib/workflow/dispatch-v2.ts
git commit -m "feat(ai-node): fan-out dispatch for iterations (local loop + production prediction tracking)"
```

---

## Task B6: Webhook aggregation for fan-out predictions

**Files:**
- Modify: `app/api/webhooks/replicate-v2/route.ts`

Context: The webhook receives one prediction completion at a time (`executionId`, `nodeId` from query; `id: predictionId`, `status`, `output`, `error` from body). For N=1 (no `node_predictions` rows) the existing path is unchanged. For fan-out, each prediction's webhook writes its mirrored output into its `node_predictions` row; the LAST one to resolve aggregates all rows into `node_results` and dispatches children.

- [ ] **Step 1: Read first**

Read `app/api/webhooks/replicate-v2/route.ts`. Note: the `succeeded` branch computes `outputType`, builds `resultData`, mirrors media via `mirrorMediaToStorage`, then upserts `node_results` (onConflict `execution_id,node_id`) and calls `checkAndDispatchChildren`. The `failed`/`canceled` branch upserts a failed `node_results`. Note `predictionId` is `body.id`.

- [ ] **Step 2: Add a fan-out discriminator + helpers**

After `const supabase = createServiceClient();` and the `executionCtx` fetch (after `predictionId` is known), add a lookup for this prediction's tracking row:

```ts
    // Fan-out (iterations > 1) tracks each prediction in node_predictions. If a
    // row exists for this prediction, take the aggregation path; otherwise the
    // legacy single-prediction path below runs unchanged.
    const { data: predRow } = await supabase
        .from('node_predictions')
        .select('id, prediction_index')
        .eq('execution_id', executionId)
        .eq('node_id', nodeId)
        .eq('replicate_id', predictionId)
        .maybeSingle();
    const isFanOut = !!predRow;
```

Add this helper function at module scope (near `resolveNodeOutputWireType`), which finalizes a fan-out node once all its predictions resolve, electing a single dispatcher via a conditional `node_results` transition:

```ts
async function finalizeFanOutIfReady(
    supabase: ReturnType<typeof createServiceClient>,
    executionId: string,
    nodeId: string,
    sessionId: string | null,
    outputType: NodeResultType,
    origin: string
): Promise<void> {
    // Any predictions still pending? If so, nothing to do yet.
    const { count: pendingCount } = await supabase
        .from('node_predictions')
        .select('id', { count: 'exact', head: true })
        .eq('execution_id', executionId)
        .eq('node_id', nodeId)
        .eq('status', 'pending');
    if ((pendingCount ?? 0) > 0) return;

    // All resolved. Gather successful outputs in prediction order.
    const { data: rows } = await supabase
        .from('node_predictions')
        .select('prediction_index, status, result_data')
        .eq('execution_id', executionId)
        .eq('node_id', nodeId)
        .order('prediction_index', { ascending: true });

    const aggregated: any[] = [];
    let anySuccess = false;
    for (const r of rows ?? []) {
        if (r.status === 'completed' && Array.isArray(r.result_data)) {
            aggregated.push(...r.result_data);
            anySuccess = true;
        }
    }

    // Elect a single dispatcher: transition node_results out of 'running' exactly
    // once. Concurrent final webhooks race here; only the row-returning update wins.
    const { data: claimed } = await supabase
        .from('node_results')
        .update({
            status: anySuccess ? 'completed' : 'failed',
            result_type: outputType,
            result_data: aggregated,
            error: anySuccess ? null : 'All iterations failed',
            updated_at: new Date().toISOString(),
        })
        .eq('execution_id', executionId)
        .eq('node_id', nodeId)
        .eq('status', 'running')
        .select('id');

    if (claimed && claimed.length > 0) {
        await checkAndDispatchChildren(executionId, nodeId, origin);
    }
}
```

- [ ] **Step 3: Route the succeeded branch**

Inside `if (status === 'succeeded') { ... }`, AFTER `resultData` is computed and mirrored (i.e. after the `mirrorMediaToStorage` block, at the point where the legacy code does the final `node_results` upsert), branch on `isFanOut`. Replace the final success upsert + dispatch with:

```ts
      if (isFanOut) {
        await supabase
          .from('node_predictions')
          .update({ status: 'completed', result_data: resultData, error: null, updated_at: new Date().toISOString() })
          .eq('id', predRow!.id);
        const { origin } = new URL(request.url);
        await finalizeFanOutIfReady(supabase, executionId, nodeId, sessionId, outputType, origin);
        return NextResponse.json({ success: true });
      }

      const { error: updateError } = await supabase.from('node_results').upsert(
        {
          execution_id: executionId,
          node_id: nodeId,
          session_id: sessionId,
          status: 'completed',
          result_type: outputType,
          result_data: resultData,
          replicate_id: predictionId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'execution_id,node_id' }
      );
      if (updateError) {
        return NextResponse.json({ error: 'Failed to update node_results' }, { status: 500 });
      }
      const { origin } = new URL(request.url);
      await checkAndDispatchChildren(executionId, nodeId, origin);
```

ALSO handle the two early failure exits inside the succeeded branch (the `mirrorMediaToStorage` catch, and the "still replicate-hosted url" guard). In BOTH, when `isFanOut`, mark THIS prediction failed and finalize instead of upserting node_results failed directly. Replace each of those two blocks' `node_results` failed-upsert + dispatch with:

```ts
        if (isFanOut) {
          await supabase
            .from('node_predictions')
            .update({ status: 'failed', error: '<same error string as before>', updated_at: new Date().toISOString() })
            .eq('id', predRow!.id);
          const { origin } = new URL(request.url);
          await finalizeFanOutIfReady(supabase, executionId, nodeId, sessionId, outputType, origin);
          return NextResponse.json({ success: true });
        }
        // ...existing legacy failed-upsert + dispatch + return unchanged below...
```

(Use the EXACT existing error strings: `Media upload to storage failed: ...` and `Media could not be permanently stored. Please re-run the node.` respectively. `outputType` is in scope in the succeeded branch.)

- [ ] **Step 4: Route the failed/canceled branch**

In the `else if (status === 'failed' || status === 'canceled')` branch, branch on `isFanOut`:

```ts
    } else if (status === 'failed' || status === 'canceled') {
      if (isFanOut) {
        await supabase
          .from('node_predictions')
          .update({ status: 'failed', error: predictionError || `Prediction ${status}`, updated_at: new Date().toISOString() })
          .eq('id', predRow!.id);
        // outputType is only computed in the succeeded branch; resolve it here for aggregation typing.
        const outType = await resolveNodeOutputWireType(supabase, executionCtx?.graph_json, nodeId);
        const { origin } = new URL(request.url);
        await finalizeFanOutIfReady(supabase, executionId, nodeId, sessionId, outType, origin);
        return NextResponse.json({ success: true });
      }
      // ...existing legacy failed-upsert + dispatch unchanged...
    }
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit` → clean.

- [ ] **Step 6: Manual verification (PRODUCTION fan-out)**

This path only runs when `NEXT_PUBLIC_APP_URL` is a public URL (async webhooks) — it cannot be exercised on plain localhost. Verify on a deployed/preview environment (or a tunnel) with the migration applied: set iterations=3, run, and confirm (a) three `node_predictions` rows are created, (b) the node stays "running" until all three webhooks arrive, (c) `node_results` then holds all 3 outputs and children dispatch exactly once, (d) the node's collection shows 3 new outputs. If a public env isn't available now, mark this step BLOCKED-for-env and rely on the B5 local path + code review; do not claim it verified.

- [ ] **Step 7: Commit**

```bash
git add app/api/webhooks/replicate-v2/route.ts
git commit -m "feat(ai-node): webhook aggregation for fan-out predictions (race-safe completion)"
```

---

## Task B7: Full verification + finalize

**Files:** none.

- [ ] **Step 1:** `npx tsc --noEmit` → clean.
- [ ] **Step 2:** `npx tsx scripts/check-ai-outputs.ts` → ALL ASSERTIONS PASSED (Plan A still green).
- [ ] **Step 3: Manual end-to-end (local):**
  - [ ] Iterations slider shows in properties only (NOT on the node face), 1–8, persists.
  - [ ] Cost badge + footer scale with iterations (N×).
  - [ ] Run with iterations=3 locally → node completes, collection gains 3 outputs (carousel navigates all), balance debited 3×.
  - [ ] iterations=1 behaves exactly as before (single output, unchanged path).
  - [ ] Chat brain: ask it to "make 4 variations" and confirm it sets `config.iterations` (inspect the node config).
- [ ] **Step 4:** Production fan-out (B6 Step 6) verified on a public env, or explicitly noted as env-blocked.
- [ ] **Step 5:** Commit any cleanup.

---

## Self-Review (plan author)

**Spec coverage (Plan B):** iterations control properties-only (B2) ✓; cost = N× via single boundary, client+server (B3) ✓; AI access (B4) ✓; N separate predictions (B5) ✓; predictions-tracking table + webhook aggregation + "all resolved" gate + race-safe single dispatch (B1, B6) ✓; append all N to collection — reuses Plan A `appendAiGeneratorRun` because `node_results` ends up with N items and the realtime `applyNodeResult` appends them (B5/B6) ✓; partial-failure handling (append successes, don't block children) (B5 local + B6 `finalizeFanOutIfReady`) ✓; clamp 1–8 client+server (`clampIterations`) ✓; N=1 unchanged (explicit legacy path) ✓.

**Placeholder scan:** Concrete code in every code step. The two webhook early-failure replacements reference "the same error string as before" — the exact strings are named explicitly in B6 Step 3.

**Type consistency:** `clampIterations` (cost.ts) used identically in cost.ts, properties.tsx, component.tsx, dispatch-v2.ts. `node_predictions` columns (`execution_id, node_id, prediction_index, replicate_id, status, result_data, error`) match across the migration, dispatch insert (B5), and webhook updates/aggregation (B6). `finalizeFanOutIfReady` signature matches its three call sites.

**Risk note:** B6 (production webhook) is the highest-risk task and can only be fully verified on a public-webhook environment; B5's local path makes iterations functional in dev immediately, and N=1 is provably unchanged.
