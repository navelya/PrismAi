# Wire-Drag Affordance — Design

**Date:** 2026-05-15
**Status:** Approved (pending implementation plan)
**Scope:** Editor canvas — wire-drag UX

## Problem

When a user drags a wire in the workflow editor, they get no canvas-wide feedback about where the wire can land. Handle labels are only revealed via per-node `group-hover` ([BaseNode.tsx:319](../../../lib/nodes/core/canvas/BaseNode.tsx#L319)), and no node is visually distinguished as compatible vs. incompatible. The result: users either drop on the canvas to get the filtered context menu, or drift over nodes one-by-one to discover compatible handles.

## Goal

While a wire is being dragged, communicate compatibility across the entire workflow at a glance:

1. Pin the originating handle's label visible for the drag duration.
2. Reveal the labels of *only the compatible handles* on every other node.
3. Dim nodes (and their attached edges) that cannot accept the wire.

The drag-time overlay is purely additive — it neither blocks nor alters the existing `group-hover` reveal that runs when no wire is being dragged.

## Behavior

When the user starts dragging a wire from any handle (source or target side) and until the drag ends (successful drop, drop on canvas, or cancel):

| Element | Treatment |
|---|---|
| Originating node | Full brightness. Only the originating handle's label is pinned visible. Other handles' labels stay hidden. |
| Compatible target node (at least one handle on the *opposite side* whose type matches `typesAreCompatible`) | Full brightness. Labels of *only the compatible handles* are visible. Incompatible handles, and all handles on the same side as the origin, stay hidden. |
| Incompatible target node | `opacity: 0.3, filter: grayscale(0.6)`, handle labels hidden. |
| Edge with at least one dimmed endpoint | `opacity: 0.3, filter: grayscale(0.6)`. |
| Edge between two bright endpoints | Unchanged. |

CSS transition `transition: opacity 150ms, filter 150ms` so dim-on / dim-off is a smooth fade.

When the drag ends, all overlay styling reverts. The existing `group-hover` label reveal continues to work as before.

## Architecture

### `WireDragContext`

A new React Context, owned by `EditorCanvas` and consumed by `BaseNode` and the edge wrapper.

```ts
// lib/editor/wire-drag-context.tsx
export type WireDragState = {
  originNodeId: string;
  originHandleId: string | null;
  originHandleType: 'source' | 'target';
  dataType: string | string[];
} | null;

const WireDragContext = React.createContext<WireDragState>(null);

export function WireDragProvider({ value, children }): JSX.Element;
export function useWireDrag(): WireDragState;
```

### `EditorCanvas` changes

In [components/editor/EditorCanvas.tsx](../../../components/editor/EditorCanvas.tsx):

- Add `const [wireDrag, setWireDrag] = useState<WireDragState>(null);` next to the existing `connectStartRef`.
- In `handleConnectStart`, resolve the origin handle's dataType via the existing `getNodeHandleType(originNode, params.handleId, params.handleType, models, sharedRegistry)` (same call already used by `handleConnectEnd`), then `setWireDrag({...})`.
- In `handleConnectEnd`, `setWireDrag(null)`.
- Wrap `<ReactFlow>` with `<WireDragProvider value={wireDrag}>`.

State only mutates at drag start and drag end — not on mouse-move — so the provider's value is referentially stable during the drag, and consumers do not re-render on cursor movement.

### `BaseNode` changes

In [lib/nodes/core/canvas/BaseNode.tsx](../../../lib/nodes/core/canvas/BaseNode.tsx):

1. Read drag state: `const wireDrag = useWireDrag();`
2. Pull models from the app store via a `useModels()` selector (`models` already lives in the store; expose a small selector hook if not already exported).
3. Derive `dragRole: 'none' | 'origin' | 'compatible' | 'incompatible'` via `useMemo` keyed on `(wireDrag, id, type, data?.config, models)`:
   - `wireDrag === null` → `'none'`
   - `wireDrag.originNodeId === id` → `'origin'`
   - else: call `findHandleForNode({ type, data: { config: data?.config } }, wireDrag, models, sharedRegistry)`. If a match is returned → `'compatible'`; else → `'incompatible'`.
4. When `dragRole === 'compatible'`, compute a `Set<string>` of *all* compatible handle IDs on this node via a new `findAllCompatibleHandlesForNode` helper (see below).
5. **Outer wrapper:** when `dragRole === 'incompatible'`, add `opacity-30 grayscale-[0.6] transition-[opacity,filter] duration-150` to the existing `cn(...)` class list.
6. **Per-handle label visibility:** replace the existing `opacity-0 group-hover:opacity-100` on each handle's label `<div>` with conditional logic:
   - Force `opacity-100` if `dragRole === 'origin'` *and* this handle is the origin handle (handle id matches `wireDrag.originHandleId`, and this handle is on the same side as `wireDrag.originHandleType`).
   - Force `opacity-100` if `dragRole === 'compatible'` *and* the handle id is in the compatible-handle set.
   - Otherwise keep `opacity-0 group-hover:opacity-100` (existing behavior).

   "Same side as `originHandleType`" means: when origin is `source`, only handles rendered on the right (outputs) of the origin node qualify; when origin is `target`, only the inputs. The current `BaseNode` already separates these into the input-map and output-map branches, so the check is local to each branch.

### Edge dimming

A thin edge wrapper component:

- Calls `useWireDrag()` and `findHandleForNode` for `sourceNode` and `targetNode`.
- Both ends incompatible, or one incompatible + one is *not* the origin → apply `opacity: 0.3; filter: grayscale(0.6); transition: opacity 150ms, filter 150ms` to the rendered edge path's style.
- Otherwise renders the underlying edge unchanged.

Origin-node attached edges: by spec the origin stays bright. So an edge attached to the origin dims only if its *other* end is incompatible — which is the same rule "at least one dimmed endpoint" once we treat the origin itself as never-dimmed.

If the existing edge type config makes a wrapper awkward, the fallback is to set `data-wire-dimmed="true"` on dimmed edges from `EditorCanvas` via a derived edge-class function, and target it from a small global CSS rule. Path A is preferred.

### `handle-compatibility.ts` addition

Add:

```ts
export function findAllCompatibleHandlesForNode(
  node, pending, models, sharedRegistry
): ResolvedHandle[]
```

Same body as `findHandleForNode` but returns *all* matching handles, not just the first. `BaseNode` uses this to build its compatible-handle set; `findHandleForNode` keeps working unchanged for the wire-drop menu.

## Edge cases

| Case | Handling |
|---|---|
| `ai_generator` dynamic handles | Already handled by `findHandleForNode`'s special-case lookup against `inputs_schema`/`outputs_schema`. |
| `'any'` data type | Already handled by `typesAreCompatible` — both directions match. |
| Array types (`image_array` ↔ `image`) | Already handled by `typesAreCompatible`'s `_array` strip. |
| Self-connection | Origin node always gets `dragRole === 'origin'` and is skipped from the compatibility check, so it never appears as a compatible drop target for its own wire. |
| Occupied input handles | Treated as compatible (label revealed). React Flow's existing `isValidConnection` permits the drop and the canvas handles replace/parallel semantics. |
| Group / container nodes | They have no `Handle`s — `findHandleForNode` returns `null` → they dim. Correct: they recede during the drag. |
| Hidden handles (`is_visible: false`) | Already filtered by `resolveHandlesForMenuItem` and the schema-driven branches of `findHandleForNode`. |
| Non-standard `customInputs` / `customOutputs` (a per-type wrapper passes a handle set not derivable from `sharedRegistry` or an `ai_generator` model) | Compatibility helper won't see them → those handles stay treated as incompatible (labels hidden). Graceful degradation; flag during implementation if any node type other than `ai_generator` does this. |

## Performance

- `wireDrag` state mutates only at drag start / end — never on mouse-move. The context value is referentially stable during the drag, so `BaseNode` re-renders only when drag-state actually changes.
- Compatibility resolution per node is memoized on `(wireDrag, id, type, data?.config, models)`. For a workflow of N nodes this is O(N) per drag-start, then zero work for the duration of the drag.
- Dim styling is CSS-only (`opacity`, `filter`, `transition`) — no JS work per frame.

## Out of scope

- Compatibility highlighting in the chat-side mini-canvas or any non-`EditorCanvas` surface.
- Mobile / touch drag treatment beyond what React Flow provides natively.
- Animating compatible handle emphasis (pulse/glow). Labels alone are the cue (per design decision).
- Changing the `group-hover` behavior when no wire is being dragged.

## File list

| File | Change |
|---|---|
| `lib/editor/wire-drag-context.tsx` | NEW — Context, Provider, `useWireDrag` hook |
| `lib/editor/handle-compatibility.ts` | Add `findAllCompatibleHandlesForNode` helper |
| `components/editor/EditorCanvas.tsx` | Add `wireDrag` state, populate in `handleConnectStart`, clear in `handleConnectEnd`, wrap `<ReactFlow>` with `<WireDragProvider>` |
| `lib/nodes/core/canvas/BaseNode.tsx` | Read context, derive `dragRole`, apply outer dim classes, override per-handle label visibility |
| Edge wrapper (component or inline class via `data-*`) | Dim edges with at least one incompatible endpoint |
| `lib/store/app-store.ts` (if needed) | Export `useModels()` selector if not already exposed |

## Success criteria

- Dragging a wire from any output handle visibly dims all nodes that cannot accept that output's data type, including their attached edges.
- Compatible nodes' compatible-handle labels become visible without hovering.
- The originating handle's label remains visible for the entire drag.
- On drag end (success, cancel, or canvas drop), all styling reverts within ~150ms.
- Existing wire-drop context menu, `isValidConnection` checks, and missing-mandatory pulse all continue to work unchanged.
