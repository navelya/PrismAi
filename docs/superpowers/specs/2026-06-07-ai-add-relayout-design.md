# AI-add re-layout with measured sizes — design

**Date:** 2026-06-07
**Status:** Approved

## Problem

When the chat brain adds nodes to the canvas, they land too close together
(see the prompt → image-generation pair: nearly touching). Clicking the
manual **Auto-layout** button immediately spaces them correctly.

### Root cause

There are two layout code paths that share the *same* ELK configuration
(`elk.direction: RIGHT`, 60px node spacing, **120px between layers**) but
feed ELK *different node sizes*:

| Path | Where | Sizes fed to ELK |
| --- | --- | --- |
| AI add | `lib/chat/tools/handlers.ts` → `layoutPatchAsync` (`lib/workflow/layout-incremental.ts`) | **server-side** — no React Flow `measured`, so `effectiveSize` falls back to the static registry in `lib/workflow/layout-utils.ts` (`prompt: 185w`, `ai_generator: 210w`) |
| Auto-layout button | `components/editor/EditorCanvas.tsx:2083` → `autoLayoutNodesAsync` | **client-side** — passes `reactFlowInstance.getNodes()`, i.e. real measured DOM sizes |

Real rendered sizes are ~2× the registry values (prompt ~440w; `ai_generator`
is dynamic — it sizes to the generated image's aspect ratio). ELK places the
downstream node's left edge at `prompt.x + 185 + 120`, but once rendered the
prompt's true right edge (~440) eats almost the entire 120px gap, so the nodes
look glued. The auto-layout button looks right only because it sees the true
widths.

`layoutPatchAsync` is already exactly "ELK over just the new portion, existing
nodes as fixed anchors," and `effectiveSize` already *prefers* `measured` when
present — it simply never receives measured sizes server-side.

## Fix

Re-run the same incremental ELK pass **client-side, once, at end-of-turn**,
after React Flow has measured the new nodes.

1. **Keep the server-side pass unchanged** — it gives nodes a sane rough
   placement during streaming so they never appear stacked at origin.

2. **Track newly-added node ids per turn.** `aiTurn.touchedNodeIds`
   (`lib/store/slices/ui-slice.ts`) already exists but mixes in `updatedNodes`
   and edge endpoints — existing nodes we must NOT move. Add a separate
   `addedNodeIds: string[]` to `aiTurn`, populated from `patch.addedNodes` in
   `recordAiPatch`. Reset to `[]` in `beginAiTurn`.

3. **Re-layout after measurement.** Reuse the existing end-of-turn `requestAnimationFrame`
   transition in `AiAddedZoom.tsx` (active → inactive). After the rAF:
   - `newNodes` = measured RF nodes whose id ∈ `addedNodeIds`
   - `existingNodes` = all other measured RF nodes (fixed anchors)
   - call `layoutPatchAsync({ existingNodes, existingEdges: edges, newNodes, newEdges: edges })`
   - apply via `updatePositions(result)`; the existing camera settle `fitBounds`
     then runs on the corrected layout.

   `AiAddedZoom` is mounted inside `<ReactFlow>` and already has the rAF +
   override-guard plumbing, so it is the natural home. It needs access to
   `edges` and `updatePositions` (thread as props, mirroring `EditorCanvas`).

4. **No-jump guard for a fresh canvas.** When there are no anchor nodes,
   `computeDockTranslation` returns `{0,0}` → results land near origin and the
   new nodes would teleport. Detect the empty-anchor case and translate the
   result so its top-left matches the new nodes' *current* bbox top-left
   (refine spacing in place). With existing anchors present, keep the normal
   dock-right behaviour.

## Out of scope

- Changing the ELK configuration or the static registry values.
- Re-laying out during the stream (only the end-of-turn settle).
- Moving existing / updated nodes — only `addedNodeIds` are repositioned.

## Files touched

- `lib/store/slices/ui-slice.ts` — add `addedNodeIds` to `aiTurn`, populate in `recordAiPatch`, reset in `beginAiTurn`.
- `lib/store/types.ts` — type the new `addedNodeIds` field.
- `components/editor/AiAddedZoom.tsx` — end-of-turn re-layout via `layoutPatchAsync` on measured nodes; props for `edges` + `updatePositions`.
- `components/editor/EditorCanvas.tsx` — pass `edges` + `updatePositions` to `AiAddedZoom`.
