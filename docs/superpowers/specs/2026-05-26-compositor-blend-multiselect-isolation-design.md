# Compositor: video-blend fix, multi-select layers, editor window isolation

Date: 2026-05-26

Three independent improvements to the Compositor node. Each is self-contained
(separate files, separate concerns) and can be implemented and verified on its
own. They are grouped here only because they were requested together.

Relevant files:
- [EditorModal.tsx](../../../lib/nodes/plugins/compositor/ui/EditorModal.tsx) — full-screen editor (selection, properties panel, Konva stage)
- [Renderer.tsx](../../../lib/nodes/plugins/compositor/ui/Renderer.tsx) — shared Konva layer renderer (`CompositorLayerNodes`, `LayerVideo`, `LayerImage`)
- [component.tsx](../../../lib/nodes/plugins/compositor/component.tsx) — node card + `LivePreview`
- [EditorCanvas.tsx](../../../components/editor/EditorCanvas.tsx) — React Flow canvas (global keyboard shortcuts)

---

## Mission 1 — Video blend mode is invisible in the node card preview

### Symptom
A layer's blend mode (e.g. `multiply`, `screen`) renders correctly in the
full-screen editor modal but has no visible effect in the node **card preview**
(`LivePreview`) when the layer is a **video**. Image layers blend correctly in
both surfaces. Confirmed location: the node card preview, not downstream/lightbox.

### Why this is a debugging task, not a predetermined change
Both surfaces render through the same `CompositorLayerNodes`, and `LayerVideo`
already sets `globalCompositeOperation` identically to `LayerImage`
([Renderer.tsx](../../../lib/nodes/plugins/compositor/ui/Renderer.tsx) lines
~348 and ~149). So the cause lives in what is *structurally different* about the
card's Stage versus the editor's Stage. The fix is whatever the repro reveals;
we confirm before changing code (systematic-debugging).

### Structural differences between the two surfaces
| | Editor modal | Card preview (`LivePreview`) |
|---|---|---|
| Konva layer | `<Layer>` | `<Layer listening={false} pixelRatio={1/scale}>` |
| Content wrapper | direct children | `<Group scaleX={scale} scaleY={scale}>` |
| Backdrop | `<Rect fill="#121212">` drawn as bottom of layer | **none** (transparent Konva, CSS checkerboard behind) |

### Ranked hypotheses (to confirm empirically)
1. **Lead hypothesis — no Konva backdrop to blend against.** Blend modes
   composite a shape against the pixels already on the canvas. The editor has an
   opaque `<Rect>` at the bottom of the layer; the card preview's Konva surface
   is fully transparent (the checkerboard is CSS *behind* the canvas, not Konva
   pixels). A video that is the lowest opaque layer therefore has nothing to
   blend against in the card and reads as "Normal." Images may appear to "work"
   only when they happen to sit above another layer. This would also explain why
   the same image+video stack differs between the two surfaces.
2. **`Konva.Animation` redraw interacting with `pixelRatio`/scaled `Group`.** The
   video path repaints continuously via `CompositorAnimator`; the image path
   draws once. Confirm the blend survives the animated redraw under the card's
   `pixelRatio={1/scale}` layer.
3. **Per-shape buffering quirk** specific to a video-backed `KonvaImage`.

### Repro to build first
A two-layer compositor: an opaque image on the bottom, a video on top with
`multiply`. Compare card preview vs. editor. If hypothesis 1 holds, the blend is
visible in the editor (composites against the `#121212` rect + image) and absent
or wrong in the card.

### Fix direction (contingent on repro)
If hypothesis 1 is confirmed: make the blend backdrop **consistent** between the
two surfaces so a layer blends against the layers beneath it identically in both.
The card preview should not introduce an opaque background that would defeat the
compositor's transparency contract — so the correct fix is to ensure blend modes
compose against *lower layers* the same way in both surfaces, not to paint a card
background. Exact change determined by the confirmed cause; no code changes land
until the repro pins it down.

### Acceptance
- The image-under-video-with-`multiply` repro shows the same blend result in the
  card preview as in the editor modal.
- Image-layer blending is unchanged.
- The card's transparent/checkerboard background is preserved (no opaque
  backdrop introduced into the published/transparent output).

---

## Mission 2 — Multi-select layers (group bounding box + shared properties)

### Goal
Select multiple layers at once via a selection box **or** click-then-Ctrl/Cmd-click,
get a single group bounding box on the canvas that transforms them together, and
a properties panel that shows only the properties shared across the selection —
editing any field applies to all selected layers.

### Selection model
Replace the single `selectedLayerId: string | null` with
`selectedLayerIds: string[]` (component-local state, exactly like today — it must
**never** be written into `currentWorkflow`; see the project memory note on
selection churning the store hot-path). Derive `primarySelectedId` (last added)
where a single anchor is needed.

Input gestures (all funnel into one `setSelection`/`toggleSelection` helper):
- **Click** (layer list row or canvas node): replace selection with just that layer.
- **Ctrl/Cmd + click** (layer list row or canvas node): toggle that layer in/out
  of the current selection.
- **Marquee drag** on empty canvas with the move tool: draw a selection rectangle;
  on release, select every layer whose bounding box intersects the rectangle.
  (Shift/Ctrl during marquee = additive — optional, can default to replace.)
- **Click empty space**: clear selection (existing `checkDeselect` extended).

### Group transform on canvas
The Konva `Transformer` is attached to **all** currently-selected Konva nodes via
`transformer.nodes([...])` (Konva supports multi-node transform natively, giving a
single bounding box). The existing single-node wiring effect
([EditorModal.tsx](../../../lib/nodes/plugins/compositor/ui/EditorModal.tsx)
~line 636) becomes a multi-node lookup (`.img-<id>` for each selected id).

On `transformEnd`, each selected node's resulting absolute transform (x, y, width,
height, rotation, accounting for flip) is read back and committed per-layer
through the existing `updateLayers`/`updateTransform` path in one batched store
write. Locked layers are excluded from the Transformer's node set.

### Marquee rendering + hit testing
- A Konva `<Rect>` drawn on the stage during the marquee drag (dashed, accent
  stroke), in stage coordinates.
- Hit test: rectangle-vs-rotated-layer-AABB intersection. The rotated-AABB corner
  math already exists inline in `fitCanvasToContent`; extract it into a shared
  `layerAABB(layer)` helper in the plugin's `shared.ts` so both the fit logic and
  the marquee use one implementation.

### Shared properties panel
A new `MultiLayerProperties` view rendered when `selectedLayerIds.length > 1`
(single-select keeps today's `selectedLayer` panel verbatim — no regression).

Field visibility:
- **Always shown** (common to every layer type): Geometry (X/Y/W/H), Rotation,
  Flip X/Y, Opacity, Blend Mode, Alignment.
- **Typography section**: shown only when **every** selected layer is a text
  (`prompt`) layer.

Mixed-value behavior (per decision): for each field, compute whether all selected
layers share the same value.
- Same value → show the value normally.
- Differing values → show a **"Mixed"** placeholder (empty/greyed).
- Editing any field → set that value **absolutely on all** selected layers
  (one batched `updateLayers` write). Geometry X/Y set absolute (all move to the
  same coordinate) — this is the simple, predictable model chosen over relative
  nudging.

### Components / boundaries
- `EditorModal` owns `selectedLayerIds` and the gesture helpers.
- `MultiLayerProperties` is a new presentational component (props: the selected
  layer array + an `onUpdateAll(patch)` callback). Pure UI; no store access.
- `layerAABB` helper extracted to `shared.ts`.
- `CompositorLayerNodes` gains the ability to report selection on Ctrl/Cmd-click
  (the `onSelectLayer` callback signature extends to pass the modifier state, or
  a sibling `onToggleLayer` is added — implementation detail).

### Acceptance
- Marquee selects all intersecting layers; Ctrl/Cmd-click toggles; plain click
  replaces.
- A single bounding box wraps the multi-selection and drag/resize/rotate moves all
  selected layers together; result persists correctly per layer.
- Properties panel shows only shared fields; differing fields read "Mixed";
  editing applies to all selected layers.
- Single-select behavior and the existing typography/canvas panels are unchanged.
- Selection never triggers a `currentWorkflow` write.

---

## Mission 3 — Editor behaves like a separate window (background isolation)

### Goal
While the editor modal is open, the workflow canvas behind it must be fully inert
— no node selection, no marquee, no arrow-key node nudging, no global shortcuts —
achieved by treating the editor as a separate window rather than by adding
per-handler `if (editorOpen) return` guards.

### Root cause of the leaks
The editor is a `createPortal` overlay on `document.body`. The leaks are React
Flow behaviors that don't care about the visual overlay:
- **Arrow-key node nudging**: React Flow's keyboard a11y moves the *focused* node.
- **Marquee / click selection**: pointer events on the React Flow pane.
- **Global shortcuts** (Ctrl+Z / Ctrl+Y / Ctrl+G): a `document`-level capture
  listener in [EditorCanvas.tsx](../../../components/editor/EditorCanvas.tsx#L846)
  that fires regardless of focus.

### Approach: `inert` background + a keyboard firewall
Two declarative mechanisms, no per-handler guards:

1. **`inert` on the background.** On editor open, set the `inert` attribute (and
   `aria-hidden="true"`) on every direct child of `document.body` **except** the
   editor's portal container; restore on close. `inert`:
   - blurs any focused element in the background → React Flow has no focused node
     → arrow-key nudging does nothing;
   - blocks all pointer events on the background → no marquee, no node clicks;
   - removes the background from the accessibility tree.

   This covers both leaks the user named, declaratively. Implemented as a small
   reusable hook `useInertBackground(active, exceptEl)` that the modal mounts. The
   canvas's own code is untouched.

2. **Keyboard firewall for global shortcuts.** `inert` does **not** stop the
   canvas's `document`-level global shortcuts (they fire irrespective of focus).
   To make the editor a true "separate window," the modal installs a
   **`window`-capture** `keydown` listener (capture phase on `window` runs *before*
   the `document`-level capture listener in EditorCanvas). It stops propagation of
   the canvas's global chords (Ctrl/Cmd+Z/Y/G and Delete) so they never reach the
   canvas handler — while leaving keys the modal itself uses to flow into the
   modal's React tree.

   Critical constraint: the firewall must **not** blanket-`stopImmediatePropagation`
   all keys, because the modal is portaled to `document.body` and React dispatches
   its synthetic events at the React root container — swallowing everything at
   `window` capture would break typing in the modal's own inputs (NumberInput,
   text fields). So the firewall is **selective**: it only stops the specific
   global chords, and it skips when the event target is an editable element inside
   the modal. The existing Delete/Backspace handling in EditorModal (already a
   `window`-capture listener using `stopImmediatePropagation`) is folded into this
   firewall so there's one place that owns "what the canvas must not see."

### Why not native `<dialog showModal()>`
`<dialog>.showModal()` would give a real top layer and auto-inert, but it does not
stop `document`-level global keydown listeners either (same firewall still needed),
and migrating the existing portal-based modal to a `<dialog>` is a larger structural
change with its own focus/scroll quirks. Marking the background `inert` achieves the
same isolation with the current structure and far less risk. Revisit `<dialog>` only
if broader modal infrastructure is reworked later.

### Components / boundaries
- `useInertBackground(active: boolean, exceptEl: HTMLElement | null)` — new hook;
  finds body children, applies/removes `inert` + `aria-hidden`, restores prior
  state on cleanup. Idempotent and safe if other portals mount/unmount.
- The editor's portal gets a stable wrapper element so the hook can exclude it.
- The keyboard firewall lives in `EditorModal` (extends the existing window-capture
  effect), enumerating the canvas chords to block.

### Acceptance
- With the editor open: clicking/marquee on the canvas does nothing; arrow keys do
  not move any node; Ctrl+Z/Y/G and Delete do not reach the canvas (no global
  undo/redo/group/delete fired behind the modal).
- The editor's own undo/redo (local), Delete-layer, typing in inputs, and all
  interactions work normally.
- Closing the editor fully restores canvas interactivity (focus, pointer,
  shortcuts) with no residual `inert`/`aria-hidden` left on any element.
- No per-handler `if (editorOpen)` guards added to canvas/React Flow code.

---

## Out of scope
- Server-side export blend behavior (Mission 1 is preview-only).
- Persisting multi-selection across editor sessions.
- Reworking the modal into a native `<dialog>` element.

## Verification
Per project memory: `npm run lint` / `next build` are unreliable here. Verify
types with `npx tsc --noEmit`, then manual QA against each mission's acceptance
list in the running dev server.
