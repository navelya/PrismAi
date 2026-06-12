# Compositor Timeline UX Overhaul — Design

**Date:** 2026-06-12
**Status:** Approved (brainstorming) — ready for implementation plan
**Area:** `lib/nodes/plugins/compositor/`

## Goal

Bring the compositor timeline closer to a real non-linear editor (NLE) with four
improvements:

1. **Trim from the start** (left-edge trim) and **split a clip into two clips on
   the same row** (real blade cutting). The source/edge connection for a row is
   removed only when the row is *completely* deleted (its last clip).
2. **Gentler playhead** — a thin neutral line, no neon/glow.
3. **Zoom slider** — change pixels-per-second so the user sees more or less of the
   timeline in the same width.
4. **Resizable timeline height** — drag the timeline's top border up/down.

## Decisions (from brainstorming)

- **Cut point:** at the **playhead** (frame-accurate, blade behavior). Right-click
  → "Split at playhead."
- **Left trim:** **true trim-in** for video/audio — hides earlier source frames,
  remaining content stays time-locked. Images/text just move `startTime`.
- **Persistence:** timeline **height and zoom are session-only** local editor view
  state — never written into node config / the workflow.
- **Row model:** a "row" = all layers that share one `sourceHandleId`. A "clip" =
  one `CompositorLayer`.
- **Toggle vs edit granularity:** visibility / lock / mute apply **per-row** (write
  to every layer in the group); selection / move / trim / split / delete apply
  **per-clip**.

## Approach for #1 — "layers-as-clips", not a Track→Clips rewrite

A full Track→Clips data-model rewrite was rejected (YAGNI + high risk): it would
touch `definition.ts`, the renderer, both executors, the aiSchema the chat brain
reads, store edge-sync, and require migrating every saved compositor.

The existing architecture **already tolerates multiple layers per edge** in every
critical path, so we reuse it:

- `renderable` already iterates **per-layer** (`component.tsx:659`) and looks the
  edge up by `sourceHandleId`, so two layers sharing a source each render at their
  own `[startTime, startTime+duration)` window.
- Executors key `inputs` by `sourceHandleId`
  (`executor.client.ts:147`, `executor.server.ts:178/268/462`) — two layers reading
  the same key resolve to the same URL.
- Store edge-sync drops layers by matching `sourceHandleId`
  (`workflow-slice.ts:659`: `existingLayers.filter(l => incomingIds.has(l.sourceHandleId))`),
  so **removing the edge already removes every clip on that row** — exactly the
  "remove only when row completely deleted" rule, inverted.

New invariant introduced: **all layers sharing a `sourceHandleId` stay contiguous
in `config.layers`** so a row maps to a coherent z-order span. Splitting inserts the
second clip immediately after the first.

## Feature details

### 1a. Left-edge trim handle (true trim-in)

- Add a **left** resize handle to `ui/ClipBlock.tsx`, mirroring the existing right
  handle (`ClipBlock.tsx:233-237`) and reusing the same pointer-drag machinery
  (`ClipBlock.tsx:119-209`) with a new drag `kind: 'trim-start'`.
- Drag math (video/audio): for a delta `dT` to the right,
  `startTime += dT`, `duration -= dT`, `trimIn += dT`. Content stays time-locked.
  Clamp: `trimIn >= 0`, `startTime >= 0`, and don't cross the right edge
  (`duration` stays `>= ~0.1s`).
- Images/text: no source time — `startTime += dT`, `duration -= dT`, `trimIn`
  untouched.
- Snap: reuse existing snap targets/threshold (already px-scaled, `ClipBlock.tsx:44-47`).

**Engine must honor `trimIn`** (today it's "Stage 1 ignored", used only to clamp
resize at `Timeline.tsx:327`):

- Preview: `ui/Renderer.tsx:964-966` computes
  `localTime = Math.max(0, playhead - startTime)`. Change to
  `localTime = Math.max(0, playhead - startTime) + (layer.trimIn || 0)` so the
  pooled `<video>` seeks to the trimmed source time (the seek already uses
  `localTime` at `Renderer.tsx:333-340`).
- Server render: apply the same `+ trimIn` offset wherever `executor.server.ts`
  maps frame/timeline time to a source seek time (mirror the preview formula).
- `trimIn` does not affect `isLayerActiveAt` / `getEffectiveDuration` in
  `shared.ts` — those are timeline-space (`startTime`/`duration`), which is correct.

### 1b. Split at playhead

- Right-click a clip → context menu "Split at playhead" (reuse the shared menu
  pattern already used in the editor; no hand-rolled portal).
- Enabled only when `startTime < playhead < startTime + effectiveDuration`.
- Produces two layers from one (`splitLayerAtPlayhead(layer, playhead)` helper in
  `shared.ts`):
  - **Left:** unchanged `startTime`/`trimIn`; `duration = playhead - startTime`.
  - **Right:** new `id`; `startTime = playhead`;
    `trimIn = layer.trimIn + (playhead - layer.startTime)`;
    `duration = originalDuration - (playhead - startTime)` (or `null`-aware for
    image/text → resolve effective duration first, then assign concrete halves).
  - Same `sourceHandleId`, `selectedIndex`, `transform`, `visible`, `locked`,
    `muted`, `name`. Insert the right clip immediately after the left in
    `config.layers` (contiguity invariant).

### 1c. Delete semantics (row removed only when last clip goes)

- Right-click clip → "Delete clip":
  - If **other layers share its `sourceHandleId`**: remove just this layer from
    `config.layers` via `updateNodeConfig` (edge/connection preserved).
  - If it's the **last** clip for that `sourceHandleId`: remove the **edge**
    (`onEdgesChange([{ id: sourceHandleId, type: 'remove' }])`) — the store cascade
    drops the layer (current `deleteSelectedLayer` behavior at
    `EditorModal.tsx:517-526`).
- Right-click row label → "Remove row / disconnect": always removes the edge →
  store drops all clips on that row.
- Keyboard delete on a selected clip follows the "Delete clip" branch.

### 2. Gentler playhead

- `ui/Timeline.tsx:372-386`: replace the `bg-accent-primary` 1px line + chunky
  accent triangle with a thin neutral line (e.g. `bg-white/70`, no `shadow`) and a
  small flat grab handle at the top. No glow/neon.
- Leave the amber snap guide (`Timeline.tsx:365-370`) as-is — it's a transient
  alignment aid, distinct from the playhead, and may be slightly toned down but is
  out of scope.

### 3. Zoom slider

- Promote `PIXELS_PER_SECOND = 40` (`Timeline.tsx:32`) to `pixelsPerSecond` React
  state in `Timeline`. It is already threaded into `ClipBlock` as a prop, so clips
  and snap thresholds scale automatically.
- Add a compact range slider in the timeline header (reuse a shared slider
  primitive if one exists in `components/ui/`; otherwise a minimal styled
  `<input type=range>`). Range ~**10–120 px/s**, default 40.
- Ruler tick spacing (`Timeline.tsx:85-90`) must adapt to the current
  `pixelsPerSecond` so labels don't crowd at high zoom (choose a tick interval that
  keeps a sane minimum px gap).
- Session-only state; recomputed `totalWidth` drives horizontal scroll as today.

### 4. Resizable timeline height

- The timeline mount is a fixed `h-[260px]` in `ui/EditorModal.tsx:~1288`.
- Replace with a `useState` height in `EditorModal`, applied as an inline
  `style={{ height }}`.
- Add a thin drag handle on the **top** border (cursor `ns-resize`); dragging up
  grows the timeline, down shrinks it. Clamp `min ~140px`,
  `max ~70% of modal height`.
- Session-only; not persisted.

## Files touched (anticipated)

- `lib/nodes/plugins/compositor/shared.ts` — `splitLayerAtPlayhead`, trim-in time
  mapping helper (so preview + server share one formula).
- `lib/nodes/plugins/compositor/ui/ClipBlock.tsx` — left trim handle + `trim-start`
  drag kind.
- `lib/nodes/plugins/compositor/ui/Timeline.tsx` — row grouping by `sourceHandleId`,
  multiple `ClipBlock`s per row, per-row toggles, playhead restyle, zoom slider +
  adaptive ruler, right-click clip/row menus.
- `lib/nodes/plugins/compositor/ui/Renderer.tsx` — honor `trimIn` in `localTime`.
- `lib/nodes/plugins/compositor/executor.server.ts` — honor `trimIn` in server
  render seek.
- `lib/nodes/plugins/compositor/ui/EditorModal.tsx` — resizable timeline height;
  per-clip vs per-row delete wiring.
- Possibly `lib/nodes/plugins/compositor/definition.ts` — only doc-comment updates
  (`trimIn`/`trimOut` are no longer "Stage 1 ignored"; no schema shape change).

## Non-goals / YAGNI

- No Track→Clips data-model rewrite; no saved-workflow migration.
- No persistence of zoom/height into node config.
- `trimOut`, `speed`, `transition` remain forward-compat (untouched).
- Snap-guide glow restyle beyond the playhead.
- Mobile-specific timeline interactions.

## Risks / verification

- **Grouping correctness:** rows must stay coherent in z-order — verify the
  contiguity invariant holds after split and after delete-one-clip.
- **trim-in parity:** preview (`Renderer.tsx`) and server render
  (`executor.server.ts`) must use the *same* `+ trimIn` offset, or a clip looks
  different rendered vs. previewed. Verify both paths against a trimmed video clip.
- **Edge-removal branch:** deleting a non-last clip must NOT drop the edge; deleting
  the last clip MUST. Verify both with a split clip.
- Verify with `npx tsc --noEmit` (project's reliable check; `npm run lint`/`build`
  are flaky here) plus in-app E2E in the editor modal.
