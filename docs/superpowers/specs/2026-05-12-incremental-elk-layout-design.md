# Incremental ELK Layout for AI-Generated Workflow Patches

**Date:** 2026-05-12
**Status:** Draft — awaiting user approval

## Problem

When the AI chat brain emits `add_node` tool calls, node positions on the canvas come out badly:

- Groups land overlapping each other.
- Sibling nodes have zero gap between them.
- Children inside an AI-created group are dumped at trivial offsets like (24, 24) and (304, 24) with no real spacing logic.
- When a multi-task plan emits several `add_node` calls in sequence, each batch lands right of the previous bounding box — but the intra-batch layout itself is whatever the LLM wrote, which is poor.
- "Replace node X with Y" and "remove + add 2" patterns aren't handled at all by the current logic — the existing translator only knows how to dock new batches to the right.

The current implementation, [placeBatchInFreeSpace](../../../lib/workflow/place-batch.ts), translates the AI's whole batch as a unit to the right of the existing canvas bbox + 80px. It preserves the AI's intra-batch layout verbatim. Since the AI is bad at 2D layout, the result is bad.

Meanwhile, ELK ([autoLayoutNodesAsync](../../../lib/utils/graph-layout.ts)) already produces clean layouts and is used for initial-load + the manual auto-layout button — but never on AI-driven incremental adds.

## Goal

Replace AI-position handling with an ELK-driven layout that:

1. Produces a clean, well-spaced layout for new nodes (groups, children, ungrouped nodes).
2. Never moves nodes the user can see on canvas.
3. Handles every patch shape the AI emits: pure adds, adds connected to existing nodes, replace, remove+add, group-add-with-children, adds-into-existing-group.
4. Uses one algorithm, not a per-case classifier.

## Approach: ELK INTERACTIVE Mode with Fixed Anchors

### Why this works

ELK's `layered` algorithm has three orthogonal `INTERACTIVE` strategies designed for incremental layout:

- `elk.layered.layering.strategy: INTERACTIVE` — preserves the layer (x-band) of existing nodes
- `elk.layered.nodePlacement.strategy: INTERACTIVE` — preserves the y coordinate of existing nodes
- `elk.layered.crossingMinimization.strategy: INTERACTIVE` — preserves the ordering of existing nodes

Combined with seeding existing nodes' real x/y coordinates as input, ELK lays out **only the new nodes**, positioning them in topological flow around the fixed anchors. `hierarchyHandling: INCLUDE_CHILDREN` lays out group internals in the same pass.

This is the canonical "incremental layout" pattern named by Tom Sawyer Software's graph-layout literature, which our current code reinvents poorly.

### Algorithm

```
Input:
  existingNodes:  WorkflowNode[]   // post-patch existing (pre-existing)
  existingEdges:  WorkflowEdge[]
  newNodes:       WorkflowNode[]   // nodes being added
  newEdges:       WorkflowEdge[]   // edges being added (may cross existing/new boundary)

1. Snapshot existing positions:
   originalPositions = Map<id, {x, y}> from existingNodes.

2. Build ELK input:
   - All nodes: existingNodes + newNodes.
   - Top-level nodes are direct children of root.
   - Group nodes have their children nested via ELK's `children` array.
   - Children positions are RELATIVE to parent (React Flow convention).
   - Every existing node carries its real x/y as ELK input.
   - Every new node has no x/y (ELK computes them).
   - Width/height from NODE_DIMENSIONS registry (server-side fallback — no
     React-Flow measured props available).

3. Build ELK edges:
   - All edges: existingEdges + newEdges.
   - Cross-hierarchy edges (child↔outside) kept as-is; INCLUDE_CHILDREN handles them.

4. Run ELK with config (see § ELK Configuration below).

5. Apply safety net:
   For every node in originalPositions, OVERRIDE the ELK output back to its
   original x/y. This guarantees zero existing-node movement even if ELK's
   INTERACTIVE strategies have edge-case bugs.

6. Return Map<id, {x, y}> for new nodes only.
```

### How each scenario falls out of this algorithm

| Patch shape | Why it works |
|---|---|
| Pure add, disconnected | New nodes form an unconnected component; ELK places them to the right (`separateConnectedComponents: true`, `componentComponent` spacing). Existing fixed. |
| Add, connected to canvas | New edges point to fixed anchors; ELK lays out new nodes in the natural layer downstream of those anchors. |
| Replace X with Y | X removed before ELK runs. Y inherits X's edges (handled by the AI's tool call). Y is now connected to X's old neighbors, which are fixed. ELK fits Y between/around them. |
| Group + new children | INCLUDE_CHILDREN lays out children inside the group's hierarchy. Group itself is a new top-level node; ELK places it. |
| Add into existing group | Group is fixed. Existing children inside are fixed (have positions). New child is hierarchical member of group with no position; ELK fits it among siblings. |
| Remove + add multiple | Removed nodes gone. New nodes' edges anchor to surviving fixed nodes. ELK lays them out coherently. |

## API

### New function

```ts
// lib/workflow/layout-incremental.ts (new file)

export interface LayoutPatchInput {
    existingNodes: WorkflowNode[];   // nodes already on canvas
    existingEdges: WorkflowEdge[];
    newNodes: WorkflowNode[];        // nodes about to be added
    newEdges: WorkflowEdge[];        // edges about to be added
}

/**
 * Compute positions for `newNodes` that flow topologically around the
 * existing canvas. Existing node positions are guaranteed unchanged.
 *
 * Returns Map<nodeId, {x, y}> for NEW nodes only. Callers should treat
 * any new node missing from the map as a layout failure for that node
 * (fall back to whatever position the node currently has, or 0,0).
 *
 * Children positions in the returned map are RELATIVE to their parent
 * group (matching React Flow's `parentNode` convention).
 */
export async function layoutPatchAsync(
    input: LayoutPatchInput,
): Promise<Map<string, { x: number; y: number }>>;
```

### Integration point

In [handlers.ts:111](../../../lib/chat/tools/handlers.ts#L111), `runAddNode` becomes async. The current synchronous `placeBatchInFreeSpace` call is replaced with an awaited `layoutPatchAsync` call.

The current shape:

```ts
export function runAddNode(state: ToolHandlerState, args: any): ToolResult {
  ...
  if (hasNodes) {
    args = { ...args, nodes: placeBatchInFreeSpace(args.nodes, state.workflow.nodes) };
  }
  ...
}
```

Becomes:

```ts
export async function runAddNode(state: ToolHandlerState, args: any): Promise<ToolResult> {
  ...
  if (hasNodes || hasEdges) {
    const positions = await layoutPatchAsync({
      existingNodes: state.workflow.nodes,
      existingEdges: state.workflow.edges,
      newNodes: args.nodes ?? [],
      newEdges: args.edges ?? [],
    });
    if (hasNodes) {
      args = {
        ...args,
        nodes: args.nodes.map((n: any) => {
          const pos = positions.get(n.id);
          return pos ? { ...n, position: pos } : n;
        }),
      };
    }
  }
  ...
}
```

`dispatchTool` becomes async. Three call sites need `await`:

- [lib/chat/brain.ts:233](../../../lib/chat/brain.ts#L233)
- [app/api/chat/stream/route.ts:145](../../../app/api/chat/stream/route.ts#L145)
- [app/api/chat/stream/route.ts:242](../../../app/api/chat/stream/route.ts#L242)

## ELK Configuration

```ts
{
    'elk.algorithm': 'layered',
    'elk.direction': 'RIGHT',
    'elk.hierarchyHandling': 'INCLUDE_CHILDREN',

    // Spacing — match existing autoLayoutNodesAsync values for visual
    // consistency with the manual auto-layout button.
    'elk.spacing.nodeNode': '60',
    'elk.layered.spacing.nodeNodeBetweenLayers': '120',
    'elk.padding': '[top=50,left=50,bottom=50,right=50]',
    'elk.spacing.componentComponent': '80',
    'elk.separateConnectedComponents': 'true',

    // Incremental layout — read existing positions, lay out new nodes around them.
    'elk.layered.layering.strategy': 'INTERACTIVE',
    'elk.layered.nodePlacement.strategy': 'INTERACTIVE',
    'elk.layered.crossingMinimization.strategy': 'INTERACTIVE',

    // Required when crossingMinimization.strategy is INTERACTIVE:
    // tells ELK the input order is meaningful.
    'elk.interactive': 'true',
}
```

Existing nodes are passed to ELK with their real `x` and `y` as input properties. New nodes have neither — ELK computes them.

For groups (parent containers), children are passed as the ELK node's `children` array. The group itself gets `'org.eclipse.elk.nodeSize.constraints': 'NODE_LABELS PORTS MINIMUM_SIZE'` so it auto-resizes to fit its children plus padding.

## Server-side dimension fallback

Server-side handlers don't have access to React Flow's `measured` dimensions (those exist only after client rendering). The existing [NODE_DIMENSIONS](../../../lib/workflow/layout-utils.ts) registry is the right source:

```ts
export const NODE_DIMENSIONS: Record<string, { width: number; height: number }> = {
    prompt:       { width: 185, height: 100 },
    media_input:  { width: 210, height: 180 },
    compositor:   { width: 210, height: 280 },
    blur:         { width: 210, height: 220 },
    ai_generator: { width: 210, height: 380 },
};
```

Unknown types fall back to `{ width: 220, height: 380 }`. The registry stays where it is; we delete the rest of `layout-utils.ts` (the `calculateNodePosition` function and helpers — vestigial, not called from anywhere after this change).

## What gets deleted

- [lib/workflow/place-batch.ts](../../../lib/workflow/place-batch.ts) — entire file.
- The `calculateNodePosition`, `rectsOverlap`, `resolveY`, `resolveX` functions in [lib/workflow/layout-utils.ts](../../../lib/workflow/layout-utils.ts). Keep `NODE_DIMENSIONS` and `getNodeDimensions`.
- The `placeBatchInFreeSpace` import in [handlers.ts:3](../../../lib/chat/tools/handlers.ts#L3).

## What stays unchanged

- [autoLayoutNodesAsync](../../../lib/utils/graph-layout.ts) — used for initial workflow load ([use-chat-realtime.ts:178](../../../lib/hooks/use-chat-realtime.ts#L178)) and the manual auto-layout button ([EditorCanvas.tsx:863](../../../components/editor/EditorCanvas.tsx#L863)). These are full-canvas re-layouts; INTERACTIVE mode isn't needed.
- Client-side rendering, React Flow integration, persistence — all untouched.

## Testing

There's no test runner in this repo (per [CLAUDE.md](../../../CLAUDE.md)). Verification is by manual chat session walks — after integration, drive the chat brain through each shape and visually inspect:

- **Simple add:** "make me an image of X" — prompt + ai_generator, clean horizontal layout.
- **Add connected to existing:** "now add a blur to the result" — blur lands downstream of the ai_generator.
- **Replace:** "replace the blur with a compositor" — compositor lands roughly where the blur was, neighbors don't move.
- **Multi-task plan:** "make a video with 3 scenes" — three groups, side-by-side, with proper inter-group spacing.
- **Add into existing group:** "add a media input to scene 2" — new child slots into scene 2's group without overlapping existing children.
- **Group + children intra-layout:** any of the above with groups — children inside each group have non-zero spacing and don't overlap.

Acceptance criteria for each walk: result looks comparable to what the manual auto-layout button produces. No existing node moves between turns (visual check — nodes that were on canvas at start of turn N should be in the same position at end of turn N).

## Fallback if INTERACTIVE misbehaves

If during manual testing we discover ELK's INTERACTIVE strategies have unfixable quirks on our specific hierarchy/edge shapes (see elkjs issues #88, #112, #129 for known hierarchy bugs), the fallback is a hybrid:

- Per-group internal ELK + dock-right for new groups (the user's earlier suggestion).
- Targeted "drop at removed-node's slot" for replace cases.

This is more code (3 strategies vs. 1) but is a known-good backstop. We don't build it speculatively — only if manual testing exposes a blocker.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| ELK INTERACTIVE has bugs on our hierarchy shapes (see elkjs #88, #112, #129) | Manual testing catches it. Documented fallback (hybrid approach) if blocking. |
| ELK shifts existing nodes by a few pixels despite INTERACTIVE | Safety-net step 5 explicitly restores existing positions byte-for-byte. |
| Performance regression — ELK on whole graph each AI tool call | Worst case <100ms for 50 nodes (existing client-side ELK already does this on load). Acceptable for chat-tool latency. |
| Server-side ELK uses fallback dimensions, not real measured sizes | Same fallback approach as the pre-existing client code uses on first render. The registry is tuned. New mismatches would be one-off and fixable by tuning the registry. |
| `dispatchTool` becoming async breaks a sync caller we missed | Three call sites, all already in async contexts. TypeScript will catch any miss. |

## Out of scope

- Removing AI position emission from the tool schema. The `position` field on [tools/definitions.ts](../../../lib/chat/tools/definitions.ts) stays as-is — we just stop reading it. Removing it from the schema is a future cleanup; keeping it removes one moving piece from this change.
- Compacting gaps after removes. If the AI removes a node and leaves a gap, the gap stays. User can hit the manual auto-layout button to compact.
- Improving group-internal layout when the user is the one adding nodes (drag-from-palette). User-driven adds have their own position handling and aren't covered.

## File-level change summary

| File | Change |
|---|---|
| `lib/workflow/layout-incremental.ts` | **New.** Exports `layoutPatchAsync`. |
| `lib/workflow/place-batch.ts` | **Delete.** |
| `lib/workflow/layout-utils.ts` | Delete everything except `NODE_DIMENSIONS` and `getNodeDimensions`. |
| `lib/chat/tools/handlers.ts` | `runAddNode` becomes async; calls `layoutPatchAsync`. `dispatchTool` becomes async. |
| `lib/chat/brain.ts` | Await `dispatchTool` (1 call site). |
| `app/api/chat/stream/route.ts` | Await `dispatchTool` (2 call sites). |
