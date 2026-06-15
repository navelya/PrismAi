# Seed control: explicit Random toggle

**Date:** 2026-06-15
**Status:** Approved design

## Problem

The `ai_generator` seed control currently infers "randomize" from an empty/null
field value (the executor omits a `null`/`''`/`undefined` seed so the model
randomizes). There is no way to keep a seed value visible while still requesting
a random run, and the admin's seed config is entangled with this auto/random
inference. We want an explicit, decoupled UX:

- A seed **number field** that always shows the admin-configured value.
- A **Random toggle**, ON by default. When ON, the model randomizes regardless of
  the number in the field. When OFF, the field's number is used.

## Behavior

| Random toggle | Seed field | What is sent to the provider |
|---|---|---|
| ON (default) | visible, **disabled**, shows the value that would be used if turned off | seed **omitted** → provider randomizes (per run / per fan-out iteration) |
| OFF | visible, **editable** | the field's number |

- New nodes default to Random ON.
- "Random ON → omit" preserves today's fan-out semantics: each iteration gets a
  fresh random seed from the provider (we do not generate one client-side).

## Storage

A reserved boolean key `__seedRandom` inside the node's existing
`control_values`:

- `undefined` is treated as `true` (Random ON) — so existing nodes,
  chat-created nodes, and templates stay random-by-default with no migration.
- It is **not** a real control `api_mapping_key`, so the executor's generic
  control→payload mapping loop never reads or forwards it. (Same reserved-key
  pattern as `__characterRefCount`.)

The seed *value* continues to live under `control_values.seed` (the control's
`api_mapping_key`), pre-filled from `control.default_value`.

## Changes

### 1. Runtime UI — `lib/nodes/plugins/ai_generator/properties.tsx` (`isSeedControl` branch, ~L392)

Replace the single `NumberInput` with:

- A `Switch` labeled "Random", `checked = control_values.__seedRandom ?? true`.
  `onChange` writes `__seedRandom` (boolean) via the existing `onChange(key, value)`
  contract, using key `'__seedRandom'`.
- A `NumberInput` showing `value ?? control.default_value ?? ''`, `disabled` when
  Random is ON. Editing writes `control_values.seed` as today.

Layout mirrors the existing admin seed block (label + helper text + switch, then
the number field), using the minimal variant consistent with other runtime
controls.

### 2. Executor — `lib/nodes/plugins/ai_generator/executor.server.ts` (controls loop, ~L103)

In the per-control loop, special-case the seed control (`isSeedControl(ctrl)`):

- If `control_values.__seedRandom !== false` → **skip** (omit seed → random).
- Else → send `control_values.seed ?? ctrl.default_value` when it is a finite
  number; otherwise omit.

The existing `null/''/undefined` omission stays as a fallback for the fixed path.
`__seedRandom` itself is never written to `replicateInputs` because it is not a
control key.

### 3. Admin — `components/admin/ModelForm.tsx` (`isSeedControl` block, ~L945)

Remove the "Auto (random seed)" `Switch`. Render a single always-visible
**Default Seed** `NumberInput` bound to `default_value`:

- Empty field → `default_value = null` (no pinned default; runtime field starts empty).
- A number → `default_value = <number>` (pre-fills the runtime field).

Backward-compatible: existing rows with `default_value === null` (set by the old
auto switch) simply render as an empty field.

## Non-goals

- No client-side seed generation, no per-iteration seed recording.
- No DB migration (reserved key is additive and optional).
- No change to `isSeedControl` (still `api_mapping_key.toLowerCase() === 'seed'`),
  so all seed controls across all models are covered.

## Verification

- `npx tsc --noEmit` clean (lint/build are unreliable in this repo).
- Manual E2E: new node defaults to Random ON (field disabled); toggling off
  enables editing and pins the seed; toggling on randomizes; admin Default Seed
  pre-fills the runtime field; existing/auto rows still work.
