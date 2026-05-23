# Per-image/video model cost + instant optimistic credit balance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bill `ai_generator` models per connected image/video at an admin-set rate, and make the credit balance drop on run / pop back on failure instantly instead of after a DB round-trip.

**Architecture:** Add `cost_per_image`/`cost_per_video` columns to `ai_models`, surfaced in the admin Model form. Extend the single shared cost function (`lib/billing/cost.ts`) to add `units × rate` for media wired into a model's image/video input handles, counted from the **full graph** identically on client (estimate) and server (debit) so the 5% drift guard never trips. Add an ephemeral signed `optimisticCreditDelta` to the app-store that `useTokenBalance` adds to the authoritative balance, applied on run and reversed on failure (mirroring the orchestrator's whole-execution refund), reconciled to 0 on every realtime balance update.

**Tech Stack:** Next.js, TypeScript, Supabase (Postgres + realtime), Zustand.

**Testing note:** This repo has **no test runner** (per CLAUDE.md). Every task verifies with `npx tsc --noEmit` (the reliable check here — `npm run lint`/`build` are flaky) plus the manual check stated in the task. There are no unit-test steps.

---

### Task 1: DB columns + `AiModel` type

**Files:**
- Create: `supabase/migrations/20260523_add_media_input_cost_to_models.sql`
- Modify: `lib/nodes/types.ts` (AiModel interface, ~line 67)

- [ ] **Step 1: Write the migration**

```sql
-- Per-connected-media pricing for ai_generator models.
-- cost_per_image / cost_per_video are added to the run cost for each image/video
-- item wired into the model's image/video input handles. Default 0 = free (today's behavior).
ALTER TABLE public.ai_models
  ADD COLUMN IF NOT EXISTS cost_per_image NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_per_video NUMERIC NOT NULL DEFAULT 0;
```

- [ ] **Step 2: Apply the migration**

Run it against the live Supabase (this repo applies SQL directly — there is no migration CLI step wired up). Confirm in the Supabase SQL editor or via psql that `ai_models` now has both columns defaulting to 0.

- [ ] **Step 3: Add the fields to the `AiModel` interface**

In `lib/nodes/types.ts`, inside `export interface AiModel { ... }`, after the `credit_cost: number;` line add:

```ts
    credit_cost: number;
    /** Credits added per image item wired into this model's image input handles. */
    cost_per_image: number;
    /** Credits added per video item wired into this model's video input handles. */
    cost_per_video: number;
```

- [ ] **Step 4: Verify types**

Run: `npx tsc --noEmit`
Expected: no NEW errors referencing `cost_per_image`/`cost_per_video`. (`/api/models/list` uses `select('*')`, so the client store receives the columns automatically — no query change needed there.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260523_add_media_input_cost_to_models.sql lib/nodes/types.ts
git commit -m "feat(billing): add cost_per_image/cost_per_video columns to ai_models"
```

---

### Task 2: Persist the new fields through the admin model APIs

**Files:**
- Modify: `app/api/admin/models/route.ts` (POST, lines 10-22 and 31-44)
- Modify: `app/api/admin/models/[id]/route.ts` (PATCH, lines 12-24 and 28-42)

- [ ] **Step 1: POST — destructure and insert the new fields**

In `app/api/admin/models/route.ts`, add `cost_per_image`, `cost_per_video` to the destructure:

```ts
        const {
            replicate_model_id,
            display_name,
            category_id,
            node_type_id,
            archetype_id,
            credit_cost,
            cost_per_image,
            cost_per_video,
            is_active,
            inputs_schema,
            outputs_schema,
            provider_id,
            description
        } = body;
```

And in the `.insert({ ... })`, after `credit_cost: credit_cost || 0,` add:

```ts
                credit_cost: credit_cost || 0,
                cost_per_image: cost_per_image || 0,
                cost_per_video: cost_per_video || 0,
```

- [ ] **Step 2: PATCH — destructure and update the new fields**

In `app/api/admin/models/[id]/route.ts`, add the two keys to the destructure (after `credit_cost,`):

```ts
            credit_cost,
            cost_per_image,
            cost_per_video,
```

And in the `.update({ ... })`, after the existing `credit_cost:` line add (mirroring its `undefined`-guard pattern):

```ts
                credit_cost: credit_cost !== undefined ? Number(credit_cost) : undefined,
                cost_per_image: cost_per_image !== undefined ? Number(cost_per_image) : undefined,
                cost_per_video: cost_per_video !== undefined ? Number(cost_per_video) : undefined,
```

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/models/route.ts "app/api/admin/models/[id]/route.ts"
git commit -m "feat(admin): persist cost_per_image/cost_per_video on model create/update"
```

---

### Task 3: Admin Model form fields (conditional on image/video handles)

**Files:**
- Modify: `components/admin/ModelForm.tsx` (form state ~134-145, init effect ~165-176, submit ~432-438, Cost & Status section ~528-555)

- [ ] **Step 1: Add the fields to the `form` state initializer (line ~137)**

In the `useState({ ... })` at line 134, after `credit_cost: initialData?.credit_cost || 0,` add:

```ts
        credit_cost: initialData?.credit_cost || 0,
        cost_per_image: initialData?.cost_per_image || 0,
        cost_per_video: initialData?.cost_per_video || 0,
```

- [ ] **Step 2: Mirror them in the edit-mode reset effect (line ~168)**

In the `setForm({ ... })` inside the `if (initialData)` effect, after `credit_cost: initialData.credit_cost || 0,` add:

```ts
                credit_cost: initialData.credit_cost || 0,
                cost_per_image: initialData.cost_per_image || 0,
                cost_per_video: initialData.cost_per_video || 0,
```

- [ ] **Step 3: Pass them through on submit (line ~436)**

In `handleSubmit`'s `await onSubmit({ ... })`, after `credit_cost: Number(form.credit_cost),` add:

```ts
            credit_cost: Number(form.credit_cost),
            cost_per_image: Number(form.cost_per_image),
            cost_per_video: Number(form.cost_per_video),
```

- [ ] **Step 4: Derive handle-presence flags (just above the `return (` at line ~441)**

Add, right before `return (`:

```ts
    // Show per-image / per-video pricing only when the model actually declares a
    // matching input handle. `visualInputWires` is the form's live handle list.
    const hasImageInput = visualInputWires.some(w => (w.type || '').toLowerCase().includes('image'));
    const hasVideoInput = visualInputWires.some(w => (w.type || '').toLowerCase().includes('video'));
```

- [ ] **Step 5: Render the conditional fields in the Cost & Status section**

In the `<FormSection title="Cost & Status" ...>` block, change the inner row so the new inputs sit beside Credit Cost. Replace the existing `<div className="flex items-center gap-8">` opening through the `Credit Cost` `NumberInput` close with:

```tsx
                <div className="flex items-center gap-8 flex-wrap">
                    <NumberInput
                        label="Credit Cost"
                        name="credit_cost"
                        value={form.credit_cost}
                        onChange={e => setForm({ ...form, credit_cost: Number(e.target.value) })}
                        className="max-w-[150px]"
                        suffix={form.is_per_second ? "/s" : ""}
                    />
                    {hasImageInput && (
                        <NumberInput
                            label="Cost / connected image"
                            name="cost_per_image"
                            value={form.cost_per_image}
                            onChange={e => setForm({ ...form, cost_per_image: Number(e.target.value) })}
                            className="max-w-[170px]"
                            suffix="CR"
                        />
                    )}
                    {hasVideoInput && (
                        <NumberInput
                            label="Cost / connected video"
                            name="cost_per_video"
                            value={form.cost_per_video}
                            onChange={e => setForm({ ...form, cost_per_video: Number(e.target.value) })}
                            className="max-w-[170px]"
                            suffix="CR"
                        />
                    )}
```

(Leave the existing `<div className="pt-5 flex items-center gap-6">` Bill-Per-Second / Is-Active block and the closing tags unchanged.)

- [ ] **Step 6: Verify types**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Manual check**

Open the admin Models page, edit a model that has an image input handle → the "Cost / connected image" field appears; a text-only model shows neither. Set a value, save, reopen → value persists.

- [ ] **Step 8: Commit**

```bash
git add components/admin/ModelForm.tsx
git commit -m "feat(admin): per-image/video cost fields in Model form (shown when handle exists)"
```

---

### Task 4: Connected-media cost in the shared cost function

**Files:**
- Modify: `lib/billing/cost.ts`

- [ ] **Step 1: Add the graph-context type and media-counting helper**

After the `CostNode` interface (line ~20) add:

```ts
/**
 * Optional graph context for connected-media pricing. When supplied to
 * computeExecutionCost, each ai_generator node is additionally charged for the
 * image/video items wired into its media input handles. Counted from the FULL
 * graph (not the trimmed execution set) so the client estimate and the server
 * debit produce the same number and never trip COST_DRIFT_TOLERANCE.
 */
export interface CostGraphContext {
    /** Every node in the workflow — used to resolve each edge's source node. */
    allNodes: CostNode[];
    /** Every edge in the workflow. */
    edges: { source: string; target: string; targetHandle?: string | null }[];
}

/** Classify a handle's `type` string as image, video, or neither. */
function mediaKindOfHandleType(type: string | undefined | null): 'image' | 'video' | null {
    const t = (type || '').toLowerCase();
    if (t.includes('video')) return 'video';
    if (t.includes('image')) return 'image';
    return null;
}

/**
 * Count image/video items wired into a single ai_generator node's media input
 * handles. A media_input source contributes config.images.length items; any
 * other source contributes 1 per edge. Bucketed by the TARGET handle's type.
 */
function countConnectedMedia(
    node: CostNode,
    model: { inputs_schema?: AiModel['inputs_schema'] | null },
    graph: CostGraphContext
): { imageUnits: number; videoUnits: number } {
    // handle id -> media kind. The ai_generator node always declares a static
    // 'image' input handle in addition to the model's dynamic handles.
    const handleKind = new Map<string, 'image' | 'video'>();
    handleKind.set('image', 'image');
    for (const h of model.inputs_schema?.handles ?? []) {
        const kind = mediaKindOfHandleType((h as any).type);
        const key = (h as any).api_mapping_key;
        if (kind && key) handleKind.set(key, kind);
    }

    const nodeById = new Map(graph.allNodes.map(n => [n.id, n]));
    let imageUnits = 0;
    let videoUnits = 0;
    for (const edge of graph.edges) {
        if (edge.target !== node.id) continue;
        const kind = edge.targetHandle ? handleKind.get(edge.targetHandle) : undefined;
        if (!kind) continue;
        const source = nodeById.get(edge.source);
        let units = 1;
        if (source?.type === 'media_input') {
            const imgs = (source.config as any)?.images;
            units = Array.isArray(imgs) ? imgs.length : 0;
        }
        if (kind === 'image') imageUnits += units;
        else videoUnits += units;
    }
    return { imageUnits, videoUnits };
}
```

- [ ] **Step 2: Thread the optional graph through `computeExecutionCost`**

Change the signature and the per-node accumulation. Replace the `computeExecutionCost` function body's loop so it reads:

```ts
export function computeExecutionCost(
    nodes: CostNode[],
    modelsById: Map<number, AiModel>,
    graph?: CostGraphContext
): ExecutionCostResult {
    let cost = 0;
    let generativeCount = 0;
    const missingModels: number[] = [];

    for (const node of nodes) {
        if (node.type !== 'ai_generator') continue;

        const rawId = node.config?.model_id;
        const modelId = typeof rawId === 'string' ? Number(rawId) : rawId;
        if (!modelId || !Number.isFinite(modelId)) continue;

        const model = modelsById.get(modelId);
        if (!model) {
            missingModels.push(modelId);
            continue;
        }

        let nodeCost = computeAiNodeCost(node.config?.control_values, model);

        if (graph) {
            const { imageUnits, videoUnits } = countConnectedMedia(node, model, graph);
            const perImage = Number((model as any).cost_per_image ?? 0);
            const perVideo = Number((model as any).cost_per_video ?? 0);
            if (Number.isFinite(perImage) && perImage > 0) nodeCost += imageUnits * perImage;
            if (Number.isFinite(perVideo) && perVideo > 0) nodeCost += videoUnits * perVideo;
        }

        cost += Math.max(0, nodeCost);
        generativeCount++;
    }

    return {
        cost: Math.max(0, cost),
        generativeCount,
        missingModels,
    };
}
```

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: no new errors. (Existing two callers pass no `graph` arg yet — still valid because it's optional.)

- [ ] **Step 4: Commit**

```bash
git add lib/billing/cost.ts
git commit -m "feat(billing): add connected-image/video cost to computeExecutionCost"
```

---

### Task 5: Feed the graph context into the client estimate

**Files:**
- Modify: `components/editor/SharedWorkflowEditor.tsx` (`calculateExecutionCost`, lines ~474-501; import line for cost helpers)

- [ ] **Step 1: Build and pass the graph context**

In `calculateExecutionCost`, after the `const costNodes: CostNode[] = executionNodes.map(...)` block and before the `computeExecutionCost(...)` call, add an all-nodes/edges graph built from the FULL workflow (closed-over `nodes`/`edges`), then pass it:

```ts
        const costNodes: CostNode[] = executionNodes.map(n => ({
            id: n.id,
            type: n.type as string,
            config: (n.data as any)?.config,
        }));

        const graph = {
            allNodes: nodes.map(n => ({
                id: n.id,
                type: n.type as string,
                config: (n.data as any)?.config,
            })),
            edges: edges.map(e => ({
                source: e.source,
                target: e.target,
                targetHandle: e.targetHandle ?? null,
            })),
        };

        const { cost, generativeCount } = computeExecutionCost(costNodes, modelsById, graph);
        return { cost, count: generativeCount };
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: no new errors. (`CostGraphContext` is structurally satisfied by the inline object; no import needed beyond the existing `computeExecutionCost`/`CostNode` imports. If `CostNode` isn't already imported in this file, add it to the existing `@/lib/billing/cost` import.)

- [ ] **Step 3: Manual check**

With a model whose `cost_per_image=5`, wire a media_input holding 3 images into its image input. The Run-button cost popover / CreditConfirmModal estimate increases by 15 vs. the same graph with the media disconnected.

- [ ] **Step 4: Commit**

```bash
git add components/editor/SharedWorkflowEditor.tsx
git commit -m "feat(billing): include connected-media cost in client run estimate"
```

---

### Task 6: Feed the graph context into the server debit

**Files:**
- Modify: `app/api/executions/start/route.ts` (model select ~407; cost block ~385-414)

- [ ] **Step 1: Select the new columns when fetching models for cost**

At line ~405-408, change the select to include the pricing columns:

```ts
      const { data: modelRows } = await supabase
        .from('ai_models')
        .select('id, credit_cost, cost_per_image, cost_per_video, inputs_schema')
        .in('id', generativeNodeIds);
```

- [ ] **Step 2: Build the full-graph context and pass it to computeExecutionCost**

Immediately before `const result = computeExecutionCost(costNodes, modelsById);` (line ~413), build the graph from the FULL request graph. `executableNodes` is the full node list and `allEdges` the full edge list (both defined earlier in this handler). Insert:

```ts
      const graphForCost = {
        allNodes: executableNodes.map((n: any) => {
          const data = n.data || {};
          const inner = data.config || {};
          return {
            id: n.id,
            type: n.type,
            config: {
              model_id: inner.model_id ?? data.model_id,
              control_values: inner.control_values ?? data.control_values,
              images: inner.images ?? data.images,
            },
          };
        }),
        edges: allEdges.map((e: any) => ({
          source: e.source,
          target: e.target,
          targetHandle: e.targetHandle ?? null,
        })),
      };

      const result = computeExecutionCost(costNodes, modelsById, graphForCost);
```

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: no new errors. (Confirm `executableNodes` and `allEdges` are the in-scope identifiers for the full graph; if the handler names them differently, use those. Do NOT use `nodesToExecute`/`edgesToInclude` here — those are trimmed and would undercount media from out-of-set media_input nodes.)

- [ ] **Step 4: Manual check**

Run the Task-5 graph for real. Server log `[Execution/Start] Cost calc — total cost: N` matches the modal estimate (the run is NOT rejected for cost drift), and the debited amount equals base + 15.

- [ ] **Step 5: Commit**

```bash
git add app/api/executions/start/route.ts
git commit -m "feat(billing): charge connected-media cost in server debit (full-graph count)"
```

---

### Task 7: Optimistic credit fields in the app-store

**Files:**
- Modify: `lib/store/types.ts` (ExecutionSlice, lines 244-267)
- Modify: `lib/store/slices/execution-slice.ts`
- Modify: `lib/store/app-store.ts` (partialize filter ~96-135)

- [ ] **Step 1: Extend the `ExecutionSlice` type**

In `lib/store/types.ts`, inside `interface ExecutionSlice`, after `nodeErrors: Record<string, string>;` add the state, and after `invalidateNodes` add the actions:

```ts
    nodeErrors: Record<string, string>;
    /** Signed, ephemeral adjustment added to the authoritative balance for display.
     *  Negative while a run's debit is in flight; positive while a refund is in flight. */
    optimisticCreditDelta: number;
    /** In-flight optimistic charges, keyed by executionId. */
    pendingCharges: Record<string, { cost: number; nodeIds: string[] }>;
```

```ts
    invalidateNodes: (nodeIds: string[]) => void;
    applyOptimisticCharge: (executionId: string, cost: number, nodeIds: string[]) => void;
    settleOptimisticCharge: (executionId: string, failed: boolean) => void;
    resetOptimisticDelta: () => void;
}
```

- [ ] **Step 2: Implement them in the slice**

In `lib/store/slices/execution-slice.ts`, add the initial state after `nodeErrors: {},`:

```ts
    nodeErrors: {},
    optimisticCreditDelta: 0,
    pendingCharges: {},
```

And add these actions before the closing `});` of the slice:

```ts
    applyOptimisticCharge: (executionId, cost, nodeIds) =>
        set((state) => {
            if (!(cost > 0)) return state;
            return {
                optimisticCreditDelta: state.optimisticCreditDelta - cost,
                pendingCharges: {
                    ...state.pendingCharges,
                    [executionId]: { cost, nodeIds },
                },
            };
        }),

    settleOptimisticCharge: (executionId, failed) =>
        set((state) => {
            const rec = state.pendingCharges[executionId];
            if (!rec) return state;
            const nextCharges = { ...state.pendingCharges };
            delete nextCharges[executionId];
            return {
                // On failure, reverse the decrement so the balance pops back up
                // immediately. On success, leave the delta — the server's debit
                // realtime has (or will) reset it to 0 via resetOptimisticDelta.
                optimisticCreditDelta: failed
                    ? state.optimisticCreditDelta + rec.cost
                    : state.optimisticCreditDelta,
                pendingCharges: nextCharges,
            };
        }),

    resetOptimisticDelta: () => set({ optimisticCreditDelta: 0 }),
```

- [ ] **Step 3: Exclude the new fields from persistence**

In `lib/store/app-store.ts`, add to the `partialize` filter array (after `'nodeOutputs',`):

```ts
                    'nodeStatuses',
                    'nodeOutputs',
                    'optimisticCreditDelta',
                    'pendingCharges',
```

- [ ] **Step 4: Verify types**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add lib/store/types.ts lib/store/slices/execution-slice.ts lib/store/app-store.ts
git commit -m "feat(store): ephemeral optimistic credit delta + pending charges"
```

---

### Task 8: Surface the optimistic delta in `useTokenBalance`

**Files:**
- Modify: `lib/billing/use-balance.ts`

- [ ] **Step 1: Read the store delta and reconcile on authoritative updates**

Rewrite `use-balance.ts` to keep a raw authoritative balance in state, add the store delta for the returned value, and reset the delta whenever an authoritative value arrives:

```ts
'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAppStore } from '@/lib/store/app-store';

/**
 * Subscribes to the authenticated user's token_balance with realtime updates,
 * and overlays the store's ephemeral optimisticCreditDelta so the displayed
 * balance reflects an in-flight run instantly. Any authoritative update (initial
 * fetch or realtime) resets the optimistic delta to 0 — the server is then truth.
 */
export function useTokenBalance() {
    const [rawBalance, setRawBalance] = useState<number | null>(null);
    const [userId, setUserId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const optimisticDelta = useAppStore((s) => s.optimisticCreditDelta);
    const resetOptimisticDelta = useAppStore((s) => s.resetOptimisticDelta);

    useEffect(() => {
        const supabase = createClient();
        let unmounted = false;
        let channel: ReturnType<typeof supabase.channel> | null = null;

        (async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) {
                    if (!unmounted) setLoading(false);
                    return;
                }
                if (unmounted) return;
                setUserId(user.id);

                const { data: profile, error: fetchErr } = await supabase
                    .from('profiles')
                    .select('token_balance')
                    .eq('id', user.id)
                    .single();

                if (unmounted) return;
                if (fetchErr) {
                    setError(fetchErr.message);
                } else {
                    setRawBalance(Number(profile?.token_balance ?? 0));
                    resetOptimisticDelta();
                }
                setLoading(false);

                channel = supabase
                    .channel(`balance:${user.id}`)
                    .on(
                        'postgres_changes',
                        {
                            event: 'UPDATE',
                            schema: 'public',
                            table: 'profiles',
                            filter: `id=eq.${user.id}`,
                        },
                        (payload: { new: { token_balance?: number | string } }) => {
                            const next = payload.new?.token_balance;
                            if (next !== undefined && next !== null) {
                                setRawBalance(Number(next));
                                resetOptimisticDelta();
                            }
                        }
                    )
                    .subscribe();
            } catch (e: any) {
                if (!unmounted) {
                    setError(e?.message || 'Failed to load balance');
                    setLoading(false);
                }
            }
        })();

        return () => {
            unmounted = true;
            if (channel) channel.unsubscribe();
        };
    }, [resetOptimisticDelta]);

    const balance = rawBalance === null ? null : rawBalance + optimisticDelta;

    return { balance, userId, loading, error };
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/billing/use-balance.ts
git commit -m "feat(billing): overlay optimistic delta on displayed token balance"
```

---

### Task 9: Apply the optimistic charge on run + reverse on start failure

**Files:**
- Modify: `components/editor/SharedWorkflowEditor.tsx` (`commitExecution`, lines ~331-468)

- [ ] **Step 1: Apply the charge after node statuses are seeded**

In `commitExecution`, after the optimistic node-status seeding block (the `if (mode === 'selection') ... else { ... }` ending at line ~381) and before `const workflow = getCurrentWorkflow();`, compute the cost and record it with the exact node-id set that was just seeded:

```ts
        // Optimistic credit decrement — drop the balance the instant Run is
        // clicked, using the SAME estimate the modal shows. Reconciled to the
        // server's number when the debit realtime arrives (resetOptimisticDelta).
        const { cost: optimisticCost } = calculateExecutionCost(targetNodeId, mode, selectionIds);
        const chargedNodeIds = Object.entries(useAppStore.getState().nodeStatuses)
            .filter(([, s]) => s === 'running' || s === 'pending')
            .map(([id]) => id);
        if (optimisticCost > 0) {
            store.applyOptimisticCharge(executionId, optimisticCost, chargedNodeIds);
        }
```

(Note: `store` is the `useAppStore.getState()` captured at line ~336; `executionId` is the locally generated id at line ~337. `calculateExecutionCost` is defined later in the component but is in scope via closure at call time.)

- [ ] **Step 2: Reverse the charge if the start request fails**

In the `catch (err: any)` block (line ~435), after the node-status→error loop, add an optimistic refund (the run never dispatched, or the server will refund):

```ts
            setIsExecuting(false);
            store.settleOptimisticCharge(executionId, true);
```

Place it alongside the existing `setIsExecuting(false);` in that catch block (do not remove existing lines).

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual check**

Click Run on a paid graph → toolbar credits drop immediately (before any DB round-trip). Force a start failure (e.g. temporarily point the fetch at a bad URL, or run with insufficient balance to get 402) → credits return immediately.

- [ ] **Step 5: Commit**

```bash
git add components/editor/SharedWorkflowEditor.tsx
git commit -m "feat(billing): optimistic balance decrement on run, reverse on start failure"
```

---

### Task 10: Reverse the charge when a run settles in failure

**Files:**
- Modify: `components/editor/SharedWorkflowEditor.tsx` (add an effect near the other run-related hooks, e.g. after `runSelectionIds` at line ~518)

- [ ] **Step 1: Add a settle-detection effect**

This mirrors the orchestrator's whole-execution rule ([orchestrator.ts:286](../../../lib/workflow/orchestrator.ts#L286)): when none of a run's nodes are still `pending`/`running` and at least one is in `error`, the execution failed → optimistically refund. On all-success, just drop the bookkeeping record (no delta change). Add:

```ts
    const nodeStatusesForSettle = useAppStore((s) => s.nodeStatuses);
    const pendingChargesForSettle = useAppStore((s) => s.pendingCharges);
    useEffect(() => {
        for (const [execId, rec] of Object.entries(pendingChargesForSettle)) {
            const statuses = rec.nodeIds.map((id) => nodeStatusesForSettle[id]);
            const anyActive = statuses.some((s) => s === 'pending' || s === 'running');
            if (anyActive) continue; // still running — wait
            const anyFailed = statuses.some((s) => s === 'error');
            useAppStore.getState().settleOptimisticCharge(execId, anyFailed);
        }
    }, [nodeStatusesForSettle, pendingChargesForSettle]);
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Manual check**

Run a paid graph and force one node to fail (e.g. a model misconfig). When the node flips to its error badge and no node is still spinning, the credits pop back up immediately — before the server's refund realtime arrives. On a fully successful run, credits stay debited (no spurious refund) and converge to the server value.

- [ ] **Step 4: Commit**

```bash
git add components/editor/SharedWorkflowEditor.tsx
git commit -m "feat(billing): reverse optimistic charge when a run settles in failure"
```

---

## Self-review — spec coverage

- Per-image/video cost on the model — Tasks 1-3 (DB/type, APIs, form). ✔
- Per-uploaded-item counting, bucketed by handle type, full-graph on both sides — Task 4 (logic), Task 5 (client), Task 6 (server). ✔
- Fields shown only when an image/video handle exists — Task 3 Steps 4-5. ✔
- Estimate == debit (no drift rejection) — full-graph counting in Tasks 5 & 6 with the matching `MAX(0)`/per-node logic from Task 4; manual check in Task 6 Step 4. ✔
- Instant decrement on run — Task 9 Step 1. ✔
- Reverse on start failure — Task 9 Step 2. ✔
- Reverse on run-time failure mirroring the orchestrator — Task 10. ✔
- Reconcile to authoritative value, no double-count — Task 8 (`resetOptimisticDelta` on every authoritative update) + the success/failure traces in the spec. ✔
- Ephemeral, never persisted — Task 7 Step 3. ✔

Type consistency check: `applyOptimisticCharge(executionId, cost, nodeIds)`, `settleOptimisticCharge(executionId, failed)`, `resetOptimisticDelta()`, `optimisticCreditDelta`, `pendingCharges{ cost, nodeIds }`, `CostGraphContext{ allNodes, edges }` — names match across Tasks 4, 7, 8, 9, 10. ✔

## Risks / watch-points

- **Handle id ↔ `targetHandle` naming.** Task 4 classifies by matching `edge.targetHandle` to `api_mapping_key` (+ the static `'image'` id). If a model's edges use a different handle-id convention, the media won't be counted. Verify on a real graph in Task 6 Step 4; if mismatched, adjust the key used to build `handleKind`.
- **Full-graph identifiers on the server (Task 6).** Must use the untrimmed node/edge lists (`executableNodes`/`allEdges` or whatever the handler calls them), never `nodesToExecute`/`edgesToInclude`.
- **Concurrent executions.** `pendingCharges` is a per-execution map (forward-compatible), but the rest of the app assumes a single `activeExecutionId`; true concurrency is out of scope.
