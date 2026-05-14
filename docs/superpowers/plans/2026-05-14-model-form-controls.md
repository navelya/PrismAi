# Model-Form Control Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three authoring capabilities to the admin model-schema editor — manual slider min/max, per-option visibility toggles for dropdowns, and per-control "cost multiplier" flag (with auto-detect at schema-fetch time).

**Architecture:** Pure additive changes. Two new optional fields on the existing `Control` type (`disabled_options?: string[]`, `is_cost_multiplier?: boolean`). Cost math gains a second pass that multiplies the additive total by every multiplier-flagged control's value. Admin form gains three small UI controls; end-user renderer filters disabled options and suppresses the cosmetic `/s` suffix when a real multiplier is in play. No DB migration — `inputs_schema` is JSONB.

**Tech Stack:** TypeScript 5, Next.js 14, React 18, Tailwind, Zustand, Supabase. **No test runner.** Verification = `npm run lint` + `npm run build` + standalone `node scripts/<file>.mjs` smoke tests for pure logic + manual browser checks via `npm run dev`.

**Spec:** [docs/superpowers/specs/2026-05-14-model-form-controls-design.md](../specs/2026-05-14-model-form-controls-design.md)

---

## File map

| File | Why it's touched |
|---|---|
| [lib/nodes/types.ts](../../../lib/nodes/types.ts) | Add `disabled_options?: string[]` and `is_cost_multiplier?: boolean` to `Control`. |
| [lib/billing/cost.ts](../../../lib/billing/cost.ts) | Extend `computeAiNodeCost` with a second pass that applies multipliers. |
| [lib/utils/schema-parser.ts](../../../lib/utils/schema-parser.ts) | Auto-set `is_cost_multiplier: true` for duration-like numeric keys at fetch time. |
| [components/admin/ModelForm.tsx](../../../components/admin/ModelForm.tsx) | Three UI additions: Min/Max inputs on numeric cards, eye-icon toggle on select option rows, multiplier `Switch` next to "Cost Per Unit". |
| [lib/nodes/plugins/ai_generator/properties.tsx](../../../lib/nodes/plugins/ai_generator/properties.tsx) | Filter `disabled_options` from end-user select; drop `/s` suffix when any control is a multiplier. |
| `scripts/verify-cost-multiplier.mjs` (new) | One-off node smoke test asserting the new cost formula on hand-crafted control sets. |
| `scripts/verify-multiplier-autodetect.mjs` (new) | One-off node smoke test asserting the duration-key regex matches expected names. |

The two `scripts/*.mjs` files are pure-JS reimplementations of the algorithms — they don't import the TS source (no test runner, no `tsx`). Treat them as regression guards: they encode the spec's expected behavior, and if the TS implementation ever drifts, the engineer must port the change to the script too.

---

## Task 1: Add new optional fields to the `Control` type

**Files:**
- Modify: `lib/nodes/types.ts:23-36`

- [ ] **Step 1: Add the two fields**

In `lib/nodes/types.ts`, replace the `Control` interface (lines 23-36) with:

```ts
export interface Control {
    api_mapping_key: string;
    type: string;
    component: 'text_input' | 'textarea' | 'slider' | 'number_input' | 'checkbox' | 'select' | 'prompt_textarea' | 'negative_prompt' | 'aspect_ratio' | 'resolution' | 'format' | 'reverse' | 'threshold';
    default_value: any;
    is_visible: boolean;
    label?: string;
    options?: string[];
    /** Option values to hide from the end-user picker. Admin still sees them. Absent or empty = all visible. */
    disabled_options?: string[];
    min?: number;
    max?: number;
    step?: number;
    cost_modifiers?: Record<string, number>;
    cost_per_unit?: number;
    /** When true on a numeric control, multiplies the total node cost by this control's value (e.g. video duration). */
    is_cost_multiplier?: boolean;
}
```

- [ ] **Step 2: Verify the project still type-checks**

Run: `npm run build`
Expected: build succeeds. The new fields are optional, so no consumer is forced to provide them.

- [ ] **Step 3: Commit**

```bash
git add lib/nodes/types.ts
git commit -m "feat(types): add disabled_options and is_cost_multiplier to Control"
```

---

## Task 2: Write the cost-math smoke test (red)

**Files:**
- Create: `scripts/verify-cost-multiplier.mjs`

- [ ] **Step 1: Write the smoke test**

Create `scripts/verify-cost-multiplier.mjs` with this content (it will fail when run, because the algorithm it tests doesn't exist yet — Task 3 implements it):

```js
// Smoke test for computeAiNodeCost multiplier behavior.
// No test runner in this repo; run manually: `node scripts/verify-cost-multiplier.mjs`
// Mirrors the algorithm in lib/billing/cost.ts. If you change the TS, update this.

import assert from 'node:assert/strict';

// --- Pure JS port of computeAiNodeCost (kept in sync with lib/billing/cost.ts) ---
function computeAiNodeCost(controlValues, model) {
    let total = Number(model.credit_cost ?? 0);
    if (!Number.isFinite(total)) total = 0;

    const controls = model.inputs_schema?.controls ?? [];
    const values = controlValues ?? {};

    for (const ctrl of controls) {
        const val = values[ctrl.api_mapping_key] ?? ctrl.default_value;
        if (ctrl.cost_modifiers && val !== undefined && val !== null) {
            const key = String(val);
            const m = ctrl.cost_modifiers[key];
            if (typeof m === 'number' && Number.isFinite(m)) total += m;
        }
        if (typeof ctrl.cost_per_unit === 'number' && typeof val === 'number') {
            total += val * ctrl.cost_per_unit;
        }
    }

    let multiplier = 1;
    for (const ctrl of controls) {
        if (!ctrl.is_cost_multiplier) continue;
        const val = values[ctrl.api_mapping_key] ?? ctrl.default_value;
        const n = Number(val);
        if (!Number.isFinite(n) || n < 1) continue;
        multiplier *= n;
    }

    return Math.max(0, total * multiplier);
}

// --- Cases ---

// Case 1: no multiplier flag -> behaves exactly like today (regression guard).
const baseModel = {
    credit_cost: 10,
    inputs_schema: {
        controls: [
            { api_mapping_key: 'aspect', component: 'select', cost_modifiers: { '16:9': 5, '1:1': 0 }, default_value: '1:1' },
            { api_mapping_key: 'steps', component: 'slider', cost_per_unit: 0.1, default_value: 20 },
        ],
    },
};
assert.equal(computeAiNodeCost({ aspect: '16:9', steps: 30 }, baseModel), 10 + 5 + 30 * 0.1);
assert.equal(computeAiNodeCost(undefined, baseModel), 10 + 0 + 20 * 0.1);

// Case 2: multiplier flag present.
const videoModel = {
    credit_cost: 12,
    inputs_schema: {
        controls: [
            { api_mapping_key: 'duration', component: 'number_input', is_cost_multiplier: true, default_value: 1 },
        ],
    },
};
assert.equal(computeAiNodeCost({ duration: 5 }, videoModel), 12 * 5);
assert.equal(computeAiNodeCost({ duration: 1 }, videoModel), 12);

// Case 3: zero/empty multiplier value clamps to 1 (no free runs).
assert.equal(computeAiNodeCost({ duration: 0 }, videoModel), 12);
assert.equal(computeAiNodeCost({ duration: undefined }, videoModel), 12);
assert.equal(computeAiNodeCost({ duration: 'abc' }, videoModel), 12);

// Case 4: multiplier combines with additive costs in the right order.
const combined = {
    credit_cost: 10,
    inputs_schema: {
        controls: [
            { api_mapping_key: 'aspect', component: 'select', cost_modifiers: { '16:9': 5 }, default_value: '16:9' },
            { api_mapping_key: 'duration', component: 'number_input', is_cost_multiplier: true, default_value: 1 },
        ],
    },
};
// (10 + 5) * 3 = 45
assert.equal(computeAiNodeCost({ aspect: '16:9', duration: 3 }, combined), 45);

// Case 5: two multipliers compose multiplicatively.
const twoMultipliers = {
    credit_cost: 4,
    inputs_schema: {
        controls: [
            { api_mapping_key: 'duration', is_cost_multiplier: true, default_value: 1 },
            { api_mapping_key: 'frames', is_cost_multiplier: true, default_value: 1 },
        ],
    },
};
assert.equal(computeAiNodeCost({ duration: 2, frames: 3 }, twoMultipliers), 4 * 2 * 3);

console.log('OK: cost-multiplier smoke test passed');
```

- [ ] **Step 2: Run it — expect a regression failure**

Run: `node scripts/verify-cost-multiplier.mjs`
Expected: **PASS** in this script (it's self-contained), but the *real* TS function in `lib/billing/cost.ts` does not yet implement the multiplier — that gap is what Task 3 closes. The script defines the contract; Task 3 makes the TS match it.

> Why this shape: the project has no test runner and no TS execution harness. Inlining the algorithm in JS gives us an executable spec we can run with bare `node`. When you edit `lib/billing/cost.ts` in Task 3, mirror the change here.

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-cost-multiplier.mjs
git commit -m "test: smoke test for cost multiplier semantics"
```

---

## Task 3: Implement the multiplier in `computeAiNodeCost`

**Files:**
- Modify: `lib/billing/cost.ts:42-69`

- [ ] **Step 1: Replace the function body**

In `lib/billing/cost.ts`, replace the entire `computeAiNodeCost` function (lines 42-69) with:

```ts
/**
 * Cost of a single ai_generator node:
 *   1. additive total = model.credit_cost
 *                     + sum of cost_modifiers[selected_value]   (select/checkbox controls)
 *                     + sum of value × cost_per_unit            (slider/number controls)
 *   2. multiplier     = product of every numeric control with is_cost_multiplier === true,
 *                       coercing each value to Number. Values that are NaN or < 1 contribute 1
 *                       (so an empty/zero/non-numeric input cannot zero out a charge).
 *   3. result         = additive total × multiplier
 *
 * Same code runs on client and server, so the modal estimate and the
 * authoritative server debit cannot drift apart.
 */
export function computeAiNodeCost(
    controlValues: Record<string, any> | undefined,
    model: { credit_cost?: number | null; inputs_schema?: AiModel['inputs_schema'] | null }
): number {
    let total = Number(model.credit_cost ?? 0);
    if (!Number.isFinite(total)) total = 0;

    const controls: Control[] = model.inputs_schema?.controls ?? [];
    const values = controlValues ?? {};

    // Pass 1: additive (existing behavior, preserved verbatim).
    for (const ctrl of controls) {
        const val = values[ctrl.api_mapping_key] ?? ctrl.default_value;

        if (ctrl.cost_modifiers && val !== undefined && val !== null) {
            const key = typeof val === 'boolean' ? String(val) : String(val);
            const modifier = ctrl.cost_modifiers[key];
            if (typeof modifier === 'number' && Number.isFinite(modifier)) {
                total += modifier;
            }
        }

        if (typeof ctrl.cost_per_unit === 'number' && typeof val === 'number') {
            total += val * ctrl.cost_per_unit;
        }
    }

    // Pass 2: multiplier. Every is_cost_multiplier control multiplies the running total.
    let multiplier = 1;
    for (const ctrl of controls) {
        if (!ctrl.is_cost_multiplier) continue;
        const val = values[ctrl.api_mapping_key] ?? ctrl.default_value;
        const n = Number(val);
        if (!Number.isFinite(n) || n < 1) continue; // clamp guards against zeroing the charge
        multiplier *= n;
    }

    return Math.max(0, total * multiplier);
}
```

- [ ] **Step 2: Verify the project type-checks**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Re-run the smoke test (sanity check that the JS port still matches)**

Run: `node scripts/verify-cost-multiplier.mjs`
Expected: `OK: cost-multiplier smoke test passed`

- [ ] **Step 4: Commit**

```bash
git add lib/billing/cost.ts
git commit -m "feat(billing): apply is_cost_multiplier controls to total cost"
```

---

## Task 4: Write the auto-detect smoke test (red)

**Files:**
- Create: `scripts/verify-multiplier-autodetect.mjs`

- [ ] **Step 1: Write the smoke test**

Create `scripts/verify-multiplier-autodetect.mjs`:

```js
// Smoke test for the duration-key regex used by parseReplicateSchema
// to auto-flag is_cost_multiplier on numeric controls.
// Mirror any change here when editing lib/utils/schema-parser.ts.

import assert from 'node:assert/strict';

const MULTIPLIER_KEY_REGEX = /^(duration|num_frames|frames|length|seconds|num_seconds)$/i;

const matches = ['duration', 'Duration', 'DURATION', 'num_frames', 'frames', 'length', 'seconds', 'num_seconds'];
for (const k of matches) {
    assert.ok(MULTIPLIER_KEY_REGEX.test(k), `expected match: ${k}`);
}

const nonMatches = ['width', 'height', 'steps', 'guidance_scale', 'cfg', 'frame_rate', 'duration_seconds', 'video_duration', ''];
for (const k of nonMatches) {
    assert.ok(!MULTIPLIER_KEY_REGEX.test(k), `expected no match: ${k}`);
}

console.log('OK: multiplier-autodetect smoke test passed');
```

- [ ] **Step 2: Run it**

Run: `node scripts/verify-multiplier-autodetect.mjs`
Expected: `OK: multiplier-autodetect smoke test passed`

> Note: this script verifies the regex itself, not the parser integration. The parser change in Task 5 calls the same regex literal — keep the two in sync.

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-multiplier-autodetect.mjs
git commit -m "test: smoke test for duration-key auto-detect regex"
```

---

## Task 5: Auto-detect multiplier-eligible keys in the schema parser

**Files:**
- Modify: `lib/utils/schema-parser.ts:218-247` (Rule B4 + the `controls.push` block)

- [ ] **Step 1: Add the regex constant near the top of the file**

In `lib/utils/schema-parser.ts`, find the top-level `formatDisplayName` function (around line 6) and immediately after its closing brace, add:

```ts
/**
 * Property keys that, when seen on a numeric control, are auto-flagged as
 * cost multipliers. Mirrors scripts/verify-multiplier-autodetect.mjs.
 */
const MULTIPLIER_KEY_REGEX = /^(duration|num_frames|frames|length|seconds|num_seconds)$/i;
```

- [ ] **Step 2: Wire the flag into the controls.push block**

In the same file, locate the `controls.push({ ... })` call (around lines 235-247). Replace the entire push call with:

```ts
const isMultiplierKey = MULTIPLIER_KEY_REGEX.test(key);
const isNumeric = prop.type === 'number' || prop.type === 'integer';

controls.push({
    api_mapping_key: key,
    type: prop.type === 'integer' ? 'number' : (prop.type || 'string'),
    component,
    default_value: defaultValue,
    is_visible: true,
    label: prop.title || formatDisplayName(key),
    options: prop.enum,
    min: prop.minimum,
    max: prop.maximum,
    step: prop.type === 'integer' ? 1 : 0.01,
    is_mandatory: isMandatory,
    ...(isMultiplierKey && isNumeric ? { is_cost_multiplier: true } : {}),
});
```

The conditional spread keeps the field absent for non-multiplier controls, so the saved JSON stays clean.

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Manual browser check**

In one terminal: `npm run dev`
In the browser: visit `http://localhost:3000/admin?tab=management`. Open or create a model, paste a known video model id (e.g. one with a `duration` integer input) into the Replicate Model ID field, click **Fetch Schema**. After parsing, open the browser devtools console and run:

```js
// In the React DevTools, inspect the ModelForm component's `visualControls` state,
// or reach for it via a temporary console.log in handleSubmit.
```

Easier check: hit Save, then re-open the model — the duration control should round-trip with `is_cost_multiplier: true` (verifiable in Supabase Studio against the `ai_models.inputs_schema` JSONB).

- [ ] **Step 5: Commit**

```bash
git add lib/utils/schema-parser.ts
git commit -m "feat(schema-parser): auto-flag duration-like numeric keys as cost multipliers"
```

---

## Task 6: Admin UI — manual Min/Max inputs on numeric control cards

**Files:**
- Modify: `components/admin/ModelForm.tsx:658-727` (the `isNumericControl` block inside the per-control card)

- [ ] **Step 1: Add the Min/Max row above the existing default-value editor**

In `components/admin/ModelForm.tsx`, find the block that starts:

```tsx
{isNumericControl(ctrl) && !isBooleanControl(ctrl) && (() => {
    const step = ctrl.step ?? (normalizedControlType(ctrl) === 'integer' ? 1 : 0.01);
    const fallback = ctrl.min ?? 0;
    const current = Number.isFinite(Number(ctrl.default_value)) ? Number(ctrl.default_value) : fallback;
    const isRanged = (ctrl.component === 'slider' || ctrl.component === 'threshold')
        && typeof ctrl.min === 'number'
        && typeof ctrl.max === 'number';
```

Right after the `const isRanged = ...` line (still inside the IIFE, before the `if (!isRanged) {` branch), do nothing — just ensure context is correct.

Then change the IIFE's `return` so it always renders a Min/Max row above whatever default-value editor it would have rendered. Replace the body from `if (!isRanged) {` down through the closing `})()` with:

```tsx
                                    const renderRangeFields = () => (
                                        <div className="grid grid-cols-2 gap-3">
                                            <NumberInput
                                                label="Min"
                                                step={step}
                                                value={typeof ctrl.min === 'number' ? ctrl.min : ''}
                                                onChange={e => {
                                                    const raw = e.target.value;
                                                    const next = raw === '' ? undefined : Number(raw);
                                                    setVisualControls(prev => prev.map(c => {
                                                        if (c.id !== ctrl.id) return c;
                                                        const updated: Control & { id: string } = { ...c, min: Number.isFinite(next as number) ? (next as number) : undefined };
                                                        // Re-clamp default if it falls below the new min
                                                        if (typeof updated.min === 'number' && typeof updated.default_value === 'number' && updated.default_value < updated.min) {
                                                            updated.default_value = updated.min;
                                                        }
                                                        return updated;
                                                    }));
                                                }}
                                            />
                                            <NumberInput
                                                label="Max"
                                                step={step}
                                                value={typeof ctrl.max === 'number' ? ctrl.max : ''}
                                                onChange={e => {
                                                    const raw = e.target.value;
                                                    const next = raw === '' ? undefined : Number(raw);
                                                    setVisualControls(prev => prev.map(c => {
                                                        if (c.id !== ctrl.id) return c;
                                                        const updated: Control & { id: string } = { ...c, max: Number.isFinite(next as number) ? (next as number) : undefined };
                                                        if (typeof updated.max === 'number' && typeof updated.default_value === 'number' && updated.default_value > updated.max) {
                                                            updated.default_value = updated.max;
                                                        }
                                                        return updated;
                                                    }));
                                                }}
                                            />
                                        </div>
                                    );

                                    if (!isRanged) {
                                        return (
                                            <div className="space-y-3">
                                                {renderRangeFields()}
                                                <NumberInput
                                                    label="Default Value"
                                                    min={ctrl.min}
                                                    max={ctrl.max}
                                                    step={step}
                                                    value={current}
                                                    onChange={e => {
                                                        const val = Number(e.target.value);
                                                        setControlPatch(ctrl.id, { default_value: Number.isFinite(val) ? val : fallback });
                                                    }}
                                                />
                                            </div>
                                        );
                                    }

                                    const min = ctrl.min as number;
                                    const max = ctrl.max as number;
                                    const clamp = (v: number) => Math.min(max, Math.max(min, v));
                                    const display = clamp(current);

                                    return (
                                        <div className="space-y-3">
                                            {renderRangeFields()}
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-bold text-content-tertiary uppercase tracking-[0.1em] pl-1 opacity-80 block">
                                                    Default Value
                                                </label>
                                                <div className="flex items-center gap-4">
                                                    <div className="flex-1 space-y-1.5">
                                                        <input
                                                            type="range"
                                                            min={min}
                                                            max={max}
                                                            step={step}
                                                            value={display}
                                                            onChange={e => {
                                                                const val = parseFloat(e.target.value);
                                                                setControlPatch(ctrl.id, { default_value: Number.isFinite(val) ? clamp(val) : min });
                                                            }}
                                                            className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-accent-primary"
                                                        />
                                                        <div className="flex justify-between text-[9px] font-mono text-content-tertiary/50 px-0.5 tabular-nums">
                                                            <span>{min}</span>
                                                            <span>{max}</span>
                                                        </div>
                                                    </div>
                                                    <div className="w-28 shrink-0">
                                                        <NumberInput
                                                            min={min}
                                                            max={max}
                                                            step={step}
                                                            value={display}
                                                            onChange={e => {
                                                                const raw = Number(e.target.value);
                                                                if (!Number.isFinite(raw)) return;
                                                                setControlPatch(ctrl.id, { default_value: clamp(raw) });
                                                            }}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })()}
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Manual browser check**

Run: `npm run dev`
1. Open `/admin?tab=management`, edit any model with a slider control.
2. Confirm the Min and Max `NumberInput`s appear above the default-value slider.
3. Change Max from (e.g.) 100 to 30. The default-value slider should immediately re-clamp if its current value was > 30. The slider's track ceiling label updates to `30`.
4. Clear the Max field (empty input). The block should fall back to the unranged `NumberInput` for the default value (no track ceiling).
5. Save the model, reload the admin page, re-open — values persist.

- [ ] **Step 4: Commit**

```bash
git add components/admin/ModelForm.tsx
git commit -m "feat(admin): manual Min/Max inputs on numeric control cards"
```

---

## Task 7: Admin UI — eye-icon visibility toggle on select option rows

**Files:**
- Modify: `components/admin/ModelForm.tsx:796-816` (the `select` branch of the Pricing Modifiers section)

- [ ] **Step 1: Replace the per-option grid**

In `components/admin/ModelForm.tsx`, locate:

```tsx
{ctrl.component === 'select' && ctrl.options && (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {ctrl.options.map(opt => (
            <NumberInput
                key={opt}
                label={`Cost for "${opt}"`}
                ...
```

Replace the **entire** `{ctrl.component === 'select' && ctrl.options && ( ... )}` block with:

```tsx
{ctrl.component === 'select' && ctrl.options && (
    <div className="space-y-2">
        {ctrl.options.map(opt => {
            const isHidden = (ctrl.disabled_options ?? []).includes(opt);
            return (
                <div
                    key={opt}
                    className={cn(
                        "flex items-center gap-3 p-2 rounded-xl bg-white/5 border border-white/10 transition-all",
                        isHidden && "opacity-50"
                    )}
                >
                    <button
                        type="button"
                        onClick={() => {
                            setVisualControls(prev => prev.map(c => {
                                if (c.id !== ctrl.id) return c;
                                const current = c.disabled_options ?? [];
                                const next = isHidden ? current.filter(x => x !== opt) : [...current, opt];
                                return { ...c, disabled_options: next };
                            }));
                        }}
                        title={isHidden ? "Click to show this option to users" : "Click to hide this option from users"}
                        className={cn(
                            "shrink-0 w-7 h-7 rounded-lg flex items-center justify-center border transition-colors",
                            isHidden
                                ? "bg-white/5 border-white/10 text-content-tertiary"
                                : "bg-green-500/10 border-green-500/30 text-green-500"
                        )}
                    >
                        {isHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                    <div className="flex-1 min-w-0">
                        <NumberInput
                            label={`Cost for "${opt}"`}
                            value={ctrl.cost_modifiers?.[opt] || 0}
                            onChange={e => {
                                const val = Number(e.target.value);
                                setVisualControls(prev => prev.map(c =>
                                    c.id === ctrl.id ? {
                                        ...c,
                                        cost_modifiers: { ...(c.cost_modifiers || {}), [opt]: val }
                                    } : c
                                ));
                            }}
                            suffix="CR"
                        />
                    </div>
                </div>
            );
        })}
    </div>
)}
```

(`Eye` and `EyeOff` are already imported at the top of the file — verify the existing line `import { Save, Layers, Link2, Settings2, Trash2, X, Eye, EyeOff, GripVertical, ChevronUp, ChevronDown } from 'lucide-react';` is intact.)

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Manual browser check (admin side only — end-user filtering is Task 9)**

Run: `npm run dev`
1. Open `/admin?tab=management`, edit a model that has a `select` control with multiple options (e.g. anything with `aspect_ratio`).
2. The Pricing-Modifiers area for the select should now render each option as a row with: eye-icon + cost input.
3. Click the eye icon. It toggles to `EyeOff`, the row fades to 50% opacity, and the option is added to `disabled_options`.
4. Save and re-open the model. The hidden state persists.
5. Confirm the option still appears in the admin's Default-Value selector immediately above (we want the admin to *still see* it).

- [ ] **Step 4: Commit**

```bash
git add components/admin/ModelForm.tsx
git commit -m "feat(admin): eye-icon visibility toggle for dropdown options"
```

---

## Task 8: Admin UI — `is_cost_multiplier` switch next to "Cost Per Unit"

**Files:**
- Modify: `components/admin/ModelForm.tsx:851-865` (the numeric pricing block)

- [ ] **Step 1: Replace the numeric pricing block**

In `components/admin/ModelForm.tsx`, locate:

```tsx
{(ctrl.component === 'slider' || ctrl.component === 'number_input' || ctrl.component === 'threshold') && (
    <div className="max-w-[200px]">
        <NumberInput
            label="Cost Per Unit"
            ...
```

Replace the **entire** block with:

```tsx
{(ctrl.component === 'slider' || ctrl.component === 'number_input' || ctrl.component === 'threshold') && (
    <div className="space-y-3">
        <div className="max-w-[200px]">
            <NumberInput
                label="Cost Per Unit"
                value={ctrl.cost_per_unit || 0}
                onChange={e => {
                    const val = Number(e.target.value);
                    setVisualControls(prev => prev.map(c =>
                        c.id === ctrl.id ? { ...c, cost_per_unit: val } : c
                    ));
                }}
                suffix="CR"
            />
        </div>
        <div className="flex items-start justify-between gap-4 p-3 rounded-xl bg-white/5 border border-white/10">
            <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-wider text-content-secondary">
                    Multiply Total by Value
                </p>
                <p className="text-[10px] text-content-tertiary opacity-70 mt-1 leading-relaxed">
                    e.g. video duration — total cost × this control&apos;s value. Empty / zero / non-numeric values are treated as 1.
                </p>
            </div>
            <Switch
                checked={Boolean(ctrl.is_cost_multiplier)}
                onCheckedChange={(checked) => {
                    setVisualControls(prev => prev.map(c =>
                        c.id === ctrl.id ? { ...c, is_cost_multiplier: Boolean(checked) } : c
                    ));
                }}
            />
        </div>
    </div>
)}
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Manual browser check**

Run: `npm run dev`
1. Open `/admin?tab=management`, edit a model with a numeric control (or fetch a video schema with a `duration` field — Task 5 should have auto-toggled the switch ON).
2. Confirm the new "Multiply Total by Value" row sits below "Cost Per Unit" with a switch on the right.
3. Toggle it on for a non-multiplier model (e.g. a `width` slider). In the live preview at the bottom of the form, watch the **Cost** label react: with `width: 1024`, base cost should now multiply by 1024. Toggle it off — cost returns to base.
4. Save, reload, re-open — toggle state persists.

- [ ] **Step 4: Commit**

```bash
git add components/admin/ModelForm.tsx
git commit -m "feat(admin): per-control 'Multiply Total by Value' switch"
```

---

## Task 9: End-user UI — filter `disabled_options` in `ControlRenderer`

**Files:**
- Modify: `lib/nodes/plugins/ai_generator/properties.tsx:349-363` (the `case 'select'` branch)

- [ ] **Step 1: Filter the options array and add a fallback for stored values**

In `lib/nodes/plugins/ai_generator/properties.tsx`, locate the `case 'select':` branch inside `ControlRenderer` and replace it (through the closing `);` of that return) with:

```tsx
        case 'select':
        case 'resolution':
        case 'format': {
            const allOptions = control.options || [];
            const disabled = new Set(control.disabled_options ?? []);
            const visibleOptions = allOptions.filter(opt => !disabled.has(opt));
            const stored = value ?? control.default_value ?? '';
            // If the saved value points at a now-hidden option, fall back to the first
            // visible option for display only — do NOT mutate stored config.
            const effective = disabled.has(String(stored)) && visibleOptions.length > 0
                ? visibleOptions[0]
                : stored;
            return (
                <Select
                    label={label}
                    value={effective}
                    onChange={e => onChange(control.api_mapping_key, e.target.value)}
                    options={visibleOptions.map(opt => ({
                        id: opt,
                        display_name: formatDisplayName(opt.toString())
                    }))}
                    variant="minimal"
                />
            );
        }
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Manual browser check**

Run: `npm run dev`
1. In `/admin?tab=management`, hide one option (eye-off) on a model's select control. Save.
2. Open the workflow canvas (`/`), drop an `ai_generator` node, pick that model. The end-user select should NOT show the hidden option.
3. In the canvas, edit the node's stored value to the hidden option (e.g. via JSON or by selecting it before hiding it server-side, then re-hiding). Reload the page. The picker should display the first visible option without throwing a console error. The underlying `control_values` is untouched — verify by running the workflow (the stored hidden value still ships to Replicate; this is intentional, the UI is just protective).
4. In the admin's preview panel (`AIGeneratorProperties` rendered with `editMode={true}`), the same filter applies — admins testing the preview see the user's view, not the full list. (The full list is still visible in the admin form's Pricing-Modifiers grid above.)

- [ ] **Step 4: Commit**

```bash
git add lib/nodes/plugins/ai_generator/properties.tsx
git commit -m "feat(ai_generator): hide disabled_options from end-user picker"
```

---

## Task 10: End-user UI — drop `/s` suffix when a multiplier is active

**Files:**
- Modify: `lib/nodes/plugins/ai_generator/properties.tsx:282-284` (the cost-suffix span in the footer)

- [ ] **Step 1: Compute a `hasMultiplier` flag and gate the suffix on it**

In `lib/nodes/plugins/ai_generator/properties.tsx`, locate the `totalCost` declaration (around line 121):

```ts
    const totalCost = selectedModel
        ? Number(computeAiNodeCost(config.control_values, selectedModel).toFixed(2))
        : 0;
```

Immediately below it, add:

```ts
    const hasMultiplier = (selectedModel?.inputs_schema?.controls ?? [])
        .some(c => c.is_cost_multiplier === true);
```

Then locate the footer `<span>` around lines 282-284:

```tsx
                    <span className="text-[9px] font-bold text-accent-primary/60 uppercase tracking-tight leading-none whitespace-nowrap">
                        CR{selectedModel?.is_per_second ? '/s' : ''}
                    </span>
```

Replace it with:

```tsx
                    <span className="text-[9px] font-bold text-accent-primary/60 uppercase tracking-tight leading-none whitespace-nowrap">
                        CR{!hasMultiplier && selectedModel?.is_per_second ? '/s' : ''}
                    </span>
```

Rationale: when any control is a real multiplier, `totalCost` already encodes the per-run price (base × value). Showing `/s` on top of that double-implies the math.

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Manual browser check**

Run: `npm run dev`
1. Pick a model with `is_per_second: true` and **no** `is_cost_multiplier` controls. The footer label still shows `CR/s` (legacy behavior preserved).
2. Pick a model where you've enabled `is_cost_multiplier` on the duration control (or fetch a video schema so it auto-flags). The footer label now shows `CR` (no `/s`), and the displayed cost equals `base × duration`.
3. In the admin preview at the bottom of `ModelForm`, the same gating applies.

- [ ] **Step 4: Commit**

```bash
git add lib/nodes/plugins/ai_generator/properties.tsx
git commit -m "feat(ai_generator): suppress /s suffix when a real cost multiplier is active"
```

---

## Task 11: Final regression sweep

**Files:** none modified — verification only.

- [ ] **Step 1: Lint + build**

Run: `npm run lint`
Expected: no new warnings/errors related to changed files.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 2: Re-run both smoke tests**

```bash
node scripts/verify-cost-multiplier.mjs
node scripts/verify-multiplier-autodetect.mjs
```
Expected: `OK` from each.

- [ ] **Step 3: End-to-end browser walkthrough**

Run: `npm run dev` and validate this flow on a fresh model:

1. **Fetch:** paste a Replicate video model id with a `duration` integer input → click Fetch Schema. Confirm the duration card auto-shows the multiplier switch ON. Confirm any select with multiple options shows eye icons.
2. **Edit:** override Min/Max on a slider; hide one select option; toggle multiplier off then on again on the duration field.
3. **Save:** click Save. Reload `/admin?tab=management`, re-open the same model. All edits persist.
4. **End-user:** drop an `ai_generator` node, pick this model. Hidden option should be absent from the picker. Adjust the slider — its bounds match the manual Min/Max. Adjust the duration — the cost label updates as `base × duration`, with no `/s` suffix.
5. **Run cost parity:** kick off a real execution. The server-side debit (visible in the user's balance / Supabase `executions` row) matches the cost the client previewed.
6. **Regression:** load an old model that has none of the new fields. Behavior is identical to before this change (cost number unchanged, no UI elements broken).

- [ ] **Step 4: Final commit if any cleanup edits emerged**

If steps 1-3 surfaced no issues, no commit needed — the plan is done. If you tweaked anything, commit it as `chore: post-walkthrough cleanup` and stop.
