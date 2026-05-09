# Node Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Group" button to the multi-select toolbar that wraps selected nodes in a draggable, resizable, titled visual container with React Flow native parent/child mechanics.

**Architecture:** A new `'group'` `NodeType` rendered by a custom `GroupNode` component. Children get React Flow's `parentNode` field (without `extent: 'parent'`, so they can be dragged out). React Flow handles drag-together and selection coordination natively. Persistence rides on the existing `WorkflowNode[]` save path.

**Tech Stack:** React 18, Next.js 14 App Router, React Flow 11, Zustand (with persist), TypeScript, Tailwind CSS. **There is no test runner in this repo** ([CLAUDE.md](CLAUDE.md)) — verification per task is `npm run lint` + manual browser checks at `http://localhost:3000`.

**Companion spec:** [docs/superpowers/specs/2026-05-09-node-grouping-design.md](docs/superpowers/specs/2026-05-09-node-grouping-design.md). If anything in this plan contradicts the spec, the spec wins — stop and ask.

---

## Conventions

- **Verification step every task:** `npm run lint` must succeed; if the task affects the canvas UI, also `npm run dev` and exercise the relevant interaction in a browser tab. Watch DevTools console — any new error/warning is a failed verification.
- **Commit format:** Conventional commits (`feat:`, `fix:`, `refactor:`). Match the existing style (see `git log --oneline -15`).
- **Read before edit:** every file mentioned has a Read step before any Edit step in the same task. The Edit tool refuses to operate on un-read files.
- **Constants used throughout:**
  - `GROUP_PADDING = 24` (px around children)
  - `GROUP_TITLE_BAR_HEIGHT = 40` (px reserved at top for title)
  - `GROUP_RESIZE_HANDLE_SIZE = 8` (px hit zone for edge/corner handles)
  - `GROUP_DEFAULT_LABEL = 'Group'`

---

## Task 1: Extend the type system to recognize groups

**Goal:** Make `'group'` a first-class `NodeType` and introduce `GroupConfig`, `parentNode`, `extent` on `WorkflowNode`. Also extend `WorkflowNodeUpdate` to carry `parentNode` so AI patches can reassign children.

**Files:**
- Modify: `lib/nodes/types.ts`
- Modify: `lib/workflow/workflow-patch.ts`

- [ ] **Step 1.1: Read both files**

Read `lib/nodes/types.ts` (full) and `lib/workflow/workflow-patch.ts` (full).

- [ ] **Step 1.2: Add `'group'` to the `NodeType` union**

In `lib/nodes/types.ts`, replace the existing `NodeType` line:

```ts
export type NodeType = 'media_input' | 'compositor' | 'prompt' | 'ai_generator' | 'blur';
```

with:

```ts
export type NodeType = 'media_input' | 'compositor' | 'prompt' | 'ai_generator' | 'blur' | 'group';
```

- [ ] **Step 1.3: Add `GroupConfig` interface and add it to `NodeConfig` union**

In `lib/nodes/types.ts`, just before `export type NodeConfig =` (around line 254), add:

```ts
/**
 * Group Node Configuration
 * Visual container that wraps related nodes. Non-executable — has no handles
 * and is skipped by the workflow engine. Children reference the group via
 * the WorkflowNode.parentNode field.
 */
export interface GroupConfig {
    width: number;   // px in flow coordinates
    height: number;  // px in flow coordinates
}
```

Then update the `NodeConfig` union to include it:

```ts
export type NodeConfig =
    | AIGenerateImageConfig
    | MediaInputConfig
    | CompositorConfig
    | PromptConfig
    | AIGeneratorConfig
    | BlurConfig
    | GroupConfig;
```

- [ ] **Step 1.4: Add `parentNode` and `extent` to `WorkflowNode`**

In `lib/nodes/types.ts`, append two optional fields to the `WorkflowNode` interface (after `measured`):

```ts
    /** ID of the group this node belongs to (omitted when ungrouped) */
    parentNode?: string;
    /** Intentionally NOT set on grouped children — must be omitted so they can be dragged OUT of the group. */
    extent?: 'parent';
```

- [ ] **Step 1.5: Extend `WorkflowNodeUpdate` to carry `parentNode`**

In `lib/workflow/workflow-patch.ts`, replace the existing `WorkflowNodeUpdate` interface (lines 3-7):

```ts
export interface WorkflowNodeUpdate {
    id: string;
    data?: Record<string, any>;
    position?: { x: number; y: number };
}
```

with:

```ts
export interface WorkflowNodeUpdate {
    id: string;
    data?: Record<string, any>;
    position?: { x: number; y: number };
    /** Set to a group id to attach this node to a group, or null to detach. Omit to leave unchanged. */
    parentNode?: string | null;
}
```

- [ ] **Step 1.6: Apply `parentNode` in `applyWorkflowPatch`**

In `lib/workflow/workflow-patch.ts`, replace the existing `nodes.map((node) => { ... })` block inside `applyWorkflowPatch` (around lines 103-119):

```ts
        nodes = nodes.map((node) => {
            const update = updateMap.get(node.id);
            if (!update) return node;

            return {
                ...node,
                ...(update.position ? { position: update.position } : {}),
                data: {
                    ...node.data,
                    ...(update.data || {}),
                    config: {
                        ...node.data?.config,
                        ...(update.data?.config || {})
                    }
                }
            };
        });
```

with:

```ts
        nodes = nodes.map((node) => {
            const update = updateMap.get(node.id);
            if (!update) return node;

            const next: WorkflowNode = {
                ...node,
                ...(update.position ? { position: update.position } : {}),
                data: {
                    ...node.data,
                    ...(update.data || {}),
                    config: {
                        ...node.data?.config,
                        ...(update.data?.config || {})
                    }
                }
            };

            // parentNode: explicit string sets membership, explicit null clears it,
            // undefined leaves it unchanged. We must omit the key when clearing,
            // not set it to undefined, otherwise React Flow still treats the node
            // as having an undefined parent and child layout breaks.
            if (update.parentNode === null) {
                delete (next as any).parentNode;
            } else if (typeof update.parentNode === 'string') {
                next.parentNode = update.parentNode;
            }

            return next;
        });
```

- [ ] **Step 1.7: Reject patches that connect edges to/from group nodes**

In `lib/workflow/workflow-patch.ts`, just inside `applyWorkflowPatch`, after the `removedEdgeSet` line and before `let nodes = ...`, add a defensive filter on `addedEdges` that drops any that touch a group node. We do this by computing the set of group ids from the post-patch node set first.

Replace the body of `applyWorkflowPatch` from `const removedNodeSet = ...` through `if (patch.addedEdges?.length) { ... }` with this version that adds the guard:

```ts
    const removedNodeSet = new Set(patch.removedNodeIds || []);
    const removedEdgeSet = new Set(patch.removedEdgeIds || []);

    let nodes = (base.nodes || []).filter((node) => !removedNodeSet.has(node.id));
    let edges = (base.edges || []).filter((edge) =>
        !removedEdgeSet.has(edge.id) &&
        !removedNodeSet.has(edge.source) &&
        !removedNodeSet.has(edge.target)
    );

    if (patch.updatedNodes?.length) {
        const updateMap = new Map(patch.updatedNodes.map((u) => [u.id, u]));
        nodes = nodes.map((node) => {
            const update = updateMap.get(node.id);
            if (!update) return node;

            const next: WorkflowNode = {
                ...node,
                ...(update.position ? { position: update.position } : {}),
                data: {
                    ...node.data,
                    ...(update.data || {}),
                    config: {
                        ...node.data?.config,
                        ...(update.data?.config || {})
                    }
                }
            };

            if (update.parentNode === null) {
                delete (next as any).parentNode;
            } else if (typeof update.parentNode === 'string') {
                next.parentNode = update.parentNode;
            }

            return next;
        });
    }

    if (patch.addedNodes?.length) {
        nodes = dedupeById([...nodes, ...patch.addedNodes]);
    }

    // Build the post-patch group id set so we can drop any edge that
    // touches a group. Groups are non-executable — edges to/from them
    // would either crash dispatch or silently do nothing.
    const groupIds = new Set(nodes.filter((n) => n.type === 'group').map((n) => n.id));

    if (patch.addedEdges?.length) {
        const safeEdges = patch.addedEdges.filter((e) => {
            if (groupIds.has(e.source) || groupIds.has(e.target)) {
                console.warn(`[applyWorkflowPatch] Dropping edge ${e.id}: connects to a group node (groups are non-executable).`);
                return false;
            }
            return true;
        });
        edges = dedupeById([...edges, ...safeEdges]);
    }
```

- [ ] **Step 1.8: Verify**

Run `npm run lint`. Expected: passes (no new errors).
Run `npx tsc --noEmit` if `tsconfig.json` permits standalone type-check. If not, `npm run build` and abort once it gets past the type-check phase.
Expected: no type errors related to the changed files.

- [ ] **Step 1.9: Commit**

```bash
git add lib/nodes/types.ts lib/workflow/workflow-patch.ts
git commit -m "feat(types): add group node type and parentNode field

Adds 'group' to NodeType union, introduces GroupConfig (width/height),
adds parentNode/extent to WorkflowNode, and extends WorkflowNodeUpdate +
applyWorkflowPatch to support reassigning parentNode via patches.
applyWorkflowPatch also drops any added edge that touches a group node."
```

---

## Task 2: Workflow slice — group lifecycle actions

**Goal:** Add Zustand slice actions for create / ungroup / set-parent / resize / rename. All call `takeSnapshot()` first so they participate in undo/redo.

**Files:**
- Modify: `lib/store/types.ts`
- Modify: `lib/store/slices/workflow-slice.ts`

- [ ] **Step 2.1: Read both files**

Read `lib/store/types.ts` lines 1-110 and `lib/store/slices/workflow-slice.ts` (full). You need to see the existing slice action style.

- [ ] **Step 2.2: Add new action signatures to `WorkflowSlice`**

In `lib/store/types.ts`, inside the `WorkflowSlice` interface, append the following before the closing `}` (after `setWorkflowDirty`):

```ts

    // Grouping
    /**
     * Create a new group node containing the given child node ids.
     * Computes a bounding box around children, adds GROUP_PADDING + title bar room,
     * places the group with zIndex -1, sets parentNode on each child, converts
     * each child's position to be relative to the new group's origin.
     * Returns the new group's id.
     */
    groupNodes: (childIds: string[]) => string | null;
    /**
     * Dissolve a group: clear parentNode on all its children, convert each
     * child's position back to absolute (group.position + child.position),
     * remove the group node itself.
     */
    ungroupNode: (groupId: string) => void;
    /**
     * Move a single node into or out of a group.
     * - parentId = string: attaches; child position is converted from absolute
     *   to relative to the group's origin; group is expanded to fit the child.
     * - parentId = null: detaches; child position is converted from relative
     *   to absolute. Group keeps its current size (no shrink).
     */
    setNodeParent: (nodeId: string, parentId: string | null) => void;
    /**
     * Resize a group container. Clamps width/height so the group never shrinks
     * past the bounding box of current children + GROUP_PADDING.
     */
    resizeGroup: (groupId: string, width: number, height: number) => void;
    /**
     * Rename a group's title (stored in data.label).
     */
    renameGroup: (groupId: string, label: string) => void;
```

- [ ] **Step 2.3: Add a constants module for group sizing**

Create a new file `lib/nodes/group-constants.ts` with:

```ts
/**
 * Shared constants for group node geometry. Imported by the slice (for
 * sizing math) and by the GroupNode component (for layout). Keep these
 * in lockstep — drift between the two would cause snap-back on first drag.
 */
export const GROUP_PADDING = 24;
export const GROUP_TITLE_BAR_HEIGHT = 40;
export const GROUP_RESIZE_HANDLE_SIZE = 8;
export const GROUP_DEFAULT_LABEL = 'Group';
export const GROUP_Z_INDEX = -1;
```

- [ ] **Step 2.4: Implement the actions in the slice**

In `lib/store/slices/workflow-slice.ts`, add an import at the top:

```ts
import {
    GROUP_PADDING,
    GROUP_TITLE_BAR_HEIGHT,
    GROUP_DEFAULT_LABEL,
    GROUP_Z_INDEX,
} from '../../nodes/group-constants';
```

Then, inside the action object returned by `createWorkflowSlice`, append the following five actions before the closing brace (after the existing `setWorkflowDirty` action):

```ts
    groupNodes: (childIds) => {
        const { currentWorkflow } = get();
        if (!currentWorkflow || childIds.length < 2) return null;

        const childSet = new Set(childIds);
        const children = currentWorkflow.nodes.filter((n) => childSet.has(n.id));
        if (children.length < 2) return null;

        // Refuse if any child is already in a group — toolbar should hide the
        // button in this case, but defend in depth.
        if (children.some((c) => c.parentNode)) return null;

        // Compute bounding box of children (in absolute flow coordinates).
        // We use measured.width/height when available, falling back to width/height,
        // and finally a 200x100 default if RF hasn't measured the node yet.
        const bbox = children.reduce(
            (acc, n) => {
                const w = n.measured?.width ?? n.width ?? 200;
                const h = n.measured?.height ?? n.height ?? 100;
                return {
                    minX: Math.min(acc.minX, n.position.x),
                    minY: Math.min(acc.minY, n.position.y),
                    maxX: Math.max(acc.maxX, n.position.x + w),
                    maxY: Math.max(acc.maxY, n.position.y + h),
                };
            },
            { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
        );

        const groupX = bbox.minX - GROUP_PADDING;
        const groupY = bbox.minY - GROUP_PADDING - GROUP_TITLE_BAR_HEIGHT;
        const groupW = (bbox.maxX - bbox.minX) + GROUP_PADDING * 2;
        const groupH = (bbox.maxY - bbox.minY) + GROUP_PADDING * 2 + GROUP_TITLE_BAR_HEIGHT;

        const groupId = `group_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        get().takeSnapshot();

        const groupNode: WorkflowNode = {
            id: groupId,
            type: 'group' as any,
            position: { x: groupX, y: groupY },
            data: {
                label: GROUP_DEFAULT_LABEL,
                config: { width: groupW, height: groupH } as any,
            },
            zIndex: GROUP_Z_INDEX,
        };

        // Convert each child's absolute position to be relative to the group's
        // origin. React Flow positions parented children relative to their parent.
        const updatedNodes: WorkflowNode[] = currentWorkflow.nodes.map((n) => {
            if (!childSet.has(n.id)) return n;
            return {
                ...n,
                parentNode: groupId,
                position: {
                    x: n.position.x - groupX,
                    y: n.position.y - groupY,
                },
            };
        });

        // Group must come BEFORE its children in the array — React Flow requires
        // a parent to appear earlier than any of its children. Otherwise
        // childen flicker at the wrong position on first render.
        const reorderedNodes = [
            groupNode,
            ...updatedNodes,
        ];

        set({
            currentWorkflow: { ...currentWorkflow, nodes: reorderedNodes },
            isWorkflowDirty: true,
        });

        return groupId;
    },

    ungroupNode: (groupId) => {
        const { currentWorkflow } = get();
        if (!currentWorkflow) return;

        const group = currentWorkflow.nodes.find((n) => n.id === groupId && n.type === 'group');
        if (!group) return;

        get().takeSnapshot();

        // Convert children's positions back to absolute and clear parentNode.
        // Then remove the group node entirely.
        const updatedNodes = currentWorkflow.nodes
            .filter((n) => n.id !== groupId)
            .map((n) => {
                if (n.parentNode !== groupId) return n;
                const { parentNode: _p, extent: _e, ...rest } = n;
                return {
                    ...rest,
                    position: {
                        x: n.position.x + group.position.x,
                        y: n.position.y + group.position.y,
                    },
                };
            });

        set({
            currentWorkflow: { ...currentWorkflow, nodes: updatedNodes },
            isWorkflowDirty: true,
        });
    },

    setNodeParent: (nodeId, parentId) => {
        const { currentWorkflow } = get();
        if (!currentWorkflow) return;

        const node = currentWorkflow.nodes.find((n) => n.id === nodeId);
        if (!node) return;
        if (node.type === 'group') return; // never parent a group to anything

        // Same parent — no-op (don't snapshot for nothing).
        if ((node.parentNode || null) === (parentId || null)) return;

        get().takeSnapshot();

        // Compute the node's absolute position from its current state.
        const oldParent = node.parentNode
            ? currentWorkflow.nodes.find((n) => n.id === node.parentNode)
            : null;
        const absoluteX = node.position.x + (oldParent?.position.x ?? 0);
        const absoluteY = node.position.y + (oldParent?.position.y ?? 0);

        const newParent = parentId
            ? currentWorkflow.nodes.find((n) => n.id === parentId)
            : null;
        if (parentId && (!newParent || newParent.type !== 'group')) return;

        // Compute the node's new position (relative to new parent if any).
        const newX = absoluteX - (newParent?.position.x ?? 0);
        const newY = absoluteY - (newParent?.position.y ?? 0);

        let updatedNodes = currentWorkflow.nodes.map((n) => {
            if (n.id !== nodeId) return n;
            if (parentId) {
                return {
                    ...n,
                    parentNode: parentId,
                    position: { x: newX, y: newY },
                };
            }
            const { parentNode: _p, extent: _e, ...rest } = n;
            return {
                ...rest,
                position: { x: newX, y: newY },
            };
        });

        // If we attached to a group, expand the group to fit the new child.
        // (When detaching, we intentionally do NOT shrink the old group — per spec.)
        if (parentId && newParent) {
            const childW = node.measured?.width ?? node.width ?? 200;
            const childH = node.measured?.height ?? node.height ?? 100;
            const childRight = newX + childW;
            const childBottom = newY + childH;
            const cfg = (newParent.data?.config as any) || {};
            const requiredW = childRight + GROUP_PADDING;
            const requiredH = childBottom + GROUP_PADDING;
            const newW = Math.max(cfg.width || 0, requiredW);
            const newH = Math.max(cfg.height || 0, requiredH);
            if (newW !== cfg.width || newH !== cfg.height) {
                updatedNodes = updatedNodes.map((n) =>
                    n.id === parentId
                        ? {
                              ...n,
                              data: {
                                  ...n.data,
                                  config: { ...cfg, width: newW, height: newH },
                              },
                          }
                        : n
                );
            }
        }

        // Re-order so any parent appears before its children.
        const groups = updatedNodes.filter((n) => n.type === 'group');
        const others = updatedNodes.filter((n) => n.type !== 'group');
        const reordered = [...groups, ...others];

        set({
            currentWorkflow: { ...currentWorkflow, nodes: reordered },
            isWorkflowDirty: true,
        });
    },

    resizeGroup: (groupId, width, height) => {
        const { currentWorkflow } = get();
        if (!currentWorkflow) return;

        const group = currentWorkflow.nodes.find((n) => n.id === groupId && n.type === 'group');
        if (!group) return;

        // Clamp to children bbox + padding so user can't shrink past content.
        const children = currentWorkflow.nodes.filter((n) => n.parentNode === groupId);
        const minWidth = children.reduce((acc, c) => {
            const w = c.measured?.width ?? c.width ?? 200;
            return Math.max(acc, c.position.x + w + GROUP_PADDING);
        }, GROUP_PADDING * 2);
        const minHeight = children.reduce((acc, c) => {
            const h = c.measured?.height ?? c.height ?? 100;
            return Math.max(acc, c.position.y + h + GROUP_PADDING);
        }, GROUP_PADDING * 2 + GROUP_TITLE_BAR_HEIGHT);

        const clampedW = Math.max(width, minWidth);
        const clampedH = Math.max(height, minHeight);

        const cfg = (group.data?.config as any) || {};
        if (cfg.width === clampedW && cfg.height === clampedH) return;

        get().takeSnapshot();

        const updatedNodes = currentWorkflow.nodes.map((n) =>
            n.id === groupId
                ? {
                      ...n,
                      data: {
                          ...n.data,
                          config: { ...cfg, width: clampedW, height: clampedH },
                      },
                  }
                : n
        );

        set({
            currentWorkflow: { ...currentWorkflow, nodes: updatedNodes },
            isWorkflowDirty: true,
        });
    },

    renameGroup: (groupId, label) => {
        const { currentWorkflow } = get();
        if (!currentWorkflow) return;

        const group = currentWorkflow.nodes.find((n) => n.id === groupId && n.type === 'group');
        if (!group) return;
        if ((group.data?.label || '') === label) return;

        get().takeSnapshot();

        const updatedNodes = currentWorkflow.nodes.map((n) =>
            n.id === groupId
                ? { ...n, data: { ...n.data, label } }
                : n
        );

        set({
            currentWorkflow: { ...currentWorkflow, nodes: updatedNodes },
            isWorkflowDirty: true,
        });
    },
```

- [ ] **Step 2.5: Verify**

Run `npm run lint`. Expected: passes.
Run `npm run build`. Expected: type-check passes.

- [ ] **Step 2.6: Commit**

```bash
git add lib/store/types.ts lib/store/slices/workflow-slice.ts lib/nodes/group-constants.ts
git commit -m "feat(store): add group lifecycle actions to workflow slice

groupNodes / ungroupNode / setNodeParent / resizeGroup / renameGroup,
plus a shared group-constants module. All actions snapshot for undo/redo.
setNodeParent expands the destination group to fit; detach intentionally
does not shrink the old group (per spec)."
```

---

## Task 3: Build the GroupNode component

**Goal:** Render the group container — translucent background, faint border, title in the top-right with click-to-edit, eight resize handles around the perimeter.

**Files:**
- Create: `components/canvas/GroupNode.tsx`

- [ ] **Step 3.1: Read the existing simplest custom node for styling cues**

Read `components/canvas/PromptNode.tsx` (full) — copy its theming/Tailwind class conventions.
Read `components/canvas/BaseNode.tsx` lines 190-260 — for the rounded-2xl + border styles.

- [ ] **Step 3.2: Create the file**

Create `components/canvas/GroupNode.tsx` with:

```tsx
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { NodeProps } from 'reactflow';
import { useAppStore } from '@/lib/store/app-store';
import {
    GROUP_PADDING,
    GROUP_TITLE_BAR_HEIGHT,
    GROUP_RESIZE_HANDLE_SIZE,
} from '@/lib/nodes/group-constants';

interface GroupNodeData {
    label: string;
    config: { width: number; height: number };
}

type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const HANDLES: Array<{ dir: ResizeDir; cursor: string; style: React.CSSProperties }> = [
    { dir: 'n',  cursor: 'ns-resize', style: { top: -GROUP_RESIZE_HANDLE_SIZE / 2, left: GROUP_RESIZE_HANDLE_SIZE, right: GROUP_RESIZE_HANDLE_SIZE, height: GROUP_RESIZE_HANDLE_SIZE } },
    { dir: 's',  cursor: 'ns-resize', style: { bottom: -GROUP_RESIZE_HANDLE_SIZE / 2, left: GROUP_RESIZE_HANDLE_SIZE, right: GROUP_RESIZE_HANDLE_SIZE, height: GROUP_RESIZE_HANDLE_SIZE } },
    { dir: 'e',  cursor: 'ew-resize', style: { right: -GROUP_RESIZE_HANDLE_SIZE / 2, top: GROUP_RESIZE_HANDLE_SIZE, bottom: GROUP_RESIZE_HANDLE_SIZE, width: GROUP_RESIZE_HANDLE_SIZE } },
    { dir: 'w',  cursor: 'ew-resize', style: { left: -GROUP_RESIZE_HANDLE_SIZE / 2, top: GROUP_RESIZE_HANDLE_SIZE, bottom: GROUP_RESIZE_HANDLE_SIZE, width: GROUP_RESIZE_HANDLE_SIZE } },
    { dir: 'ne', cursor: 'nesw-resize', style: { top: -GROUP_RESIZE_HANDLE_SIZE / 2, right: -GROUP_RESIZE_HANDLE_SIZE / 2, width: GROUP_RESIZE_HANDLE_SIZE, height: GROUP_RESIZE_HANDLE_SIZE } },
    { dir: 'nw', cursor: 'nwse-resize', style: { top: -GROUP_RESIZE_HANDLE_SIZE / 2, left: -GROUP_RESIZE_HANDLE_SIZE / 2, width: GROUP_RESIZE_HANDLE_SIZE, height: GROUP_RESIZE_HANDLE_SIZE } },
    { dir: 'se', cursor: 'nwse-resize', style: { bottom: -GROUP_RESIZE_HANDLE_SIZE / 2, right: -GROUP_RESIZE_HANDLE_SIZE / 2, width: GROUP_RESIZE_HANDLE_SIZE, height: GROUP_RESIZE_HANDLE_SIZE } },
    { dir: 'sw', cursor: 'nesw-resize', style: { bottom: -GROUP_RESIZE_HANDLE_SIZE / 2, left: -GROUP_RESIZE_HANDLE_SIZE / 2, width: GROUP_RESIZE_HANDLE_SIZE, height: GROUP_RESIZE_HANDLE_SIZE } },
];

export default function GroupNode({ id, data, selected }: NodeProps<GroupNodeData>) {
    const width = data.config?.width ?? 400;
    const height = data.config?.height ?? 300;

    const renameGroup = useAppStore((s) => s.renameGroup);
    const resizeGroup = useAppStore((s) => s.resizeGroup);

    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState(data.label || '');
    const inputRef = useRef<HTMLInputElement>(null);

    // Sync draft when label changes externally (undo/redo, AI patch).
    useEffect(() => {
        if (!isEditingTitle) setTitleDraft(data.label || '');
    }, [data.label, isEditingTitle]);

    const commitTitle = useCallback(() => {
        const next = titleDraft.trim() || 'Group';
        renameGroup(id, next);
        setIsEditingTitle(false);
    }, [id, titleDraft, renameGroup]);

    const cancelTitle = useCallback(() => {
        setTitleDraft(data.label || '');
        setIsEditingTitle(false);
    }, [data.label]);

    useEffect(() => {
        if (isEditingTitle) inputRef.current?.select();
    }, [isEditingTitle]);

    // Pointer-driven resize. We capture the pointer on mousedown, then the
    // active-direction state and starting geometry are read from refs (NOT
    // React state) so the handler fires at native rate without re-renders.
    const dragStateRef = useRef<{
        dir: ResizeDir;
        startX: number;
        startY: number;
        startW: number;
        startH: number;
    } | null>(null);

    const onResizePointerDown = useCallback((e: React.PointerEvent, dir: ResizeDir) => {
        e.stopPropagation();
        e.preventDefault();
        (e.target as Element).setPointerCapture(e.pointerId);
        dragStateRef.current = {
            dir,
            startX: e.clientX,
            startY: e.clientY,
            startW: width,
            startH: height,
        };
    }, [width, height]);

    const onResizePointerMove = useCallback((e: React.PointerEvent) => {
        const s = dragStateRef.current;
        if (!s) return;
        const dx = e.clientX - s.startX;
        const dy = e.clientY - s.startY;

        let newW = s.startW;
        let newH = s.startH;
        if (s.dir.includes('e')) newW = s.startW + dx;
        if (s.dir.includes('w')) newW = s.startW - dx;
        if (s.dir.includes('s')) newH = s.startH + dy;
        if (s.dir.includes('n')) newH = s.startH - dy;

        // The slice clamps min size; we don't double-clamp here.
        resizeGroup(id, newW, newH);
    }, [id, resizeGroup]);

    const onResizePointerUp = useCallback((e: React.PointerEvent) => {
        if ((e.target as Element).hasPointerCapture(e.pointerId)) {
            (e.target as Element).releasePointerCapture(e.pointerId);
        }
        dragStateRef.current = null;
    }, []);

    return (
        <div
            className="group relative rounded-2xl bg-bg-primary/60 border border-stroke-subtle/60 transition-colors"
            style={{
                width,
                height,
                // Pointer events: container itself accepts clicks (selection), but
                // children render above due to RF's internal z-stacking.
                // The "group" Tailwind utility class above lets handles use
                // group-hover:opacity-100 to fade in on hover.
            }}
            data-group-id={id}
            data-group-selected={selected ? 'true' : 'false'}
        >
            {/* Title (top-right). Single click selects the group via RF's normal
                selection handler; second click on the title turns into an input. */}
            <div
                className="absolute top-0 right-0 h-[40px] flex items-center pr-3 pointer-events-auto"
                style={{ height: GROUP_TITLE_BAR_HEIGHT }}
                onMouseDown={(e) => e.stopPropagation()}
            >
                {isEditingTitle ? (
                    <input
                        ref={inputRef}
                        value={titleDraft}
                        onChange={(e) => setTitleDraft(e.target.value)}
                        onBlur={commitTitle}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') commitTitle();
                            else if (e.key === 'Escape') cancelTitle();
                        }}
                        className="bg-transparent border-b border-stroke-subtle text-content-primary text-sm px-1 py-0.5 outline-none focus:border-accent-primary nopan nodrag"
                    />
                ) : (
                    <button
                        type="button"
                        onClick={(e) => {
                            // Only enter rename mode on a second click — this stops
                            // the very first click from immediately stealing focus
                            // before the user even sees that the group is selected.
                            if (selected) {
                                e.stopPropagation();
                                setIsEditingTitle(true);
                            }
                        }}
                        className="text-content-primary text-sm font-medium px-1 py-0.5 rounded hover:bg-white/5 cursor-text"
                    >
                        {data.label || 'Group'}
                    </button>
                )}
            </div>

            {/* Resize handles — visible on hover or when the group is selected.
                Always rendered so they participate in pointer hit-testing; their
                opacity is what changes. */}
            {HANDLES.map((h) => (
                <div
                    key={h.dir}
                    onPointerDown={(e) => onResizePointerDown(e, h.dir)}
                    onPointerMove={onResizePointerMove}
                    onPointerUp={onResizePointerUp}
                    className={
                        "absolute z-20 nopan nodrag transition-opacity " +
                        (selected ? "opacity-100" : "opacity-0 group-hover:opacity-100")
                    }
                    style={{ ...h.style, cursor: h.cursor }}
                />
            ))}
        </div>
    );
}
```

- [ ] **Step 3.3: Verify it compiles in isolation**

Run `npm run lint`. Expected: passes.

The component won't render anywhere yet — registration happens in Task 4. Don't try to use it in the browser this task.

- [ ] **Step 3.4: Commit**

```bash
git add components/canvas/GroupNode.tsx
git commit -m "feat(canvas): add GroupNode component

Translucent container with faint border, top-right inline-editable title,
8 resize handles (4 edges + 4 corners) with native cursors, pointer-driven
resize that calls into the workflow slice's resizeGroup action."
```

---

## Task 4: Register the group node type with React Flow

**Goal:** Make `'group'` resolve to `GroupNode` in `stableNodeTypes`. Without this, the Proxy fallback would render groups as `AIGeneratorNode`.

**Files:**
- Modify: `components/editor/reactflow-types.ts`

- [ ] **Step 4.1: Read the file**

Read `components/editor/reactflow-types.ts` (full).

- [ ] **Step 4.2: Add the import and registration**

In `components/editor/reactflow-types.ts`, after the `import AIGeneratorNode` line, add:

```ts
import GroupNode from '@/components/canvas/GroupNode';
```

Then, in the `concreteNodeTypes` object, add a `group` entry:

```ts
const concreteNodeTypes: Record<string, React.ComponentType<any>> = {
    ...baseNodeTypes,
    ai_generator: AIGeneratorNode,
    legacy: FallbackNode,
    group: GroupNode,
};
```

- [ ] **Step 4.3: Verify**

Run `npm run lint`. Expected: passes.
Run `npm run dev`. Open the app in a browser. The canvas should still render normally. There's no UI to create groups yet — verifying nothing has regressed.

- [ ] **Step 4.4: Commit**

```bash
git add components/editor/reactflow-types.ts
git commit -m "feat(canvas): register group node type with React Flow

Maps 'group' to GroupNode in stableNodeTypes so it doesn't fall through
the Proxy to AIGeneratorNode."
```

---

## Task 5: Add the Group button to the multi-select toolbar

**Goal:** Add a third button — left of Copy — to the existing `NodeToolbar` in `EditorCanvas.tsx`. Clicking it calls `groupNodes(selectedIds)`. Hidden when any selected node is already in a group.

**Files:**
- Modify: `components/editor/EditorCanvas.tsx`

- [ ] **Step 5.1: Read the file**

Read `components/editor/EditorCanvas.tsx` lines 1-200 to see the imports and `selectedNodeIds`/`handleDuplicateSelected` patterns. Read lines 540-600 for the NodeToolbar render.

- [ ] **Step 5.2: Add `Group` to the lucide imports**

In `components/editor/EditorCanvas.tsx`, replace:

```ts
import { Trash2, Copy } from 'lucide-react';
```

with:

```ts
import { Trash2, Copy, Group as GroupIcon } from 'lucide-react';
```

- [ ] **Step 5.3: Add the visibility check + handler**

In `components/editor/EditorCanvas.tsx`, just below the existing `handleDeleteSelected = useCallback(...)` definition (around line 205), add:

```ts
    // Group button is shown only when 2+ nodes are selected AND none are already
    // in a group. Mixed selections (some grouped, some not) would be ambiguous —
    // the user must ungroup first.
    const canGroupSelection = useMemo(() => {
        if (selectedNodeIds.length < 2) return false;
        const rfNodes = reactFlowInstance?.getNodes() ?? localNodes;
        const selectedNodes = rfNodes.filter((n: any) => selectedNodeIds.includes(n.id));
        if (selectedNodes.length < 2) return false;
        // No selected node may already have a parentNode, AND none may BE a group
        // (no nesting per spec).
        return selectedNodes.every((n: any) => !n.parentNode && n.type !== 'group');
    }, [reactFlowInstance, localNodes, selectedNodeIds]);

    const groupNodes = useAppStore((state) => state.groupNodes);

    const handleGroupSelected = useCallback(() => {
        if (!canGroupSelection) return;
        const newGroupId = groupNodes(selectedNodeIds);
        if (newGroupId && reactFlowInstance) {
            // Move selection from the children to the new group itself, so the
            // single-select toolbar / property panel act on the group next.
            reactFlowInstance.setNodes((nds: any[]) =>
                nds.map((n) => ({ ...n, selected: n.id === newGroupId })),
            );
        }
    }, [canGroupSelection, groupNodes, selectedNodeIds, reactFlowInstance]);
```

- [ ] **Step 5.4: Add the Group button to the toolbar markup**

In `components/editor/EditorCanvas.tsx`, replace the existing `<div className="nopan nowheel ...">` block inside the `<NodeToolbar>` (around lines 549-573) with this version that adds the Group button on the LEFT of Copy:

```tsx
                        <div
                            className="nopan nowheel flex items-center gap-0.5 p-0.5 rounded-md bg-surface-elevated/95 backdrop-blur-md border border-stroke-subtle shadow-lg"
                            style={{ pointerEvents: 'auto', zIndex: 50 }}
                            onMouseDown={(e) => e.stopPropagation()}
                        >
                            {canGroupSelection && (
                                <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleGroupSelected(); }}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    className="w-6 h-6 rounded flex items-center justify-center text-content-primary hover:bg-white/10 hover:text-accent-primary transition-all"
                                    title="Group selected"
                                >
                                    <GroupIcon className="w-3 h-3 pointer-events-none" />
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleDuplicateSelected(); }}
                                onMouseDown={(e) => e.stopPropagation()}
                                className="w-6 h-6 rounded flex items-center justify-center text-content-primary hover:bg-white/10 hover:text-accent-primary transition-all"
                                title="Duplicate selected"
                            >
                                <Copy className="w-3 h-3 pointer-events-none" />
                            </button>
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleDeleteSelected(); }}
                                onMouseDown={(e) => e.stopPropagation()}
                                className="w-6 h-6 rounded flex items-center justify-center text-accent-error hover:bg-accent-error/20 transition-all"
                                title="Delete selected"
                            >
                                <Trash2 className="w-3 h-3 pointer-events-none" />
                            </button>
                        </div>
```

- [ ] **Step 5.5: Verify**

Run `npm run lint`. Expected: passes.
Run `npm run dev`. In the browser:
1. Drop two media_input nodes onto the canvas
2. Marquee-select them or shift-click both
3. The toolbar above should now show three buttons: Group / Copy / Delete (left to right)
4. Click Group — a translucent container with title "Group" should appear behind the two nodes; the two nodes should now sit inside it
5. Drag the container's body — both children move with it (React Flow native behavior)
6. Drag one child — it moves freely (we have not yet implemented drag-OUT detection, so it will visually leave the container but still be `parentNode`-attached)

Console should be free of new errors/warnings.

- [ ] **Step 5.6: Commit**

```bash
git add components/editor/EditorCanvas.tsx
git commit -m "feat(canvas): add Group button to multi-select toolbar

Third toolbar button (left of Copy) appears when 2+ nodes are selected
and none are already in a group. Click groups them via the slice action
and re-selects the new group node."
```

---

## Task 6: Drag-OUT — clear `parentNode` when child leaves the group

**Goal:** When a child is drag-stopped with its center outside the group's rect, call `setNodeParent(childId, null)`. The group keeps its size (per spec — no shrink).

**Files:**
- Modify: `components/editor/EditorCanvas.tsx`

- [ ] **Step 6.1: Read the relevant section**

Read `components/editor/EditorCanvas.tsx` lines 268-340 (the existing drag handlers).

- [ ] **Step 6.2: Augment `handleNodeDragStop` to detect drag-out**

In `components/editor/EditorCanvas.tsx`, locate `handleNodeDragStop` (around line 294) and replace it with this version:

```ts
    const setNodeParent = useAppStore((state) => state.setNodeParent);

    const handleNodeDragStop: NodeDragHandler = useCallback((event, node, nodes) => {
        isDraggingRef.current = false;
        setIsDragging(false);

        // Sync final positions to global store
        const positionsMap = new Map<string, { x: number; y: number }>();
        nodes.forEach(n => positionsMap.set(n.id, n.position));

        if (updatePositions) {
            updatePositions(positionsMap);
        }

        // ── DRAG-OUT detection ────────────────────────────────────────────────
        // For every dragged node that has a parentNode, check whether its CENTER
        // is now outside the parent's rect. If so, detach it (slice converts the
        // position to absolute and leaves the group's size unchanged per spec).
        const allNodes = reactFlowInstance?.getNodes() ?? [];
        for (const dragged of nodes) {
            if (!dragged.parentNode) continue;
            const parent = allNodes.find((n: any) => n.id === dragged.parentNode);
            if (!parent || parent.type !== 'group') continue;
            const childW = dragged.width ?? dragged.measured?.width ?? 200;
            const childH = dragged.height ?? dragged.measured?.height ?? 100;
            const childCenterX = dragged.position.x + childW / 2;
            const childCenterY = dragged.position.y + childH / 2;
            const cfg = (parent.data?.config as any) || {};
            const insideX = childCenterX >= 0 && childCenterX <= (cfg.width || 0);
            const insideY = childCenterY >= 0 && childCenterY <= (cfg.height || 0);
            if (!insideX || !insideY) {
                setNodeParent(dragged.id, null);
            }
        }

        // Commit the local zIndex pop applied in handleWrapperMouseDown so it
        // survives the next prop sync. Doing it here keeps the global store
        // write away from the moment of grab.
        useAppStore.getState().bringNodeToFront(node.id);

        touchInteraction();
        if (onNodeDragStop) onNodeDragStop(event, node, nodes);
    }, [setIsDragging, onNodeDragStop, touchInteraction, updatePositions, reactFlowInstance, setNodeParent]);
```

- [ ] **Step 6.3: Mirror the same logic into `handleSelectionDragStop`**

Multi-drag (after a marquee) goes through `handleSelectionDragStop`, NOT `handleNodeDragStop`. Replace `handleSelectionDragStop` (around line 325) with:

```ts
    const handleSelectionDragStop = useCallback((_event: React.MouseEvent, nodes: any[]) => {
        isDraggingRef.current = false;
        setIsDragging(false);

        const positionsMap = new Map<string, { x: number; y: number }>();
        nodes.forEach(n => positionsMap.set(n.id, n.position));

        if (updatePositions) {
            updatePositions(positionsMap);
        }

        // Same drag-OUT detection as handleNodeDragStop. Multi-drag is just a
        // batched version of single-node drag.
        const allNodes = reactFlowInstance?.getNodes() ?? [];
        for (const dragged of nodes) {
            if (!dragged.parentNode) continue;
            const parent = allNodes.find((n: any) => n.id === dragged.parentNode);
            if (!parent || parent.type !== 'group') continue;
            const childW = dragged.width ?? dragged.measured?.width ?? 200;
            const childH = dragged.height ?? dragged.measured?.height ?? 100;
            const childCenterX = dragged.position.x + childW / 2;
            const childCenterY = dragged.position.y + childH / 2;
            const cfg = (parent.data?.config as any) || {};
            const insideX = childCenterX >= 0 && childCenterX <= (cfg.width || 0);
            const insideY = childCenterY >= 0 && childCenterY <= (cfg.height || 0);
            if (!insideX || !insideY) {
                setNodeParent(dragged.id, null);
            }
        }

        touchInteraction();
    }, [setIsDragging, touchInteraction, updatePositions, reactFlowInstance, setNodeParent]);
```

- [ ] **Step 6.4: Verify**

Run `npm run lint`. Expected: passes.
Run `npm run dev`. In the browser:
1. Create a group of 2 nodes (Task 5)
2. Drag one child out so its center is past the group's edge — release
3. Expected: child is now standalone (no longer moves with the group); the group's size is unchanged (no shrink)
4. Refresh the page — the change persists
5. Undo (Ctrl+Z) — the child returns to being grouped

- [ ] **Step 6.5: Commit**

```bash
git add components/editor/EditorCanvas.tsx
git commit -m "feat(canvas): detect drag-OUT of group children

On drag-stop (single or selection), if a parented child's center is outside
the parent group's rect, detach it via setNodeParent. Group keeps its size."
```

---

## Task 7: Drag-IN with hover-highlight

**Goal:** While dragging an unparented node, hit-test against every group's rect; highlight the touched group's border. On drop while touching, attach the node and expand the group.

**Files:**
- Modify: `components/editor/EditorCanvas.tsx`
- Modify: `components/canvas/GroupNode.tsx`

- [ ] **Step 7.1: Read both files**

Read both files to refresh context.

- [ ] **Step 7.2: Add a global "drag-over group" signal to the app store UI slice**

Find the UI slice file: `git ls-files | grep ui-slice` should return `lib/store/slices/ui-slice.ts`. Read it. Then add a transient state field for which group is being hovered during drag-in.

In `lib/store/types.ts`, find the `UISlice` interface and add inside it (before the closing `}`):

```ts
    /** ID of the group currently being hovered over by a dragged node, or null. Ephemeral — never persisted. */
    dragHoverGroupId: string | null;
    setDragHoverGroupId: (id: string | null) => void;
```

In `lib/store/slices/ui-slice.ts`, inside the slice action object, append:

```ts
    dragHoverGroupId: null,
    setDragHoverGroupId: (id) => set({ dragHoverGroupId: id }),
```

In `lib/store/app-store.ts`, find the `partialize` filter and add `'dragHoverGroupId'` to the excluded keys list (so it doesn't persist):

```ts
                    'nodeLabelDraft',
                    'dragHoverGroupId',
                ].includes(key))
```

- [ ] **Step 7.3: Add hover highlight to GroupNode**

In `components/canvas/GroupNode.tsx`, find the import block and add:

```tsx
const useDragHoverGroupId = () => {
    // Inline hook to avoid a separate file. Imports useAppStore from the
    // existing import already at the top.
    return useAppStore((s: any) => s.dragHoverGroupId);
};
```

Then inside the `GroupNode` function, after the existing `width` / `height` lines, add:

```tsx
    const hoveredGroupId = useDragHoverGroupId();
    const isHoverTarget = hoveredGroupId === id;
```

Replace the outer `<div className="relative rounded-2xl ...` line so the border switches under hover:

```tsx
        <div
            className={
                "relative rounded-2xl bg-bg-primary/60 transition-colors " +
                (isHoverTarget
                    ? "border-2 border-accent-primary"
                    : "border border-stroke-subtle/60")
            }
            style={{
                width,
                height,
            }}
            data-group-id={id}
            data-group-selected={selected ? 'true' : 'false'}
        >
```

- [ ] **Step 7.4: Add drag-IN detection in EditorCanvas**

In `components/editor/EditorCanvas.tsx`, locate the `onNodeDrag` handler — currently not declared. Add a new prop and pass-through. First, add this above `handleNodeDragStop`:

```ts
    const setDragHoverGroupId = useAppStore((state) => state.setDragHoverGroupId);

    const handleNodeDrag: NodeDragHandler = useCallback((_event, node, _nodes) => {
        // Only consider drag-IN for nodes that are NOT already inside a group.
        // (A node already in a group can be dragged out — Task 6 handles that.)
        if (node.parentNode) {
            setDragHoverGroupId(null);
            return;
        }
        if (node.type === 'group') {
            setDragHoverGroupId(null);
            return;
        }

        const allNodes = reactFlowInstance?.getNodes() ?? [];
        const childW = node.width ?? node.measured?.width ?? 200;
        const childH = node.height ?? node.measured?.height ?? 100;
        const childRect = {
            left: node.position.x,
            top: node.position.y,
            right: node.position.x + childW,
            bottom: node.position.y + childH,
        };

        // Find the first group whose rect overlaps the dragged node's rect.
        // "Touching" per spec — any overlap counts.
        let hoverId: string | null = null;
        for (const g of allNodes) {
            if (g.type !== 'group') continue;
            const cfg = (g.data?.config as any) || {};
            const gRect = {
                left: g.position.x,
                top: g.position.y,
                right: g.position.x + (cfg.width || 0),
                bottom: g.position.y + (cfg.height || 0),
            };
            const overlaps =
                childRect.right >= gRect.left &&
                childRect.left <= gRect.right &&
                childRect.bottom >= gRect.top &&
                childRect.top <= gRect.bottom;
            if (overlaps) {
                hoverId = g.id;
                break;
            }
        }
        setDragHoverGroupId(hoverId);
    }, [reactFlowInstance, setDragHoverGroupId]);
```

- [ ] **Step 7.5: Wire `onNodeDrag` into the `<ReactFlow>` element**

In `components/editor/EditorCanvas.tsx`, find the `<ReactFlow>` JSX (around line 498). Add the `onNodeDrag` prop next to `onNodeDragStart`:

```tsx
                onNodeDragStart={handleNodeDragStart}
                onNodeDrag={handleNodeDrag}
                onNodeDragStop={handleNodeDragStop}
```

- [ ] **Step 7.6: Apply the attach + expand on drag-stop**

In `components/editor/EditorCanvas.tsx`, modify `handleNodeDragStop` to use the hover signal. Replace the `handleNodeDragStop` body so it ALSO performs the attach. Update the function (the version from Task 6) to add a drag-IN clause **before** the existing drag-OUT loop:

```ts
    const handleNodeDragStop: NodeDragHandler = useCallback((event, node, nodes) => {
        isDraggingRef.current = false;
        setIsDragging(false);

        const positionsMap = new Map<string, { x: number; y: number }>();
        nodes.forEach(n => positionsMap.set(n.id, n.position));

        if (updatePositions) {
            updatePositions(positionsMap);
        }

        // ── DRAG-IN: attach the dragged node to the hovered group, if any. ─────
        // Only the primary `node` arg is the one being dragged. Selection drags
        // route through handleSelectionDragStop (which does not currently
        // attach into groups — explicitly out of scope: drag-in is single-node).
        const hoveredGroupId = useAppStore.getState().dragHoverGroupId;
        if (hoveredGroupId && !node.parentNode && node.type !== 'group') {
            setNodeParent(node.id, hoveredGroupId);
        }
        setDragHoverGroupId(null);

        // ── DRAG-OUT: detect parented children whose center has left the rect. ─
        const allNodes = reactFlowInstance?.getNodes() ?? [];
        for (const dragged of nodes) {
            if (!dragged.parentNode) continue;
            const parent = allNodes.find((n: any) => n.id === dragged.parentNode);
            if (!parent || parent.type !== 'group') continue;
            const childW = dragged.width ?? dragged.measured?.width ?? 200;
            const childH = dragged.height ?? dragged.measured?.height ?? 100;
            const childCenterX = dragged.position.x + childW / 2;
            const childCenterY = dragged.position.y + childH / 2;
            const cfg = (parent.data?.config as any) || {};
            const insideX = childCenterX >= 0 && childCenterX <= (cfg.width || 0);
            const insideY = childCenterY >= 0 && childCenterY <= (cfg.height || 0);
            if (!insideX || !insideY) {
                setNodeParent(dragged.id, null);
            }
        }

        useAppStore.getState().bringNodeToFront(node.id);

        touchInteraction();
        if (onNodeDragStop) onNodeDragStop(event, node, nodes);
    }, [setIsDragging, onNodeDragStop, touchInteraction, updatePositions, reactFlowInstance, setNodeParent, setDragHoverGroupId]);
```

- [ ] **Step 7.7: Verify**

Run `npm run lint`. Expected: passes.
Run `npm run dev`. In the browser:
1. Create a group of 2 nodes
2. Drop a third media_input outside the group, then drag it so it touches the group's border — group's border highlights with accent color
3. Release while overlapping — node attaches to the group (now drags with it); group expands if needed to fit
4. Drag the new child out past the group's edge — it detaches; group keeps its size
5. No console errors

- [ ] **Step 7.8: Commit**

```bash
git add lib/store/types.ts lib/store/slices/ui-slice.ts lib/store/app-store.ts \
        components/canvas/GroupNode.tsx components/editor/EditorCanvas.tsx
git commit -m "feat(canvas): drag-IN with hover highlight + auto-expand

Adds dragHoverGroupId UI signal, hit-tested in onNodeDrag against group
rects. Hovered group gets a 2px accent border. On drop while overlapping,
setNodeParent attaches the node and expands the group to fit."
```

---

## Task 8: Generalize Duplicate to handle group selection

**Goal:** When a group is in the selection set, fold its children in too. Duplicate the group + all children + their internal edges as one bundle, with `parentNode` references remapped.

**Files:**
- Modify: `components/editor/EditorCanvas.tsx`

- [ ] **Step 8.1: Read the existing function**

Read `components/editor/EditorCanvas.tsx` lines 153-200.

- [ ] **Step 8.2: Replace `handleDuplicateSelected`**

Replace the existing `handleDuplicateSelected` function (around lines 153-197) with:

```ts
    const handleDuplicateSelected = useCallback(() => {
        const rfNodes = reactFlowInstance?.getNodes() ?? localNodes;
        const directlySelected = rfNodes.filter((n: any) => n.selected);
        if (!onDuplicate || directlySelected.length === 0) return;

        // If any selected node is a group, fold its children into the duplication
        // set so the group + its contents move as one bundle.
        const expandedSet = new Map<string, any>();
        directlySelected.forEach((n: any) => expandedSet.set(n.id, n));
        for (const sel of directlySelected) {
            if (sel.type === 'group') {
                const children = rfNodes.filter((n: any) => n.parentNode === sel.id);
                children.forEach((c: any) => expandedSet.set(c.id, c));
            }
        }
        const selectedNodes = Array.from(expandedSet.values());
        const selectedNodeIdSet = new Set(selectedNodes.map((n: any) => n.id));

        // Filter the raw edges (not memoizedEdges, which carry runtime style fields).
        const selectedEdges = (edges || []).filter((e: any) =>
            selectedNodeIdSet.has(e.source) && selectedNodeIdSet.has(e.target)
        );

        // Clone with fresh ids, remap edge endpoints, and remap parentNode refs
        // so duplicated children point at the duplicated group, not the original.
        const idMap = new Map<string, string>();
        const stamp = Date.now();
        const newNodes = selectedNodes.map((n: any, i: number) => {
            const newId = (n.type === 'group' ? 'group_' : 'node_')
                + `${stamp}_${i}_${Math.random().toString(36).slice(2, 8)}`;
            idMap.set(n.id, newId);
            const { width: _w, height: _h, positionAbsolute: _pa, dragging: _dr, ...rest } = n as any;
            // For non-group nodes, original copy logic offsets by +40,+40. For
            // group children, we keep the relative position (since their parent
            // is also being duplicated and itself shifts by +40,+40).
            const offset = n.parentNode ? { x: 0, y: 0 } : { x: 40, y: 40 };
            return {
                ...JSON.parse(JSON.stringify(rest)),
                id: newId,
                position: {
                    x: (n.position?.x || 0) + offset.x,
                    y: (n.position?.y || 0) + offset.y,
                },
                selected: false,
            };
        });

        // Second pass: remap parentNode on duplicated children to point at the
        // duplicated parent. Drop parentNode if its target wasn't duplicated
        // (defensive — shouldn't happen given the expandedSet logic above).
        for (const n of newNodes) {
            if (n.parentNode) {
                const remapped = idMap.get(n.parentNode);
                if (remapped) n.parentNode = remapped;
                else delete n.parentNode;
            }
        }

        const newEdges = selectedEdges.map((e: any, i: number) => {
            const cloned = JSON.parse(JSON.stringify(e));
            return {
                ...cloned,
                id: `edge_${stamp}_${i}_${Math.random().toString(36).slice(2, 8)}`,
                source: idMap.get(e.source) as string,
                target: idMap.get(e.target) as string,
                selected: false,
            };
        });

        onDuplicate(newNodes, newEdges);
    }, [reactFlowInstance, localNodes, edges, onDuplicate]);
```

- [ ] **Step 8.3: Verify**

Run `npm run lint`. Expected: passes.
Run `npm run dev`. In the browser:
1. Create a group of 2 connected nodes (drop two media_input → connect via wire → group both)
2. Click the group to select it
3. Press Copy in the toolbar
4. Expected: a complete duplicate appears — new group, new children (offset slightly because parent moves +40,+40), internal edge preserved between the duplicated children

- [ ] **Step 8.4: Commit**

```bash
git add components/editor/EditorCanvas.tsx
git commit -m "feat(canvas): duplicate group + children + internal edges as a bundle

When a group is in the selection, children are folded in automatically;
parentNode refs in the duplicated children are remapped to the new group id."
```

---

## Task 9: Generalize Delete to remove group + children + connected edges

**Goal:** When the selected set includes a group, delete it together with all its children and any edges connected to those children.

**Files:**
- Modify: `components/editor/EditorCanvas.tsx`

- [ ] **Step 9.1: Read the file**

Read `components/editor/EditorCanvas.tsx` lines 199-210.

- [ ] **Step 9.2: Replace `handleDeleteSelected`**

Replace the existing `handleDeleteSelected` function with:

```ts
    const handleDeleteSelected = useCallback(() => {
        if (!onDelete) return;
        const rfNodes = reactFlowInstance?.getNodes() ?? localNodes;
        const directlySelected = rfNodes.filter((n: any) => n.selected);
        if (directlySelected.length === 0) return;

        // Fold each selected group's children into the delete set so groups
        // delete as a single bundle.
        const idsToDelete = new Set<string>();
        directlySelected.forEach((n: any) => idsToDelete.add(n.id));
        for (const sel of directlySelected) {
            if (sel.type === 'group') {
                rfNodes
                    .filter((n: any) => n.parentNode === sel.id)
                    .forEach((c: any) => idsToDelete.add(c.id));
            }
        }

        onDelete(Array.from(idsToDelete));
    }, [reactFlowInstance, localNodes, onDelete]);
```

The downstream `onDelete` handler in `WorkspaceLayout` / `SharedWorkflowEditor` already removes connected edges when nodes are removed (it's the same path used by the existing single-node delete and the Delete-key shortcut), so no change is needed there.

- [ ] **Step 9.3: Verify**

Run `npm run lint`. Expected: passes.
Run `npm run dev`. In the browser:
1. Create a group with 2 nodes connected to a third (ungrouped) node via an edge
2. Select the group, press Delete in the toolbar
3. Expected: group disappears, both children disappear, the edge connecting one child to the third node disappears, the third node remains

- [ ] **Step 9.4: Commit**

```bash
git add components/editor/EditorCanvas.tsx
git commit -m "feat(canvas): delete group + children + connected edges as a bundle

When a group is in the selection, its children are folded into the
delete set. Edge cleanup happens in the existing onDelete pipeline."
```

---

## Task 10: Add the Ungroup button to the toolbar

**Goal:** When exactly one node is selected and it's a group, the toolbar shows an additional "Ungroup" button between Copy and Delete (or wherever fits — see step). Click calls `ungroupNode(groupId)`.

**Files:**
- Modify: `components/editor/EditorCanvas.tsx`

- [ ] **Step 10.1: Read the toolbar section**

Read `components/editor/EditorCanvas.tsx` lines 540-600.

- [ ] **Step 10.2: Add a single-select toolbar branch for groups**

The current `<NodeToolbar>` only renders when `selectedNodeIds.length >= 2`. We need a second `<NodeToolbar>` instance that renders when a single group is selected.

Add the import:

```ts
import { Trash2, Copy, Group as GroupIcon, Ungroup as UngroupIcon } from 'lucide-react';
```

Add the handler (place near `handleGroupSelected`):

```ts
    const ungroupNode = useAppStore((state) => state.ungroupNode);

    // True when exactly one node is selected AND it's a group.
    const singleSelectedGroupId = useMemo(() => {
        if (selectedNodeIds.length !== 1) return null;
        const rfNodes = reactFlowInstance?.getNodes() ?? localNodes;
        const sel = rfNodes.find((n: any) => n.id === selectedNodeIds[0]);
        return sel && sel.type === 'group' ? sel.id : null;
    }, [reactFlowInstance, localNodes, selectedNodeIds]);

    const handleUngroup = useCallback(() => {
        if (!singleSelectedGroupId) return;
        ungroupNode(singleSelectedGroupId);
    }, [singleSelectedGroupId, ungroupNode]);

    // Reuse handleDeleteSelected — it already folds group children into the
    // delete set when a group is in the selection (Task 9).
```

After the existing `{selectedNodeIds.length >= 2 && (<NodeToolbar>...)}` block, add a second toolbar for the group-only case:

```tsx
                {singleSelectedGroupId && (
                    <NodeToolbar
                        isVisible={true}
                        nodeId={singleSelectedGroupId}
                        position={Position.Top}
                        align="end"
                    >
                        <div
                            className="nopan nowheel flex items-center gap-0.5 p-0.5 rounded-md bg-surface-elevated/95 backdrop-blur-md border border-stroke-subtle shadow-lg"
                            style={{ pointerEvents: 'auto', zIndex: 50 }}
                            onMouseDown={(e) => e.stopPropagation()}
                        >
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleUngroup(); }}
                                onMouseDown={(e) => e.stopPropagation()}
                                className="w-6 h-6 rounded flex items-center justify-center text-content-primary hover:bg-white/10 hover:text-accent-primary transition-all"
                                title="Ungroup"
                            >
                                <UngroupIcon className="w-3 h-3 pointer-events-none" />
                            </button>
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleDuplicateSelected(); }}
                                onMouseDown={(e) => e.stopPropagation()}
                                className="w-6 h-6 rounded flex items-center justify-center text-content-primary hover:bg-white/10 hover:text-accent-primary transition-all"
                                title="Duplicate group"
                            >
                                <Copy className="w-3 h-3 pointer-events-none" />
                            </button>
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleDeleteSelected(); }}
                                onMouseDown={(e) => e.stopPropagation()}
                                className="w-6 h-6 rounded flex items-center justify-center text-accent-error hover:bg-accent-error/20 transition-all"
                                title="Delete group + contents"
                            >
                                <Trash2 className="w-3 h-3 pointer-events-none" />
                            </button>
                        </div>
                    </NodeToolbar>
                )}
```

- [ ] **Step 10.3: Verify**

Run `npm run lint`. Expected: passes.
Run `npm run dev`. In the browser:
1. Create a group with 2 children
2. Click the group's container background — toolbar above shows Ungroup / Copy / Delete (this is the new single-select-group toolbar)
3. Click Ungroup — group disappears, children remain at their absolute positions
4. Re-create, click Copy — duplicate group + children appear
5. Re-create, click Delete — group + children both disappear

- [ ] **Step 10.4: Commit**

```bash
git add components/editor/EditorCanvas.tsx
git commit -m "feat(canvas): single-group selection toolbar with Ungroup action

When a single group is selected, show a 3-button toolbar (Ungroup, Copy,
Delete). Ungroup dissolves the group and restores absolute positions.
Delete removes the group plus all its children."
```

---

## Task 11: Execution safety guards

**Goal:** Make sure groups can never be dispatched. Three places: the start route filters groups out of the execution set; `dispatchNode` early-returns if asked to handle a group; the shared registry doesn't masquerade groups as a known executable type.

**Files:**
- Modify: `app/api/executions/start/route.ts`
- Modify: `lib/workflow/dispatch-v2.ts`
- Modify: `lib/nodes/core/shared-registry.ts`

- [ ] **Step 11.1: Read all three files**

Read `app/api/executions/start/route.ts` (full), `lib/workflow/dispatch-v2.ts` lines 1-80, and `lib/nodes/core/shared-registry.ts` (full).

- [ ] **Step 11.2: Filter groups out of the execution set**

In `app/api/executions/start/route.ts`, locate the section after `const allNodes = Array.from(uniqueNodesMap.values());` (around line 85). Add a filter step right after:

```ts
    const allNodes = Array.from(uniqueNodesMap.values());
    const allEdges = graph_json.edges || [];

    // Group nodes are visual organization only — they have no handles, no
    // executor, and must never be dispatched. Strip them from the executable
    // node set before any downstream logic runs.
    const executableNodes = allNodes.filter((n: NodeConfig) => n.type !== 'group');
```

Then replace `allNodes` with `executableNodes` in **only** the spots where the code is selecting WHAT TO RUN. Specifically:

In the `if (!targetNodeId || mode === 'all')` branch, change:

```ts
      nodesToExecute = [...allNodes];
```

to:

```ts
      nodesToExecute = [...executableNodes];
```

And in the `else` branch, change:

```ts
      const targetNode = allNodes.find(n => n.id === targetNodeId);
```

to:

```ts
      const targetNode = executableNodes.find(n => n.id === targetNodeId);
```

The BFS over `parentEdges`/`allEdges` should still use `allEdges`, but its parent-resolution lookup must also skip groups. Replace:

```ts
          const parentNode = allNodes.find(n => n.id === edge.source);
          if (!parentNode || executionSet.has(edge.source) || generativeAncestorIds.has(edge.source)) {
            continue; // already classified, skip
          }
```

with:

```ts
          const parentNode = executableNodes.find(n => n.id === edge.source);
          if (!parentNode || executionSet.has(edge.source) || generativeAncestorIds.has(edge.source)) {
            continue; // already classified, or it's a group (non-executable)
          }
```

Finally, replace the line:

```ts
      nodesToExecute = allNodes.filter(n => executionSet.has(n.id));
```

with:

```ts
      nodesToExecute = executableNodes.filter(n => executionSet.has(n.id));
```

- [ ] **Step 11.3: Add an early-return for group dispatch**

In `lib/workflow/dispatch-v2.ts`, inside `dispatchNode` (around line 31), add a guard right after the `try {` opening:

```ts
  try {
    const nodeType = nodeConfig.type;

    // Groups are non-executable visual containers. If anything ever asks for
    // their dispatch (orchestrator misfire, AI-generated bad patch, etc.) we
    // log and bail safely instead of marking the execution failed.
    if (nodeType === 'group') {
      console.log(`[Dispatch] Skipping group node ${nodeId} (groups are non-executable).`);
      return { success: true, data: null };
    }

    if (isEphemeralNode(nodeType)) {
```

(The trailing `if (isEphemeralNode(nodeType)) {` line was already there — the new lines insert above it.)

- [ ] **Step 11.4: Register a no-op shared definition for groups**

In `lib/nodes/core/shared-registry.ts`, add a `group` entry to the `sharedRegistry` object (after `ai_generator`):

```ts
    group: {
        type: 'group',
        family: 'organization',
        category: 'organization',
        meta: {
            label: 'Group',
            color: 'rgb(var(--stroke-subtle))',
            icon: 'Group',
        },
        // Groups have no handles — they are visual containers, not executable nodes.
        handles: {
            inputs: [],
            outputs: [],
        },
        defaultConfig: {
            width: 400,
            height: 300,
        },
        nonExecutable: true,
    } as any,
```

(Casting to `any` because `nonExecutable` may not be in `NodeSharedDef` yet — that's fine; the field is purely informational for any code that defensively checks it.)

- [ ] **Step 11.5: Verify**

Run `npm run lint`. Expected: passes.
Run `npm run build`. Expected: type-check passes.

Then in the browser (with `npm run dev`):
1. Create a workflow with a group containing 2 prompt nodes, plus an ungrouped media_input → ai_generator chain
2. Click Run on the ai_generator node
3. Expected: the workflow runs successfully; the group is invisible to the engine; the prompt nodes inside the group still execute (they have edges to other things — wire one of them into the ai_generator first if you want to see this)
4. Server logs should show no errors related to dispatching a group

- [ ] **Step 11.6: Commit**

```bash
git add app/api/executions/start/route.ts lib/workflow/dispatch-v2.ts \
        lib/nodes/core/shared-registry.ts
git commit -m "fix(workflow): make group nodes non-executable end-to-end

Three guards: start route filters groups out of the executable set,
dispatchNode early-returns on group type, sharedRegistry registers group
with empty handles + nonExecutable flag for any defensive lookups."
```

---

## Task 12: Teach the AI brain about groups

**Goal:** Add a one-paragraph addition to the system prompt explaining when and how to emit group nodes via the existing patch language.

**Files:**
- Modify: `lib/chat/prompt/system.ts`

- [ ] **Step 12.1: Read the file**

Read `lib/chat/prompt/system.ts` (full — it's only ~200 lines based on what we sampled).

- [ ] **Step 12.2: Add a `GROUPING` constant and include it in the assembled prompt**

In `lib/chat/prompt/system.ts`, add a new `const GROUPING = ...` block just below the existing `const TOOL_RULES = ...` definition:

```ts
const GROUPING = `GROUPING:
- You may organize related nodes into a visual group by emitting a node with type 'group'. Use it to communicate structure when a workflow has clearly distinct sections (e.g. "input prep", "generation", "post-processing").
- Group node shape: { id: 'group_1', type: 'group', position: { x, y }, data: { label: '<title>', config: { width, height } } }
- To put a node into the group, set its parentNode field to the group's id in the SAME tool call that creates both. Children's positions are relative to the group's origin.
- A group has no input/output handles. NEVER add an edge whose source or target is a group node — such edges will be dropped silently and the user will see the group disconnected from the workflow.
- Groups never execute. Do not propose a group as a way to run nodes in parallel or to "wrap" execution.
- Default size when uncertain: width 400, height 300. The UI auto-expands a group when nodes are dropped into it.
- Do not group a single node. Only use groups when the user is asking for organization/visual structure or when 3+ related nodes belong together.`;
```

Then find where the system prompt is assembled (typically a `buildSystemPrompt` or `getSystemBlocks` function near the bottom of the file). Add `GROUPING` to the joined sections.

If the assembly looks like this (typical pattern):

```ts
return [IDENTITY, CAPABILITIES, TOOL_RULES, ...].join('\n\n');
```

Change it to include GROUPING after TOOL_RULES:

```ts
return [IDENTITY, CAPABILITIES, TOOL_RULES, GROUPING, ...].join('\n\n');
```

(The exact spot depends on the file's actual assembly — read it first and insert at the matching position.)

- [ ] **Step 12.3: Verify**

Run `npm run lint`. Expected: passes.
Run `npm run dev`. In the browser:
1. Open the chat panel
2. Ask the assistant: "Add a media_input, a prompt, and an ai_generator. Group the media_input and prompt together and label it 'Inputs'."
3. Expected: the AI emits an `add_node` tool call that includes a `'group'` node and sets `parentNode` on the two source nodes; the canvas renders the group; nothing is connected to the group itself.

If the AI tries to connect an edge to the group, the patch validator from Task 1 will drop it silently (with a console warning).

- [ ] **Step 12.4: Commit**

```bash
git add lib/chat/prompt/system.ts
git commit -m "feat(chat): teach the brain about visual node grouping

Adds GROUPING section to the system prompt: how to emit a group node,
parentNode field, no edges to/from groups, default sizing, when to use."
```

---

## Task 13: Final smoke-test sweep + spec verification

**Goal:** Walk through the full Testing checklist from the spec end-to-end on a single dev session. Catch any cross-task regressions.

**Files:** none modified — verification only.

- [ ] **Step 13.1: Start fresh**

Run `npm run dev`. Open `http://localhost:3000` in a browser. Open DevTools console.

- [ ] **Step 13.2: Run the spec's testing checklist**

Run through every item from the "Testing" section of [docs/superpowers/specs/2026-05-09-node-grouping-design.md](docs/superpowers/specs/2026-05-09-node-grouping-design.md):

  - [ ] Create group from selection (toolbar button)
  - [ ] Drag the group — children move with it
  - [ ] Drag a child out of the group — child leaves, group keeps its size
  - [ ] Drag an ungrouped node into the group — border highlights on touch, drop expands group
  - [ ] Resize the group from each of the 8 handles; verify the min-size clamp
  - [ ] Rename via title click; commit on blur and Enter; cancel on Escape
  - [ ] Copy a selected group → duplicate appears with all children + internal edges, fresh ids
  - [ ] Delete a selected group → group + children + connected edges all removed
  - [ ] Ungroup → children stay where they are, group disappears
  - [ ] Reload the page → group persists with title, size, position, and child membership
  - [ ] Run a workflow that contains a group → execution completes successfully, group is ignored
  - [ ] Ask the AI chat to "organize these nodes into a group" → AI emits a valid patch, group renders correctly
  - [ ] Undo + Redo work for: group create, ungroup, drag-in, drag-out, resize, rename

- [ ] **Step 13.3: If any item fails**

Don't paper over a failure. Fix the underlying task that introduced it (return to that task's section, identify the gap, add a step), then re-run the smoke test from the top.

- [ ] **Step 13.4: Final commit (if any fixes were needed)**

If you had to fix anything, commit those changes with a message that names what was wrong:

```bash
git add <files>
git commit -m "fix(canvas): <what was broken in plain English>"
```

If everything passed clean, no commit needed — the implementation is done.
