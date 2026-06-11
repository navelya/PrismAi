// scripts/proto-layout-helpers.mjs — run: node scripts/proto-layout-helpers.mjs
// Mirrors the two pure helpers inline (the lib is TS; this spike stays in JS)
// and asserts their behavior on small fixtures. PASS/FAIL printed.

function collectAffectedComponentIds(nodes, edges, touched) {
  const parentOf = new Map(); for (const n of nodes) if (n.parentNode) parentOf.set(n.id, n.parentNode);
  const root = (id) => parentOf.get(id) ?? id;
  const adj = new Map(); const link = (a, b) => { if (!adj.has(a)) adj.set(a, new Set()); adj.get(a).add(b); };
  for (const n of nodes) { const r = root(n.id); if (!adj.has(r)) adj.set(r, new Set()); }
  for (const e of edges) { const s = root(e.source), t = root(e.target); if (s === t) continue; link(s, t); link(t, s); }
  const seen = new Set(), q = [];
  for (const id of touched) { const r = root(id); if (!seen.has(r)) { seen.add(r); q.push(r); } }
  while (q.length) { const c = q.shift(); for (const nb of adj.get(c) ?? []) if (!seen.has(nb)) { seen.add(nb); q.push(nb); } }
  const out = new Set(); for (const n of nodes) if (seen.has(root(n.id))) out.add(n.id); return out;
}

let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify([...got].sort()) === JSON.stringify([...want].sort()); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) { fails++; console.log('  got', [...got], 'want', want); } };

// Two separate chains; touching one must not pull in the other.
const nodes = [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'X' }, { id: 'Y' }];
const edges = [{ source: 'A', target: 'B' }, { source: 'B', target: 'C' }, { source: 'X', target: 'Y' }];
eq('component of B', collectAffectedComponentIds(nodes, edges, new Set(['B'])), ['A', 'B', 'C']);
eq('component of X', collectAffectedComponentIds(nodes, edges, new Set(['X'])), ['X', 'Y']);
eq('isolated touched node', collectAffectedComponentIds([{ id: 'Z' }], [], new Set(['Z'])), ['Z']);

process.exit(fails ? 1 : 0);
