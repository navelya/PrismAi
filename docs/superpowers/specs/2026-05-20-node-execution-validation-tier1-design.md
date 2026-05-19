# Node Execution Validation — Tier 1 (Pre-Flight Wiring Checks)

**Status:** Design approved, ready for implementation plan.
**Date:** 2026-05-20

## Problem

Today, clicking **Run** on a workflow with bad wiring (missing required input, wrong type, upstream with no cached data) silently submits the execution. The error only surfaces mid-run when a node executor receives bad inputs and throws — by which point credits may already be debited and the user has no clue *which* node was misconfigured. There is no pre-flight check.

We want a small, focused first pass that catches the three most common wiring problems before the `/api/executions/start` POST and surfaces them clearly on the canvas.

## Scope

### In scope (Tier 1 — graph wiring)

Three error kinds, all derivable from the workflow graph + cached node-result state, with no schema changes:

1. **`missing-required-input`** — an input handle marked `is_mandatory` / `isMandatory: true` has no edge connected to it.
2. **`no-upstream-data`** — an input handle has an edge, but in solo/chain runs the upstream node has never produced a completed result, so there is literally no data to feed in.
3. **`type-mismatch`** — an edge connects an output of one type to an input that doesn't accept it (rare in practice — `typesAreCompatible` runs at wire time — but possible in old saved workflows, after model schema changes, or for the dynamic `ai_generator`).

### Out of scope (deferred)

- **Tier 2** — required *config* fields (empty Prompt `text`, AI Generator with no model selected, Compositor with zero layers, Media Input with no asset).
- **Tier 3** — cycle detection, broken-chain / disconnected-target detection.
- **Tier 4** — cost ceiling and insufficient credits (already handled by the existing checks in `app/api/executions/start/route.ts`).
- **Live "as-you-edit" validation** — the per-node badge will naturally appear/disappear reactively as the user edits, but we are not adding new edit-time blocks, dialogs, or warnings. Validation *blocks* only at Run-click time.

## Architecture

A single pure validator, consumed by both client and server. The client renders surfaces (badges, popover) and blocks the Run click; the server is defense in depth — it returns 400 before debiting credits if a malformed POST slips through.

```
┌────────────────────────────────────────────┐
│ lib/workflow/validate-execution.ts         │
│   validateExecution({ workflow, runMode,   │
│     targetNodeId, completedNodeIds })      │
│   → ValidationError[]                      │
│                                            │
│ Pure. No I/O. No imports from              │
│ store/components/server.                   │
└──────────────┬─────────────────┬───────────┘
               │                 │
   ┌───────────▼───────┐   ┌─────▼──────────────────────┐
   │ Client            │   │ Server                     │
   │  - useExecution-  │   │  app/api/executions/start  │
   │    Validation()   │   │  calls validator after     │
   │  - per-node badge │   │  target set is built,      │
   │  - Run-button     │   │  returns 400 +             │
   │    popover        │   │  ValidationError[] body    │
   │  - commitExecution│   │  if non-empty              │
   │    blocks if !=0  │   │                            │
   └───────────────────┘   └────────────────────────────┘
```

## Validator contract

```ts
// lib/workflow/validate-execution.ts

export type ValidationError =
  | {
      kind: 'missing-required-input';
      nodeId: string;
      nodeLabel: string;
      inputId: string;
      inputLabel: string;
    }
  | {
      kind: 'no-upstream-data';
      nodeId: string;
      nodeLabel: string;
      inputId: string;
      inputLabel: string;
      sourceNodeId: string;
      sourceNodeLabel: string;
    }
  | {
      kind: 'type-mismatch';
      nodeId: string;
      nodeLabel: string;
      inputId: string;
      inputLabel: string;
      sourceNodeId: string;
      sourceHandleId: string;
      expectedType: string;
      actualType: string;
    };

export function validateExecution(args: {
  workflow: Workflow;
  runMode: 'all' | 'solo' | 'chain';
  targetNodeId: string | null;
  completedNodeIds: Set<string>;
}): ValidationError[];
```

### Rules

The validator first computes `executingNodes` — the subset of `workflow.nodes` that will actually run under the given `runMode` + `targetNodeId`:

- `all` → every non-`group_container` node.
- `solo` → `{ targetNodeId }`.
- `chain` → `targetNodeId` and all descendants reachable from it through the edge graph (excluding `group_container`).

For each `node ∈ executingNodes`, walk its **input handles** (from the shared registry; for `ai_generator`, from the model's `inputs_schema` resolved against the node's current `model_id`). For each input handle `h`:

1. Find the edge whose `target === node.id` and `targetHandle === h.id` (compositor special case: the per-layer `sourceHandleId` stored in the layer config is used to find the matching edge id).
2. **Missing required input** — if no such edge AND `h.isMandatory === true` → emit `missing-required-input`.
3. **Type mismatch** — if an edge exists, look up the source node and its output handle's `dataType`. If `typesAreCompatible(sourceDataType, h.expectedType)` (existing util in `lib/utils/handle-compatibility.ts`) is false → emit `type-mismatch`.
4. **No upstream data** — if an edge exists, the source node is NOT in `executingNodes` (so it won't be re-run as part of this execution), AND the source node is NOT in `completedNodeIds` → emit `no-upstream-data`.

Implication: in `runMode === 'all'`, `no-upstream-data` is impossible because every node is in `executingNodes`.

Errors are returned in stable order — outer iteration over `executingNodes` in their workflow array order, inner iteration over the input handles in their handle-array order. The UI relies on this for a deterministic hover list.

### Edge cases

- **Optional inputs (`isMandatory` falsy or absent)** — a missing edge is fine; skip. But if an edge exists and is the wrong type or points to a node with no cached data, the error still fires — connecting a wrong-typed input is never OK, and a connected-but-empty upstream is still a runtime bomb.
- **`group_container` nodes** — never validated (already filtered out by the start route at line 91). Treat as transparent.
- **`ai_generator` with no `model_id` selected** — the shared definition exposes no required handles in this state, so Tier 1 emits no error. The user gets a Tier 2 error later; for v1 they just see a generic runtime failure if they Run, same as today.
- **Compositor `layers` input** — each layer holds a `sourceHandleId` pointing to an edge id. We treat each populated layer as one "input slot" and apply rules 2/3/4 against the edge it references. A layer with no `sourceHandleId` is empty and skipped (compositors with zero layers fall under Tier 2).

## Client surfacing

### Hook

```ts
// lib/hooks/use-execution-validation.ts

export function useExecutionValidation(): {
  errors: ValidationError[];
  errorsByNode: Record<string, ValidationError[]>;
};
```

Subscribes to:
- `workflow` slice (for graph shape + node configs).
- `ui` slice's `runFromNodeId` + `runMode` (to know what *would* execute on Run click).
- `execution` slice's per-node statuses + result data (to derive `completedNodeIds` — any node whose latest result is `success` with usable output).

Reactively recomputes via a memoized selector when any of those change. Cheap — the validator is pure and the graphs are small.

### Per-node badge (always on)

In the shared canvas node renderer `lib/nodes/core/canvas/BaseNode.tsx` (all per-type renderers pass through it):

- Add a new optional prop `validationErrors?: ValidationError[]` (or pull from a context/hook directly inside `BaseNode` keyed by `id`).
- When non-empty, render a red exclamation badge in the top-right corner of the node body, distinct from the existing `badgeCount` chip.
- Hovering the badge opens a small tooltip (reuse the existing `components/ui/Tooltip`) listing the human messages from `formatValidationError`, one per line.
- Z-index above the node body, below modal overlays.

The badge shows regardless of `runMode` — if the user has the Solo Run button selected on this node, they see the badge there; if they're about to Run Workflow, badges appear on every offending node.

### Run Workflow button popover (workflow-run only)

In `components/editor/EditorToolbar.tsx`, on the Run Workflow button:

- When `errors.length > 0`, the button gets a red count badge ("3").
- Hovering the button opens a popover listing every error as `<NodeLabel> — <human message>`, in validator order.
- Clicking an item:
  1. Calls a new store action `selectNodeAndCenter(nodeId)` on `workflow-slice` (or directly invokes React Flow's `setCenter(node.position.x + width/2, node.position.y + height/2, { duration: 500, zoom: currentZoom })`).
  2. Adds that node to `selectedNodes` so the existing selection outline highlights it.
  3. Closes the popover.

Smooth-scroll duration: 500ms (matches the existing AI-added-zoom spec's camera-tracking duration for consistency).

The Solo Run button does NOT get a popover — the per-node badge on the single node being run is louder than a popover ever could be.

### Blocking

In `components/editor/SharedWorkflowEditor.tsx` → `commitExecution`, before the cost check and POST:

```ts
const { errors } = useExecutionValidation();  // or read from store snapshot
if (errors.length > 0) {
  if (runMode !== 'solo') {
    // For workflow runs, the popover is on a button the user may not be hovering.
    // Show a tiny toast nudging them toward it.
    showToast("Can't run — fix the highlighted issues");
  }
  // Solo: the badge on the one offending node is already loud. No toast.
  return;
}
```

No `/api/executions/start` POST happens. No credits debited. No `executions` row written.

### Message formatter

A single module so the same human strings appear on hover tooltips, in the popover, and in fallback toasts when the server returns a 400:

```ts
// lib/workflow/validate-execution-messages.ts

export function formatValidationError(e: ValidationError): string {
  switch (e.kind) {
    case 'missing-required-input':
      return `Input '${e.inputLabel}' is required`;
    case 'no-upstream-data':
      return `Input '${e.inputLabel}' needs ${e.sourceNodeLabel} to run first`;
    case 'type-mismatch':
      return `Input '${e.inputLabel}' expects ${e.expectedType}, got ${e.actualType}`;
  }
}
```

## Server enforcement

In `app/api/executions/start/route.ts`, immediately after the target set + `preseedInputs` are built (around line 244, before the cost calculation at line 304):

```ts
const completedNodeIds = new Set(preseedInputs.keys());
const errors = validateExecution({
  workflow: graph_json,
  runMode: mode,
  targetNodeId,
  completedNodeIds,
});
if (errors.length > 0) {
  return NextResponse.json(
    { error: 'VALIDATION_FAILED', errors },
    { status: 400 }
  );
}
```

The client's existing fetch error handler in `commitExecution` parses the response body; if `error === 'VALIDATION_FAILED'`, it runs the same `formatValidationError` over the returned list and shows a toast — the user effectively sees the same surface they would have seen client-side. (This safety net exists for the unlikely case where the client's reactive validation is stale relative to the server view, e.g. an upstream completed-result was cleaned up between hook recompute and click.)

## Files touched

### New (3)

- `lib/workflow/validate-execution.ts` — pure validator.
- `lib/workflow/validate-execution-messages.ts` — message formatter.
- `lib/hooks/use-execution-validation.ts` — reactive selector hook returning `errors` + `errorsByNode`.

### Edited (~5)

- `components/editor/EditorToolbar.tsx` — count-badge + popover + smooth-scroll handler on Run Workflow button.
- `components/editor/SharedWorkflowEditor.tsx` — block `commitExecution` when `errors.length > 0`; toast on workflow-run block.
- `lib/nodes/core/canvas/BaseNode.tsx` — red exclamation badge + tooltip (shared wrapper used by all per-type node renderers).
- `app/api/executions/start/route.ts` — call validator after target-set build, return 400 on errors.
- `lib/store/slices/workflow-slice.ts` — optional `selectNodeAndCenter(nodeId)` action if it cleans up the toolbar code.

No schema changes. No migrations. No new dependencies.

## Verification

- `npx tsc --noEmit` (project memory: `next lint`/`next build` are unreliable here).
- Manual: workflow with required input unconnected → run-workflow button shows count, hover lists it, click jumps. Solo-run a Blur whose Media Input never ran → badge on Blur with "needs Media Input to run first". Hand-craft a saved-workflow JSON with a `text → image` edge to verify `type-mismatch`.

## Non-goals worth restating

- We are **not** preventing the user from making bad edits in the editor — they can still wire whatever. Validation is at *Run* time only.
- We are **not** adding any new realtime channels, DB columns, or migrations.
- We are **not** changing the V2 execution engine, orchestrator, or webhook flow.
