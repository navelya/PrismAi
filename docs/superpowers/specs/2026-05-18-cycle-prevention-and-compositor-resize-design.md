# Cycle Prevention + Compositor Dynamic Width

Date: 2026-05-18

Two small, independent changes to the workflow editor:

1. Reject wire drops that would close a cycle in the node graph, with a brief on-node toast explaining why.
2. Make the `compositor` node card use the same dynamic-width pattern as `blur` and `ai_generator` so wide/narrow canvases get a card that scales with their aspect.

## 1. Cycle prevention

### Problem

`handleIsValidConnection` in [components/editor/EditorCanvas.tsx](../../../components/editor/EditorCanvas.tsx) currently rejects only two things: self-loops (`source === target`) and type-incompatible drops. Multi-node cycles (A→B→C→A) are allowed. Cyclic graphs feed back into a number of resolver paths (`resolveBlurOutputKind` already carries a defensive depth cap for this reason — see [lib/editor/handle-compatibility.ts](../../../lib/editor/handle-compatibility.ts):29). It is better to refuse the cycle at wire-drop time than to harden every downstream resolver against it.

### Approach

Add a generic `wouldCreateCycle(source, target, edges)` helper and call it from two places:

- The connection validator, to reject the drop.
- `BaseNode`, to render a small hover-tracked toast on the node the user is currently dragging the wire onto, so the rejection is explained instead of being silent.

### `wouldCreateCycle` helper

Lives next to the other connection validators in [lib/editor/handle-compatibility.ts](../../../lib/editor/handle-compatibility.ts):

```ts
/**
 * True if adding `source → target` to the current edge set would close a
 * directed cycle. Forward DFS from `target` — if `source` is reachable, the
 * new edge would loop back. O(V + E); fine for typical workflow sizes.
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

### Wire-drop rejection

In [components/editor/EditorCanvas.tsx](../../../components/editor/EditorCanvas.tsx), extend `handleIsValidConnection` after the existing type check:

```ts
const handleIsValidConnection = useCallback((connection: Connection) => {
    if (connection.source === connection.target) return false;
    if (!reactFlowInstance) return true;

    const sourceNode = reactFlowInstance.getNode(connection.source!);
    const targetNode = reactFlowInstance.getNode(connection.target!);
    if (!sourceNode || !targetNode) return true;

    const src = getNodeHandleType(sourceNode as any, connection.sourceHandle, 'source', models, sharedRegistry);
    const tgt = getNodeHandleType(targetNode as any, connection.targetHandle, 'target', models, sharedRegistry);
    if (!src || !tgt) return true;
    if (!typesAreCompatible(src.type, tgt.type)) return false;

    // NEW: refuse drops that would close a directed cycle.
    if (wouldCreateCycle(connection.source!, connection.target!, reactFlowInstance.getEdges())) {
        return false;
    }
    return true;
}, [reactFlowInstance, models]);
```

React Flow already paints the wire red and silently discards the drop on `false`. No extra side effects needed at the drop site itself — the toast lives on the hovered node (next section).

### Hover toast on `BaseNode`

In [lib/nodes/core/canvas/BaseNode.tsx](../../../lib/nodes/core/canvas/BaseNode.tsx), extend the existing wire-drag classification:

1. Read the live edge list from the store:
   ```ts
   const edges = useAppStore((s) => s.currentWorkflow?.edges ?? []);
   ```
2. Derive `isCycleTarget` next to `dragRole`. Direction-aware so both kinds of wire drag are covered:
   - Wire from an OUTPUT (`originHandleType === 'source'`) → prospective edge is `origin → this`.
   - Wire from an INPUT (`originHandleType === 'target'`) → prospective edge is `this → origin`.
   ```ts
   const isCycleTarget = useMemo(() => {
       if (!wireDrag) return false;
       if (wireDrag.originNodeId === id) return false;
       const src = wireDrag.originHandleType === 'source' ? wireDrag.originNodeId : id;
       const tgt = wireDrag.originHandleType === 'source' ? id : wireDrag.originNodeId;
       return wouldCreateCycle(src, tgt, edges);
   }, [wireDrag, id, edges]);
   ```
3. Treat cycle targets as `dragRole === 'incompatible'` for the dim/grayscale effect (the existing CSS class already covers this — when `isCycleTarget` is true and `dragRole` resolved to `'compatible'` based on type, override it to `'incompatible'`).
4. Track local hover state with `onPointerEnter` / `onPointerLeave` on the outer card div:
   ```ts
   const [isHovered, setIsHovered] = useState(false);
   ```
5. Render the toast when `wireDrag && isCycleTarget && isHovered`:
   ```tsx
   {wireDrag && isCycleTarget && isHovered && (
       <div className="absolute -top-7 left-2 px-2 py-1 rounded-md
                       bg-bg-primary/90 border border-accent-error/50
                       text-[10px] font-medium text-accent-error
                       pointer-events-none whitespace-nowrap shadow-lg z-50">
           Circular connections are not allowed
       </div>
   )}
   ```

The toast disappears as soon as:

- the cursor leaves the node (pointer-leave clears `isHovered`), OR
- the wire drag ends (`wireDrag` becomes null on `onConnectEnd` in EditorCanvas).

Both paths satisfy the user's "gone when the user is moving away" requirement.

### Why we don't reject existing cycles

The spec only blocks creation of new cycles via wire-drop. Workflows that were already cyclic (legacy data, programmatic patches) are not retroactively pruned. That is consistent with how `pruneIncompatibleOutgoingEdges` only fires on type-narrowing transitions, not as a sweep.

## 2. Compositor dynamic width

### Problem

[lib/nodes/plugins/compositor/component.tsx](../../../lib/nodes/plugins/compositor/component.tsx) passes `width={320}` to `BaseNode`, so the compositor card is a fixed 320px regardless of the canvas aspect. A 1920×1080 preview renders at 320 × 180 — visually cramped. Other media-bearing nodes (`blur`, `ai_generator`) use a max-content idiom that lets the card grow up to 420px wide and clamps height via the inner content's aspect ratio.

### Approach

Apply the same idiom to the compositor.

### Change 1 — BaseNode props

```diff
- width={320}
+ width=""
+ style={{ width: 'max-content', minWidth: 320, maxWidth: 420 }}
```

(`BaseNode` already forwards `style` via its `{...props}` spread — see [lib/nodes/core/canvas/BaseNode.tsx](../../../lib/nodes/core/canvas/BaseNode.tsx):302.)

### Change 2 — LivePreview wrapper intrinsic width

`max-content` on the parent needs a child with a definite preferred width to measure against. Today the `LivePreview` wrapper is `w-full` with only `aspect-ratio`, which collapses under `max-content`. Give it an explicit pixel width equal to the canvas width — the outer `min/maxWidth` clamps will bound it.

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

Result:

- 16:9 canvas (1920×1080) → BaseNode clamps to 420 wide, preview is 420 × 236.
- 1:1 canvas (1080×1080) → 420 × 420.
- 9:16 canvas (1080×1920) → 420 × 747 (matches blur's portrait-video behaviour).
- Tiny canvas (e.g. 200×200) → bumps up to the 320 `minWidth` floor.

Height is fully aspect-ratio driven; the existing `ResizeObserver` inside `LivePreview` keeps the Konva stage in sync with the measured width as before.

### Non-goals

- Not changing canvas dimensions or any compositor logic. Purely a card-sizing change.
- Not making width user-resizable (no drag handles). Just dynamic-from-content.

## Files touched

- `lib/editor/handle-compatibility.ts` — add `wouldCreateCycle`.
- `components/editor/EditorCanvas.tsx` — call `wouldCreateCycle` in `handleIsValidConnection`.
- `lib/nodes/core/canvas/BaseNode.tsx` — cycle-target detection, hover state, toast render.
- `lib/nodes/plugins/compositor/component.tsx` — swap fixed width for `max-content` pattern; give LivePreview wrapper an intrinsic width.

## Verification

- `npx tsc --noEmit` clean.
- Manual checks in the editor:
  - Try to wire a node back into its own upstream — wire is red, drop is rejected, toast appears over the target while hovering and clears on leave.
  - Type-incompatible drops still produce the existing dim treatment without a toast (toast is cycle-specific).
  - Add a compositor to a workflow, open with 16:9 vs 9:16 canvas dimensions — card grows wider for landscape, taller for portrait, both bounded by 320/420.
