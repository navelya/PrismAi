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
