# Interactive Incremental Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AI-added/replacement nodes land where they belong — filling the gap left by deleted nodes and sitting beside the existing nodes they connect to — instead of being docked to the far right of the canvas.

**Architecture:** At end of an AI turn, run a single ELK *layered + interactive* relayout scoped to the connected component(s) the AI touched, seeded with every node's current position. ELK re-derives layers from existing x-coords and rows from existing y-coords, slotting new nodes into the structure. The result is anchor-pinned (translated so the least-drifted surviving node returns to its original spot) so existing nodes barely move and untouched components never move.

**Tech Stack:** TypeScript, Next.js, React Flow, elkjs (`elkjs/lib/elk.bundled.js`), Zustand store.

**Verification reality:** No unit-test runner exists in this repo. Verification = (1) a throwaway elkjs prototype harness run with `node`, (2) `npx tsc --noEmit`, (3) a manual in-app E2E checklist. There is no `pytest`/`jest`.

**Spec:** `docs/superpowers/specs/2026-06-11-interactive-incremental-layout-design.md`

---

## File Structure

- `scripts/proto-interactive-layout.mjs` — **Task 1 only**, throwaway. Self-contained elkjs spike on synthetic graphs. Validates the option combo + new-node x-seeding + measures existing-node displacement. Committed for reference, not imported by the app.
- `lib/workflow/layout-incremental.ts` — add three exports: `collectAffectedComponentIds` (pure), `anchorTranslate` (pure), `interactiveRelayout` (async, the ELK pass). Reuses existing `layoutGroupInterior`, `effectiveSize`, `layoutPatchAsync`.
- `components/editor/AiAddedZoom.tsx` — rewrite `relayoutAddedNodes` to detect the affected component, call `interactiveRelayout`, and write the full-component position map (with fallbacks).

No change to `lib/store/slices/workflow-slice.ts` — `updateNodePositions` already updates any id present in the position map.

---

## Task 1: Prototype gate — validate the ELK interactive combo

**Files:**
- Create (throwaway): `scripts/proto-interactive-layout.mjs`

This is a spike. It duplicates the relayout logic inline (does NOT import the TS lib) so it runs in plain node. Goal: confirm that interactive layering + x-seeding places a replacement node in the gap and that surviving nodes barely move.

- [ ] **Step 1: Write the prototype harness**

```js
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
```

- [ ] **Step 2: Run it**

Run: `node scripts/proto-interactive-layout.mjs`
Expected: `B2` final x ≈ 340 (between A=0 and C=680, i.e. in the gap), survivor `drift` values small (ideally 0 for the anchor and < ~60 for the other). Exact numbers depend on ELK; the pass criterion is "B2 in the gap, survivors barely move."

- [ ] **Step 3: Decision checkpoint**

If the prototype places `B2` in the gap with small survivor drift: **proceed to Task 2**, and copy the working `OPTS` and the `seed()` constants forward (they are the source of truth for Task 3).
If drift is large or `B2` lands wrong even after tuning the seed: **STOP** and fall back to the "anchor-dock + collision sweep" approach (Approach A in the spec). Record the finding in the spec's References section before switching.

- [ ] **Step 4: Commit**

```bash
git add scripts/proto-interactive-layout.mjs
git commit -m "spike: prototype ELK interactive relayout for incremental layout"
```

---

## Task 2: Pure helpers — affected component + anchor translation

**Files:**
- Modify: `lib/workflow/layout-incremental.ts` (add two exported pure functions near the top, after the constants)
- Create (throwaway verifier): `scripts/proto-layout-helpers.mjs`

- [ ] **Step 1: Add `collectAffectedComponentIds`**

Add to `lib/workflow/layout-incremental.ts`:

```ts
/**
 * Returns the set of node ids belonging to the connected component(s) that
 * contain any `touchedIds`. Components are computed over UNDIRECTED edges.
 * Group children are collapsed to their parent group for component purposes,
 * then expanded back, so a whole group travels with its component.
 */
export function collectAffectedComponentIds(
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
    touchedIds: Set<string>,
): Set<string> {
    const parentOf = new Map<string, string>();
    for (const n of nodes) if (n.parentNode) parentOf.set(n.id, n.parentNode);
    const rootId = (id: string): string => parentOf.get(id) ?? id;

    const adj = new Map<string, Set<string>>();
    const link = (a: string, b: string) => {
        if (!adj.has(a)) adj.set(a, new Set());
        adj.get(a)!.add(b);
    };
    for (const n of nodes) {
        const r = rootId(n.id);
        if (!adj.has(r)) adj.set(r, new Set());
    }
    for (const e of edges) {
        const s = rootId(e.source);
        const t = rootId(e.target);
        if (s === t) continue;
        link(s, t);
        link(t, s);
    }

    const visitedRoots = new Set<string>();
    const queue: string[] = [];
    for (const id of touchedIds) {
        const r = rootId(id);
        if (!visitedRoots.has(r)) {
            visitedRoots.add(r);
            queue.push(r);
        }
    }
    while (queue.length) {
        const cur = queue.shift()!;
        for (const nb of adj.get(cur) ?? []) {
            if (!visitedRoots.has(nb)) {
                visitedRoots.add(nb);
                queue.push(nb);
            }
        }
    }

    const result = new Set<string>();
    for (const n of nodes) {
        if (visitedRoots.has(rootId(n.id))) result.add(n.id);
    }
    return result;
}
```

- [ ] **Step 2: Add `anchorTranslate`**

Add below it. NOTE: operates on **top-level absolute** positions only; group-child positions are parent-relative and must NOT be passed here.

```ts
/**
 * Translate a laid-out set of TOP-LEVEL absolute positions so the surviving
 * (non-added) node that drifted least returns to its original coordinates.
 * Keeps the component visually anchored; only internal spacing changes.
 * Returns the laidOut map unchanged when there is no surviving node to anchor
 * to (fresh canvas) — the caller handles that case.
 */
export function anchorTranslate(
    original: Map<string, { x: number; y: number }>,
    laidOut: Map<string, { x: number; y: number }>,
    addedIds: Set<string>,
): Map<string, { x: number; y: number }> {
    let bestId: string | null = null;
    let bestDrift = Infinity;
    for (const [id, np] of laidOut) {
        if (addedIds.has(id)) continue;
        const op = original.get(id);
        if (!op) continue;
        const d = Math.hypot(np.x - op.x, np.y - op.y);
        if (d < bestDrift) {
            bestDrift = d;
            bestId = id;
        }
    }
    if (bestId == null) return laidOut;
    const op = original.get(bestId)!;
    const np = laidOut.get(bestId)!;
    const dx = op.x - np.x;
    const dy = op.y - np.y;
    const out = new Map<string, { x: number; y: number }>();
    for (const [id, p] of laidOut) out.set(id, { x: p.x + dx, y: p.y + dy });
    return out;
}
```

- [ ] **Step 3: Write a throwaway verifier for the pure helpers**

```js
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
```

- [ ] **Step 4: Run it**

Run: `node scripts/proto-layout-helpers.mjs`
Expected: three `PASS` lines, exit 0.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/workflow/layout-incremental.ts scripts/proto-layout-helpers.mjs
git commit -m "feat(layout): add affected-component + anchor-translate helpers"
```

---

## Task 3: Implement `interactiveRelayout`

**Files:**
- Modify: `lib/workflow/layout-incremental.ts`

Uses the **validated** `OPTS` and `seed()` constants from Task 1. The constants below are the best-current-guess; if Task 1 produced different working values, use those.

- [ ] **Step 1: Add interactive options + input type**

Add near `ELK_LAYERED_OPTIONS`:

```ts
// Interactive (incremental) layout: existing node x/y are fed as pseudo-
// positions so ELK re-derives layers from x and row-order from y, keeping
// the arrangement close to current while admitting new nodes. Confirmed
// viable by scripts/proto-interactive-layout.mjs.
const ELK_INTERACTIVE_OPTIONS = {
    'elk.algorithm': 'layered',
    'elk.direction': 'RIGHT',
    'elk.layered.cycleBreaking.strategy': 'INTERACTIVE',
    'elk.layered.layering.strategy': 'INTERACTIVE',
    'elk.layered.crossingMinimization.semiInteractive': 'true',
    'elk.separateConnectedComponents': 'false',
    'elk.spacing.nodeNode': '60',
    'elk.layered.spacing.nodeNodeBetweenLayers': '120',
};

export interface InteractiveRelayoutInput {
    // All nodes in the affected component(s), carrying CURRENT absolute
    // positions (top-level) / parent-relative positions (children) and
    // measured width/height where available.
    componentNodes: WorkflowNode[];
    componentEdges: WorkflowEdge[];
    addedIds: Set<string>;
}
```

- [ ] **Step 2: Add the new-node seeding helper**

```ts
// Seed added TOP-LEVEL nodes with an x/y derived from their connected
// EXISTING neighbors so interactive layering assigns the right column.
// Downstream of an existing node => to its right; upstream => to its left.
function seedAddedTopLevel(
    topLevel: WorkflowNode[],
    edges: WorkflowEdge[],
    addedIds: Set<string>,
    sizeOfNode: (n: WorkflowNode) => { width: number; height: number },
): Map<string, { x: number; y: number }> {
    const LAYER_GAP = 120;
    const byId = new Map(topLevel.map((n) => [n.id, n]));
    const seeded = new Map<string, { x: number; y: number }>();
    for (const n of topLevel) {
        seeded.set(n.id, { x: n.position?.x ?? 0, y: n.position?.y ?? 0 });
    }
    for (const n of topLevel) {
        if (!addedIds.has(n.id)) continue;
        const w = sizeOfNode(n).width;
        const ups = edges
            .filter((e) => e.target === n.id)
            .map((e) => byId.get(e.source))
            .filter((x): x is WorkflowNode => !!x && !addedIds.has(x.id));
        const downs = edges
            .filter((e) => e.source === n.id)
            .map((e) => byId.get(e.target))
            .filter((x): x is WorkflowNode => !!x && !addedIds.has(x.id));
        if (ups.length) {
            const ref = ups[0];
            seeded.set(n.id, {
                x: Math.max(...ups.map((u) => seeded.get(u.id)!.x)) + LAYER_GAP + sizeOfNode(ref).width,
                y: seeded.get(ref.id)!.y,
            });
        } else if (downs.length) {
            const ref = downs[0];
            seeded.set(n.id, {
                x: Math.min(...downs.map((d) => seeded.get(d.id)!.x)) - LAYER_GAP - w,
                y: seeded.get(ref.id)!.y,
            });
        }
    }
    return seeded;
}
```

- [ ] **Step 3: Add `interactiveRelayout`**

```ts
/**
 * Re-lay-out the affected connected component using ELK's interactive
 * (pseudo-position) layered layout, then anchor-pin the result so the
 * least-drifted surviving node returns to its original coordinates.
 *
 * Returns Map<nodeId, {x,y}> for ALL component nodes. Top-level nodes get
 * absolute positions; group children get parent-relative positions (and are
 * NOT anchor-translated — they ride with their parent).
 *
 * Throws on ELK failure so the caller can fall back to layoutPatchAsync.
 */
export async function interactiveRelayout(
    input: InteractiveRelayoutInput,
): Promise<Map<string, { x: number; y: number }>> {
    const { componentNodes, componentEdges, addedIds } = input;
    if (componentNodes.length === 0) return new Map();

    const ids = new Set(componentNodes.map((n) => n.id));
    const childOfGroup = new Map<string, WorkflowNode[]>(); // group id -> its children in the component
    const topLevel: WorkflowNode[] = [];
    for (const n of componentNodes) {
        if (n.parentNode && ids.has(n.parentNode)) {
            const arr = childOfGroup.get(n.parentNode) ?? [];
            arr.push(n);
            childOfGroup.set(n.parentNode, arr);
        } else {
            topLevel.push(n);
        }
    }

    const result = new Map<string, { x: number; y: number }>();

    // Group interiors: re-use existing per-group interior layout for groups
    // that gained new children; groups with only existing children keep their
    // current child positions (not added to result, so the store leaves them).
    const groupSizes = new Map<string, { width: number; height: number }>();
    for (const [groupId, kids] of childOfGroup) {
        const hasNewChild = kids.some((k) => addedIds.has(k.id));
        if (hasNewChild) {
            const { childPositions, groupSize } = await layoutGroupInterior(groupId, kids, componentEdges);
            for (const [id, pos] of childPositions) result.set(id, pos);
            groupSizes.set(groupId, groupSize);
        } else {
            groupSizes.set(groupId, effectiveSize(componentNodes.find((n) => n.id === groupId)!));
        }
    }

    // Top-level interactive pass.
    const sizeFor = (n: WorkflowNode) => groupSizes.get(n.id) ?? effectiveSize(n);
    const seeded = seedAddedTopLevel(topLevel, componentEdges, addedIds, sizeFor);

    const topIds = new Set(topLevel.map((n) => n.id));
    const childToParent = new Map<string, string>();
    for (const n of componentNodes) if (n.parentNode) childToParent.set(n.id, n.parentNode);
    const remap = (id: string): string | null => {
        let cur: string | undefined = id;
        const guard = new Set<string>();
        while (cur && !topIds.has(cur)) {
            if (guard.has(cur)) return null;
            guard.add(cur);
            cur = childToParent.get(cur);
        }
        return cur ?? null;
    };

    const seen = new Set<string>();
    const elkEdges: any[] = [];
    componentEdges.forEach((e, i) => {
        const s = remap(e.source);
        const t = remap(e.target);
        if (!s || !t || s === t) return;
        const key = `${s}→${t}`;
        if (seen.has(key)) return;
        seen.add(key);
        elkEdges.push({ id: e.id ?? `__elk_int_${i}`, sources: [s], targets: [t] });
    });

    const graph: any = {
        id: 'root',
        layoutOptions: ELK_INTERACTIVE_OPTIONS,
        children: topLevel.map((n) => {
            const { width, height } = sizeFor(n);
            const p = seeded.get(n.id)!;
            return { id: n.id, x: p.x, y: p.y, width, height };
        }),
        edges: elkEdges,
    };

    const laidOut = await elk.layout(graph);
    const topPositions = new Map<string, { x: number; y: number }>();
    for (const c of laidOut.children ?? []) {
        if (typeof c.x === 'number' && typeof c.y === 'number') {
            topPositions.set(c.id, { x: c.x, y: c.y });
        }
    }

    // Anchor-pin against the ORIGINAL top-level positions.
    const originalTop = new Map<string, { x: number; y: number }>();
    for (const n of topLevel) originalTop.set(n.id, { x: n.position?.x ?? 0, y: n.position?.y ?? 0 });
    const anchored = anchorTranslate(originalTop, topPositions, addedIds);

    for (const [id, p] of anchored) result.set(id, p);
    return result;
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (If `layoutGroupInterior`/`effectiveSize` are not yet exported within the module scope, they are already module-local in this file — no import needed.)

- [ ] **Step 5: Commit**

```bash
git add lib/workflow/layout-incremental.ts
git commit -m "feat(layout): add interactiveRelayout (incremental ELK pass)"
```

---

## Task 4: Wire `interactiveRelayout` into the end-of-turn settle

**Files:**
- Modify: `components/editor/AiAddedZoom.tsx` (rewrite `relayoutAddedNodes`, ~lines 216-273)

- [ ] **Step 1: Update the import**

Change the existing import of `layoutPatchAsync`:

```ts
import {
    layoutPatchAsync,
    interactiveRelayout,
    collectAffectedComponentIds,
} from '@/lib/workflow/layout-incremental';
```

- [ ] **Step 2: Rewrite `relayoutAddedNodes`**

Replace the whole function body (keep the JSDoc above it updated) with:

```ts
async function relayoutAddedNodes(addedIds: string[]) {
    const updateFn = updatePositionsRef.current;
    if (!updateFn || addedIds.length === 0) return;

    const addedSet = new Set(addedIds);
    const rfNodes = getNodes();
    const allNodes = rfNodes as unknown as WorkflowNode[];
    const allEdges = edgesRef.current;

    // Scope to the connected component(s) the AI touched. Untouched parts of
    // the canvas are never relaid-out and never move.
    const componentIds = collectAffectedComponentIds(allNodes, allEdges, addedSet);
    const componentNodes = allNodes.filter((n) => componentIds.has(n.id));
    const componentEdges = allEdges.filter(
        (e) => componentIds.has(e.source) && componentIds.has(e.target),
    );

    const survivors = componentNodes.filter((n) => !addedSet.has(n.id) && !(n as any).parentNode);

    // Fresh canvas / no surviving anchor / disconnected add: fall back to the
    // existing isolated-cluster dock (handles the empty-canvas no-jump case).
    if (survivors.length === 0) {
        return relayoutAddedNodesDock(addedIds);
    }

    let positions: Map<string, { x: number; y: number }>;
    try {
        positions = await interactiveRelayout({
            componentNodes,
            componentEdges,
            addedIds: addedSet,
        });
    } catch (err) {
        console.error('[AiAddedZoom] interactive relayout failed, docking:', err);
        return relayoutAddedNodesDock(addedIds);
    }
    if (positions.size === 0) return;

    // Safety: if surviving nodes were displaced too far, the interactive pass
    // disrupted the layout — dock instead so we never make placement worse.
    const MAX_SURVIVOR_DISPLACEMENT = 400;
    for (const n of survivors) {
        const np = positions.get(n.id);
        if (!np || !n.position) continue;
        if (Math.hypot(np.x - n.position.x, np.y - n.position.y) > MAX_SURVIVOR_DISPLACEMENT) {
            console.warn('[AiAddedZoom] survivor displacement too large, docking');
            return relayoutAddedNodesDock(addedIds);
        }
    }

    updateFn(positions);
}
```

- [ ] **Step 3: Keep the old dock path as a named fallback**

Rename the *current* implementation (the `layoutPatchAsync` version, body from old lines 217-272) to `relayoutAddedNodesDock` so the fallbacks above can call it. Its body is unchanged from today:

```ts
// Fallback: isolated-cluster ELK + far-right dock (the pre-incremental
// behavior). Used for fresh canvas, disconnected adds, and on any
// interactive-relayout failure or excessive displacement.
async function relayoutAddedNodesDock(addedIds: string[]) {
    const updateFn = updatePositionsRef.current;
    if (!updateFn || addedIds.length === 0) return;

    const addedSet = new Set(addedIds);
    const rfNodes = getNodes();
    const newNodes = rfNodes.filter((n) => addedSet.has(n.id)) as unknown as WorkflowNode[];
    const existingNodes = rfNodes.filter((n) => !addedSet.has(n.id)) as unknown as WorkflowNode[];
    if (newNodes.length === 0) return;

    let positions: Map<string, { x: number; y: number }>;
    try {
        positions = await layoutPatchAsync({
            existingNodes,
            existingEdges: edgesRef.current,
            newNodes,
            newEdges: edgesRef.current,
        });
    } catch (err) {
        console.error('[AiAddedZoom] re-layout failed:', err);
        return;
    }
    if (positions.size === 0) return;

    if (existingNodes.length === 0) {
        const topLevelNew = newNodes.filter((n) => !(n as any).parentNode);
        let curMinX = Infinity, curMinY = Infinity;
        let resMinX = Infinity, resMinY = Infinity;
        for (const n of topLevelNew) {
            const res = positions.get(n.id);
            if (!res || !n.position) continue;
            curMinX = Math.min(curMinX, n.position.x);
            curMinY = Math.min(curMinY, n.position.y);
            resMinX = Math.min(resMinX, res.x);
            resMinY = Math.min(resMinY, res.y);
        }
        if (isFinite(curMinX) && isFinite(resMinX)) {
            const dx = curMinX - resMinX;
            const dy = curMinY - resMinY;
            if (dx !== 0 || dy !== 0) {
                const topLevelIds = new Set(topLevelNew.map((n) => n.id));
                for (const id of topLevelIds) {
                    const p = positions.get(id);
                    if (p) positions.set(id, { x: p.x + dx, y: p.y + dy });
                }
            }
        }
    }

    updateFn(positions);
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/editor/AiAddedZoom.tsx
git commit -m "feat(layout): use interactive relayout at end-of-turn settle"
```

---

## Task 5: Manual in-app E2E verification

**Files:** none (run the app)

No automated runner exists; verify behavior live. Run `npm run dev`, open a workflow, and exercise each case via the chat brain.

- [ ] **Step 1: Replace-and-fill.** Build `A → B → C`. Ask the AI to replace `B` with a different node wired to `A` and `C`. Expected: the new node lands in B's old gap (same column, between A and C); A and C barely move.
- [ ] **Step 2: Add downstream.** With an existing node `D`, ask the AI to add a node that consumes `D`'s output. Expected: new node appears to the RIGHT of `D`, aligned, not docked far away.
- [ ] **Step 3: Add upstream.** Ask the AI to add a source node that feeds an existing node `E`. Expected: new node appears to the LEFT of `E`.
- [ ] **Step 4: Fresh canvas.** On an empty canvas, ask the AI to build a multi-node workflow. Expected: identical to today (dock fallback; no teleport to origin).
- [ ] **Step 5: Disconnected add.** With nodes present, ask the AI to add a node unconnected to anything. Expected: docks to the right (fallback), no crash.
- [ ] **Step 6: Grouped nodes.** With a group container present, ask the AI to add a node connected to a node inside/around the group. Expected: no overlap, group not corrupted, reveal-on-settle works (no flash of nodes at origin).
- [ ] **Step 7: Confirm no console errors** during any of the above; confirm new nodes reveal in their final positions (no visible jump).

- [ ] **Step 8: Final type-check + commit any fixes**

Run: `npx tsc --noEmit`
Then commit any adjustments made during E2E:

```bash
git add -A
git commit -m "fix(layout): E2E adjustments for interactive relayout"
```

---

## Task 6: Cleanup

- [ ] **Step 1: Remove or keep the prototype scripts**

The `scripts/proto-*.mjs` files are throwaway. Either delete them or leave them as reference (the repo already keeps ad-hoc scripts in `scripts/`). If deleting:

```bash
git rm scripts/proto-interactive-layout.mjs scripts/proto-layout-helpers.mjs
git commit -m "chore: remove interactive-layout prototype spikes"
```

- [ ] **Step 2: Update memory**

Add a memory file recording the feature (shipped state, tsc status, E2E pending) and a one-line pointer in `MEMORY.md`, per the project memory convention.

---

## Self-Review (filled by plan author)

- **Spec coverage:** ELK option combo (Task 1/3) ✓; pseudo-position seeding (Task 3) ✓; component scoping (Task 2/4) ✓; anchor-pin (Task 2/3) ✓; client end-of-turn location (Task 4) ✓; server provisional placement unchanged (no task needed — confirmed unchanged) ✓; groups as opaque boxes + interiors (Task 3) ✓; fresh-canvas/disconnected/failure fallbacks (Task 4) ✓; displacement safety threshold (Task 4) ✓; prototype gate first (Task 1) ✓.
- **Placeholder scan:** none — all steps carry full code or exact commands.
- **Type consistency:** `interactiveRelayout`, `collectAffectedComponentIds`, `anchorTranslate`, `relayoutAddedNodesDock`, `InteractiveRelayoutInput` used consistently across Tasks 2-4. `seedAddedTopLevel` is module-local. `ELK_INTERACTIVE_OPTIONS` defined once (Task 3).
