# Compositor: Blend Fix, Multi-Select, Editor Isolation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix video blend modes in the compositor node-card preview, add multi-layer selection with a group bounding box and shared properties panel to the editor, and isolate the editor modal so the workflow canvas behind it is fully inert.

**Architecture:** Three independent workstreams in the compositor plugin. Mission 1 is a systematic-debugging pass on the shared Konva renderer / card preview. Mission 2 extends the editor's local selection state from a single id to an array, attaches Konva's multi-node `Transformer`, adds a marquee + a `MultiLayerProperties` panel. Mission 3 adds a reusable `useInertBackground` hook plus a `window`-capture keyboard firewall in the editor modal.

**Tech Stack:** Next.js, React, Zustand, react-konva / Konva, React Flow, TypeScript.

**No test runner in this repo** (see [CLAUDE.md](../../../CLAUDE.md)). Verification per task = `npx tsc --noEmit` (the reliable type-check; `npm run lint`/`build` are flaky here) **plus** manual QA in `npm run dev` against the listed acceptance checks. Commit after each task.

**Spec:** [2026-05-26-compositor-blend-multiselect-isolation-design.md](../specs/2026-05-26-compositor-blend-multiselect-isolation-design.md)

---

## File Structure

**Mission 1 (debug):**
- Modify (contingent on diagnosis): [lib/nodes/plugins/compositor/component.tsx](../../../lib/nodes/plugins/compositor/component.tsx) (`LivePreview`) and/or [lib/nodes/plugins/compositor/ui/Renderer.tsx](../../../lib/nodes/plugins/compositor/ui/Renderer.tsx).

**Mission 2 (multi-select):**
- Modify: [lib/nodes/plugins/compositor/shared.ts](../../../lib/nodes/plugins/compositor/shared.ts) — add `layerAABB` + `rectsIntersect` helpers.
- Modify: [lib/nodes/plugins/compositor/ui/Renderer.tsx](../../../lib/nodes/plugins/compositor/ui/Renderer.tsx) — thread modifier key + group-drag callbacks through `onSelectLayer`/`onLayerDragMove`.
- Create: `lib/nodes/plugins/compositor/ui/MultiLayerProperties.tsx` — shared-properties panel.
- Modify: [lib/nodes/plugins/compositor/ui/EditorModal.tsx](../../../lib/nodes/plugins/compositor/ui/EditorModal.tsx) — selection array, marquee, multi-node transformer, group drag, panel switch.

**Mission 3 (isolation):**
- Create: `lib/hooks/use-inert-background.ts` — the hook.
- Modify: [lib/nodes/plugins/compositor/ui/EditorModal.tsx](../../../lib/nodes/plugins/compositor/ui/EditorModal.tsx) — mount hook + extend the existing `window`-capture keydown effect into a firewall.
- Modify: [lib/nodes/plugins/compositor/component.tsx](../../../lib/nodes/plugins/compositor/component.tsx) — give the portal a stable wrapper element for the hook to exclude.

The three missions touch `EditorModal.tsx` in non-overlapping regions; implement in the order below (3 → 1 → 2) so the largest change (Mission 2) lands last on a stable file.

---

## Mission 3 — Editor window isolation

### Task 3.1: Create the `useInertBackground` hook

**Files:**
- Create: `lib/hooks/use-inert-background.ts`

- [ ] **Step 1: Write the hook**

```typescript
'use client';

import { useEffect } from 'react';

/**
 * Treat a modal/portal as a separate window: while `active`, every direct
 * child of <body> EXCEPT the one containing `exceptEl` is marked `inert`
 * (and aria-hidden). `inert` blurs any focused element inside the background
 * and blocks all pointer events on it — so React Flow has no focused node
 * (arrow keys do nothing) and no pane to click/marquee — without adding any
 * per-handler guards. State is restored exactly on cleanup.
 *
 * Idempotent: re-runs reconcile against the current set of body children, so
 * portals that mount while active are also caught on the next dependency tick.
 */
export function useInertBackground(active: boolean, exceptEl: HTMLElement | null): void {
    useEffect(() => {
        if (!active || typeof document === 'undefined') return;

        const body = document.body;
        const keep = exceptEl
            ? Array.from(body.children).find((c) => c === exceptEl || c.contains(exceptEl)) ?? null
            : null;

        // Remember prior state so we restore (not blanket-clear) on cleanup.
        const touched: { el: HTMLElement; hadInert: boolean; prevAria: string | null }[] = [];
        for (const child of Array.from(body.children)) {
            if (child === keep) continue;
            if (!(child instanceof HTMLElement)) continue;
            touched.push({
                el: child,
                hadInert: child.hasAttribute('inert'),
                prevAria: child.getAttribute('aria-hidden'),
            });
            child.setAttribute('inert', '');
            child.setAttribute('aria-hidden', 'true');
        }

        return () => {
            for (const t of touched) {
                if (!t.hadInert) t.el.removeAttribute('inert');
                if (t.prevAria === null) t.el.removeAttribute('aria-hidden');
                else t.el.setAttribute('aria-hidden', t.prevAria);
            }
        };
    }, [active, exceptEl]);
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `use-inert-background.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/hooks/use-inert-background.ts
git commit -m "feat(compositor): add useInertBackground hook for modal isolation"
```

### Task 3.2: Give the editor portal a stable wrapper and mount the hook

**Files:**
- Modify: `lib/nodes/plugins/compositor/component.tsx` (the `createPortal` block, ~line 1285)
- Modify: `lib/nodes/plugins/compositor/ui/EditorModal.tsx` (accept a wrapper ref / mount hook)

The portal currently renders the modal directly into `document.body`, so the modal's own `fixed inset-0` div is a direct child of `<body>` — but it is created/destroyed by React and we need a stable element reference to exclude. Wrap the portal target in a dedicated `<div>` we control.

- [ ] **Step 1: Wrap the portal in a stable container in `component.tsx`**

Replace the portal block:

```tsx
{isEditorOpen && createPortal(
    <CompositorEditorModal
        nodeId={id}
        config={config}
        onClose={() => setIsEditorOpen(false)}
        onConfigChange={updateConfig}
    />,
    document.body
)}
```

with:

```tsx
{isEditorOpen && createPortal(
    <div ref={editorPortalRef}>
        <CompositorEditorModal
            nodeId={id}
            config={config}
            onClose={() => setIsEditorOpen(false)}
            onConfigChange={updateConfig}
            portalEl={editorPortalRef.current}
        />
    </div>,
    document.body
)}
```

Add the ref near the other refs in `CompositorNode` (e.g. after `const stageRef = useRef<any>(null);`):

```tsx
const editorPortalRef = useRef<HTMLDivElement>(null);
```

- [ ] **Step 2: Accept `portalEl` and mount the hook in `EditorModal.tsx`**

Extend the props interface:

```tsx
interface CompositorEditorModalProps {
    nodeId: string;
    /** Initial config snapshot. Live edits flow through the store, not this prop. */
    config: CompositorConfig;
    onClose: () => void;
    /** Forwarded so callers can intercept; the modal also writes via updateNodeConfig directly. */
    onConfigChange?: (config: Partial<CompositorConfig>) => void;
    /** The portal wrapper element; used to keep this modal interactive while the rest of the page is inert. */
    portalEl?: HTMLElement | null;
}
```

Destructure `portalEl` in the component signature, add the import, and mount the hook (the modal is always "open" while mounted, so pass `true`):

```tsx
import { useInertBackground } from '@/lib/hooks/use-inert-background';
// ...
export default function CompositorEditorModal({
    nodeId,
    config: initialConfig,
    onClose,
    portalEl = null,
}: CompositorEditorModalProps) {
    useInertBackground(true, portalEl);
    // ...existing body...
```

Note: on the very first render `editorPortalRef.current` is `null`; the hook's `exceptEl` dependency changes to the real element once the ref attaches, and the effect re-runs and reconciles. Until then nothing is inert (modal is mid-mount), which is harmless.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual QA**

In `npm run dev`: open a compositor editor. Behind the modal — (a) click on the canvas: no node selects/deselects; (b) with a node previously selected, press arrow keys: the node does NOT move; (c) marquee-drag on the canvas: nothing selects. Close the editor: all three work again normally. Inspect `<body>` in devtools while open — sibling divs have `inert`; after close, `inert` is gone.

- [ ] **Step 5: Commit**

```bash
git add lib/nodes/plugins/compositor/component.tsx lib/nodes/plugins/compositor/ui/EditorModal.tsx
git commit -m "feat(compositor): isolate editor by marking canvas background inert"
```

### Task 3.3: Keyboard firewall for global canvas shortcuts

`inert` does not stop the canvas's `document`-level global chords (Ctrl/Cmd+Z/Y/G in [EditorCanvas.tsx:846](../../../components/editor/EditorCanvas.tsx#L846)) because they fire regardless of focus. Extend the modal's existing `window`-capture keydown effect (which already handles Space / undo / redo / Delete) into a selective firewall. A `window`-capture listener runs before `document`-capture, so stopping propagation there prevents the canvas handler from ever seeing the event — while keys the modal does NOT block still flow to React's root for the modal's own inputs.

**Files:**
- Modify: `lib/nodes/plugins/compositor/ui/EditorModal.tsx` (the `useEffect` registering `onKeyDown` on `window` with capture, ~lines 675-704)

- [ ] **Step 1: Add the firewall to the existing window-capture keydown handler**

Inside the existing `onKeyDown` (the one added with `window.addEventListener('keydown', onKeyDown, true)`), add this block at the TOP of the handler, before the Space branch:

```tsx
const onKeyDown = (e: KeyboardEvent) => {
    // Firewall: keep the workflow canvas's global chords from firing behind
    // the editor (the editor owns its OWN undo/redo locally). We stop only
    // these specific chords so the modal's own inputs still receive every
    // other key. Editable targets inside the modal are exempted so typing a
    // literal 'z'/'y'/'g' isn't swallowed.
    const tgt = e.target as HTMLElement | null;
    const tag = tgt?.tagName;
    const editable = tag === 'INPUT' || tag === 'TEXTAREA' || tgt?.isContentEditable === true;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (!editable && mod && (k === 'z' || k === 'y' || k === 'g')) {
        // Block the canvas handler. Undo/redo for the editor are handled in
        // the dedicated branches below (Ctrl/Cmd+Z / Shift+Z), so we stop the
        // canvas from ALSO running global undo/redo. Ctrl+G (group) has no
        // editor meaning — just swallow it.
        e.stopImmediatePropagation();
    }

    // --- existing branches below, unchanged ---
    if (e.code === 'Space' && !e.repeat && e.target === document.body) {
        e.preventDefault();
        setSpaceHeld(true);
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) localRedo(); else localUndo();
    }
    // ...Delete/Backspace branch unchanged...
};
```

Note: `stopImmediatePropagation()` on `window` capture still allows the SAME handler's later branches to run (it stops OTHER listeners, not the current function), so the editor's own `localUndo`/`localRedo` still fire from the branch below.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Manual QA**

With the editor open and a node selected on the canvas behind: press Ctrl/Cmd+Z — the editor's local undo fires (a layer edit reverts) and NO global canvas undo happens (no node-position/structural change behind). Ctrl/Cmd+G does nothing (no group created behind). Delete with a layer selected removes only that layer's edge (existing behavior). Typing in a NumberInput / text field is unaffected. Close editor: canvas Ctrl+Z/Y/G work again.

- [ ] **Step 4: Commit**

```bash
git add lib/nodes/plugins/compositor/ui/EditorModal.tsx
git commit -m "feat(compositor): firewall global canvas shortcuts while editor is open"
```

---

## Mission 1 — Video blend invisible in node-card preview (debug-first)

> **REQUIRED SUB-SKILL for this mission:** superpowers:systematic-debugging. Do NOT apply a fix before the repro confirms the cause. The fix code below is contingent illustration, not a predetermined change.

### Task 1.1: Build the repro and confirm the cause

**Files:** none yet (investigation).

- [ ] **Step 1: Reproduce**

In `npm run dev`, build a compositor with two layers: an opaque IMAGE on the bottom (array index 1) and a VIDEO on top (array index 0). In the editor modal, set the video layer's Blend Mode to `multiply`. Confirm: the blend is visible in the editor modal preview. Then look at the node card preview (`LivePreview`) — confirm the blend is NOT visible there (video renders as if `source-over`).

- [ ] **Step 2: Confirm the rendered props are identical**

Temporarily add a log in `LayerVideo`'s `commonProps` construction in [Renderer.tsx](../../../lib/nodes/plugins/compositor/ui/Renderer.tsx) (~line 334):

```tsx
console.log('[blend-debug] LayerVideo', { id: layer.id, interactive, gco: commonProps.globalCompositeOperation });
```

Verify the SAME `gco: 'multiply'` is logged for both the editor (`interactive: true`) and the card (`interactive: false`) instances. If the card instance shows `source-over`, the bug is upstream in prop derivation — chase that instead. If both show `multiply`, the prop is correct and the cause is in how Konva composites it on the card surface → continue to Step 3.

- [ ] **Step 3: Test the lead hypothesis (no Konva backdrop / draw-order)**

The card preview's Konva `<Layer pixelRatio={1/scale}>` is transparent (no background Rect), and the video is animated via `Konva.Animation`. Two checks:

(a) **Backdrop check:** Temporarily add a background `<Rect>` as the first child inside the card's `<Group>` in `LivePreview` ([component.tsx](../../../lib/nodes/plugins/compositor/component.tsx) ~line 400), `fill="#121212"` sized to the canvas, and see if the video blend appears. If it does, the cause is "nothing opaque beneath the video for the blend to act against on this surface."

(b) **Stacking check:** Confirm the image layer actually renders BENEATH the video in the card (z-order). If the image is present and opaque beneath the video and the blend STILL doesn't show while it does in the editor, the cause is the `Konva.Animation`-driven redraw interacting with `globalCompositeOperation` under `pixelRatio` (hypothesis 2) — note that for the fix step.

- [ ] **Step 4: Record the confirmed diagnosis**

Write one or two sentences in the commit message of Task 1.2 stating which hypothesis held and the exact mechanism. Remove all temporary `console.log`/debug Rect added above.

### Task 1.2: Apply the fix indicated by the diagnosis

**Files:** depends on diagnosis — `lib/nodes/plugins/compositor/component.tsx` (`LivePreview`) and/or `lib/nodes/plugins/compositor/ui/Renderer.tsx`.

- [ ] **Step 1: Implement the fix for the confirmed cause**

- **If hypothesis 1 (the layer blends against an empty backdrop differently than in the editor):** make the blend backdrop consistent between surfaces *without* introducing an opaque background into the card (that would break the transparent/checkerboard output contract). The consistent fix is for blend to compose only against the layers beneath it on both surfaces. If the editor's `#121212` background was the thing making the editor "look right," verify whether the editor's result or the card's result is the intended one, then align the OTHER surface to it. Concretely, if the desired behavior is "blend composes against lower layers only" (transparent base), the editor's background Rect should not participate in blending — wrap the editor's `CompositorLayerNodes` so the dimmer/background are not part of the same composite group, OR accept the editor as correct and give the card the same neutral base. Pick the alignment that keeps the card transparent.

- **If hypothesis 2 (`Konva.Animation` + `pixelRatio` composite quirk):** the typical Konva remedy is to ensure the layer redraw is a full clear-and-redraw in stacking order. Verify `CompositorAnimator` marks the whole layer dirty (it does, via `Konva.Animation(() => {}, konvaLayer)`); if the quirk is `pixelRatio`-specific, reproduce with `pixelRatio={1}` to confirm, then adjust the card's pixelRatio handling (e.g. apply scale via the `<Group>` only and leave `pixelRatio` at default) so video frames composite identically to the editor.

Implement only the branch the repro confirmed.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Manual QA**

Re-run the Task 1.1 repro: the image-under-video-with-`multiply` blend now looks the SAME in the card preview as in the editor. Switch the video blend to `screen` and `overlay` — also consistent. Confirm a pure image-only compositor's blending is unchanged, and the card background is still transparent (checkerboard visible where no layer covers).

- [ ] **Step 4: Commit**

```bash
git add lib/nodes/plugins/compositor/component.tsx lib/nodes/plugins/compositor/ui/Renderer.tsx
git commit -m "fix(compositor): video blend modes now render in node-card preview

Diagnosis: <one-line confirmed cause from Task 1.1 Step 4>"
```

---

## Mission 2 — Multi-select layers (group box + shared properties)

### Task 2.1: Geometry helpers in `shared.ts`

**Files:**
- Modify: `lib/nodes/plugins/compositor/shared.ts`

- [ ] **Step 1: Add `layerAABB` and `rectsIntersect`**

Append to `shared.ts` (it already imports `CompositorLayer`):

```typescript
/** Axis-aligned bounding box in canvas coordinates. */
export interface AABB { minX: number; minY: number; maxX: number; maxY: number; }

/**
 * Rotated-rectangle axis-aligned bounding box for a layer, in canvas
 * coordinates. Mirrors the corner math previously inlined in the editor's
 * fit-canvas-to-content routine so the marquee hit-test and the fit logic
 * share one implementation.
 */
export function layerAABB(layer: CompositorLayer): AABB {
    const t = layer.transform;
    const cx = t.x + t.width / 2;
    const cy = t.y + t.height / 2;
    const rad = ((t.rotation || 0) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const hw = t.width / 2;
    const hh = t.height / 2;
    const corners = [
        { x: -hw, y: -hh }, { x: hw, y: -hh },
        { x: hw, y: hh }, { x: -hw, y: hh },
    ];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of corners) {
        const rx = c.x * cos - c.y * sin + cx;
        const ry = c.x * sin + c.y * cos + cy;
        if (rx < minX) minX = rx;
        if (ry < minY) minY = ry;
        if (rx > maxX) maxX = rx;
        if (ry > maxY) maxY = ry;
    }
    return { minX, minY, maxX, maxY };
}

/** Do two AABBs overlap (touching edges count as overlap)? */
export function rectsIntersect(a: AABB, b: AABB): boolean {
    return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}
```

- [ ] **Step 2: Type-check + commit**

Run: `npx tsc --noEmit` (expected: clean)
```bash
git add lib/nodes/plugins/compositor/shared.ts
git commit -m "feat(compositor): add layerAABB + rectsIntersect helpers"
```

### Task 2.2: Thread modifier key + group-drag through the renderer

**Files:**
- Modify: `lib/nodes/plugins/compositor/ui/Renderer.tsx`

The interactive nodes currently call `onSelect?.()` with no event and commit position only on `onDragEnd`. To support Ctrl/Cmd-click toggle and live group drag, (a) pass the modifier state to selection, and (b) expose a per-frame drag-move callback.

- [ ] **Step 1: Extend the props interface**

In `CompositorLayerNodesProps`:

```tsx
    onSelectLayer?: (layerId: string, additive: boolean) => void;
    /** Live position during a drag (canvas coords), used to drive group drag. */
    onLayerDragMove?: (layerId: string, pos: { x: number; y: number }) => void;
    /** Ids currently in the multi-selection; used to keep group members draggable. */
    selectedLayerIds?: string[];
```

(Keep the existing `selectedLayerId?` line for the single-select call sites, or remove it and update both callers — see Task 2.5/preview note below. Simplest: keep both; `selectedLayerId` is unused by the renderer internals.)

- [ ] **Step 2: Forward the modifier from each interactive node's click**

For each of `LayerImage`, `LayerVideo`, `LayerSubgraph`, `LayerText`, change the `onClick`/`onTap` wiring so the Konva event reaches `onSelect`. The per-component `onSelect` prop type is `(e?: any) => void`. Update each render's `onClick={onSelect} onTap={onSelect}` to pass through (they already receive the Konva event when Konva calls them — no change needed there), and change the `onDragStart` calls from `onSelect?.()` to `onSelect?.()` (drag selects non-additively — leave as-is). The actual modifier extraction happens where `CompositorLayerNodes` builds the `onSelect` closure.

In `CompositorLayerNodes`, replace each `onSelect={interactive && onSelectLayer ? () => onSelectLayer(layer.id) : undefined}` (4 occurrences — image, video, subgraph, text) with:

```tsx
onSelect={interactive && onSelectLayer
    ? (e?: any) => onSelectLayer(layer.id, !!(e?.evt?.ctrlKey || e?.evt?.metaKey))
    : undefined}
```

Update each component's `onSelect` prop type from `() => void` to `(e?: any) => void` (image, video, subgraph, text). The `onDragStart` handlers call `onSelect?.()` (no event) — that resolves `additive` to `false`, which is correct (starting a drag selects just that layer unless it's already part of the selection; group-drag handling in Task 2.4 preserves an existing multi-selection).

- [ ] **Step 3: Add `onDragMove` to interactive nodes**

For `LayerImage`, `LayerVideo`, `LayerText` (the draggable media/text nodes — `LayerSubgraph` too), add an `onDragMove` to the interactive `<KonvaImage>`/`<KonvaText>`:

```tsx
onDragMove={(e) => onDragMove?.(e.target.x(), e.target.y())}
```

Add `onDragMove?: (x: number, y: number) => void;` to each component's prop type, and in `CompositorLayerNodes` pass:

```tsx
onDragMove={interactive && onLayerDragMove ? (x: number, y: number) => onLayerDragMove(layer.id, { x, y }) : undefined}
```

- [ ] **Step 4: Type-check + commit**

Run: `npx tsc --noEmit` (expected: clean — note callers still pass the old single-arg `onSelectLayer`; fix in Task 2.3, so this task may show type errors at the EditorModal call site. If so, commit together with 2.3.)

If clean independently:
```bash
git add lib/nodes/plugins/compositor/ui/Renderer.tsx
git commit -m "feat(compositor): thread modifier key + drag-move through layer renderer"
```
Otherwise proceed to Task 2.3 and commit both together.

### Task 2.3: Selection-array state in the editor

**Files:**
- Modify: `lib/nodes/plugins/compositor/ui/EditorModal.tsx`

- [ ] **Step 1: Replace single-id selection state**

Replace:

```tsx
const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
const selectedLayerIdRef = useRef<string | null>(null);
selectedLayerIdRef.current = selectedLayerId;
```

with:

```tsx
const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);
const selectedLayerIdsRef = useRef<string[]>([]);
selectedLayerIdsRef.current = selectedLayerIds;

// Primary = last added; single-select surfaces (Timeline, single-layer panel)
// key off this. Selection is LOCAL UI state and must never be written into
// currentWorkflow (see project memory: selection must not churn the hot path).
const selectedLayerId = selectedLayerIds.length > 0 ? selectedLayerIds[selectedLayerIds.length - 1] : null;

const selectLayer = useCallback((layerId: string, additive: boolean) => {
    setSelectedLayerIds((prev) => {
        if (additive) {
            return prev.includes(layerId) ? prev.filter((id) => id !== layerId) : [...prev, layerId];
        }
        return [layerId];
    });
}, []);

const clearSelection = useCallback(() => setSelectedLayerIds([]), []);
```

- [ ] **Step 2: Update every `setSelectedLayerId` / `selectedLayerIdRef` usage**

- `deleteSelectedLayer`: change the trailing `setSelectedLayerId(null)` to `setSelectedLayerIds((prev) => prev.filter((id) => id !== layerId))`.
- Delete-key branch in the window keydown effect: replace `const layerId = selectedLayerIdRef.current; if (!layerId) return;` and the single `deleteSelectedLayer(layerId)` with a loop over `selectedLayerIdsRef.current` (delete each):

```tsx
const ids = selectedLayerIdsRef.current;
if (ids.length === 0) return;
e.preventDefault();
e.stopPropagation();
e.stopImmediatePropagation();
ids.forEach((lid) => deleteSelectedLayer(lid));
```

- `checkDeselect`: replace `setSelectedLayerId(null)` with `clearSelection()`.
- Layer list `LayerListItem` `onSelect`: it currently calls `onSelect(layer.id)`. Change the `onSelect` prop passed in the list to a handler that reads the click modifier. In `LayerListItem`, the `Reorder.Item` `onClick={() => onSelect(layer.id)}` — change to `onClick={(e) => onSelect(layer.id, e.ctrlKey || e.metaKey)}` and update the call site `onSelect={selectLayer}`.
- `CompositorLayerNodes` props: `onSelectLayer={selectLayer}` (now `(id, additive)`), add `selectedLayerIds={selectedLayerIds}`, and (Task 2.4) `onLayerDragMove`.
- Timeline props: `selectedLayerId={selectedLayerId}` stays (single primary); `onSelectLayer={(id) => selectLayer(id, false)}`.
- Properties panel: see Task 2.6 — gate single vs multi on `selectedLayerIds.length`.

- [ ] **Step 3: Update the transformer wiring effect to attach ALL selected nodes**

Replace the effect (~lines 636-650):

```tsx
useEffect(() => {
    const tr = transformerRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    if (selectedLayerIds.length === 0) {
        tr.nodes([]);
        tr.getLayer()?.batchDraw();
        return;
    }
    const nodes = selectedLayerIds
        .map((lid) => stage.findOne(`.img-${lid}`))
        .filter((n: any) => !!n && !n.getAttr('locked'));
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
}, [selectedLayerIds, renderable]);
```

The Transformer render condition (~line 846) currently gates on `selectedLayer && !selectedLayer.locked`. Change to show whenever there is at least one unlocked selected layer:

```tsx
{selectedLayerIds.some((lid) => {
    const l = layers.find((x) => x.id === lid);
    return l && !l.locked;
}) && (
    <Transformer ref={transformerRef} flipEnabled={false} borderStroke="#00F2EA" anchorStroke="#00F2EA" anchorFill="#00F2EA" anchorSize={8} borderDash={[3, 3]} />
)}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: clean (together with Task 2.2's renderer changes).

- [ ] **Step 5: Manual QA**

Open editor with ≥2 layers. Click a layer → selects it (single). Ctrl/Cmd+click another → both selected, bounding box wraps both. Ctrl/Cmd+click a selected one → removed from selection. Click empty canvas → cleared. Click a layer-list row, Ctrl+click another row → multi-select reflects on canvas. Resize/rotate via the group box → all selected layers transform together. Delete with two selected → both layers' edges removed.

- [ ] **Step 6: Commit**

```bash
git add lib/nodes/plugins/compositor/ui/Renderer.tsx lib/nodes/plugins/compositor/ui/EditorModal.tsx
git commit -m "feat(compositor): multi-layer selection with group transformer"
```

### Task 2.4: Group drag (move selected layers together)

Konva's `Transformer` gives group resize/rotate but not group move — each node drags independently. Move siblings by the dragged node's delta, live, then commit all on drag end.

**Files:**
- Modify: `lib/nodes/plugins/compositor/ui/EditorModal.tsx`

- [ ] **Step 1: Add group-drag refs and handlers**

Add near the other refs:

```tsx
// Group-drag bookkeeping: positions of every selected Konva node at drag
// start, so siblings can be moved by the anchor's delta during the gesture.
const groupDragRef = useRef<{ anchorId: string; start: Map<string, { x: number; y: number }> } | null>(null);
```

Add a drag-move handler:

```tsx
const handleLayerDragMove = useCallback((layerId: string, pos: { x: number; y: number }) => {
    const sel = selectedLayerIdsRef.current;
    // Only drive group movement when the dragged layer is part of a 2+ selection.
    if (sel.length < 2 || !sel.includes(layerId)) return;
    const stage = stageRef.current;
    if (!stage) return;

    if (!groupDragRef.current || groupDragRef.current.anchorId !== layerId) {
        const start = new Map<string, { x: number; y: number }>();
        for (const lid of sel) {
            const node = stage.findOne(`.img-${lid}`);
            if (node) start.set(lid, { x: node.x(), y: node.y() });
        }
        // The anchor's CURRENT pos already moved; reconstruct its start as the
        // pos minus the delta we haven't applied yet — instead, store the anchor
        // start as its first reported pos so subsequent deltas are relative.
        start.set(layerId, start.get(layerId) ?? pos);
        groupDragRef.current = { anchorId: layerId, start };
        return; // first move establishes the baseline; no sibling shift yet
    }

    const start = groupDragRef.current.start;
    const anchorStart = start.get(layerId);
    if (!anchorStart) return;
    const dx = pos.x - anchorStart.x;
    const dy = pos.y - anchorStart.y;
    for (const lid of sel) {
        if (lid === layerId) continue;
        const node = stage.findOne(`.img-${lid}`);
        const s = start.get(lid);
        if (node && s) {
            node.x(s.x + dx);
            node.y(s.y + dy);
        }
    }
    stage.batchDraw();
}, []);
```

- [ ] **Step 2: Commit all moved layers on drag end**

The renderer commits the dragged layer's own position via `onTransform` in its `onDragEnd`. For the siblings (moved imperatively above), commit them in `handleInteractEnd`:

```tsx
const handleInteractEnd = useCallback(() => {
    setIsDragging(false);
    const gd = groupDragRef.current;
    groupDragRef.current = null;
    if (!gd) return;
    const stage = stageRef.current;
    if (!stage) return;
    // Read final positions of every selected node and commit in one write.
    const updates = new Map<string, { x: number; y: number }>();
    for (const lid of selectedLayerIdsRef.current) {
        const node = stage.findOne(`.img-${lid}`);
        if (node) updates.set(lid, { x: node.x(), y: node.y() });
    }
    if (updates.size === 0) return;
    updateLayers((prev) => prev.map((l) => {
        const u = updates.get(l.id);
        return u ? { ...l, transform: { ...l.transform, x: u.x, y: u.y } } : l;
    }));
}, [setIsDragging, updateLayers]);
```

(The anchor layer's own `onDragEnd` → `onTransform` write and this batched write both land; the batched write is authoritative since it includes the anchor too. Verify no double-snapshot: `handleInteractStart` already pushed one undo snapshot at drag start, which covers the whole group move.)

- [ ] **Step 3: Pass `onLayerDragMove` to the renderer**

In the `<CompositorLayerNodes>` interactive instance, add `onLayerDragMove={handleLayerDragMove}`.

- [ ] **Step 4: Type-check + manual QA**

`npx tsc --noEmit` (clean). In dev: select 2+ layers, drag one → all move together preserving relative offsets; release → positions persist; single Ctrl+Z reverts the whole group move. Single-select drag still moves just one layer.

- [ ] **Step 5: Commit**

```bash
git add lib/nodes/plugins/compositor/ui/EditorModal.tsx
git commit -m "feat(compositor): group-drag moves all selected layers together"
```

### Task 2.5: Marquee selection box on the canvas

**Files:**
- Modify: `lib/nodes/plugins/compositor/ui/EditorModal.tsx`

- [ ] **Step 1: Add marquee state + Konva Rect import**

Add `Rect` is already imported. Add state:

```tsx
// Marquee selection rectangle in CANVAS coords (null when not dragging one).
const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
const marqueeRef = useRef<typeof marquee>(null);
marqueeRef.current = marquee;
```

- [ ] **Step 2: Start/update/end the marquee on stage pointer events**

The `<Stage>` already has `onMouseDown={checkDeselect}` and supports `draggable` only when panning. Add marquee handling that runs only when NOT panning and the move tool is active and the pointer started on empty space.

Add a helper to convert pointer → canvas coords (account for stage pan/zoom):

```tsx
const stagePointerToCanvas = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return null;
    const p = stage.getPointerPosition();
    if (!p) return null;
    return { x: (p.x - stage.x()) / stage.scaleX(), y: (p.y - stage.y()) / stage.scaleY() };
}, []);
```

Wire Stage handlers (replace the single `onMouseDown={checkDeselect}`):

```tsx
onMouseDown={(e) => {
    const clickedEmpty = e.target === e.target.getStage() || e.target.name() === 'background';
    if (!clickedEmpty) return;            // clicks on a layer are handled by the layer
    if (spaceHeld || tool === 'pan') return; // panning, not marqueeing
    const c = stagePointerToCanvas();
    if (!c) { clearSelection(); return; }
    if (!(e.evt.ctrlKey || e.evt.metaKey)) clearSelection(); // plain marquee replaces
    setMarquee({ x1: c.x, y1: c.y, x2: c.x, y2: c.y });
}}
onMouseMove={() => {
    if (!marqueeRef.current) return;
    const c = stagePointerToCanvas();
    if (!c) return;
    setMarquee((m) => (m ? { ...m, x2: c.x, y2: c.y } : m));
}}
onMouseUp={(e) => {
    const m = marqueeRef.current;
    if (!m) return;
    setMarquee(null);
    const box = { minX: Math.min(m.x1, m.x2), minY: Math.min(m.y1, m.y2), maxX: Math.max(m.x1, m.x2), maxY: Math.max(m.y1, m.y2) };
    // Ignore click-sized boxes (treat as a plain click → already cleared above).
    if (Math.abs(m.x2 - m.x1) < 3 && Math.abs(m.y2 - m.y1) < 3) return;
    const additive = e.evt.ctrlKey || e.evt.metaKey;
    const hitIds = layers.filter((l) => l.visible && rectsIntersect(layerAABB(l), box)).map((l) => l.id);
    setSelectedLayerIds((prev) => additive ? Array.from(new Set([...prev, ...hitIds])) : hitIds);
}}
```

Import the helpers: add `layerAABB, rectsIntersect` to the existing `from '../shared'` import.

- [ ] **Step 3: Render the marquee rectangle**

Inside the `<Layer>`, after `CompositorLayerNodes` and before the dimmer `<Path>` (so it sits above layers but below the dimmer is fine either way — put it above the dimmer so it's always visible):

```tsx
{marquee && (
    <Rect
        x={Math.min(marquee.x1, marquee.x2)}
        y={Math.min(marquee.y1, marquee.y2)}
        width={Math.abs(marquee.x2 - marquee.x1)}
        height={Math.abs(marquee.y2 - marquee.y1)}
        fill="rgba(0,242,234,0.12)"
        stroke="#00F2EA"
        strokeWidth={1 / stageZoom}
        dash={[4 / stageZoom, 4 / stageZoom]}
        listening={false}
    />
)}
```

- [ ] **Step 4: Type-check + manual QA**

`npx tsc --noEmit` (clean). In dev: with the move tool, drag a box over 2+ layers on empty canvas → those layers get selected and the group box appears. Ctrl/Cmd+drag a marquee → adds to the current selection. A tiny drag/click on empty space clears. Pan tool / space-drag still pans (no marquee). Marquee rect scales crisply at any zoom.

- [ ] **Step 5: Commit**

```bash
git add lib/nodes/plugins/compositor/ui/EditorModal.tsx
git commit -m "feat(compositor): marquee box selects intersecting layers"
```

### Task 2.6: Shared-properties panel for multi-selection

**Files:**
- Create: `lib/nodes/plugins/compositor/ui/MultiLayerProperties.tsx`
- Modify: `lib/nodes/plugins/compositor/ui/EditorModal.tsx`

- [ ] **Step 1: Create `MultiLayerProperties.tsx`**

A presentational panel: given the selected layers + an `onUpdateAll(patch)` callback (patch is a `Partial<LayerTransform>` applied to every selected layer), render the always-shared fields, plus Typography only if all selected are text layers. Differing values show "Mixed".

```tsx
'use client';

import React, { useMemo } from 'react';
import { RotateCcw, FlipHorizontal, FlipVertical, AlignLeft, AlignCenter, AlignRight, AlignJustify, ArrowLeft, ArrowRight, ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NumberInput } from '@/components/ui/NumberInput';
import { Select } from '@/components/ui/Select';
import { CompositorLayer, LayerTransform } from '../definition';

const BLEND_MODES = [
    { id: 'source-over', display_name: 'Normal' }, { id: 'multiply', display_name: 'Multiply' },
    { id: 'screen', display_name: 'Screen' }, { id: 'overlay', display_name: 'Overlay' },
    { id: 'darken', display_name: 'Darken' }, { id: 'lighten', display_name: 'Lighten' },
    { id: 'color-dodge', display_name: 'Color Dodge' }, { id: 'color-burn', display_name: 'Color Burn' },
    { id: 'hard-light', display_name: 'Hard Light' }, { id: 'soft-light', display_name: 'Soft Light' },
    { id: 'difference', display_name: 'Difference' }, { id: 'exclusion', display_name: 'Exclusion' },
];

/** Returns the shared value across layers for a transform field, or undefined if mixed. */
function shared<K extends keyof LayerTransform>(layers: CompositorLayer[], key: K): LayerTransform[K] | undefined {
    if (layers.length === 0) return undefined;
    const first = layers[0].transform[key];
    return layers.every((l) => l.transform[key] === first) ? first : undefined;
}

export default function MultiLayerProperties({
    layers,
    onUpdateAll,
    onAlignAll,
}: {
    layers: CompositorLayer[];
    onUpdateAll: (patch: Partial<LayerTransform>) => void;
    onAlignAll: (type: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => void;
}) {
    const opacity = shared(layers, 'opacity');
    const rotation = shared(layers, 'rotation');
    const blend = shared(layers, 'blendMode') ?? 'source-over';
    const flipX = shared(layers, 'flipX');
    const flipY = shared(layers, 'flipY');
    const allText = useMemo(() => layers.every((l) => l.transform.fontSize !== undefined || l.transform.fontFamily !== undefined), [layers]);

    return (
        <div className="flex-1 overflow-y-auto p-4 space-y-8 custom-scrollbar pb-20">
            <div className="text-[10px] font-black text-accent-primary uppercase tracking-widest">{layers.length} layers selected</div>

            {/* Alignment (applies to each layer against the canvas) */}
            <div className="space-y-3">
                <label className="text-[9px] font-black text-white/20 uppercase tracking-widest">Alignment</label>
                <div className="grid grid-cols-6 gap-1 bg-white/5 p-1 rounded-xl border border-white/5">
                    <button onClick={() => onAlignAll('left')} className="p-2 rounded-lg hover:bg-white/10 text-white/40 flex items-center justify-center"><ArrowLeft className="w-3.5 h-3.5" /></button>
                    <button onClick={() => onAlignAll('center')} className="p-2 rounded-lg hover:bg-white/10 text-white/40 flex items-center justify-center"><AlignCenter className="w-3.5 h-3.5" /></button>
                    <button onClick={() => onAlignAll('right')} className="p-2 rounded-lg hover:bg-white/10 text-white/40 flex items-center justify-center"><ArrowRight className="w-3.5 h-3.5" /></button>
                    <button onClick={() => onAlignAll('top')} className="p-2 rounded-lg hover:bg-white/10 text-white/40 flex items-center justify-center"><ArrowUp className="w-3.5 h-3.5" /></button>
                    <button onClick={() => onAlignAll('middle')} className="p-2 rounded-lg hover:bg-white/10 text-white/40 flex items-center justify-center"><AlignJustify className="w-3.5 h-3.5 rotate-90" /></button>
                    <button onClick={() => onAlignAll('bottom')} className="p-2 rounded-lg hover:bg-white/10 text-white/40 flex items-center justify-center"><ArrowDown className="w-3.5 h-3.5" /></button>
                </div>
            </div>

            {/* Rotation + Flip */}
            <div className="grid grid-cols-2 gap-3 items-end">
                <div className="relative">
                    <label className="text-[8px] font-bold text-white/20 uppercase tracking-widest pl-1 mb-1 block">Rotation</label>
                    <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-2 h-8">
                        <RotateCcw className="w-3 h-3 text-white/20" />
                        <input type="number" placeholder={rotation === undefined ? 'Mixed' : undefined}
                            value={rotation === undefined ? '' : Math.round(rotation)}
                            onChange={(e) => onUpdateAll({ rotation: Number(e.target.value) })}
                            className="w-full bg-transparent border-none focus:outline-none text-xs text-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                        <span className="text-[10px] font-bold text-white/20">°</span>
                    </div>
                </div>
                <div className="flex gap-1 bg-white/5 p-1 rounded-lg border border-white/5 h-8">
                    <button onClick={() => onUpdateAll({ flipX: !flipX })} className={cn("flex-1 rounded flex items-center justify-center", flipX ? "bg-accent-primary text-white" : "text-white/20 hover:text-white")}><FlipHorizontal className="w-3 h-3" /></button>
                    <button onClick={() => onUpdateAll({ flipY: !flipY })} className={cn("flex-1 rounded flex items-center justify-center", flipY ? "bg-accent-primary text-white" : "text-white/20 hover:text-white")}><FlipVertical className="w-3 h-3" /></button>
                </div>
            </div>

            {/* Blend + Opacity */}
            <div className="space-y-4">
                <label className="text-[9px] font-black text-white/20 uppercase tracking-widest">Effects</label>
                <Select variant="minimal" label="Blend Mode" value={blend} options={BLEND_MODES} onChange={(e) => onUpdateAll({ blendMode: e.target.value })} />
                <div className="space-y-2">
                    <div className="flex justify-between items-center px-1">
                        <label className="text-[8px] font-bold text-white/30 uppercase tracking-widest">Opacity</label>
                        <span className="text-[10px] font-black text-accent-primary tabular-nums">{opacity === undefined ? 'Mixed' : `${Math.round(opacity * 100)}%`}</span>
                    </div>
                    <input type="range" min="0" max="1" step="0.01" value={opacity ?? 1} onChange={(e) => onUpdateAll({ opacity: Number(e.target.value) })} className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-accent-primary" />
                </div>
            </div>
        </div>
    );
}
```

Note: `allText` is computed but Typography fields are intentionally omitted from the multi panel for v1 (text multi-edit is niche and the heuristic is unreliable). Keep `allText` out or remove it to avoid an unused-var lint. Remove the `allText`/`useMemo` line before committing.

- [ ] **Step 2: Wire it into `EditorModal`'s right panel**

Add a multi-select helper in EditorModal that applies a transform patch to all selected layers (one batched write, with one undo snapshot):

```tsx
const updateAllSelectedTransform = useCallback((patch: Partial<LayerTransform>) => {
    pushSnapshot();
    const ids = new Set(selectedLayerIdsRef.current);
    updateLayers((prev) => prev.map((l) => ids.has(l.id) ? { ...l, transform: { ...l.transform, ...patch } } : l));
}, [updateLayers, pushSnapshot]);

const alignAllSelected = useCallback((type: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
    pushSnapshot();
    const ids = new Set(selectedLayerIdsRef.current);
    updateLayers((prev) => prev.map((l) => {
        if (!ids.has(l.id)) return l;
        const { width, height } = l.transform;
        let x = l.transform.x, y = l.transform.y;
        if (type === 'left') x = 0;
        if (type === 'center') x = (canvasWidth - width) / 2;
        if (type === 'right') x = canvasWidth - width;
        if (type === 'top') y = 0;
        if (type === 'middle') y = (canvasHeight - height) / 2;
        if (type === 'bottom') y = canvasHeight - height;
        return { ...l, transform: { ...l.transform, x, y } };
    }));
}, [updateLayers, pushSnapshot, canvasWidth, canvasHeight]);
```

In the right-panel JSX, change the top-level conditional. Currently it's `{selectedLayer ? (<single panel>) : (<canvas panel>)}`. Make it three-way:

```tsx
{selectedLayerIds.length > 1 ? (
    <MultiLayerProperties
        layers={layers.filter((l) => selectedLayerIds.includes(l.id))}
        onUpdateAll={updateAllSelectedTransform}
        onAlignAll={alignAllSelected}
    />
) : selectedLayer ? (
    /* ...existing single-layer panel unchanged... */
) : (
    /* ...existing canvas-dimensions panel unchanged... */
)}
```

Add the import: `import MultiLayerProperties from './MultiLayerProperties';`.

- [ ] **Step 3: Type-check + manual QA**

`npx tsc --noEmit` (clean). In dev: select 2 layers with different opacities → panel shows "Mixed", header "2 layers selected". Drag the opacity slider → both layers update to the same opacity. Change blend mode → applies to both. Rotation field shows "Mixed" when they differ and sets both when edited. Alignment buttons align each selected layer to the canvas edge. Single-select still shows the full original panel (geometry, typography for text). No selection shows the canvas-dimensions panel.

- [ ] **Step 4: Commit**

```bash
git add lib/nodes/plugins/compositor/ui/MultiLayerProperties.tsx lib/nodes/plugins/compositor/ui/EditorModal.tsx
git commit -m "feat(compositor): shared properties panel for multi-selection"
```

---

## Final verification (all missions)

- [ ] **Step 1: Full type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Regression QA pass**

Single-layer editing (transform, typography, blend, opacity, align, delete, undo/redo), reorder via the layer list, timeline scrub/play for video, download/export, and the node-card preview all behave as before. Multi-select, marquee, group transform/drag, and editor isolation behave per their acceptance lists. Video blend matches between card and editor.

- [ ] **Step 3: Update the spec's status (optional)** and open a PR if requested.

---

## Self-Review notes (author)

- **Spec coverage:** M1 → Tasks 1.1–1.2; M2 selection model → 2.3, group transform → 2.3 (resize/rotate) + 2.4 (move), marquee → 2.5, shared panel/Mixed → 2.6, `layerAABB` helper → 2.1; M3 inert → 3.1–3.2, firewall → 3.3. All spec sections mapped.
- **Type consistency:** `selectedLayerIds` / `setSelectedLayerIds` / `selectLayer(id, additive)` / `clearSelection` used consistently across 2.3–2.6; `onSelectLayer(layerId, additive)` and `onLayerDragMove(layerId, pos)` match between Renderer (2.2) and EditorModal call sites (2.3–2.4); `layerAABB`/`rectsIntersect`/`AABB` defined in 2.1 and consumed in 2.5; `useInertBackground(active, exceptEl)` defined in 3.1 and called in 3.2; `portalEl` prop added in 3.2 and threaded from `component.tsx`.
- **Mission 1 caveat:** intentionally contingent (debugging task); fix code is illustrative and gated on the Task 1.1 diagnosis, per the systematic-debugging requirement noted at the mission header.
```
