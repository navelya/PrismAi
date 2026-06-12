// Ad-hoc check for splitLayerAtPlayhead invariants. Run: node scripts/check-split-layer.js
// Mirrors lib/nodes/plugins/compositor/shared.ts:splitLayerAtPlayhead.
const MIN = 0.05;
function split(layer, playhead, eff) {
  const start = Math.max(0, layer.startTime || 0);
  const end = start + eff;
  if (playhead <= start + MIN || playhead >= end - MIN) return [layer, null];
  const leftDur = playhead - start;
  const rightDur = end - playhead;
  const left = { ...layer, duration: leftDur };
  const right = { ...layer, id: 'layer_NEW', startTime: playhead, duration: rightDur, trimIn: (layer.trimIn || 0) + leftDur };
  return [left, right];
}
function assert(cond, msg) { if (!cond) { console.error('FAIL:', msg); process.exit(1); } }

// Video clip: start=2, trimIn=1, eff=6 (source window [1,7)), split at t=5.
const base = { id: 'L1', startTime: 2, trimIn: 1, duration: 6 };
const [l, r] = split(base, 5, 6);
assert(r !== null, 'should split inside');
assert(Math.abs(l.duration - 3) < 1e-9, 'left duration = playhead - start = 3');
assert(Math.abs(r.startTime - 5) < 1e-9, 'right starts at playhead');
assert(Math.abs(r.duration - 3) < 1e-9, 'right duration = 3');
assert(Math.abs((l.duration + r.duration) - 6) < 1e-9, 'durations conserved = eff');
assert(Math.abs(r.trimIn - 4) < 1e-9, 'right trimIn = 1 + 3 = 4 (time-locked source)');
assert(r.id !== l.id, 'right has a fresh id');
assert(Math.abs(l.startTime - 2) < 1e-9, 'left start unchanged');

// Playhead outside (before) → no split.
assert(split(base, 2.01, 6)[1] === null, 'no split just after start');
// Playhead outside (after) → no split.
assert(split(base, 7.99, 6)[1] === null, 'no split just before end');

console.log('OK: splitLayerAtPlayhead invariants hold');
