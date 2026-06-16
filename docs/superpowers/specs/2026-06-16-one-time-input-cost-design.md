# One-time cost mode for input handles

**Date:** 2026-06-16
**Status:** Approved — ready for implementation

## Problem

In model management, an image/video input handle can declare a **per-connected-item**
cost (`cost_per_item`): the run is charged `cost_per_item × number of connected items`.
Admins want the option, per handle, to charge a **flat one-time cost** instead — a fixed
price applied once when ≥1 item is connected, regardless of whether 1 or 10 are wired, and
not applied at all when nothing is connected. The existing per-item behavior must remain
available; the admin chooses between the two modes per handle.

## Decision

A **mode toggle** (either/or), not a second additive fee. One toggle flips a handle between:

- **Per-item** (default, current behavior): `cost_per_item × units connected`.
- **One-time**: `cost_per_item` charged once if `units ≥ 1`, else `0`.

The same `cost_per_item` number drives both modes — the toggle only reinterprets it. No
second number to manage.

## Data model

[lib/nodes/types.ts](../../../lib/nodes/types.ts) — add one optional field to the input-handle type:

```ts
/** When true, cost_per_item is charged ONCE if ≥1 item is connected
 *  (ignored if 0), instead of per connected item. Default/false = per-item. */
cost_is_one_time?: boolean;
```

Lives in the `ai_models.inputs_schema` JSONB column — **no DB migration**. Absent/false on
every existing model preserves current per-item billing exactly.

## Runtime cost

[lib/billing/cost.ts](../../../lib/billing/cost.ts) — `computeConnectedInputCost`.

Restructure from "sum per edge" to "tally units per handle, then price each handle":

1. Build the priced-handle map as `{ cost, oneTime }` (was: `cost` only), reading
   `cost_per_item` and `cost_is_one_time` from each handle. A handle is priced when
   `cost_per_item > 0` (unchanged gate).
2. Walk the edges, accumulating connected `units` **per handle** (media_input source →
   `config.images.length`; any other source → `1` per edge), into a `Map<handleKey, units>`.
3. Sum the per-handle charges:
   - per-item handle → `units × cost`
   - one-time handle → `cost` if `units ≥ 1`, else `0`

Same pure function runs on client (estimate) and server (debit), so the two cannot drift —
no `COST_DRIFT_TOLERANCE` risk.

### Edge cases
- **0 connected items** (handle present in schema but no edges, or media_input with an empty
  `images` array): both modes charge `0`.
- **Array handle, multiple edges, one-time mode**: charged once total, not once per edge.
- **media_input with 0 images on a one-time handle**: `units = 0` → `0` (consistent with
  current per-item behavior, which also yields 0).

## Admin UI

[components/admin/ModelForm.tsx](../../../components/admin/ModelForm.tsx) — the input-wire editor.

- Add `cost_is_one_time?: boolean` to the `visualInputWires` state shape.
- Load it in the `setVisualInputWires` mapping: `cost_is_one_time: h.cost_is_one_time ?? false`.
- Default it to `false` in `convertControlToInput`'s new-wire object.
- Persist it in the `compiledInputs.handles` save mapping:
  `cost_is_one_time: !!wire.cost_is_one_time`.
- In the image/video cost block (currently the lone "Cost / connected item" `NumberInput`),
  add a `Switch` labeled **"One-time"** beside it. When on:
  - the `NumberInput` label flips to **"One-time cost"** (self-explanatory),
  - toggling updates `cost_is_one_time` on that wire.

Reuse the existing shared `Switch` / `NumberInput` primitives; no new component.

## Out of scope (YAGNI)

- `computeModelMenuCost` (the picker-menu headline cost) ignores connected-input cost today
  and continues to — one-time input cost only surfaces once something is wired, exactly as
  per-item cost does now.
- No second/additive fee field. No DB schema change. No change to non-image/video handles
  (the cost block only renders for image/video types, unchanged).

## Verification

- `npx tsc --noEmit` clean (the project's reliable check; lint/build are flaky here).
- Manual: in ModelForm, set a handle to one-time mode with a cost, save, reload, confirm it
  round-trips. On canvas, wire 1 then several items and confirm the credit estimate is flat;
  disconnect all and confirm it drops to 0; flip back to per-item and confirm it scales.
