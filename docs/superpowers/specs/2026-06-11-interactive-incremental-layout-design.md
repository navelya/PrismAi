# Interactive Incremental Layout for AI-Added Nodes

**Date:** 2026-06-11
**Status:** Approved design, pending implementation plan
**Branch:** dev

## Problem

When the chat brain edits a workflow, it positions newly-added nodes well
relative to *each other*, but the whole new cluster is **docked to the far
right of the existing canvas** regardless of which existing nodes it connects
to. The triggering use case: the AI **replaces** nodes (deletes the old ones,
adds new ones wired to the same surviving neighbors), and the replacements land
far away instead of filling the gap the deleted nodes left behind.

### Root cause (current behavior)

`layoutPatchAsync` ([lib/workflow/layout-incremental.ts](../../../lib/workflow/layout-incremental.ts))
lays out the new nodes as an **isolated subgraph** and then translates the whole
cluster via `computeDockTranslation` to sit right of the existing canvas's
bounding box (`dx = (maxRight + 80) - subMinX`). Two consequences:

1. Edges connecting new nodes to **existing** nodes are dropped before ELK sees
   them (`layoutTopLevel`, the `if (!src || !tgt) continue;` guard) — ELK has no
   knowledge of where a new node's real neighbors sit.
2. The dock references the entire-canvas bounding box, not the specific nodes
   the new cluster connects to.

This is a deliberate design: existing nodes are **never** passed to ELK, so they
can provably never move. The cost is the "push to the end" placement.

## Why ELK can't solve this with a pure-config flag

Research into ELK's capabilities (see References):

- `org.eclipse.elk.position` hard-pins coordinates only under the separate
  **Fixed Layout** algorithm, which lays out nothing new — you cannot mix
  "fixed for these, layered for those" in one pass.
- `org.eclipse.elk.interactive` takes the **whole graph** and *recomputes* all
  coordinates, "modifying the current layout as little as possible" — existing
  nodes shift; they are not frozen.
- `layerChoiceConstraint` / `positionChoiceConstraint` would pin nodes, but
  **elkjs does not evaluate or enforce them** (that is done by KLighD, a
  separate Eclipse tool). Per the ELK team: *"This solution requires more than
  ELK can deliver. ELK only specifies the corresponding constraints. Evaluating
  and enforcing them is not part of ELK."*

What **does** work in plain elkjs: **interactive strategies driven by
pseudo-positions**. Feed every node its current `x/y` and enable the interactive
strategy combo; ELK re-derives layers from existing x-coords and row-order from
existing y-coords, keeping the arrangement close to current while slotting new
nodes into the structure.

## Decision

Adopt **interactive incremental relayout** (chosen over the alternative
"anchor-dock + custom collision sweep" because it leans on built-in ELK for
layering, gap-filling, and spacing, and is the natural fit for the replace-and-
fill use case). Accepted trade-off: **already-placed nodes may shift slightly**;
we bound that shift with component scoping + anchor pinning.

## Approach

### ELK options

```
elk.algorithm:                          layered
elk.direction:                          RIGHT
elk.layered.cycleBreaking.strategy:     INTERACTIVE
elk.layered.layering.strategy:          INTERACTIVE
elk.layered.crossingMinimization.semiInteractive: true
elk.separateConnectedComponents:        false
elk.spacing.nodeNode:                   60   (match existing)
elk.layered.spacing.nodeNodeBetweenLayers: 120 (match existing)
```

Each node is fed its **current absolute position** as its ELK `x/y`
(pseudo-position). New nodes are seeded with an x derived from their connected
neighbor (neighbor's x + one layer's worth of spacing for downstream, − for
upstream) so interactive layering assigns them the correct column. **Exact
seeding is validated by the prototype gate below.**

### Scope: affected connected component(s) only, anchor-pinned

Not a whole-canvas relayout. At end of turn:

1. Build connected components over the **post-patch** graph (deleted nodes are
   already gone; surviving + new nodes remain).
2. Relayout only the component(s) containing a node the AI added or rewired this
   turn. Untouched components are never passed to ELK and never move.
3. **Anchor-pin:** after ELK returns, select the surviving node whose position
   drifted least, and translate the whole component result so that node returns
   to its original absolute coordinates. The component stays visually anchored;
   only internal spacing changes to admit the new nodes.

### Where it runs

The authoritative pass is **client-side, end-of-turn**, in
[components/editor/AiAddedZoom.tsx](../../../components/editor/AiAddedZoom.tsx) —
the only place with React Flow's *measured* node sizes plus all current
positions via `getNodes()`.

- New function `interactiveRelayout(...)` in
  [lib/workflow/layout-incremental.ts](../../../lib/workflow/layout-incremental.ts):
  takes the affected component's nodes + edges with current absolute positions
  and measured sizes; returns new positions for **all** nodes in the component
  (not just the added ones).
- `relayoutAddedNodes` is rewritten to: detect the affected component(s), call
  `interactiveRelayout`, anchor-translate, and pass the full position map to
  `updateFn`. `updateNodePositions`
  ([lib/store/slices/workflow-slice.ts](../../../lib/store/slices/workflow-slice.ts))
  already updates any node id present in the map — no store change required.
- Server-side `runAddNode`
  ([lib/chat/tools/handlers.ts](../../../lib/chat/tools/handlers.ts)) keeps its
  cheap `layoutPatchAsync` call purely as a **provisional** position for newly-
  added nodes, which stay hidden via `hiddenAddedIds` until the client pass
  reveals them — so there is no flash and the client pass is the final word.
- Reveal-on-settle is unchanged: new nodes stay hidden until `interactiveRelayout`
  finishes, then reveal in their corrected positions.

## Edge cases

- **Groups:** keep the existing two-scope handling — group interiors are laid
  out as today; interactive strategies apply at the **top-level** pass with
  groups as opaque measured boxes. (Highest-risk area; covered by the prototype
  gate.)
- **Fresh canvas / no surviving anchor** (AI built everything from scratch): no
  anchor to pin → fall back to the existing empty-canvas no-jump behavior in
  `relayoutAddedNodes`.
- **Disconnected new cluster** (no edge to anything existing): nothing to anchor
  to → place via today's far-right dock.
- **Safety fallback:** if the interactive pass throws, or total existing-node
  displacement exceeds a threshold, fall back to the current `layoutPatchAsync`
  dock — never make placement *worse* than today.

## Prototype gate (implementation step 1)

`layering.strategy: INTERACTIVE` assigns layers by x-coordinate, so the new-node
x-seeding and the exact option combo carry genuine uncertainty. Before writing
production code, build a throwaway prototype (a `scripts/` node script or a
scratch harness) that runs `interactiveRelayout` against 2–3 real replace-node
scenarios and **measures existing-node displacement**. Only proceed to the
production implementation if displacement is acceptable with anchor-pinning. If
not, fall back to the "anchor-dock + collision sweep" approach without having
sunk production work.

## Files touched

- `lib/workflow/layout-incremental.ts` — new `interactiveRelayout`; shared
  helpers for connected-components and anchor translation.
- `components/editor/AiAddedZoom.tsx` — rewrite `relayoutAddedNodes` to use the
  component-scoped interactive pass + anchor-pin + full-component position write.
- `lib/chat/tools/handlers.ts` — unchanged behavior; server layout stays as a
  provisional hidden placement (confirm, don't alter).
- (No change to `updateNodePositions` in `workflow-slice.ts`.)

## Out of scope

- Changing the server-side layout to be the authoritative pass.
- Re-laying out untouched parts of the canvas.
- The `layerChoiceConstraint`/`positionChoiceConstraint` enforcement path
  (not supported by elkjs).

## References

- ELK — Constraining the Model: https://eclipse.dev/elk/blog/posts/2023/23-01-09-constraining-the-model.html
- ELK Layered algorithm: https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html
- ELK `position` option: https://eclipse.dev/elk/reference/options/org-eclipse-elk-position.html
- ELK `interactive` option: https://eclipse.dev/elk/reference/options/org-eclipse-elk-interactive.html
- elkjs: https://github.com/kieler/elkjs
