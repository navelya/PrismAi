# Wire-Drag Affordance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the user drags a wire in the workflow editor, dim nodes (and their attached edges) that cannot accept the wire, pin the originating handle's label, and reveal the compatible-handle labels on every node that *can* accept it.

**Architecture:** A small React Context (`WireDragContext`) is populated by `EditorCanvas` on `onConnectStart` and cleared on `onConnectEnd`. `BaseNode` reads the context and, per render, classifies itself as `origin | compatible | incompatible` using the existing `findHandleForNode` helper from `lib/editor/handle-compatibility.ts`. Edge dimming is handled inline in `memoizedEdges` (no edge-component wrapper needed — the repo uses React Flow's default edge with `stableEdgeTypes = {}`).

**Tech Stack:** React, React Flow, TypeScript, Tailwind CSS, Zustand (`useAppStore`). No test runner in this repo (per `CLAUDE.md`), so verification is type-check via `npm run build` plus manual smoke-test via `npm run dev`.

**Spec:** [docs/superpowers/specs/2026-05-15-wire-drag-affordance-design.md](../specs/2026-05-15-wire-drag-affordance-design.md)

---

## File Map

| File | Role |
|---|---|
| `lib/editor/wire-drag-context.tsx` (NEW) | Context, `WireDragProvider`, `useWireDrag` hook |
| `lib/editor/handle-compatibility.ts` (MODIFY) | Add `findAllCompatibleHandlesForNode` helper |
| `components/editor/EditorCanvas.tsx` (MODIFY) | Track `wireDrag` state, populate on start/end, wrap `<ReactFlow>` with provider, extend `memoizedEdges` to dim edges |
| `lib/nodes/core/canvas/BaseNode.tsx` (MODIFY) | Read context, derive `dragRole`, apply outer dim classes, override per-handle label visibility |

---

## Task 1: Create `WireDragContext`

**Files:**
- Create: `lib/editor/wire-drag-context.tsx`

- [ ] **Step 1: Write the context module**

Create `lib/editor/wire-drag-context.tsx` with:

```tsx
'use client';

import React, { createContext, useContext } from 'react';

/**
 * Snapshot of an in-flight wire drag. `null` whenever no wire is being dragged.
 *
 * Populated by EditorCanvas in onConnectStart, cleared in onConnectEnd. Consumed
 * by BaseNode (for dim + label-reveal styling) and by EditorCanvas itself (for
 * edge dimming).
 */
export type WireDragState = {
    originNodeId: string;
    originHandleId: string | null;
    /**
     * 'source' = wire originated from an OUTPUT handle (looking for an INPUT).
     * 'target' = wire originated from an INPUT handle (looking for an OUTPUT).
     */
    originHandleType: 'source' | 'target';
    /** Resolved data type of the origin handle, via getNodeHandleType. */
    dataType: string | string[];
} | null;

const WireDragContext = createContext<WireDragState>(null);

export function WireDragProvider({
    value,
    children,
}: {
    value: WireDragState;
    children: React.ReactNode;
}) {
    return <WireDragContext.Provider value={value}>{children}</WireDragContext.Provider>;
}

export function useWireDrag(): WireDragState {
    return useContext(WireDragContext);
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run build`
Expected: build succeeds (no new errors introduced).

- [ ] **Step 3: Commit**

```bash
git add lib/editor/wire-drag-context.tsx
git commit -m "feat(editor): add WireDragContext for wire-drag affordance"
```

---

## Task 2: Add `findAllCompatibleHandlesForNode` helper

**Files:**
- Modify: `lib/editor/handle-compatibility.ts` (append a new exported function)

- [ ] **Step 1: Add the helper**

At the bottom of `lib/editor/handle-compatibility.ts`, add:

```ts
/**
 * Like `findHandleForNode`, but returns ALL handles on the node compatible
 * with the pending wire (not just the first match). Used to drive the
 * "reveal labels for compatible handles" UX while a wire is being dragged.
 */
export function findAllCompatibleHandlesForNode(
    node: { type: string; data?: { config?: any } } | undefined,
    pending: PendingConnection,
    models: AiModel[],
    sharedRegistry: Record<string, NodeSharedDef<any>>
): ResolvedHandle[] {
    if (!node) return [];

    if (node.type === 'ai_generator') {
        const modelId = node.data?.config?.model_id;
        const model = modelId ? models.find((m) => m.id === modelId) : null;
        if (!model) return [];
        const rawHandles =
            pending.handleType === 'source'
                ? model.inputs_schema?.handles || []
                : model.outputs_schema?.handles || [];
        return rawHandles
            .filter((h) => h.is_visible !== false)
            .filter((h) => typesAreCompatible(pending.dataType, h.type))
            .map((h) => ({
                id: h.api_mapping_key || h.name || (pending.handleType === 'source' ? '' : 'output'),
                label: h.name,
                type: h.type,
                isArray: h.is_array,
            }));
    }

    const def = sharedRegistry[node.type];
    if (!def) return [];
    const rawHandles =
        pending.handleType === 'source' ? def.handles?.inputs || [] : def.handles?.outputs || [];
    return (rawHandles as any[])
        .filter((h) => {
            const t = pending.handleType === 'source' ? h.expectedType : h.dataType;
            return typesAreCompatible(pending.dataType, t);
        })
        .map((h) => ({
            id: h.id,
            label: h.label,
            type: pending.handleType === 'source' ? h.expectedType : h.dataType,
            isArray: h.is_array,
        }));
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add lib/editor/handle-compatibility.ts
git commit -m "feat(editor): add findAllCompatibleHandlesForNode helper"
```

---

## Task 3: Track wire-drag state and dim edges in `EditorCanvas`

**Files:**
- Modify: `components/editor/EditorCanvas.tsx`

This task does three things at once because they're tightly coupled: introduce the state, wire it into `onConnectStart` / `onConnectEnd`, wrap `<ReactFlow>` with the provider, and extend `memoizedEdges` to dim edges with at least one incompatible endpoint.

- [ ] **Step 1: Import the new module and helper**

Near the existing imports at the top of `components/editor/EditorCanvas.tsx`, add:

```ts
import { WireDragProvider, type WireDragState } from '@/lib/editor/wire-drag-context';
import { findHandleForNode } from '@/lib/editor/handle-compatibility';
```

(`getNodeHandleType` is already imported per the existing `handleIsValidConnection` and `handleConnectEnd` usages — confirm and skip if already present.)

- [ ] **Step 2: Add `wireDrag` state next to the existing connect refs**

Find the existing `const connectStartRef = useRef<...>` declaration (around line 108). Immediately after it, add:

```ts
const [wireDrag, setWireDrag] = useState<WireDragState>(null);
```

- [ ] **Step 3: Populate `wireDrag` in `handleConnectStart`**

Locate `handleConnectStart` (around line 559). Replace its body with:

```ts
const handleConnectStart = useCallback((_event: any, params: { nodeId: string | null; handleId: string | null; handleType: 'source' | 'target' | null }) => {
    if (!params.nodeId || !params.handleType) return;
    connectStartRef.current = {
        nodeId: params.nodeId,
        handleId: params.handleId,
        handleType: params.handleType,
    };

    if (!reactFlowInstance) return;
    const originNode = reactFlowInstance.getNode(params.nodeId);
    if (!originNode) return;
    const resolved = getNodeHandleType(
        originNode as any,
        params.handleId,
        params.handleType,
        models,
        sharedRegistry,
    );
    if (!resolved) return;
    setWireDrag({
        originNodeId: params.nodeId,
        originHandleId: params.handleId,
        originHandleType: params.handleType,
        dataType: resolved.type,
    });
}, [reactFlowInstance, models]);
```

- [ ] **Step 4: Clear `wireDrag` in `handleConnectEnd`**

Locate `handleConnectEnd` (around line 570). At the top of its body — right after the existing `connectStartRef.current = null;` line — add:

```ts
setWireDrag(null);
```

(Keep all existing logic in `handleConnectEnd` unchanged below that line.)

- [ ] **Step 5: Extend `memoizedEdges` to dim edges with a dimmed endpoint**

Find the existing `memoizedEdges` declaration (around line 135). Replace with:

```ts
const dimmedNodeIds = useMemo(() => {
    if (!wireDrag) return null;
    const set = new Set<string>();
    const nodes = reactFlowInstance?.getNodes() ?? localNodes;
    for (const n of nodes) {
        if (n.id === wireDrag.originNodeId) continue;
        const compatible = findHandleForNode(
            n as any,
            wireDrag,
            models,
            sharedRegistry,
        );
        if (!compatible) set.add(n.id);
    }
    return set;
}, [wireDrag, reactFlowInstance, localNodes, models]);

const memoizedEdges = useMemo(() => edges.map(e => {
    const isDimmed = dimmedNodeIds && (
        dimmedNodeIds.has(e.source) || dimmedNodeIds.has(e.target)
    );
    return {
        ...e,
        type: 'default',
        animated: false,
        style: isDimmed
            ? { ...edgeStyle, opacity: 0.3, filter: 'grayscale(0.6)', transition: 'opacity 150ms, filter 150ms' }
            : edgeStyle,
    };
}), [edges, edgeStyle, dimmedNodeIds]);
```

Notes:
- `dimmedNodeIds` is `null` (sentinel for "no drag") rather than an empty Set so the no-drag path skips the dim check entirely.
- The CSS `transition` on the edge style produces a smooth fade-in/fade-out without any JS animation work.

- [ ] **Step 6: Wrap `<ReactFlow>` with `<WireDragProvider>`**

Find the `<ReactFlow ... >` element (around line 718). Wrap it:

```tsx
<WireDragProvider value={wireDrag}>
    <ReactFlow
        nodes={localNodes}
        edges={memoizedEdges}
        ...all existing props unchanged...
    >
        {/* existing children */}
    </ReactFlow>
</WireDragProvider>
```

Be careful to preserve every existing prop and child of `<ReactFlow>`.

- [ ] **Step 7: Verify it type-checks**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add components/editor/EditorCanvas.tsx
git commit -m "feat(editor): track wire-drag state and dim edges on incompatible endpoints"
```

---

## Task 4: `BaseNode` — derive `dragRole` and apply outer dim styling

**Files:**
- Modify: `lib/nodes/core/canvas/BaseNode.tsx`

- [ ] **Step 1: Add imports**

Near the top of `lib/nodes/core/canvas/BaseNode.tsx`, add:

```ts
import { useWireDrag } from '@/lib/editor/wire-drag-context';
import { findHandleForNode, findAllCompatibleHandlesForNode } from '@/lib/editor/handle-compatibility';
```

- [ ] **Step 2: Read drag state and models inside `BaseNode`**

Locate the section that pulls store data (around line 104 onward, after `const rawStatus = ...`). Add:

```ts
const wireDrag = useWireDrag();
const models = useAppStore((s) => s.models);
```

The node `data` is accessed via the parent wrapper; `BaseNode` itself takes `id` and `type` as props but not `data`. The compatibility check for the `ai_generator` branch needs `data?.config?.model_id`. To get it, add an optional prop:

In the `BaseNodeProps` interface (around line 35), add:

```ts
/**
 * Node data (forwarded by per-type wrappers from React Flow's NodeProps.data).
 * Used by the wire-drag compatibility check on ai_generator nodes, which read
 * `data.config.model_id`. Optional — falling back to `undefined` is safe; the
 * compatibility helper treats a missing model as "no compatible handles".
 */
nodeData?: any;
```

Add `nodeData` to the destructured prop list. We use the prop name `nodeData` (not `data`) to avoid shadowing React's reserved-ish naming and any existing `data` usage in callers — see Task 4, Step 5 for the wrapper updates.

- [ ] **Step 3: Derive `dragRole` and compatible-handle set**

Below the `wireDrag` / `models` reads, add:

```ts
const dragRole: 'none' | 'origin' | 'compatible' | 'incompatible' = useMemo(() => {
    if (!wireDrag) return 'none';
    if (wireDrag.originNodeId === id) return 'origin';
    const match = findHandleForNode(
        { type, data: { config: nodeData?.config } },
        wireDrag,
        models,
        sharedRegistry,
    );
    return match ? 'compatible' : 'incompatible';
}, [wireDrag, id, type, nodeData?.config, models]);

const compatibleHandleIds = useMemo(() => {
    if (dragRole !== 'compatible' || !wireDrag) return null;
    const handles = findAllCompatibleHandlesForNode(
        { type, data: { config: nodeData?.config } },
        wireDrag,
        models,
        sharedRegistry,
    );
    return new Set(handles.map((h) => h.id));
}, [dragRole, wireDrag, type, nodeData?.config, models]);
```

- [ ] **Step 4: Apply outer dim styling**

Find the existing outer wrapper className construction (around line 209, inside `<motion.div className={cn(...)}>`). Add a new class fragment to the `cn(...)` call:

```ts
className={cn(
    "rounded-2xl border backdrop-blur-xl relative group bg-bg-primary/40 transition-[border-color,background-color] duration-500 ease-out",
    selected ? "border-accent-primary shadow-[0_0_20px_rgb(var(--accent-primary)/0.15)] outline-none" : "border-stroke-subtle shadow-xl",
    "hover:border-stroke-strong hover:bg-surface-elevated/20",
    dragRole === 'incompatible' && "opacity-30 grayscale-[0.6] transition-[opacity,filter] duration-150",
    typeof width === 'string' ? width : '',
    className
)}
```

The new line is the `dragRole === 'incompatible' && ...` fragment. Keep all other class fragments unchanged.

- [ ] **Step 5: Forward `nodeData` from per-type node wrappers**

Per-type node wrappers (in `lib/nodes/plugins/<type>/component.tsx` and the special-cased components like `AIGeneratorNode`) render `<BaseNode ...>` and receive React Flow's `NodeProps` (which includes `data`). For the compatibility check on `ai_generator` to work, the wrapper must pass `nodeData={data}` to `BaseNode`.

For non-`ai_generator` nodes the compatibility check ignores `nodeData` entirely (it falls back to `sharedRegistry`), so passing `nodeData` is harmless and consistent for all wrappers.

**Action:** locate all `<BaseNode` JSX usages (each per-type wrapper) and add `nodeData={data}` prop. Use:

Run: `grep -rn "<BaseNode" lib/nodes components` to find every wrapper file. Expected matches include `lib/nodes/plugins/ai_generator/component.tsx` (or its current location) and one wrapper per plugin under `lib/nodes/plugins/*/component.tsx`.

For each match: in the wrapper component, find the React Flow `NodeProps` destructure (typically `({ id, data, selected, dragging }: NodeProps)`) and add `nodeData={data}` to the `<BaseNode ... />` JSX. If a wrapper doesn't currently destructure `data` from its props, add it.

Example (illustrative — the exact wrapper varies):
```tsx
export default function FooNode({ id, data, selected, dragging }: NodeProps) {
    return (
        <BaseNode id={id} type="foo" selected={selected} dragging={dragging} nodeData={data}>
            {/* ... */}
        </BaseNode>
    );
}
```

- [ ] **Step 6: Verify type-check**

Run: `npm run build`
Expected: build succeeds. If any wrapper that wasn't updated is now flagged, fix it (the type is `nodeData?: any`, so missing it is a warning at worst — but pass `nodeData={data}` everywhere for consistency).

- [ ] **Step 7: Commit**

```bash
git add lib/nodes/core/canvas/BaseNode.tsx lib/nodes/plugins
git commit -m "feat(canvas): dim incompatible nodes during wire drag"
```

---

## Task 5: `BaseNode` — override per-handle label visibility

**Files:**
- Modify: `lib/nodes/core/canvas/BaseNode.tsx`

`BaseNode` renders four handle branches: (a) custom inputs map, (b) default input handle fallback, (c) custom outputs map, (d) default output handle fallback. Each branch has its own label `<div>` with `opacity-0 group-hover:opacity-100`. We need to override that to force `opacity-100` when the label should be visible during a wire drag.

- [ ] **Step 1: Add a helper inside `BaseNode` to decide forced visibility**

Below the `compatibleHandleIds` `useMemo` from Task 4, Step 3, add:

```ts
/**
 * Decide whether this handle's label should be force-visible because a wire is being dragged.
 *
 * - On the ORIGIN node: the originating handle (matching side + id) is force-visible.
 *   For default-handle nodes (no explicit id) we match when originHandleId is null
 *   AND the handle's resolved id equals the registry's default handle id.
 * - On a COMPATIBLE node: any handle whose id is in `compatibleHandleIds` is force-visible.
 *   (The compatibility helper already restricts to the opposite side of the origin, so we
 *   don't need to gate on side here — the id-set is already side-correct.)
 * - Otherwise: not force-visible.
 */
const isHandleLabelForced = (handleSide: 'source' | 'target', handleId: string): boolean => {
    if (!wireDrag) return false;
    if (dragRole === 'origin') {
        if (handleSide !== wireDrag.originHandleType) return false;
        // Default-handle case: originHandleId can be null. Treat any handle on
        // the originating side as the origin when the node has no explicit ids.
        if (wireDrag.originHandleId === null) return true;
        return handleId === wireDrag.originHandleId;
    }
    if (dragRole === 'compatible' && compatibleHandleIds) {
        return compatibleHandleIds.has(handleId);
    }
    return false;
};
```

- [ ] **Step 2: Override the custom-input label branch**

In the custom-input map (around line 281 onward, the `inputsToRender.map((input, index) => ...)` block), locate the label `<div>` (around line 318):

```tsx
<div className={cn(
    "absolute bottom-full right-1/2 mb-1 mr-1 opacity-0 group-hover:opacity-100 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider pointer-events-none transition-all duration-300 drop-shadow-md z-[70]",
    isErrorState ? "text-accent-error font-extrabold" : "text-content-primary"
)} style={!isErrorState ? { color: input.color || nodeColor } : undefined}>
```

Replace the `opacity-0 group-hover:opacity-100` segment with a conditional:

```tsx
const forced = isHandleLabelForced('target', input.id);
return (
    <div className={cn(
        "absolute bottom-full right-1/2 mb-1 mr-1 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider pointer-events-none transition-all duration-300 drop-shadow-md z-[70]",
        forced ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        isErrorState ? "text-accent-error font-extrabold" : "text-content-primary"
    )} style={!isErrorState ? { color: input.color || nodeColor } : undefined}>
        {input.label}{(input as any).isMandatory ? ' *' : ''}
    </div>
);
```

`forced` must be computed inside the `(() => { ... })()` IIFE that already wraps this label JSX (you can see it at line 314 — the `{input.label && (() => { ... })()}` pattern). Add `const forced = isHandleLabelForced('target', input.id);` to the IIFE's local consts, right beside the existing `const isErrorState = ...`.

- [ ] **Step 3: Override the default-input label branch**

In the default-input fallback (around line 344, the `defaultInputLabel && (() => { ... })()` IIFE), the existing label `<div>` is similar. The handle id for the default branch comes from the registry definition: `const defaultInput = sharedDef?.handles?.inputs?.[0];` — use `defaultInput?.id ?? ''` for the `isHandleLabelForced` call.

Add inside the IIFE (next to the existing `const isMissing = ...`):

```ts
const forced = isHandleLabelForced('target', defaultInput?.id ?? '');
```

Then replace the label className the same way as Step 2:

```tsx
<div className={cn(
    "absolute bottom-full right-1/2 mb-1 mr-1 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider pointer-events-none transition-all duration-300 drop-shadow-md z-[70]",
    forced ? "opacity-100" : "opacity-0 group-hover:opacity-100",
    isErrorState ? "text-accent-error font-extrabold" : "text-content-primary"
)} style={!isErrorState ? { color: nodeColor } : undefined}>
    {defaultInputLabel}{defaultInput?.isMandatory ? ' *' : ''}
</div>
```

- [ ] **Step 4: Override the custom-output label branch**

In the custom-output map (around line 387, `customOutputs.map((output, index) => ...)`), locate the label `<div>` (around line 410):

```tsx
<div className="absolute bottom-full left-1/2 mb-1 ml-1 opacity-0 group-hover:opacity-100 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider pointer-events-none transition-all duration-300 text-content-primary drop-shadow-md z-[70]" style={{ color: output.color || nodeColor }}>
    {output.label}
</div>
```

Replace with:

```tsx
{(() => {
    const forced = isHandleLabelForced('source', output.id);
    return (
        <div className={cn(
            "absolute bottom-full left-1/2 mb-1 ml-1 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider pointer-events-none transition-all duration-300 text-content-primary drop-shadow-md z-[70]",
            forced ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        )} style={{ color: output.color || nodeColor }}>
            {output.label}
        </div>
    );
})()}
```

- [ ] **Step 5: Override the default-output label branch**

In the default-output fallback (around line 431), the existing label is:

```tsx
{defaultOutputLabel && (
    <div className="absolute bottom-full left-1/2 mb-1 ml-1 opacity-0 group-hover:opacity-100 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider pointer-events-none transition-all duration-300 text-content-primary drop-shadow-md z-[70]" style={{ color: nodeColor }}>
        {defaultOutputLabel}
    </div>
)}
```

Replace with:

```tsx
{defaultOutputLabel && (() => {
    const forced = isHandleLabelForced('source', defaultOutputId);
    return (
        <div className={cn(
            "absolute bottom-full left-1/2 mb-1 ml-1 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider pointer-events-none transition-all duration-300 text-content-primary drop-shadow-md z-[70]",
            forced ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        )} style={{ color: nodeColor }}>
            {defaultOutputLabel}
        </div>
    );
})()}
```

`defaultOutputId` is already declared in `BaseNode` (line 145) — reuse it.

- [ ] **Step 6: Verify type-check**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add lib/nodes/core/canvas/BaseNode.tsx
git commit -m "feat(canvas): reveal compatible-handle labels during wire drag"
```

---

## Task 6: Manual smoke-test

There is no test runner in this repo (per `CLAUDE.md`), so verification is hands-on in the browser.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Open: `http://localhost:3000` and load any workflow with ≥3 nodes including at least one `ai_generator`, one media input, and one node that accepts a different data type (e.g., a text-only node).

- [ ] **Step 2: Test compatible-side reveal (output→input)**

- Begin dragging a wire from an `image`-type output handle.
- Expected:
  - The output handle's label stays visible for the full drag.
  - Every node that accepts `image` on an input shows its compatible-input label(s).
  - Nodes that don't accept `image` are dimmed (opacity ~30%, grayscale) along with their attached edges.
  - The originating node stays bright; only its dragged output's label is shown.
- Drop on canvas (cancel) — all styling reverts immediately.

- [ ] **Step 3: Test compatible-side reveal (input→output)**

- Begin dragging a wire from an `image`-type input handle (drag *from* the input).
- Expected mirror of Step 2: compatible output labels appear on nodes that produce `image`; the rest dim.

- [ ] **Step 4: Test `ai_generator` dynamic handles**

- Configure an `ai_generator` to a model with multiple inputs (e.g., one accepting image + text).
- Drag an `image` wire toward it. Only the image-typed input label reveals; text-only inputs stay hidden.
- Drag a `text` wire toward it. Only text-typed inputs reveal.

- [ ] **Step 5: Test `'any'` type**

- Drag a wire from any output to an `any`-typed input node (e.g., a logger or debug-pass-through if one exists). Confirm the `any` input always reveals as compatible.

- [ ] **Step 6: Test edge dimming**

- In a workflow with two disconnected subgraphs, drag a wire from one subgraph. Confirm the other subgraph's nodes AND the edges connecting them are dimmed in lockstep.

- [ ] **Step 7: Test that no-drag hover still works**

- With no wire being dragged, hover individual nodes — handle labels still reveal per the existing `group-hover` behavior.

- [ ] **Step 8: If any check fails**

Diagnose, fix, and re-verify. Common failure modes:
- Label not pinning on origin → `isHandleLabelForced` side check is wrong, or `originHandleId` is being read pre-resolution.
- Wrong nodes dim → `findHandleForNode` is being called with the wrong `pending` shape, or `models` is empty at drag-start (models load async; if a user can start dragging before they load, fall back to bright = treat as compatible).
- Edges don't dim → `dimmedNodeIds` memo dependency missing, or `memoizedEdges` style merge order incorrect.

- [ ] **Step 9: Commit any fixes**

If fixes were needed, commit them with a descriptive message:

```bash
git add -A
git commit -m "fix(canvas): <describe fix>"
```

---

## Self-Review Checklist (for the implementer)

After all tasks pass, verify the spec sections are covered:

- [ ] Originating handle label pinned for drag duration → Task 5, Steps 2–5 via `isHandleLabelForced` origin branch.
- [ ] Compatible handles' labels revealed across workflow → Task 4 (`compatibleHandleIds`) + Task 5 forced-opacity overrides.
- [ ] Incompatible nodes dim with `opacity-30 grayscale-[0.6] transition` → Task 4, Step 4.
- [ ] Edges with at least one dimmed endpoint dim in lockstep → Task 3, Step 5.
- [ ] All styling reverts on drag end → Task 3, Step 4 (`setWireDrag(null)`).
- [ ] `ai_generator` dynamic handles covered → Task 2's helper inherits the special case.
- [ ] `'any'` and array types covered → Inherited from existing `typesAreCompatible`.
- [ ] No regression to the existing wire-drop context menu → Task 3 preserves `connectStartRef` and only *adds* `wireDrag` state alongside.
- [ ] No regression to the existing `group-hover` reveal when no wire is being dragged → Task 5 leaves `opacity-0 group-hover:opacity-100` intact in the "not forced" branch.
