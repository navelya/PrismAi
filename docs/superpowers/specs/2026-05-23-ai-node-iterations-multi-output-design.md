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
  last_output?: any;          // existing — kept in sync with the selected output

  iterations?: number;        // NEW: default 1, clamped 1..8
  outputs?: GeneratedOutput[];// NEW: flat collection, newest-first
  selected_output_index?: number; // NEW: index into `outputs`; default 0 (newest)
}

interface GeneratedOutput {
  type: NodeResultType;       // 'image' | 'video' | 'text' | ...
  value: any;                 // url for media, string for text
  execution_id?: string;      // which run produced it
  created_at?: string;        // ISO timestamp, for ordering/labels
}
```

- `iterations` lives at config level — it is **never** placed into `control_values` and is **never** sent to the model.
- `last_output` continues to be the field the existing downstream/hydration path reads. On any selection change we write `config.last_output = outputs[selected_output_index].value` so consumers need no change.

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
  - **Selection side-effect**: any change to `selected_output_index` writes `config.last_output = outputs[selected_output_index].value`.
- **Text/prompt outputs**: same component, but the multi-view is a **vertical stacked list** of text blocks (click to select) instead of an image grid; single view shows one text block with hover arrows.

## Data Flow

1. User sets `iterations = N` in properties (or LLM sets `config.iterations`). Cost badge/footer show `base × N` immediately.
2. Run starts → server recomputes cost with the same multiplier and debits → dispatch creates N predictions.
3. Each prediction completes via webhook; outputs collected for the node; orchestrator waits for all N, then dispatches children.
4. Client receives the N new outputs → prepends them to `config.outputs`, sets `selected_output_index = 0`, syncs `last_output`.
5. User browses via arrows (single) or grid; selecting a tile updates `selected_output_index` and `last_output`. Downstream is **not** re-run.
6. A later run appends its outputs to the front of the same collection.

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

## Open Implementation Areas (resolve in planning, not new product decisions)

1. How N predictions for one node accumulate in `node_results` and how the orchestrator's all-complete check counts them.
2. The exact client store/realtime hook where new node results are appended to `config.outputs`.
3. How the workflow-patch/apply path routes an LLM-set `iterations` to `config.iterations` rather than `control_values`.
