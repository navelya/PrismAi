# Node Grouping — Design Spec

**Date:** 2026-05-09
**Status:** Approved, ready for implementation plan

## Goal

Add a third action ("Group") to the multi-select toolbar above selected nodes. Clicking it wraps the selection in a visual container with a slightly different background and an editable title in the top-right corner. The container can be dragged as a unit (children move with it), resized by its borders/corners like a window, and accept new nodes dragged into it. Children can be dragged out. Groups are pure visual organization — they do not execute and have no input/output handles.

## Non-goals

- Nested groups (one level only)
- Group color customization
- Group locking
- Collapsing groups to a thumbnail
- Auto-layout awareness of groups (auto-layout treats children as independent)

## Architectural Approach

**Approach: React Flow native parent/child node mechanics.**

The group is a real `WorkflowNode` with `type: 'group'`. Children get `parentNode: <groupId>` (without React Flow's `extent: 'parent'`, so they can be dragged out). React Flow handles drag-together, z-ordering, and selection coordination natively. Persistence rides along on the existing `WorkflowNode[]` save path — no schema migration.

**Why this over a separate `groups` collection:** the workflow patch language used by the AI (`addedNodes`, `updatedNodes`, `removedNodeIds`) already covers every group operation with zero new ops. A separate collection would force extending the patch language, the AI tool surface, and the save schema.

**Trade-off:** because groups are nodes, the execution engine must explicitly skip them in three places. See *Execution Safety* below.

## Data Model

### `NodeType` union ([lib/nodes/types.ts:4](lib/nodes/types.ts#L4))

```ts
export type NodeType = 'media_input' | 'compositor' | 'prompt' | 'ai_generator' | 'blur' | 'group';
```

### `WorkflowNode` ([lib/nodes/types.ts:265](lib/nodes/types.ts#L265))

Two new optional fields React Flow already understands:

```ts
parentNode?: string;  // id of the group this node belongs to (omitted when ungrouped)
extent?: 'parent';    // intentionally NOT set — children must be drag-out-able
```

### New `GroupConfig`

```ts
export interface GroupConfig {
  width: number;   // px, in flow coordinates
  height: number;  // px, in flow coordinates
}
```

Added to the `NodeConfig` union. The group's title is stored in the existing `data.label` field.

### Z-ordering

Group nodes render with a low `zIndex` (e.g. `-1`) so children naturally float above their container. React Flow respects per-node `zIndex`.

### Persistence

Zero changes to the save path. `parentNode` and the new `'group'` type ride through the existing JSON column. Loading an old workflow without any groups is a no-op.

## Visual Design & Interaction

### Toolbar button ([EditorCanvas.tsx:541-575](components/editor/EditorCanvas.tsx#L541-L575))

A "Group" button appears **left of Copy** (left-to-right order: Group, Copy, Delete). Uses lucide `Group` or `BoxSelect` icon, same 6×6 button styling as the existing two.

**Visibility rule:** shown only when 2+ nodes are selected AND none of the selected nodes already have a `parentNode` set (i.e., none are already inside any group). If any selected node is already grouped, the user must ungroup it first.

### Group creation

1. Compute the bounding box of selected nodes' positions + measured sizes
2. Add 24px padding on all sides; reserve 40px at the top for the title bar
3. Create a new node `{ type: 'group', position: bbox.topLeft - padding, data: { label: 'Group', config: { width, height } }, zIndex: -1 }`
4. Set `parentNode: <groupId>` on each previously-selected child
5. Clear selection on children, select the new group instead

### Group container rendering (`GroupNode.tsx`)

- Background: `bg-bg-primary/60` with a faint border (`border-stroke-subtle/60`) — slightly more opaque than the canvas to feel "container-ish" but not heavy
- Rounded corners matching node style (`rounded-2xl`)
- Title bar: top-right, inline editable text. Single click selects the group; second click on the title text turns it into an `<input>`. Blur or Enter commits the rename, Escape cancels.
- Eight resize handles: 4 edges (N/S/E/W cursors) + 4 corners (NW/NE/SW/SE cursors), 8px hit zones, only visible on hover or selection
- Min size: bounding box of current children + padding (cannot shrink past child bounds)

### Drag-together

React Flow native — children with `parentNode` move with the parent automatically. No custom code.

### Drag-OUT a child

- During drag, if the child's center moves outside the group's rect, mark "leaving" with a subtle visual (dim the group border)
- On drop outside: clear `parentNode` on that child. **Group keeps its current size — no auto-fit/shrink.** Child's position is converted from parent-relative to absolute coordinates so it doesn't snap.

### Drag-IN a node (a node without a parent)

- During drag, hit-test against every visible group's rect. If the dragged node touches any group, highlight that group's border (`border-accent-primary`)
- On drop while touching: set `parentNode` on the dropped node, then expand the group's `width`/`height` to fit:
  - `newWidth = max(currentWidth, child.right - group.left + padding)`
  - same for height
  - Position is converted to coordinates relative to the parent.

### Manual resize

Dragging an edge or corner handle directly mutates the group's `data.config.width` / `height`. Cannot shrink below the bounding box of current children + padding (clamp on drag).

### Selection rules

- Single click on container background → group selected (toolbar shows Copy / Delete / **Ungroup**)
- Click on a child → just the child is selected (group stays unselected)
- Marquee that crosses the group → only the children inside the marquee; group itself isn't auto-included

### Ungroup action

Clears `parentNode` on every child, converts their positions back to absolute, deletes the group node. Available only via the toolbar when a group is selected. No animation.

### Delete on selected group

Removes the group node + all children + any edges connected to those children (uses existing `getConnectedEdges` path).

### Copy / Duplicate on selected group

Generalizes existing `handleDuplicateSelected` ([EditorCanvas.tsx:153](components/editor/EditorCanvas.tsx#L153)): when a group is in the selection, fold its children in too, then duplicate everything as one bundle (group + children + internal edges) with an `idMap` that remaps `parentNode` references on the duplicated children.

## Edge Cases

### Edges crossing the group boundary

No special treatment. A node inside a group can be wired to a node outside the group exactly as before. Edges render above groups (already handled by RF's edge-layer z-order).

### Edge selection inside a group

Unchanged — clicking an edge between two grouped children selects/deletes the edge as today.

### History (undo / redo)

Group create / ungroup / drag-in / drag-out / resize / rename each call `takeSnapshot()` before mutating ([workflow-slice.ts:63](lib/store/slices/workflow-slice.ts#L63)). Snapshots are reference-snapshots, so cost matches any other edit.

### Workflow save / load

Pure data — no schema migration needed. `parentNode` and the new `'group'` type ride through the existing JSON column.

## AI Chat Integration

The brain's system prompt gets a short addition:

> *"You may organize related nodes into a group by emitting a node of type `group` with `data.label` (the title), `data.config.width/height`, and a position. Set `parentNode: <groupId>` on the children. Groups are visual organization only — they do not execute and have no input/output handles. Do not connect edges to or from a group."*

The patch language ([workflow-patch.ts](lib/workflow/workflow-patch.ts)) needs **zero** changes — `addedNodes`, `updatedNodes`, `removedNodeIds` already cover every group operation.

**Validation:** the patch-applier should reject edges where source or target is a group node (defensive — catches a hallucinated edge before it corrupts state).

## Execution Safety

Three places must explicitly handle group nodes as non-executable:

1. **[app/api/executions/start/route.ts](app/api/executions/start/route.ts)** — when computing root nodes (no incoming edges), filter out `type === 'group'` so groups never get dispatched as workflow roots.
2. **Shared registry** ([lib/nodes/core/shared-registry.ts](lib/nodes/core/shared-registry.ts)) — register `'group'` with no executor + a clear "non-executable" flag, so any defensive lookup gets a deterministic answer.
3. **`dispatchNode`** ([lib/workflow/dispatch-v2.ts](lib/workflow/dispatch-v2.ts)) — early-return with a logged skip if asked to dispatch a `'group'` node (belt-and-braces in case anything slips through).

The orchestrator's edge-driven dispatch ([orchestrator.ts:74](lib/workflow/orchestrator.ts#L74)) and "all nodes finished?" check ([orchestrator.ts:207](lib/workflow/orchestrator.ts#L207)) require no changes — groups have no edges (so the chain reaction never picks them up) and have no `node_results` rows (so the status check never fails on them).

## Things That Do NOT Change

- Workflow execution engine logic (orchestrator dispatch graph)
- Database schema
- Save / load paths
- Existing node type implementations (media_input, compositor, prompt, ai_generator, blur)
- Compositor / AI generator / etc. behavior

## Files to Touch

| File | Purpose |
|------|---------|
| [lib/nodes/types.ts](lib/nodes/types.ts) | Add `'group'` to `NodeType`; add `GroupConfig`; add `parentNode`/`extent` to `WorkflowNode` |
| [components/editor/reactflow-types.ts](components/editor/reactflow-types.ts) | Register `'group'` in `stableNodeTypes` |
| `components/canvas/GroupNode.tsx` (NEW) | Container component: background, title, resize handles |
| [components/editor/EditorCanvas.tsx](components/editor/EditorCanvas.tsx) | Add Group button to multi-select toolbar; add drag-in/drag-out hit-testing in `onNodeDragStop`; generalize duplicate/delete to handle group selection |
| [lib/store/slices/workflow-slice.ts](lib/store/slices/workflow-slice.ts) | Add `groupNodes(ids)`, `ungroupNode(groupId)`, `setNodeParent(nodeId, parentId)`, `resizeGroup(groupId, w, h)`, `renameGroup(groupId, label)` actions |
| [lib/nodes/core/shared-registry.ts](lib/nodes/core/shared-registry.ts) | Register `'group'` as non-executable |
| [lib/workflow/dispatch-v2.ts](lib/workflow/dispatch-v2.ts) | Early-return on `type === 'group'` |
| [app/api/executions/start/route.ts](app/api/executions/start/route.ts) | Filter `'group'` out of root-node selection |
| [lib/workflow/workflow-patch.ts](lib/workflow/workflow-patch.ts) | Reject patches with edges that touch group nodes |
| [lib/chat/prompt/system.ts](lib/chat/prompt/system.ts) | One-paragraph addition explaining when/how to group |

## Testing

No formal test runner exists in this repo. Verification is manual:

- Create group from selection (toolbar button)
- Drag the group — children move with it
- Drag a child out of the group — child leaves, group keeps its size
- Drag an ungrouped node into the group — border highlights on touch, drop expands group
- Resize the group from each edge and corner; verify min-size clamp
- Rename via title click; commit on blur and Enter; cancel on Escape
- Copy a selected group → duplicate appears with all children + internal edges, fresh ids
- Delete a selected group → group + children + connected edges all removed
- Ungroup → children stay where they are, group disappears
- Reload the page → group persists with title, size, position, and child membership
- Run a workflow that contains a group → execution completes successfully, group is ignored
- Ask the AI chat to "organize these nodes into a group" → AI emits a valid patch, group renders correctly
