# AI Node Iterations & Multi-Output Navigation — Design

**Date:** 2026-05-23
**Status:** Approved (pending spec review)
**Branch:** `feat/model-media-cost-live-credits`

## Summary

Add three capabilities to every AI generator node:

1. **Iterations** — a per-node count (default 1) that fans a single run out into N independent generations. Cost is `per-run cost × iterations`, shown live. The chat brain (LLM) can set it like any other control.
2. **Multi-output navigation** — every output the node has ever produced is kept in a flat, newest-first collection. A single view with hover arrows steps through it; a grid view (mirroring the `media_input` node) shows all at once. The user selects one output as **the** output; the selected item is what flows downstream.
3. **Run accumulation** — each new run appends its results to the collection rather than replacing the previous output. The newest result shows on front; older results remain navigable.

Videos behave identically to images. Text/prompt outputs use the same model with a stacked-list multi-view instead of a grid.

## Goals / Non-Goals

**Goals**
- Iterations control in the **properties panel only** (never on the node face), default 1, AI-accessible.
- Live cost = `computeAiNodeCost(...) × iterations`.
- Persistent, navigable collection of all outputs per node, with one user-selectable active output.
- Selecting an output updates the node's downstream value only — **no** automatic re-run of downstream nodes.

**Non-Goals**
- No two-axis (run × iteration) navigation UI. Outputs are one flat list.
- No run-history sidebar/strip.
- No automatic downstream re-execution on selection change.
- No change to how downstream nodes *consume* a parent value (we reuse the existing `last_output` path).

## Key Decisions (from brainstorming)

| Question | Decision |
| --- | --- |
| Iteration mechanism | **N separate Replicate predictions** per run (true variety, works for all models). Not the model's native `num_outputs`. |
| Cost scope | `N × this node's per-run cost` only. Other nodes unaffected. |
| Selecting an output | **Updates the value only**; downstream is not auto-re-run. |
| Text/prompt multi-view | Hover **arrows + vertical stacked list** (grid analog for text). |
| Iterations slider location | **Properties panel only**, not the node face. |
| Max iterations | Cap at **8** (clamped in UI and re-validated server-side). |

## Data Model

Node config (`AIGeneratorConfig` in [lib/nodes/plugins/ai_generator/definition.ts](lib/nodes/plugins/ai_generator/definition.ts)) gains:

```ts
export interface AIGeneratorConfig {
  model_id?: number;
  node_type_id?: string;
  control_values?: Record<string, any>;
  last_output?: any;          // existing — kept in sync with the selected output (preview/hydration)

  iterations?: number;        // NEW (Plan B): default 1, clamped 1..8
  outputs?: GeneratedOutput[];// NEW (Plan A): flat collection, newest-first
  selected_output_index?: number; // NEW (Plan A): index into `outputs`; default 0 (newest)
}

interface GeneratedOutput {
  type: NodeResultType;       // 'image' | 'video' | 'text' | ...
  value: any;                 // url for media, string for text
  execution_id?: string;      // which run produced it
  created_at?: string;        // ISO timestamp, for ordering/labels
}
```

- `iterations` lives at config level — it is **never** placed into `control_values` and is **never** sent to the model.
- `last_output` is kept in sync with the selected output and is what the **preview/hydration** path reads (`component.tsx` falls back to `data.config.last_output`).

### Downstream consumption (corrected)

The original assumption — "writing `config.last_output` is enough for the selection to flow downstream" — is **false**. Downstream input-building reads **only** from the `node_results` table:
- In-execution parents: `buildInputsFromParents` (orchestrator) reads `node_results` scoped by `execution_id`.
- Out-of-execution generative ancestors: `app/api/executions/start/route.ts` pre-fetches the latest completed `node_results` row per ancestor (session-scoped) and embeds it in `graph_json.preseedInputs`; `getPrimaryInputValue` takes the primary (index 0) value.

There is **no** code path that reads a parent's `config.last_output`/selection. So for "the selected image acts as the output" when a downstream node is run **without** re-running this node (the main case), the **preseed builder must prefer the parent's persisted selection**: when a generative ancestor's `config` has a `selected_output_index`/`outputs`, use `outputs[selected_output_index].value` as that ancestor's primary preseed value instead of `node_results[0]`. In-execution parents always re-run and auto-select newest, so they need no change. This preseed preference is the mechanism that makes selection flow downstream (no auto-rerun).

## Components & Changes

### 1. Iterations control — properties panel + cost
- **[lib/nodes/plugins/ai_generator/properties.tsx](lib/nodes/plugins/ai_generator/properties.tsx)**: add a slider/stepper bound to `config.iterations` (default 1, range 1–8). Clamp on input.
- **[lib/billing/cost.ts](lib/billing/cost.ts)**: multiply the computed AI node cost by `iterations` (read from config, clamped `>= 1`). Apply at the single pure-function boundary so client preview and server debit stay in sync. The properties footer and the node's run-button cost badge ([component.tsx](lib/nodes/plugins/ai_generator/component.tsx)) automatically reflect it because both call the same function.
- **Server authority**: the execution-start cost computation ([app/api/executions/start/route.ts](app/api/executions/start/route.ts)) must read the same `iterations` from the graph snapshot and apply the same multiplier, so the existing `COST_DRIFT_TOLERANCE` check still passes.

### 2. AI access (chat brain)
- **[lib/chat/prompt/registry-context.ts](lib/chat/prompt/registry-context.ts)**: inject a synthetic `iterations` descriptor (number, 1–8, default 1) into the control list exposed for every `ai_generator` model, so the LLM can set `config.iterations`. Document that it multiplies cost and produces N variations. (It is a config field, not a `control_values` entry — the workflow-patch / apply path must route it to `config.iterations`.)

### 3. Execution — N predictions per run
- **Dispatch** ([lib/workflow/dispatch-v2.ts](lib/workflow/dispatch-v2.ts)) / **orchestrator** ([lib/workflow/orchestrator.ts](lib/workflow/orchestrator.ts)): when an `ai_generator` node runs with `iterations = N`, create **N Replicate predictions**. The node is considered complete only when **all N** have returned; children dispatch after the last one.
  - The webhook ([app/api/webhooks/replicate-v2/route.ts](app/api/webhooks/replicate-v2/route.ts)) already upserts `node_results` per node; with N predictions we need each prediction's output collected into the node's result set rather than overwriting. **Implementation area to confirm during planning:** how `node_results` keys/accumulates N predictions for one `execution_id` + `node_id` (e.g. append into `result_data`, or track per-prediction rows and aggregate). The orchestrator's readiness check must wait for all N.

### 4. Output collection & navigation UI
- **[lib/nodes/plugins/ai_generator/component.tsx](lib/nodes/plugins/ai_generator/component.tsx)** (`OutputPreview`):
  - **Append, don't replace**: when new results arrive for the node, prepend them to `config.outputs` (newest first) and persist. **Implementation area to confirm during planning:** the exact client store hook where node results land (`nodeOutputs` in [lib/store/app-store.ts](lib/store/app-store.ts) / its realtime subscription) is where we append to `config.outputs`.
  - **Single view**: render `outputs[selected_output_index]`; show **hover arrows** (prev/next) that change `selected_output_index` across the whole collection. Reuse `BlurryImage` / `BlurryVideo`.
  - **Grid view**: toggle (Square / LayoutGrid) mirroring [media_input/component.tsx](lib/nodes/plugins/media_input/component.tsx); clicking a tile sets `selected_output_index` (Check + accent border). Fix the known gap: grid videos should use `BlurryVideo`, not raw `<video>`.
  - **Selection side-effect**: any change to `selected_output_index` persists via `updateNodeConfig` and writes `config.last_output = outputs[selected_output_index].value`. (Downstream flow is handled by the preseed preference above, not by `last_output`.)
- **Text/prompt outputs**: same component, but the multi-view is a **vertical stacked list** of text blocks (click to select) instead of an image grid; single view shows one text block with hover arrows.

## Data Flow

1. User sets `iterations = N` in properties (or LLM sets `config.iterations`). Cost badge/footer show `base × N` immediately.
2. Run starts → server recomputes cost with the same multiplier and debits → dispatch creates N predictions.
3. Each prediction completes via webhook; outputs collected for the node; orchestrator waits for all N, then dispatches children.
4. Client receives the N new outputs → prepends them to `config.outputs`, sets `selected_output_index = 0`, syncs `last_output`.
5. User browses via arrows (single) or grid; selecting a tile updates `selected_output_index` and `last_output` (persisted via `updateNodeConfig`). Downstream is **not** re-run; the selection takes effect the next time a downstream node runs, via the preseed preference.
6. A later run appends its outputs to the front of the same collection.

## Implementation split

This spec is delivered as two independently-shippable plans:

- **Plan A — Output navigation, selection & accumulation:** the `outputs` collection + `selected_output_index` data model, single-view hover arrows, grid/stacked-list multi-view, click-to-select, append-across-runs, persistence via `updateNodeConfig`, and the preseed preference that makes the selected output flow downstream. Works today with `iterations = 1` (models that already return multiple outputs, plus cross-run accumulation).
- **Plan B — Iterations:** the properties-panel iterations control, the cost multiplier (client + server), AI access, and the execution-engine fan-out (N separate predictions, a predictions-tracking mechanism, webhook accumulation, and an orchestrator "all N resolved" gate). Builds on Plan A's `outputs` collection.

## Edge Cases & Error Handling

- **Partial iteration failure**: if some of N predictions fail, append the successes, surface the failure count on the node, and still dispatch children once all predictions have resolved (success or error). Do not block children forever on a failed prediction.
- **Iterations clamp**: UI clamps to 1–8; server re-clamps. A value < 1 is treated as 1.
- **Empty collection**: node with no outputs renders the existing empty/placeholder state.
- **Selected index out of range** (e.g. after hydration): clamp to a valid index, default 0.
- **Cost drift**: server and client must apply the multiplier identically so `COST_DRIFT_TOLERANCE` (±5%) is not tripped.
- **Workflow size**: `config.outputs` stores URLs/strings + small metadata only (no blobs), keeping the workflow JSON bounded.

## Out of Scope / Future

- Deleting individual outputs from the collection, or a "clear history" action (could be added later, mirroring media_input's per-item delete).
- Per-run grouping/labels in the UI.
- Auto re-run of downstream on selection change.

## Open Implementation Areas (resolved during planning)

1. **N-prediction accumulation (Plan B):** `node_results` is unique on `(execution_id, node_id)` and the webhook upserts with `onConflict: 'execution_id,node_id'`, so a second prediction would **overwrite** the first. Resolution: track each prediction in its own row (a `node_predictions` table keyed by `execution_id, node_id, prediction_id`); the webhook updates the matching prediction row, and only when **no pending predictions remain** for the node does it aggregate all successful outputs into the single `node_results` row (status `completed`) and trigger `checkAndDispatchChildren`. Local-dev (`isLocal`) runs synchronously, so it loops N times and aggregates inline. Detailed in Plan B.
2. **Where new results append to `config.outputs` (Plan A):** node results land on the client in `applyNodeResult` ([lib/hooks/use-execution-channel.ts](lib/hooks/use-execution-channel.ts)) which calls `setNodeOutput`. Plan A appends to `config.outputs` (via `updateNodeConfig`) at the point a `completed` result is applied. Persistence flows through `updateNodeConfig` → `isWorkflowDirty` → `saveWorkflow` (`sessions.canvas_state`).
3. **Routing LLM-set `iterations` (Plan B):** `applyWorkflowPatch` shallow-merges `update.data.config`, so a top-level `data.config.iterations` is merged directly (no `control_values` nesting needed). The synthetic descriptor is injected in `registry-context.ts`.
