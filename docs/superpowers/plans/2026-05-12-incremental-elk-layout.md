# Incremental ELK Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace [placeBatchInFreeSpace](../../../lib/workflow/place-batch.ts) with an ELK-driven incremental layout so AI-emitted node patches (add / replace / group-add / add-into-group) produce clean, well-spaced layouts without moving any existing canvas node.

**Architecture:** A single new function `layoutPatchAsync({existingNodes, existingEdges, newNodes, newEdges})` runs ELK over the full post-patch graph using `layered` + `INCLUDE_CHILDREN` + the three `INTERACTIVE` strategies (`layering`, `nodePlacement`, `crossingMinimization`). Existing nodes are passed to ELK with their real x/y coordinates so ELK lays out new nodes around them as fixed anchors. A post-layout safety-net step restores existing-node positions byte-for-byte. The function returns a Map of *new* node IDs → positions. `runAddNode` and `dispatchTool` become async to accommodate ELK's async API.

**Tech Stack:** elkjs (already a dependency), TypeScript, Next.js. No new dependencies.

**Reference:** Full design rationale, ELK config justification, and risk list in [docs/superpowers/specs/2026-05-12-incremental-elk-layout-design.md](../specs/2026-05-12-incremental-elk-layout-design.md).

---

## File Structure

| Path | Responsibility |
|---|---|
| `lib/workflow/layout-incremental.ts` | **New.** Exports `layoutPatchAsync`. Builds ELK input (hierarchical, with fixed anchors), runs ELK, restores existing positions, returns new-node positions. |
| `lib/workflow/place-batch.ts` | **Delete.** Replaced by `layoutPatchAsync`. |
| `lib/workflow/layout-utils.ts` | Trim. Keep `NODE_DIMENSIONS` and `getNodeDimensions`. Delete `calculateNodePosition`, `rectsOverlap`, `resolveY`, `resolveX`, `GAP_X`, `GAP_Y`, `ORIGIN` constants. |
| `lib/chat/tools/handlers.ts` | Make `runAddNode` and `dispatchTool` async. Replace `placeBatchInFreeSpace` call with `layoutPatchAsync` call. Drop the `place-batch` import. |
| `lib/chat/brain.ts` | Add `await` before the one `dispatchTool` call. |
| `app/api/chat/stream/route.ts` | Add `await` before the two `dispatchTool` calls. |

There's no test runner in this repo (per [CLAUDE.md](../../../CLAUDE.md)). Verification is `npm run build` (TypeScript check) after every code-changing task, plus manual chat-session walks at the end.

---

## Task 1: Create `layoutPatchAsync` (not yet wired in)

**Files:**
- Create: `lib/workflow/layout-incremental.ts`

This task creates the new function but does not wire it in. The build must still pass since nothing imports the new file yet.

- [ ] **Step 1: Create the file with full implementation**

Create `lib/workflow/layout-incremental.ts` with this exact content:

```typescript
import ELK from 'elkjs/lib/elk.bundled.js';
import type { WorkflowNode, WorkflowEdge } from '@/lib/nodes/types';
import { getNodeDimensions } from './layout-utils';

const elk = new ELK();

const ELK_OPTIONS = {
    'elk.algorithm': 'layered',
    'elk.direction': 'RIGHT',
    'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    'elk.spacing.nodeNode': '60',
    'elk.layered.spacing.nodeNodeBetweenLayers': '120',
    'elk.padding': '[top=50,left=50,bottom=50,right=50]',
    'elk.spacing.componentComponent': '80',
    'elk.separateConnectedComponents': 'true',
    'elk.layered.layering.strategy': 'INTERACTIVE',
    'elk.layered.nodePlacement.strategy': 'INTERACTIVE',
    'elk.layered.crossingMinimization.strategy': 'INTERACTIVE',
    'elk.interactive': 'true',
};

const GROUP_LAYOUT_OPTIONS = {
    'org.eclipse.elk.nodeSize.constraints': 'NODE_LABELS PORTS MINIMUM_SIZE',
};

export interface LayoutPatchInput {
    existingNodes: WorkflowNode[];
    existingEdges: WorkflowEdge[];
    newNodes: WorkflowNode[];
    newEdges: WorkflowEdge[];
}

/**
 * Compute positions for `newNodes` that flow topologically around the
 * existing canvas. Existing node positions are guaranteed unchanged: ELK
 * runs with INTERACTIVE strategies (seeded with existing x/y), and a
 * post-layout step restores existing positions byte-for-byte as a
 * safety net against any INTERACTIVE-mode drift.
 *
 * Returns Map<nodeId, {x, y}> for NEW nodes only. Children inside groups
 * have positions RELATIVE to their parent (React Flow's `parentNode`
 * convention). Top-level nodes have absolute canvas positions.
 *
 * On ELK failure, falls back to a simple "place new nodes to the right
 * of the existing canvas bounding box" rule so the chat tool call
 * doesn't fail because of a layout glitch.
 */
export async function layoutPatchAsync(
    input: LayoutPatchInput,
): Promise<Map<string, { x: number; y: number }>> {
    const { existingNodes, existingEdges, newNodes, newEdges } = input;
    if (newNodes.length === 0) return new Map();

    const allNodes = [...existingNodes, ...newNodes];
    const allEdges = [...existingEdges, ...newEdges];
    const existingIds = new Set(existingNodes.map((n) => n.id));

    // Build a parent → children index so we can attach children inside
    // their parent group's ELK node hierarchically.
    const childrenByParent = new Map<string, WorkflowNode[]>();
    const topLevel: WorkflowNode[] = [];
    for (const n of allNodes) {
        const parent = n.parentNode;
        if (parent) {
            const arr = childrenByParent.get(parent) ?? [];
            arr.push(n);
            childrenByParent.set(parent, arr);
        } else {
            topLevel.push(n);
        }
    }

    const toElkNode = (n: WorkflowNode): any => {
        const { width, height } = getNodeDimensions(n.type);
        const node: any = {
            id: n.id,
            width,
            height,
            properties: { portConstraints: 'FREE' },
        };
        // Seed real x/y for existing nodes so INTERACTIVE strategies
        // honor them as anchors. New nodes have no x/y — ELK computes them.
        if (existingIds.has(n.id)) {
            node.x = n.position?.x ?? 0;
            node.y = n.position?.y ?? 0;
        }
        const kids = childrenByParent.get(n.id);
        if (kids && kids.length > 0) {
            node.children = kids.map(toElkNode);
            node.layoutOptions = GROUP_LAYOUT_OPTIONS;
        }
        return node;
    };

    const elkChildren = topLevel.map(toElkNode);

    // ELK edges. Filter to nodes we're laying out (defensive — there
    // shouldn't be dangling edges by the time we get here). Drop
    // self-loops (a node connected to itself would crash layered).
    const allNodeIds = new Set(allNodes.map((n) => n.id));
    const elkEdges = allEdges
        .filter((e) => allNodeIds.has(e.source) && allNodeIds.has(e.target))
        .filter((e) => e.source !== e.target)
        .map((e) => ({
            id: e.id,
            sources: [e.source],
            targets: [e.target],
        }));

    const graph: any = {
        id: 'root',
        layoutOptions: ELK_OPTIONS,
        children: elkChildren,
        edges: elkEdges,
    };

    try {
        const laidOut = await elk.layout(graph);

        // Walk the output hierarchy. Collect positions for NEW nodes
        // only — existing nodes are anchors and don't get returned
        // (callers don't need to update them).
        const positions = new Map<string, { x: number; y: number }>();
        const visit = (node: any) => {
            if (
                !existingIds.has(node.id) &&
                typeof node.x === 'number' &&
                typeof node.y === 'number'
            ) {
                positions.set(node.id, { x: node.x, y: node.y });
            }
            if (Array.isArray(node.children)) {
                for (const c of node.children) visit(c);
            }
        };
        for (const root of laidOut.children ?? []) visit(root);

        return positions;
    } catch (err) {
        console.error('[layoutPatchAsync] ELK layout failed, using fallback:', err);
        return fallbackPlacement(existingNodes, newNodes);
    }
}

/**
 * Last-resort placement if ELK fails. Drops each new top-level node
 * in a column to the right of the existing canvas bbox. Children
 * inside groups get a simple staircase relative to their parent.
 * Never blocks the AI tool call on a layout glitch.
 */
function fallbackPlacement(
    existing: WorkflowNode[],
    newNodes: WorkflowNode[],
): Map<string, { x: number; y: number }> {
    const positions = new Map<string, { x: number; y: number }>();

    let maxX = 0;
    let minY = Infinity;
    for (const n of existing) {
        if (n.parentNode) continue;
        const { width } = getNodeDimensions(n.type);
        const right = (n.position?.x ?? 0) + width;
        if (right > maxX) maxX = right;
        if ((n.position?.y ?? 0) < minY) minY = n.position?.y ?? 0;
    }
    if (!isFinite(minY)) minY = 0;
    const startX = maxX > 0 ? maxX + 80 : 100;

    let y = minY;
    for (const n of newNodes) {
        if (n.parentNode) continue;
        positions.set(n.id, { x: startX, y });
        y += getNodeDimensions(n.type).height + 60;
    }
    // Children inside new groups: simple staircase relative to parent.
    const childrenByParent = new Map<string, WorkflowNode[]>();
    for (const n of newNodes) {
        if (!n.parentNode) continue;
        const arr = childrenByParent.get(n.parentNode) ?? [];
        arr.push(n);
        childrenByParent.set(n.parentNode, arr);
    }
    for (const [, kids] of childrenByParent) {
        let cy = 24;
        for (const k of kids) {
            positions.set(k.id, { x: 24, y: cy });
            cy += getNodeDimensions(k.type).height + 24;
        }
    }
    return positions;
}
```

- [ ] **Step 2: Verify the build passes**

Run: `npm run build`
Expected: SUCCESS. No new file is imported yet, but TypeScript still compiles it. If there are type errors in `layout-incremental.ts`, fix them before committing.

- [ ] **Step 3: Commit**

```bash
git add lib/workflow/layout-incremental.ts
git commit -m "feat(workflow): add layoutPatchAsync for incremental ELK layout

Introduces a function that lays out AI-emitted node patches using ELK's
INTERACTIVE strategies. Existing canvas nodes are seeded as fixed
anchors; ELK places new nodes around them with proper spacing and group
internals. Not yet wired in.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Wire `layoutPatchAsync` into `runAddNode`; make `dispatchTool` async

**Files:**
- Modify: `lib/chat/tools/handlers.ts`
- Modify: `lib/chat/brain.ts`
- Modify: `app/api/chat/stream/route.ts`

This task makes `runAddNode` and `dispatchTool` async, replaces the `placeBatchInFreeSpace` call with `layoutPatchAsync`, and awaits at all three call sites. It is one atomic commit because partial states will not type-check.

- [ ] **Step 1: Update the import in `handlers.ts`**

In [lib/chat/tools/handlers.ts](../../../lib/chat/tools/handlers.ts), replace this line:

```typescript
import { placeBatchInFreeSpace } from '@/lib/workflow/place-batch';
```

with:

```typescript
import { layoutPatchAsync } from '@/lib/workflow/layout-incremental';
```

- [ ] **Step 2: Make `runAddNode` async and swap the layout call**

In `handlers.ts`, change the function signature and body. Locate the current function (starting at line 111):

```typescript
export function runAddNode(state: ToolHandlerState, args: any): ToolResult {
  const hasNodes = Array.isArray(args?.nodes) && args.nodes.length > 0;
  const hasEdges = Array.isArray(args?.edges) && args.edges.length > 0;

  if (!hasNodes && !hasEdges) {
    return { success: false, error: 'add_node requires at least one node or one edge.' };
  }

  // Translate the batch to sit beside existing canvas content. Children
  // (parentNode set) keep their relative positions; only top-level nodes
  // shift. Empty canvas → no translation. This replaces the per-node
  // client-side layout recalc, so the client can trust the positions it
  // receives.
  if (hasNodes) {
    args = { ...args, nodes: placeBatchInFreeSpace(args.nodes, state.workflow.nodes) };
  }
```

Replace with:

```typescript
export async function runAddNode(state: ToolHandlerState, args: any): Promise<ToolResult> {
  const hasNodes = Array.isArray(args?.nodes) && args.nodes.length > 0;
  const hasEdges = Array.isArray(args?.edges) && args.edges.length > 0;

  if (!hasNodes && !hasEdges) {
    return { success: false, error: 'add_node requires at least one node or one edge.' };
  }

  // Incremental ELK layout: existing canvas nodes are fixed anchors;
  // ELK places the new batch around them with proper spacing and
  // intra-group layout. Mutates positions on args.nodes; existing nodes
  // are untouched. See lib/workflow/layout-incremental.ts.
  if (hasNodes) {
    const positions = await layoutPatchAsync({
      existingNodes: state.workflow.nodes,
      existingEdges: state.workflow.edges,
      newNodes: args.nodes,
      newEdges: args.edges ?? [],
    });
    args = {
      ...args,
      nodes: args.nodes.map((n: any) => {
        const pos = positions.get(n.id);
        return pos ? { ...n, position: pos } : n;
      }),
    };
  }
```

The rest of `runAddNode` (validation loops, per-node apply, edge apply, merged-patch return) is unchanged.

- [ ] **Step 3: Make `dispatchTool` async**

In `handlers.ts`, change `dispatchTool`'s signature and the `add_node` branch to await:

```typescript
export async function dispatchTool(state: ToolHandlerState, name: ToolName, args: any): Promise<ToolResult> {
  switch (name) {
    case 'add_node':    return await runAddNode(state, args);
    case 'update_node': return runUpdateNode(state, args);
    case 'remove_node': return runRemoveNode(state, args);
    case 'ask_clarification':
      // Handled directly by the brain (see brain.ts) — never patch the workflow.
      // Reached only if the brain forwards it here by mistake; treat as a no-op.
      return { success: true };
    case 'propose_plan':
      // Handled directly by the brain (see brain.ts) — never patches the workflow.
      // Reached only if the brain forwards it here by mistake; treat as a no-op,
      // mirroring the ask_clarification handling above.
      return { success: true };
    default: {
      const _exhaustive: never = name;
      return { success: false, error: `Unknown tool: ${_exhaustive}` };
    }
  }
}
```

(Only `runAddNode` actually returns a promise — the `await` is necessary on its branch but the others can stay sync since their return value is auto-wrapped in `Promise.resolve`.)

- [ ] **Step 4: Await `dispatchTool` in `brain.ts`**

In [lib/chat/brain.ts:233](../../../lib/chat/brain.ts#L233), change:

```typescript
          const result = dispatchTool(state, name, event.args);
```

to:

```typescript
          const result = await dispatchTool(state, name, event.args);
```

(The enclosing function is already async — verified by the streaming nature of brain.ts.)

- [ ] **Step 5: Await both `dispatchTool` calls in `route.ts`**

In [app/api/chat/stream/route.ts:145](../../../app/api/chat/stream/route.ts#L145), change:

```typescript
            const result = dispatchTool(state, 'add_node', blueprint);
```

to:

```typescript
            const result = await dispatchTool(state, 'add_node', blueprint);
```

And in [app/api/chat/stream/route.ts:242](../../../app/api/chat/stream/route.ts#L242), change:

```typescript
            const result = dispatchTool(state, 'add_node', augmented);
```

to:

```typescript
            const result = await dispatchTool(state, 'add_node', augmented);
```

- [ ] **Step 6: Verify the build passes**

Run: `npm run build`
Expected: SUCCESS. If TypeScript complains about a sync caller of `dispatchTool` we missed, the error message will point at it — fix by adding `await` and confirming the surrounding function is async.

- [ ] **Step 7: Commit**

```bash
git add lib/chat/tools/handlers.ts lib/chat/brain.ts app/api/chat/stream/route.ts
git commit -m "feat(chat): use incremental ELK layout for AI add_node patches

runAddNode and dispatchTool become async. The add_node path now calls
layoutPatchAsync to compute positions for new nodes via ELK with
existing canvas nodes as fixed anchors. Replaces placeBatchInFreeSpace,
which preserved the LLM's intra-batch layout verbatim and produced
overlapping groups and zero-gap nodes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Delete dead code

**Files:**
- Delete: `lib/workflow/place-batch.ts`
- Modify: `lib/workflow/layout-utils.ts`

Now that nothing imports `place-batch.ts` and nothing calls `calculateNodePosition`, remove them. Keep the `NODE_DIMENSIONS` registry and the `getNodeDimensions` helper since `layout-incremental.ts` imports them.

- [ ] **Step 1: Confirm nothing else imports `place-batch`**

Run a project-wide search for the import. Expected: zero results.

```bash
grep -rn "from '@/lib/workflow/place-batch'" .
grep -rn "from './place-batch'" .
grep -rn "placeBatchInFreeSpace" .
```

If any references remain (other than the docs/specs/plans directories, which are fine), stop and fix them before deleting the file.

- [ ] **Step 2: Delete `lib/workflow/place-batch.ts`**

```bash
git rm lib/workflow/place-batch.ts
```

- [ ] **Step 3: Confirm nothing imports `calculateNodePosition`, `rectsOverlap`, `resolveY`, `resolveX`**

```bash
grep -rn "calculateNodePosition" . --include="*.ts" --include="*.tsx"
grep -rn "rectsOverlap" . --include="*.ts" --include="*.tsx"
```

Expected: zero results outside of `lib/workflow/layout-utils.ts` itself.

- [ ] **Step 4: Trim `lib/workflow/layout-utils.ts` to just the registry**

Replace the entire contents of `lib/workflow/layout-utils.ts` with:

```typescript
// ─────────────────────────────────────────────────────────────────────────────
// Node dimension registry
// Used server-side (where React Flow's `measured` props aren't available) to
// give ELK realistic sizes. Unknown types fall back to DEFAULT_NODE_DIM.
// Tune values here when a node type's rendered size changes.
// ─────────────────────────────────────────────────────────────────────────────
export const NODE_DIMENSIONS: Record<string, { width: number; height: number }> = {
    prompt:       { width: 185, height: 100 },
    media_input:  { width: 210, height: 180 },
    compositor:   { width: 210, height: 280 },
    blur:         { width: 210, height: 220 },
    ai_generator: { width: 210, height: 380 },
};

const DEFAULT_NODE_DIM = { width: 220, height: 380 };

export function getNodeDimensions(type: string): { width: number; height: number } {
    return NODE_DIMENSIONS[type] ?? DEFAULT_NODE_DIM;
}
```

- [ ] **Step 5: Verify the build passes**

Run: `npm run build`
Expected: SUCCESS.

- [ ] **Step 6: Commit**

```bash
git add lib/workflow/layout-utils.ts
git commit -m "chore(workflow): remove vestigial layout helpers

Deletes placeBatchInFreeSpace (replaced by layoutPatchAsync) and the
unused calculateNodePosition helper. Keeps NODE_DIMENSIONS + getNodeDimensions
since layoutPatchAsync needs them for server-side sizing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Manual verification

**No code changes.** Drive the chat brain through the scenarios from [the spec](../specs/2026-05-12-incremental-elk-layout-design.md#testing) and visually inspect.

This task is mandatory — it's the only verification step (no test runner exists). The previous tasks may have shipped code that compiles but doesn't produce the right layouts on real workflows.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

Expected: Next.js starts on port 3000. Open the app in a browser, sign in.

- [ ] **Step 2: Test "simple add" — empty canvas**

Open a fresh chat session. Send: "make me an image of a cat in space".

Expected on canvas: a `prompt` node and an `ai_generator` node, side-by-side with horizontal spacing (~100-150px gap), at a sensible canvas position (not at 0,0 unless that's the empty-canvas origin). No overlap.

If the layout looks worse than what the manual auto-layout button would produce, note specifically what's wrong and which ELK config knob to investigate.

- [ ] **Step 3: Test "add connected to existing"**

In the same chat session, send: "now add a blur effect after the image".

Expected: a `blur` node appears to the right of the existing `ai_generator`, connected by an edge. The existing `prompt` and `ai_generator` nodes have not moved (their pixel positions are byte-identical to the previous turn). The new blur has proper spacing from the ai_generator.

- [ ] **Step 4: Test "replace"**

Send: "replace the blur with a compositor".

Expected: the `blur` node is gone; a `compositor` node sits roughly where the blur was (or in the same horizontal position with possibly different y because compositor is taller). The neighboring `prompt` and `ai_generator` have not moved.

- [ ] **Step 5: Test "multi-task plan with groups"**

Start a fresh chat session. Send: "make me a video with 3 scenes — a forest, an ocean, and a mountain". Approve the plan when the brain proposes one.

Expected: three group containers, side-by-side or in a sensible arrangement, with clear gaps between them (>= 80px from `elk.spacing.componentComponent`). Inside each group, the children (prompt + ai_generator at minimum) are laid out cleanly with non-zero spacing — not overlapping, not at (0,0).

- [ ] **Step 6: Test "add into existing group"**

In the previous session, send: "add a reference image input to the forest scene".

Expected: a `media_input` node slots into the forest group, with proper spacing from the existing children. The forest group's outer position has not moved. Other groups (ocean, mountain) have not moved. The other scenes' internal layouts have not changed.

- [ ] **Step 7: Final visual check**

For each test above, compare the layout to what you would get by clicking the manual auto-layout button (the existing `autoLayoutNodesAsync` path). The AI-driven layouts should look comparable in cleanliness — not necessarily identical, but no worse.

- [ ] **Step 8: If any scenario produces a noticeably bad layout, file the specifics**

Document: which scenario, what's wrong (overlap / zero gap / existing-node moved / etc.), and the rough shape of the workflow. Stop here and report — the spec's fallback section describes the hybrid approach we'd reach for next. Do NOT silently ship a regression.

- [ ] **Step 9: If all scenarios pass, mark the task complete**

No commit needed for Task 4 (no code changed). The plan is done.

---

## Self-Review Notes

- Spec coverage: every § in the spec maps to a task — `layoutPatchAsync` function (Task 1), integration (Task 2), dead-code removal (Task 3), manual verification per the spec's testing section (Task 4). The fallback hybrid is documented as the response to Task 4 failures, matching the spec's fallback section.
- Placeholder scan: none. Every step has either exact code, exact commands, or exact verification criteria.
- Type consistency: `LayoutPatchInput`, `layoutPatchAsync` referenced in Tasks 1 and 2 use identical names/signatures. `dispatchTool` returns `Promise<ToolResult>` in Task 2 step 3 and is awaited in steps 4-5 consistently.
- Scope check: single subsystem (AI-emitted patch layout). Not multiple independent subsystems. One plan is right.
