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
