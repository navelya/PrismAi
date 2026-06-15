# Convert a model field between Property ⇄ Input

**Date:** 2026-06-15
**Status:** Approved (design)
**Area:** Admin model setup — `components/admin/ModelForm.tsx`

## Problem

When an admin sets up an `ai_generator` model, the model's input schema is split into
two sections in the form:

- **UI Properties** — `inputs_schema.controls` (a `Control[]`): fields rendered in the
  node's properties panel (sliders, selects, text inputs, …).
- **Input Handles** — `inputs_schema.handles` (an `InputHandle[]`): wired inputs that
  accept data from other nodes (image/video/text/audio/any).

A field's correct classification isn't always known at schema-fetch time. The admin may
want a fetched control (e.g. a `prompt` text field) to instead be a wired **input** so it
can be driven by an upstream node — or the reverse. Today there is no way to reclassify a
field; the only escape hatch is editing raw JSON. We want a one-click **Convert** button.

## Scope

- Admin only. No end-user (properties panel) change.
- No DB/migration change. The existing save path already serializes
  `visualControls → inputs_schema.controls` and `visualInputWires → inputs_schema.handles`.
  Conversion only moves an item between those two pieces of local React state; it persists
  when the admin clicks Save.
- **Outputs are out of scope** — only Property ⇄ Input (input handles).

## UX

Each Property card and each Input Handle card already renders a header button group
(reorder arrows + a Visible toggle) inside the `flex items-center gap-2` container guarded
by `onPointerDown={stopPointerProp}`. Add one button to that group:

- **Property card → "To Input"** — `Link2` icon, blue accent (matches the input-handle
  card's blue iconography). Moves the field into the Input Handles section.
- **Input Handle card → "To Property"** — `Settings2` icon, accent-primary (matches the
  property card's iconography). Moves the field into the UI Properties section.

Clicking removes the item from its source section and appends it (at the bottom) to the
destination section, instantly, in local state. The change is persisted only on Save,
consistent with every other edit in this form.

Button styling matches the sibling Visible toggle:
`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[9px] font-black uppercase transition-all`
with a subtle (non-active) color treatment, e.g.
`bg-white/5 border-white/10 text-content-tertiary hover:text-content-primary hover:bg-white/10`.

## Field mapping (drop type-specific config with sensible defaults)

A `Control` and an `InputHandle` share: `api_mapping_key`, `type` (different vocabularies),
`is_visible`, `description`, and a name/label. The conversion keeps the shared fields and
resets everything type-specific to defaults. A fresh `id` is assigned (the form's items
carry a client-only `id`).

### Property (`Control`) → Input handle

| Target handle field | Value |
|---|---|
| `api_mapping_key` | unchanged |
| `name` | `ctrl.label || formatDisplayName(ctrl.api_mapping_key)` |
| `type` | `text` if the control type is string/text-like (`string`, `text`, empty, or a text-ish component like `text_input`/`textarea`/`prompt_textarea`/`negative_prompt`); otherwise `any` |
| `is_array` | `false` |
| `is_mandatory` | `false` |
| `is_visible` | carried from `ctrl.is_visible` |
| `cost_per_item` | `0` |
| `max_items` | `0` |
| `description` | carried |

Dropped: `component`, `default_value`, `options`, `disabled_options`, `min`, `max`,
`step`, `cost_modifiers`, `cost_per_unit`, `is_cost_multiplier`.

### Input handle (`InputHandle`) → Property (`Control`)

| Target control field | Value |
|---|---|
| `api_mapping_key` | unchanged |
| `label` | `wire.name` (or undefined if empty) |
| `component` | `text_input` |
| `type` | `string` |
| `default_value` | `''` |
| `is_visible` | carried from `wire.is_visible` |
| `description` | carried |

Dropped: `is_array`, `is_mandatory`, `cost_per_item`, `max_items`.

(An image/video/audio input converts to a `text_input` control — rarely meaningful, but the
action stays available per requirement. The admin re-picks component/type afterward using the
existing per-card controls.)

## Collision guard

The engine keys controls and handles by `api_mapping_key` **within each section
independently**. Converting a field whose `api_mapping_key` already exists in the
destination section would create two same-keyed items in one section. Before converting,
check the destination array for the same `api_mapping_key`; if found, abort with a
`window.alert` explaining the clash (consistent with the existing `window.confirm`/alert
usage in this file). No move happens.

## Implementation

Two pure handlers in `ModelForm.tsx`:

```ts
function convertControlToInput(controlId: string): void
function convertInputToControl(wireId: string): void
```

Each:
1. Find the source item by `id` in its `visual*` array.
2. If the destination array already contains an item with the same `api_mapping_key`,
   `window.alert(...)` and return (no-op).
3. Build the mapped destination object (per the tables above) with a fresh `id`.
4. `setVisual<Source>(prev => prev.filter(x => x.id !== id))` and
   `setVisual<Dest>(prev => [...prev, mapped])`.

Wire the buttons into the two card header button groups. No other files change.

## Out of scope / non-goals

- Output handle conversion.
- Preserving dropped config for round-trip restore (explicitly declined — "drop with
  sensible defaults").
- A confirmation dialog per conversion (declined — instant move; only the collision case
  alerts).
- Any change to the runtime engine, executor, or DB schema.

## Verification

- `npx tsc --noEmit` clean (the project's reliable check; `lint`/`build` are unreliable here).
- Manual admin round-trip: open a model, convert a property → input, confirm it leaves the
  Properties section and appears under Input Handles with a sensible wire type; Save;
  reopen; confirm it persisted. Convert it back; confirm the collision guard fires when a
  duplicate key exists.
