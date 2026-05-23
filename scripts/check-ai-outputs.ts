import assert from 'node:assert';
import {
    buildOutputItems,
    mergeRunIntoCollection,
    clampSelectedIndex,
    selectedValue,
    MAX_OUTPUTS_PER_NODE,
} from '../lib/nodes/plugins/ai_generator/outputs';

// buildOutputItems filters empties and tags metadata
const built = buildOutputItems('image', ['a', '', null, 'b'], 'exec1');
assert.deepStrictEqual(built.map((o) => o.value), ['a', 'b'], 'filters empties');
assert.strictEqual(built[0].execution_id, 'exec1', 'tags execution_id');
assert.strictEqual(built[0].type, 'image', 'tags type');

// merge prepends newest-first
const run1 = buildOutputItems('image', ['a'], 'e1');
const run2 = buildOutputItems('image', ['b', 'c'], 'e2');
const merged = mergeRunIntoCollection(run1, run2, 'e2');
assert.deepStrictEqual(merged.map((o) => o.value), ['b', 'c', 'a'], 'newest-first');

// merge is idempotent per execution_id (re-delivered event)
const again = mergeRunIntoCollection(merged, run2, 'e2');
assert.deepStrictEqual(again.map((o) => o.value), ['b', 'c', 'a'], 'no double-append');

// cap enforced
const big = buildOutputItems('image', Array.from({ length: 100 }, (_, i) => `u${i}`), 'eBig');
assert.strictEqual(
    mergeRunIntoCollection([], big, 'eBig').length,
    MAX_OUTPUTS_PER_NODE,
    'capped',
);

// clamp + selectedValue
assert.strictEqual(clampSelectedIndex(5, 3), 2, 'clamps high');
assert.strictEqual(clampSelectedIndex(-1, 3), 0, 'clamps low');
assert.strictEqual(clampSelectedIndex(0, 0), 0, 'empty → 0');
assert.strictEqual(clampSelectedIndex(undefined, 3), 0, 'undefined index → 0');
assert.strictEqual(selectedValue(merged, 1), 'c', 'selectedValue by index');
assert.strictEqual(selectedValue([], 0), undefined, 'empty → undefined');

console.log('check-ai-outputs: ALL ASSERTIONS PASSED');
