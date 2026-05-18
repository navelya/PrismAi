# Cycle Prevention + Compositor Dynamic Width Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reject wire drops that would close a directed cycle in the workflow graph (with a brief on-node toast explaining why), and make the `compositor` node card use the same dynamic max-content / 320-420 width clamp pattern as `blur` and `ai_generator` so wide/narrow canvases get a card sized to their aspect.

**Architecture:** A single pure helper `wouldCreateCycle(source, target, edges)` lives in `lib/editor/handle-compatibility.ts` and is consumed in two places: (a) the existing `handleIsValidConnection` in `EditorCanvas` rejects the drop, and (b) `BaseNode` derives an `isCycleTarget` flag from the live `useEdges()` list so it can both visually dim the node (reusing the existing `dragRole === 'incompatible'` styling path) and render a small hover-tracked toast. The compositor change is a localized swap of `width={320}` for the existing `'max-content' / minWidth 320 / maxWidth 420` idiom, plus giving the `LivePreview` wrapper an intrinsic pixel width so `max-content` resolves.

**Tech Stack:** React, React Flow, TypeScript, Tailwind CSS, Zustand (`useAppStore`). No test runner in this repo (per `CLAUDE.md`); verification is `npx tsc --noEmit` (per the user's verification-commands memory: `npm run build` and `npm run lint` are unreliable here) plus a manual smoke-test via `npm run dev`.

**Spec:** [docs/superpowers/specs/2026-05-18-cycle-prevention-and-compositor-resize-design.md](../specs/2026-05-18-cycle-prevention-and-compositor-resize-design.md)

---

## File Map

| File | Role |
|---|---|
| `lib/editor/handle-compatibility.ts` (MODIFY) | Add `wouldCreateCycle` helper |
| `components/editor/EditorCanvas.tsx` (MODIFY) | Call `wouldCreateCycle` in `handleIsValidConnection` |
| `lib/nodes/core/canvas/BaseNode.tsx` (MODIFY) | Derive `isCycleTarget` from live edges, fold into `dragRole`, track hover, render toast |
| `lib/nodes/plugins/compositor/component.tsx` (MODIFY) | Replace `width={320}` with max-content style; give `LivePreview` wrapper intrinsic width |

---

## Task 1: Add `wouldCreateCycle` helper

**Files:**
- Modify: `lib/editor/handle-compatibility.ts`

- [ ] **Step 1: Add the helper**

Append this function to `lib/editor/handle-compatibility.ts` (place it just below `typesAreCompatible`, so the connection-validator-related helpers live next to each other):

```ts
/**
 * True if adding `source → target` to the current edge set would close a
 * directed cycle. Forward DFS from `target` — if we reach `source`, the new
 * edge would loop back. O(V + E); fine for typical workflow sizes (we have
 * worked with up to a few hundred nodes / edges per session in practice).
 *
 * Self-loops are reported as a cycle for convenience; callers can also rely
 * on their own `source === target` early-out if they want a separate code
 * path for that case.
 */
export function wouldCreateCycle(
    sourceId: string,
    targetId: string,
    edges: { source: string; target: string }[],
): boolean {
    if (sourceId === targetId) return true;
    const adj = new Map<string, string[]>();
    for (const e of edges) {
        if (!adj.has(e.source)) adj.set(e.source, []);
        adj.get(e.source)!.push(e.target);
    }
    const stack = [targetId];
    const seen = new Set<string>();
    while (stack.length) {
        const n = stack.pop()!;
        if (n === sourceId) return true;
        if (seen.has(n)) continue;
        seen.add(n);
        const next = adj.get(n);
        if (next) stack.push(...next);
    }
    return false;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors (the helper is pure, no imports, returns a boolean).

- [ ] **Step 3: Commit**

```bash
git add lib/editor/handle-compatibility.ts
git commit -m "feat(editor): add wouldCreateCycle helper for connection validator"
```

---

## Task 2: Reject cyclic wire drops in the connection validator

**Files:**
- Modify: `components/editor/EditorCanvas.tsx`

- [ ] **Step 1: Import `wouldCreateCycle`**

In `components/editor/EditorCanvas.tsx`, extend the existing import from `@/lib/editor/handle-compatibility` (around line 34) to include `wouldCreateCycle`. The block should read:

```ts
import {
    PendingConnection,
    getNodeHandleType,
    typesAreCompatible,
    findHandleForNode,
    wouldCreateCycle,
} from '@/lib/editor/handle-compatibility';
```

- [ ] **Step 2: Plug the cycle check into `handleIsValidConnection`**

Locate `handleIsValidConnection` (around line 743). Replace the existing body with:

```ts
const handleIsValidConnection = useCallback((connection: Connection) => {
    if (connection.source === connection.target) return false;
    if (!reactFlowInstance) return true;

    const sourceNode = reactFlowInstance.getNode(connection.source!);
    const targetNode = reactFlowInstance.getNode(connection.target!);
    if (!sourceNode || !targetNode) return true;

    const src = getNodeHandleType(sourceNode as any, connection.sourceHandle, 'source', models, sharedRegistry);
    const tgt = getNodeHandleType(targetNode as any, connection.targetHandle, 'target', models, sharedRegistry);
    // Fail open when either side can't be resolved (unknown plugin, missing
    // model row) — better to allow a connection we can't classify than to
    // silently block legitimate ones.
    if (!src || !tgt) return true;
    if (!typesAreCompatible(src.type, tgt.type)) return false;

    // Refuse drops that would close a directed cycle in the graph. The
    // visual rejection (red wire, silent discard) is React Flow's default
    // behavior for a `false` return; the BaseNode toast lives separately.
    if (wouldCreateCycle(connection.source!, connection.target!, reactFlowInstance.getEdges())) {
        return false;
    }
    return true;
}, [reactFlowInstance, models]);
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add components/editor/EditorCanvas.tsx
git commit -m "feat(editor): reject cyclic wire drops in connection validator"
```

---

## Task 3: Cycle-target detection + hover toast in `BaseNode`

**Files:**
- Modify: `lib/nodes/core/canvas/BaseNode.tsx`

- [ ] **Step 1: Add `useState` to the React import**

In `lib/nodes/core/canvas/BaseNode.tsx`, line 3 currently reads:

```ts
import React, { memo, useMemo } from 'react';
```

Change it to:

```ts
import React, { memo, useMemo, useState } from 'react';
```

- [ ] **Step 2: Import `wouldCreateCycle` + `NodeToolbar`**

Locate the existing import from `@/lib/editor/handle-compatibility` (around line 11) and extend it:

```ts
import { findHandleForNode, findAllCompatibleHandlesForNode, wouldCreateCycle } from '@/lib/editor/handle-compatibility';
```

Then locate the existing `reactflow` import block (around line 4) and add `NodeToolbar` to the import list:

```ts
import { Handle, Position, NodeToolbar, useReactFlow, useEdges, useStore, ReactFlowState, useUpdateNodeInternals } from 'reactflow';
```

`NodeToolbar` is React Flow's primitive for floating UI anchored to a node. It renders OUTSIDE the node's DOM tree (via React Flow's viewport), so it is not affected by `opacity-30` / `grayscale` applied to the incompatible-target card — which is exactly what we need for a visible toast on a dimmed node.

- [ ] **Step 3: Derive `isCycleTarget` from the live edge list**

Right after the existing `dragRole` `useMemo` block (the one that ends around line 135 with `return match ? 'compatible' : 'incompatible';`), insert:

```ts
const isCycleTarget = useMemo(() => {
    if (!wireDrag) return false;
    if (wireDrag.originNodeId === id) return false;
    // Direction-aware: a wire from an OUTPUT handle ('source' origin) would
    // form edge origin → this; a wire from an INPUT handle ('target' origin)
    // would form edge this → origin. Check both.
    const src = wireDrag.originHandleType === 'source' ? wireDrag.originNodeId : id;
    const tgt = wireDrag.originHandleType === 'source' ? id : wireDrag.originNodeId;
    return wouldCreateCycle(src, tgt, edges);
}, [wireDrag, id, edges]);
```

Note: `edges` is already in scope at this point — `const edges = useEdges();` is declared a few lines below `dragRole`. **You must move that `useEdges()` line up** so it precedes the `isCycleTarget` block. The cleanest place is just above the existing `dragRole` `useMemo`:

```ts
const wireDrag = useWireDrag();
const models = useAppStore((s) => s.models);
const edges = useEdges();   // moved up; was declared below

const dragRole: 'none' | 'origin' | 'compatible' | 'incompatible' = useMemo(() => {
    // ... unchanged body ...
}, [wireDrag, id, type, nodeData?.config, models]);

const isCycleTarget = useMemo(() => {
    // ... block from above ...
}, [wireDrag, id, edges]);
```

Then delete the old `const edges = useEdges();` line further down (around line 186) — `useEdges` must be called exactly once per render.

- [ ] **Step 4: Fold `isCycleTarget` into the visual `dragRole`**

A cycle target should look the same as a type-incompatible target (dimmed + grayscaled). The simplest way: define an `effectiveDragRole` derived from both flags, and use it everywhere `dragRole` is currently consulted for visuals. Add this immediately after the `isCycleTarget` `useMemo`:

```ts
// Cycle targets visually read the same as type-incompatible targets — the
// toast (rendered below) is what distinguishes the two cases for the user.
const effectiveDragRole = isCycleTarget ? 'incompatible' : dragRole;
```

Then replace the one site that consults `dragRole` for visuals — line 289:

```diff
- dragRole === 'incompatible' && "opacity-30 grayscale-[0.6] transition-[border-color,background-color,opacity,filter] duration-150",
+ effectiveDragRole === 'incompatible' && "opacity-30 grayscale-[0.6] transition-[border-color,background-color,opacity,filter] duration-150",
```

Leave `dragRole` itself in place — it's still the correct input for `compatibleHandleIds` and `isHandleLabelForced` (those are about *type* compatibility for label reveal; we don't want to start revealing labels on cycle targets).

- [ ] **Step 5: Add the hover state**

Inside the component body (anywhere after `wireDrag` is read; placing it right after `isCycleTarget` keeps the wire-drag logic clustered):

```ts
const [isHoveredDuringWireDrag, setIsHoveredDuringWireDrag] = useState(false);
```

- [ ] **Step 6: Wire `onPointerEnter` / `onPointerLeave` on the outer card**

The root element is the `motion.div` opening around line 269. Find the JSX where `onAnimationComplete` is set and add the two handlers next to it:

```diff
  <motion.div
      ref={ref as any}
      initial={isNew ? { scale: 0.8, opacity: 0 } : false}
      animate={ANIMATE_TARGET}
      onAnimationComplete={() => {
          if (isNew) updateNodeInternals(id);
      }}
+     onPointerEnter={() => { if (wireDrag) setIsHoveredDuringWireDrag(true); }}
+     onPointerLeave={() => setIsHoveredDuringWireDrag(false)}
      transition={isDragging ? DRAG_TRANSITION : SHARED_TRANSITION}
```

The `if (wireDrag)` guard on enter avoids paying the state-update cost when no wire is being dragged. The leave handler is unconditional so the toast disappears reliably even if the wire ended while the cursor was still inside the node.

- [ ] **Step 7: Render the toast via `NodeToolbar`**

Place this as the first child of the `motion.div` body — immediately after the opening `>` of `<motion.div ... >` (around line 305, just before the existing `{/* Action Buttons ... */}` comment block):

```tsx
<NodeToolbar
    nodeId={id}
    isVisible={!!wireDrag && isCycleTarget && isHoveredDuringWireDrag}
    position={Position.Top}
    align="start"
>
    <div className="px-2 py-1 rounded-md bg-bg-primary/90 border border-accent-error/50
                    text-[10px] font-medium text-accent-error whitespace-nowrap shadow-lg
                    pointer-events-none">
        Circular connections are not allowed
    </div>
</NodeToolbar>
```

Why `NodeToolbar` instead of a plain `absolute` div: the existing `effectiveDragRole === 'incompatible'` styling on `motion.div` applies `opacity-30`, which would propagate to any child element (CSS opacity inherits multiplicatively). `NodeToolbar` renders outside `motion.div`'s DOM tree (React Flow portals it into the viewport, positioned relative to the node's coordinates), so the toast stays at full opacity over a dimmed card — matching the screenshot's high-contrast red on dark background.

`pointer-events-none` on the inner div keeps the cursor from interacting with the toast itself; only the underlying card receives `onPointerEnter` / `onPointerLeave`. This prevents toast flicker (cursor enters node → toast shows → cursor moves to overlap toast → if pointer-events were enabled, the card's `onPointerLeave` would fire → toast hides → cursor re-enters card → toast shows → infinite flicker).

- [ ] **Step 8: Clear hover state when the wire drag ends**

If the wire drag ends while the cursor is still inside a node, `onPointerLeave` won't fire. Add an effect to reset the hover flag when `wireDrag` flips to `null`:

```ts
React.useEffect(() => {
    if (!wireDrag) setIsHoveredDuringWireDrag(false);
}, [wireDrag]);
```

Place this right after the `useState` line.

- [ ] **Step 9: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 10: Commit**

```bash
git add lib/nodes/core/canvas/BaseNode.tsx
git commit -m "feat(editor): reject cyclic wires with on-node hover toast"
```

---

## Task 4: Compositor dynamic width

**Files:**
- Modify: `lib/nodes/plugins/compositor/component.tsx`

- [ ] **Step 1: Swap `BaseNode` props for the max-content idiom**

Locate the `<BaseNode>` element in `CompositorNode`'s return (around line 689). Find the props block:

```tsx
<BaseNode
    id={id}
    type="compositor"
    label={data.label}
    selected={selected}
    nodeData={data}
    isNew={(data as any).isNew}
    badgeCount={renderable.length}
    width={320}
    hideStatus={true}
    customOutputs={customOutputs}
```

Replace `width={320}` with the same `width="" / style` pattern blur uses:

```diff
- width={320}
+ width=""
+ style={{ width: 'max-content', minWidth: 320, maxWidth: 420 }}
```

Final props block for reference:

```tsx
<BaseNode
    id={id}
    type="compositor"
    label={data.label}
    selected={selected}
    nodeData={data}
    isNew={(data as any).isNew}
    badgeCount={renderable.length}
    width=""
    style={{ width: 'max-content', minWidth: 320, maxWidth: 420 }}
    hideStatus={true}
    customOutputs={customOutputs}
    customActions={
        // ... unchanged ...
    }
    contentClassName="p-0 overflow-hidden"
>
```

- [ ] **Step 2: Give `LivePreview`'s wrapper an intrinsic width**

`max-content` on the parent needs a child with a definite preferred width. Today the LivePreview wrapper is `w-full` with only `aspect-ratio` (around line 185 inside the `LivePreview` component) — under `max-content`, this collapses. Update the wrapper:

```diff
  <div
      ref={containerRef}
-     className="w-full relative overflow-hidden flex items-center justify-center rounded-xl border border-stroke-subtle shadow-2xl"
+     className="relative overflow-hidden flex items-center justify-center rounded-xl border border-stroke-subtle shadow-2xl"
      style={{
          ...checkerboardStyle,
+         width: canvasWidth,
          aspectRatio: `${canvasWidth} / ${canvasHeight}`
      }}
  >
```

The outer `minWidth: 320 / maxWidth: 420` on the BaseNode clamps the result; `aspect-ratio` drives height; the existing `ResizeObserver` inside `LivePreview` keeps the Konva stage in sync with the measured width.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add lib/nodes/plugins/compositor/component.tsx
git commit -m "feat(compositor): dynamic card width matching blur/ai_generator pattern"
```

---

## Task 5: Manual smoke test

**Files:** (none — verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: dev server boots on port 3000 with no compile errors.

- [ ] **Step 2: Verify cycle rejection — direct A→B→A**

1. Open a workflow with at least two connectable nodes (e.g. Media Input → Blur).
2. Drag an output from Blur back toward Media Input's existing wire-source.
3. Expected: the in-flight wire turns React Flow's "invalid" red; releasing does not create an edge; the canvas edges count is unchanged.

- [ ] **Step 3: Verify cycle rejection — multi-hop A→B→C→A**

1. Build a chain: Media Input → Blur 1 → Blur 2.
2. Drag an output from Blur 2 back to Media Input.
3. Expected: drop is rejected.

- [ ] **Step 4: Verify the toast**

1. Start a cycle-forming wire drag (as in Step 2 or 3).
2. Hover the wire over the offending target node.
3. Expected: a small red "Circular connections are not allowed" label appears at top-left of that node.
4. Move the cursor away from the node (without releasing the wire).
5. Expected: the toast disappears immediately while the wire is still being dragged.
6. Move back over the node.
7. Expected: the toast reappears.
8. Release on empty canvas (so the wire-drag ends without a drop).
9. Expected: the toast disappears.

- [ ] **Step 5: Verify type-incompatible drops still behave as before**

1. Drag a wire from a Prompt node's text output toward a node with no text input.
2. Expected: the target node dims/grayscales as today; **no** cycle toast appears (the toast is cycle-specific).

- [ ] **Step 6: Verify compositor width — 16:9 canvas**

1. Add a Compositor node to a workflow.
2. The default config is 1920×1080.
3. Expected: the compositor card is 420px wide (the maxWidth clamp), preview area is ≈420 × 236.

- [ ] **Step 7: Verify compositor width — portrait canvas**

1. Open the compositor's editor modal, change canvasWidth=1080 / canvasHeight=1920, close.
2. Expected: card stays at 420px wide, preview is ≈420 × 747 (matches blur's portrait behavior).

- [ ] **Step 8: Verify compositor width — small canvas**

1. Set canvasWidth=200 / canvasHeight=200 in the editor.
2. Expected: card sits at the 320px `minWidth` floor (not 200), preview is 320 × 320.

- [ ] **Step 9: Verify wire alignment after canvas resize**

1. With the compositor connected to a downstream node, change canvas dimensions through the editor.
2. Expected: the output handle stays attached to its wire (`updateNodeInternals` already fires on `customOutputs` change; this should not regress).

---

## Self-review notes

- **Spec coverage:**
  - Cycle helper (`wouldCreateCycle`) → Task 1.
  - Validator rejection → Task 2.
  - Hover toast + dim treatment → Task 3 (steps 3, 4, 7).
  - Wire-drag-end cleanup → Task 3 step 8.
  - Direction-aware cycle detection (both wire-drag origins) → Task 3 step 3.
  - Compositor BaseNode props swap → Task 4 step 1.
  - LivePreview intrinsic width → Task 4 step 2.
  - All manual checks from spec "Verification" section → Task 5.
- **No new types or shared interfaces beyond `wouldCreateCycle`'s parameter shape, which uses an inline structural type.**
- **`useEdges()` consolidation:** Task 3 moves one existing call up so `isCycleTarget` and the existing `connectedTargetHandles` share a single subscription. Verified by re-reading the file: there is only one `useEdges()` call today (line 186); after the move there is still exactly one.
