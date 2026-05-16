# Hot-path performance optimization — Design

**Date:** 2026-05-16
**Scope:** Eliminate felt lag in two surfaces — the node-canvas drag path and the
compositor / video player. Hot-path only: CRITICAL/HIGH issues that cause
perceptible lag. Low-impact micro-optimizations are explicitly excluded.

## Problem

Two surfaces feel laggy:

1. **Compositor / video player** — playback and scrubbing stutter.
2. **Node dragging** — dragging nodes on the React Flow canvas feels heavy.

An audit was run and then verified against the actual code. The verification
**invalidated several audit claims** for the node-drag path; the corrected
findings are below.

## Verified findings

### Compositor (the real lag)

**C1 — Playhead re-render storm during playback.**
`LivePreview`'s `requestAnimationFrame` loop calls `onPlayheadChange(next)` every
frame (`lib/nodes/plugins/compositor/component.tsx:135`), which is wired to
`setCardPlayhead` (`component.tsx:535`). That advances React state 60×/sec, which
re-renders the whole card subtree — `LivePreview`, the Konva `<Stage>` and its
children, and `<MiniTransport>`. The video frames themselves are already drawn
independently by a `Konva.Animation` reading the `<video>` element, so React does
not need to re-render at all for playback to look correct. The 60 Hz React render
is pure waste and is the dominant cost.

**C2 — Scrub fires a state update per pointermove.**
`MiniTransport`'s scrub handler calls `onSeek` on every `pointermove`
(`lib/nodes/plugins/compositor/ui/MiniTransport.tsx:59-63`); each call triggers a
full preview re-render. A single drag gesture produces dozens-to-hundreds of
re-renders.

**C3 — Over-broad memo dependencies.**
`hasVideo` is recomputed inline every render
(`lib/nodes/plugins/compositor/ui/Renderer.tsx:506`). `snapTargetsByLayerId` and
the Timeline clip-row duration calculation
(`lib/nodes/plugins/compositor/ui/Timeline.tsx`) rebuild on every playhead tick
because their dependency arrays include values that change during playback.

### Node canvas (smaller, still real)

**N1 — Per-frame store notify during drag.**
`setDragHoverGroupId` does an unconditional `set({ dragHoverGroupId: id })`
(`lib/store/slices/ui-slice.ts:113`). `handleNodeDrag`
(`components/editor/EditorCanvas.tsx:466`) calls it on every drag frame, so even a
no-op transition (`null → null`) creates a new root store state and runs the
notify loop over every subscriber 60×/sec.

**N2 — Inline `panOnDrag` array.**
`panOnDrag={isPanMode ? [0, 1] : [1]}` (`components/editor/EditorCanvas.tsx:828`)
allocates a new array every render, thrashing React Flow's prop reconciliation.

### Audit claims verified as FALSE or moot — explicitly out of scope

- **"60 store writes/sec during node drag"** — false. Positions are buffered in
  `localNodes` React state during drag and committed to the store only on
  drag-stop (`EditorCanvas.tsx:427, 513-523`).
- **"`live-position-slice` is unused — wire it up"** — moot. The slice was
  intentionally superseded by the `localNodes` approach. Leave it.
- **"`GroupNode` scans all nodes on every drag frame"** — moot. `GroupNode`'s
  `dragHoverGroupId` selector is reference-stable, so it does not re-render on
  no-op updates; fixing N1 removes the residual notify cost.
- **Framer Motion per node** — moot. Only the actively dragged node receives
  `dragging=true`; non-dragged nodes do not animate.

## Changes

### C1 — Decouple the playhead from React render during playback
- During playback, store the advancing playhead in a ref instead of React state.
- Drive the `MiniTransport` scrubber fill/knob and timecode text via direct DOM
  writes from the rAF loop, using refs to those DOM nodes. No React state update
  occurs per frame. (Direct DOM write is chosen over a throttled state update so
  playback produces zero React commits.) The Konva `Konva.Animation` continues to
  draw video frames independently — untouched.
- On pause or seek, commit the ref value back to React state once so the rest of
  the tree (Timeline, etc.) re-syncs.
- **Boundary:** the Konva stage and `Konva.Animation` path are not modified. Only
  the React-state plumbing of the playhead changes.

### C2 — Coalesce scrub updates to one per frame
- In `MiniTransport`, buffer the latest `pointermove` X position and flush it via
  a single `requestAnimationFrame` callback, cancelling any pending frame. One
  `onSeek` per frame max.

### C3 — Tighten memo dependencies
- Wrap `hasVideo` in `useMemo` keyed on `layers` (`Renderer.tsx`).
- Narrow `snapTargetsByLayerId` and the Timeline clip-row duration computation so
  their dependency arrays contain only `layers` and source-kind data — not the
  playhead or values derived from it.

### N1 — Guard `setDragHoverGroupId`
- Make `setDragHoverGroupId` a no-op when the incoming id equals the current
  `dragHoverGroupId` (mirrors the existing guard in `setLiveNodePosition`).

### N2 — Hoist `panOnDrag` arrays
- Declare module-scope `const PAN_ON_DRAG_PAN = [0, 1]` and
  `const PAN_ON_DRAG_SELECT = [1]`; select between them by `isPanMode`.

## Risks

- **C1** is the highest-risk change: the playhead is consumed by other UI
  (Timeline, transport). The commit-on-pause/seek step must keep those in sync.
  Mitigation: keep the ref the single source of truth and verify Timeline +
  transport read consistent values after pause/seek/play transitions.
- **C3** dependency narrowing must not drop a dependency that genuinely affects
  the memo output (would produce stale snap targets / durations).

## Testing

There is no test runner in this repo (per CLAUDE.md). Verification is:

1. `npm run build` — must pass with no new type errors.
2. `npm run lint` — no new lint errors.
3. Manual, with the browser performance profiler, before vs. after:
   - Play a compositor clip — React commits should drop from ~60/sec toward ~0;
     video stays smooth.
   - Scrub the `MiniTransport` track — smooth, no update storm.
   - Drag a node on the canvas — no regression; store-notify no longer fires on
     no-op `dragHoverGroupId` transitions.
   - Drag a node in/out of a group — group attach/detach still works (N1 guard
     must not break real `dragHoverGroupId` transitions).
