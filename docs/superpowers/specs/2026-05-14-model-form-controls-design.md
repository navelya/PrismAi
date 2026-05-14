# Model-Form Control Authoring: Manual Range, Option Visibility, Cost Multiplier

Three additions to the admin model-schema editor at `/admin?tab=management` so non-developer admins can shape the end-user UX without re-fetching the Replicate schema or editing JSON by hand.

## Context

The admin editor in [components/admin/ModelForm.tsx](../../../components/admin/ModelForm.tsx) renders a list of "controls" parsed from a Replicate OpenAPI schema and saves them into the `ai_models.inputs_schema` JSONB column. End users see those controls in [lib/nodes/plugins/ai_generator/properties.tsx](../../../lib/nodes/plugins/ai_generator/properties.tsx) when they configure an `ai_generator` node. Cost is computed (both client preview and server debit) by [`computeAiNodeCost` in lib/billing/cost.ts](../../../lib/billing/cost.ts).

Today the parser auto-fills slider min/max from `prop.minimum`/`prop.maximum`, dropdown options come straight from `prop.enum`, and there is no concept of a per-input cost multiplier — the model-level `is_per_second` flag only changes the cost-label suffix, not the math.

## Feature 1 — Manual slider Min / Max

**Problem.** Some Replicate schemas omit `minimum`/`maximum` (or use values that don't suit the product). Admins currently have no way to override.

**Solution.**
- In each numeric control card in `ModelForm.tsx` (the block at lines ~658-727 covering `slider`/`threshold`/`number_input`), add two compact `NumberInput`s above the existing default-value editor: **Min** and **Max**.
- Editing either field calls `setControlPatch(ctrl.id, { min })` / `{ max }`. After the edit, re-clamp `default_value` against the new range.
- No type change required — `Control.min` / `Control.max` already exist.

**Edge cases.**
- Min > Max: don't enforce. Just don't render the dual-handle slider in that state — fall back to a plain `NumberInput` for the default value (the existing renderer at lines 666-680 already handles "no range" gracefully).
- Either field empty: treat as `undefined`, which falls back to the current "unranged" path.

## Feature 2 — Per-option Visibility (eye icon) for dropdowns

**Problem.** Replicate enums often expose many options that a product owner doesn't want users to see. Today the only choice is "ship all" or "fetch a different schema and edit by hand". Admins want a hide/show toggle that survives schema re-fetches and doesn't lose the option (so they can re-enable it later).

**Solution.**

Add a new optional field to the `Control` type in [lib/nodes/types.ts](../../../lib/nodes/types.ts):

```ts
disabled_options?: string[];
```

Hide-by-omission: an absent or empty array means every option is visible (matches today's behavior — backwards compatible without migration).

**Admin UI.** In the existing Pricing-Modifiers grid for `select` controls (lines ~796-816), add a small eye-icon `<button>` per option row. Eye-on (default) means visible; eye-off pushes the option key into `disabled_options`. The option still appears in:
- the admin's Default-Value picker (so the admin can still set a default that's hidden from users — useful for "shipped but reserved" defaults), and
- the Pricing-Modifiers grid (so cost data is preserved when an option is temporarily hidden).

**End-user UI.** In `properties.tsx` `ControlRenderer` (the `case 'select'`/`'resolution'`/`'format'` branch at lines ~349-363), filter `control.options` to exclude `disabled_options` before mapping to the picker.

**Runtime safety.** If a saved `control_values[key]` matches a now-disabled option, the user picker should fall back to displaying the first enabled option. This is a display-only fallback — do not migrate saved workflows or rewrite stored configs. (The dispatcher will send whatever is in `control_values` regardless.)

## Feature 3 — Per-control Cost Multiplier

**Problem.** Video generators charge per-second. Today the model-level `is_per_second` flag only adds a `/s` suffix to the displayed cost — the actual math doesn't multiply. That means the cost users see is wrong, and the server debit doesn't match either.

**Solution.**

Add to the `Control` type:

```ts
is_cost_multiplier?: boolean;
```

Only meaningful for numeric controls (`slider` / `number_input` / `threshold`).

**Cost math.** Update `computeAiNodeCost` in `lib/billing/cost.ts`. Two-pass:

1. Compute additive total exactly as today (`credit_cost` + `cost_modifiers` + `value × cost_per_unit`).
2. Walk controls again. For each numeric control with `is_cost_multiplier === true`, coerce its value with `Number(value)`. If the result is `NaN` or `< 1`, treat the multiplier as `1` (so an empty, zero, or non-numeric input cannot zero out the charge). Otherwise multiply the running total by it.

Same code on client and server (`computeAiNodeCost` already runs both places), so the modal estimate and the authoritative debit cannot drift.

**Admin UI.** In the Pricing-Modifiers section, next to the "Cost Per Unit" `NumberInput` (lines ~851-865), add a `Switch` labeled **"Multiply Total by Value"** with a one-line hint: *"e.g. video duration — total cost × this control's value"*. Render only for numeric components. `cost_per_unit` and `is_cost_multiplier` may coexist; admin chooses semantics.

**Auto-detect on Fetch Schema.** In [lib/utils/schema-parser.ts](../../../lib/utils/schema-parser.ts) Rule B4 (the numeric branch at lines ~218-225), set `is_cost_multiplier: true` when the property key matches `/^(duration|num_frames|frames|length|seconds|num_seconds)$/i` AND the type is numeric. The admin can still toggle it off — auto-detect only runs at fetch time.

**Footer label.** In `properties.tsx` lines 282-284, drop the `/s` suffix when any control on the selected model has `is_cost_multiplier === true`. Rationale: the displayed cost is already the final per-run number, so `/s` would double-imply the multiplication. Legacy models still using `is_per_second` keep the existing label.

## Out of scope

- No DB migration. `inputs_schema` is JSONB; new optional fields land without schema changes.
- No backfill of existing model rows. Missing fields = today's behavior.
- The legacy model-level `is_per_second` field stays. Removing it would be churn — the new per-control flag is the path forward and they don't conflict.
- No UI to reorder options, rename options, or add new options. Replicate's schema is the source of truth; this spec only adds visibility and pricing controls.

## Files touched

| File | Change |
|---|---|
| [lib/nodes/types.ts](../../../lib/nodes/types.ts) | Add `disabled_options?: string[]` and `is_cost_multiplier?: boolean` to `Control`. |
| [components/admin/ModelForm.tsx](../../../components/admin/ModelForm.tsx) | Min/Max inputs in numeric control cards; eye-icon toggle in select option grid; multiplier `Switch` in numeric pricing block. |
| [lib/nodes/plugins/ai_generator/properties.tsx](../../../lib/nodes/plugins/ai_generator/properties.tsx) | Filter `disabled_options` from select renderer; suppress `/s` suffix when multiplier is active. |
| [lib/utils/schema-parser.ts](../../../lib/utils/schema-parser.ts) | Set `is_cost_multiplier: true` on duration-like numeric keys at fetch time. |
| [lib/billing/cost.ts](../../../lib/billing/cost.ts) | Multiply additive total by all `is_cost_multiplier` control values (clamped ≥1). |

## Verification checklist

- Edit an existing model: change a slider's Max from 100 to 30, save, reopen — value persists; end-user slider obeys new ceiling.
- Edit an existing model: hide one option in a select via the eye icon, save — admin still sees option in Default + Pricing; end-user does not see it.
- Open a model whose stored default value is now in `disabled_options`: end-user picker shows first enabled option without a console error.
- Fetch a video model that has a `duration` field: multiplier auto-toggles on; end-user cost preview equals base × duration; running the workflow debits the same number on the server.
- Toggle multiplier OFF on the same model and re-save: end-user cost reverts to base; server debit matches.
- A model with no `disabled_options` and no `is_cost_multiplier` field set computes the exact same cost as before this change (regression guard).
