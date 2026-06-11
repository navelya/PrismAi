// scripts/proto-interactive-layout.mjs
// Throwaway spike: validates ELK layered+interactive relayout for the
// replace-and-fill use case. Run: node scripts/proto-interactive-layout.mjs
import ELK from 'elkjs/lib/elk.bundled.js';

const elk = new ELK();
const LAYER_GAP = 120; // elk.layered.spacing.nodeNodeBetweenLayers
const NODE_W = 220, NODE_H = 120;

const OPTS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.layered.cycleBreaking.strategy': 'INTERACTIVE',
  'elk.layered.layering.strategy': 'INTERACTIVE',
  'elk.layered.crossingMinimization.semiInteractive': 'true',
  'elk.separateConnectedComponents': 'false',
  'elk.spacing.nodeNode': '60',
  'elk.layered.spacing.nodeNodeBetweenLayers': String(LAYER_GAP),
};

// Scenario: A(0,0) -> B(340,0) -> C(680,0). Delete B, add B2 wired A->B2->C.
// B2 must land near x=340 (the gap), and A/C must stay ~put.
const nodes = [
  { id: 'A',  x: 0,   y: 0 },
  { id: 'C',  x: 680, y: 0 },
  { id: 'B2', x: 0,   y: 0, added: true }, // provisional/junk position
];
const edges = [
  { source: 'A',  target: 'B2' },
  { source: 'B2', target: 'C'  },
];

// Seed added nodes from their connected neighbors so interactive layering
// puts them in the right column. Downstream-of-existing => right of neighbor.
function seed(nodes, edges) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    if (!n.added) continue;
    const ups = edges.filter((e) => e.target === n.id).map((e) => byId.get(e.source)).filter((x) => x && !x.added);
    const downs = edges.filter((e) => e.source === n.id).map((e) => byId.get(e.target)).filter((x) => x && !x.added);
    if (ups.length) { n.x = Math.max(...ups.map((u) => u.x)) + LAYER_GAP + NODE_W; n.y = ups[0].y; }
    else if (downs.length) { n.x = Math.min(...downs.map((d) => d.x)) - LAYER_GAP - NODE_W; n.y = downs[0].y; }
  }
}
seed(nodes, edges);

const graph = {
  id: 'root',
  layoutOptions: OPTS,
  children: nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, width: NODE_W, height: NODE_H })),
  edges: edges.map((e, i) => ({ id: `e${i}`, sources: [e.source], targets: [e.target] })),
};

const out = await elk.layout(graph);
const pos = new Map(out.children.map((c) => [c.id, { x: c.x, y: c.y }]));

// Anchor-pin: translate so least-drifted survivor returns to its original.
const orig = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
let bestId = null, best = Infinity;
for (const n of nodes) {
  if (n.added) continue;
  const o = orig.get(n.id), p = pos.get(n.id);
  const d = Math.hypot(p.x - o.x, p.y - o.y);
  if (d < best) { best = d; bestId = n.id; }
}
const dx = orig.get(bestId).x - pos.get(bestId).x;
const dy = orig.get(bestId).y - pos.get(bestId).y;
for (const [, p] of pos) { p.x += dx; p.y += dy; }

console.log('anchor:', bestId);
for (const n of nodes) {
  const o = orig.get(n.id), p = pos.get(n.id);
  const drift = n.added ? 'n/a (new)' : Math.round(Math.hypot(p.x - o.x, p.y - o.y));
  console.log(`${n.id}\tfinal=(${Math.round(p.x)},${Math.round(p.y)})\tdrift=${drift}`);
}

// === scenario 2: add downstream ===
// Existing chain D(0,0) -> E(340,0). Add NEW node F wired E -> F (consumes E).
// Expected: F lands to the RIGHT of E (x > 340); D and E barely move.
async function runScenario(label, nodes, edges) {
  seed(nodes, edges);
  const graph = {
    id: 'root',
    layoutOptions: OPTS,
    children: nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, width: NODE_W, height: NODE_H })),
    edges: edges.map((e, i) => ({ id: `e${i}`, sources: [e.source], targets: [e.target] })),
  };
  const out = await elk.layout(graph);
  const pos = new Map(out.children.map((c) => [c.id, { x: c.x, y: c.y }]));
  const orig = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
  let bestId = null, best = Infinity;
  for (const n of nodes) {
    if (n.added) continue;
    const o = orig.get(n.id), p = pos.get(n.id);
    const d = Math.hypot(p.x - o.x, p.y - o.y);
    if (d < best) { best = d; bestId = n.id; }
  }
  const dx = orig.get(bestId).x - pos.get(bestId).x;
  const dy = orig.get(bestId).y - pos.get(bestId).y;
  for (const [, p] of pos) { p.x += dx; p.y += dy; }
  console.log(`=== ${label} ===`);
  console.log('anchor:', bestId);
  for (const n of nodes) {
    const o = orig.get(n.id), p = pos.get(n.id);
    const drift = n.added ? 'n/a (new)' : Math.round(Math.hypot(p.x - o.x, p.y - o.y));
    console.log(`${n.id}\tfinal=(${Math.round(p.x)},${Math.round(p.y)})\tdrift=${drift}`);
  }
}

await runScenario('scenario 2', [
  { id: 'D', x: 0,   y: 0 },
  { id: 'E', x: 340, y: 0 },
  { id: 'F', x: 0,   y: 0, added: true }, // provisional/junk position
], [
  { source: 'D', target: 'E' },
  { source: 'E', target: 'F' },
]);
