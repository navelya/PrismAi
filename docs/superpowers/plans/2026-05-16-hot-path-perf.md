# Hot-path Performance Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove felt lag from the node-canvas drag path and the compositor / video player by eliminating high-frequency re-renders triggered by continuous gestures (drag, playback, scrub).

**Architecture:** Five surgical, independent changes. No new modules, no architectural refactor. Each change either adds an equality/throttle guard or hoists an allocation out of a hot path.

**Tech Stack:** Next.js 14, React 18, Zustand 5, React Flow 11, react-konva.

**Spec:** `docs/superpowers/specs/2026-05-16-hot-path-perf-design.md`

**Testing note:** This repo has no test runner (per CLAUDE.md) and user instructions take precedence over the TDD default. Verification for every task is `npm run build` + `npm run lint` + a described manual check. Each task is its own commit.

**Spec deviation (Task 5 / spec item C1):** The spec described keeping the playhead in a ref and writing the scrubber/timecode via direct DOM writes for "zero React commits". On inspection that requires cross-component DOM plumbing (the scrubber lives in `MiniTransport`, a sibling of `LivePreview`, not a child). This plan instead **throttles** the playhead's React commit to 10 Hz while the rAF loop still advances real time every frame. That is a ~6× reduction in re-renders (60/sec → 10/sec) with a ~3-line change and no plumbing. The Konva video frames are still drawn at 60 fps by `Konva.Animation` independently of React. A truly-zero-commit version is a possible follow-up; it is out of scope here.

---

## File Structure

All changes modify existing files. No files are created.

| File | Responsibility | Task |
|---|---|---|
| `components/editor/EditorCanvas.tsx` | React Flow canvas host | 1 |
| `lib/store/slices/ui-slice.ts` | UI Zustand slice (drag-hover group id) | 2 |
| `lib/nodes/plugins/compositor/ui/Renderer.tsx` | Shared Konva layer renderer | 3 |
| `lib/nodes/plugins/compositor/ui/MiniTransport.tsx` | Compositor card transport bar | 4 |
| `lib/nodes/plugins/compositor/component.tsx` | Compositor node card + `LivePreview` | 5 |

---

## Task 1: Hoist `panOnDrag` arrays out of render (spec N2)

**Files:**
- Modify: `components/editor/EditorCanvas.tsx` (module constants near top; JSX at line 828)

`panOnDrag={isPanMode ? [0, 1] : [1]}` allocates a fresh array on every render of `EditorCanvas`. React Flow does reference-equality checks on this prop, so a new array each render makes it re-initialize pointer bindings. Hoisting the two possible values to module scope makes the prop reference-stable.

- [ ] **Step 1: Add module-scope constants**

Add these next to the existing module constants in `EditorCanvas.tsx` (the file already declares `DEFAULT_VIEWPORT`, `FIT_VIEW_OPTIONS`, `PRO_OPTIONS` at module scope — put these immediately after them):

```typescript
// Hoisted so the panOnDrag prop is reference-stable across renders — React
// Flow re-binds pointer handlers when this prop changes identity.
const PAN_ON_DRAG_PAN: number[] = [0, 1];
const PAN_ON_DRAG_SELECT: number[] = [1];
```

- [ ] **Step 2: Use the constants in the `<ReactFlow>` JSX**

In `EditorCanvas.tsx` at line 828, replace:

```tsx
                panOnDrag={isPanMode ? [0, 1] : [1]}
```

with:

```tsx
                panOnDrag={isPanMode ? PAN_ON_DRAG_PAN : PAN_ON_DRAG_SELECT}
```

- [ ] **Step 3: Verify the build passes**

Run: `npm run build`
Expected: build completes with no new TypeScript errors.

- [ ] **Step 4: Verify lint passes**

Run: `npm run lint`
Expected: no new lint errors.

- [ ] **Step 5: Manual check**

Run `npm run dev`, open `/editor`, toggle pan mode and confirm: pan-drag works in pan mode; marquee selection works out of pan mode. No behavior change — this is a pure reference-stability fix.

- [ ] **Step 6: Commit**

```bash
git add components/editor/EditorCanvas.tsx
git commit -m "perf(canvas): hoist panOnDrag arrays to module scope

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Guard `setDragHoverGroupId` against no-op updates (spec N1)

**Files:**
- Modify: `lib/store/slices/ui-slice.ts:113`

`handleNodeDrag` (`components/editor/EditorCanvas.tsx:466`) calls `setDragHoverGroupId` on every drag frame. The setter currently does an unconditional `set({ dragHoverGroupId: id })`, so even a no-op transition (`null → null`, the common case when not hovering a group) creates a new root store state and runs Zustand's notify loop over every subscriber 60×/sec. Adding an equality guard makes a no-op call free. This mirrors the guard already used by `setLiveNodePosition` in `lib/store/slices/live-position-slice.ts:9-12`.

- [ ] **Step 1: Add the equality guard**

In `lib/store/slices/ui-slice.ts` at line 113, replace:

```typescript
    setDragHoverGroupId: (id) => set({ dragHoverGroupId: id }),
```

with:

```typescript
    setDragHoverGroupId: (id) => {
        // Drag handlers call this on every frame; skip the store write (and
        // its subscriber-notify loop) when the value is unchanged.
        if (get().dragHoverGroupId === id) return;
        set({ dragHoverGroupId: id });
    },
```

Note: `get` is already the second parameter of this slice's `StateCreator` (it is used earlier in the same file, e.g. line 100 `get().dataTypes`), so no signature change is needed.

- [ ] **Step 2: Verify the build passes**

Run: `npm run build`
Expected: build completes with no new TypeScript errors.

- [ ] **Step 3: Verify lint passes**

Run: `npm run lint`
Expected: no new lint errors.

- [ ] **Step 4: Manual check**

Run `npm run dev`, open `/editor`. Confirm group attach/detach still works:
1. Drag a plain node so it overlaps a group container — the group should highlight as a drop target, and on release the node becomes a child of the group.
2. Drag a child node out of its group — on release it detaches.
Both rely on real `dragHoverGroupId` transitions, which the guard still allows; only no-op (`null → null`) repeats are skipped.

- [ ] **Step 5: Commit**

```bash
git add lib/store/slices/ui-slice.ts
git commit -m "perf(store): skip no-op setDragHoverGroupId writes during drag

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Memoize `hasVideo` in the Konva renderer (spec C3)

**Files:**
- Modify: `lib/nodes/plugins/compositor/ui/Renderer.tsx:506-513`

`CompositorLayerNodes` recomputes `hasVideo` inline on every render — a `.some()` loop that calls `detectSourceKindFromUrl()` (string matching) per layer. The component re-renders whenever its `playhead` prop changes, so this loop runs on every playback/scrub update even though `layers` has not changed. Wrapping it in `useMemo` keyed on `layers` makes it recompute only when the layer set actually changes.

- [ ] **Step 1: Wrap `hasVideo` in `useMemo`**

In `lib/nodes/plugins/compositor/ui/Renderer.tsx`, replace lines 506-513:

```typescript
    const hasVideo = layers.some(({ layer, resolved }) => {
        if (!layer.visible) return false;
        const url =
            resolved && typeof resolved === 'object' && typeof (resolved as any).url === 'string'
                ? ((resolved as any).url as string)
                : null;
        return !!(url && detectSourceKindFromUrl(url) === 'video');
    });
```

with:

```typescript
    const hasVideo = useMemo(
        () =>
            layers.some(({ layer, resolved }) => {
                if (!layer.visible) return false;
                const url =
                    resolved && typeof resolved === 'object' && typeof (resolved as any).url === 'string'
                        ? ((resolved as any).url as string)
                        : null;
                return !!(url && detectSourceKindFromUrl(url) === 'video');
            }),
        [layers],
    );
```

`useMemo` is already imported in this file (line 19: `import React, { memo, useEffect, useMemo, useRef, useState } from 'react';`) — no import change needed.

- [ ] **Step 2: Verify the build passes**

Run: `npm run build`
Expected: build completes with no new TypeScript errors.

- [ ] **Step 3: Verify lint passes**

Run: `npm run lint`
Expected: no new lint errors (in particular, no `react-hooks/exhaustive-deps` warning — `layers` is the only dependency).

- [ ] **Step 4: Manual check**

Run `npm run dev`, open `/editor`, add a compositor node with a video layer. Confirm the video still renders and animates in the card preview (the `CompositorAnimator` mounts only when `hasVideo` is true; a wrong memo would stop the video drawing).

- [ ] **Step 5: Commit**

```bash
git add lib/nodes/plugins/compositor/ui/Renderer.tsx
git commit -m "perf(compositor): memoize hasVideo detection in layer renderer

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Coalesce `MiniTransport` scrub updates to one per frame (spec C2)

**Files:**
- Modify: `lib/nodes/plugins/compositor/ui/MiniTransport.tsx:42-71`

The scrub track fires `onSeek` on every `pointermove` event (`MiniTransport.tsx:59-63`). Each `onSeek` triggers `setCardPlayhead` in the parent, re-rendering the whole compositor card preview. Pointer events can fire faster than the display refreshes. Coalescing the latest pointer position into a single `requestAnimationFrame` callback caps it at one `onSeek` per frame.

- [ ] **Step 1: Replace `seekFromClientX` with a frame-coalesced version**

In `lib/nodes/plugins/compositor/ui/MiniTransport.tsx`, replace lines 42-71 (the `seekFromClientX` callback, `onPointerDown` callback, and the `useEffect` with the pointer listeners):

```typescript
    const seekFromClientX = useCallback((clientX: number) => {
        const el = trackRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
        onSeek(ratio * totalDuration);
    }, [onSeek, totalDuration]);

    const onPointerDown = useCallback((e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        draggingRef.current = true;
        seekFromClientX(e.clientX);
    }, [seekFromClientX]);

    useEffect(() => {
        const onMoveEvt = (e: PointerEvent) => {
            if (!draggingRef.current) return;
            e.preventDefault();
            seekFromClientX(e.clientX);
        };
        const onUp = () => { draggingRef.current = false; };
        window.addEventListener('pointermove', onMoveEvt);
        window.addEventListener('pointerup', onUp);
        return () => {
            window.removeEventListener('pointermove', onMoveEvt);
            window.removeEventListener('pointerup', onUp);
        };
    }, [seekFromClientX]);
```

with:

```typescript
    // Scrub coalescing: pointermove can fire faster than the display refresh.
    // We buffer the latest X and flush exactly one onSeek per animation frame.
    const pendingXRef = useRef<number | null>(null);
    const rafRef = useRef<number | null>(null);

    const flushSeek = useCallback(() => {
        rafRef.current = null;
        const clientX = pendingXRef.current;
        pendingXRef.current = null;
        if (clientX === null) return;
        const el = trackRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
        onSeek(ratio * totalDuration);
    }, [onSeek, totalDuration]);

    const scheduleSeek = useCallback((clientX: number) => {
        pendingXRef.current = clientX;
        if (rafRef.current === null) {
            rafRef.current = requestAnimationFrame(flushSeek);
        }
    }, [flushSeek]);

    const onPointerDown = useCallback((e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        draggingRef.current = true;
        scheduleSeek(e.clientX);
    }, [scheduleSeek]);

    useEffect(() => {
        const onMoveEvt = (e: PointerEvent) => {
            if (!draggingRef.current) return;
            e.preventDefault();
            scheduleSeek(e.clientX);
        };
        const onUp = () => {
            draggingRef.current = false;
            // Make sure the final pointer position is committed even if it
            // arrived between frames.
            if (pendingXRef.current !== null) flushSeek();
        };
        window.addEventListener('pointermove', onMoveEvt);
        window.addEventListener('pointerup', onUp);
        return () => {
            window.removeEventListener('pointermove', onMoveEvt);
            window.removeEventListener('pointerup', onUp);
            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }
        };
    }, [scheduleSeek, flushSeek]);
```

`useRef`, `useCallback`, and `useEffect` are all already imported in this file (line 3: `import React, { memo, useCallback, useEffect, useRef } from 'react';`) — no import change needed.

- [ ] **Step 2: Verify the build passes**

Run: `npm run build`
Expected: build completes with no new TypeScript errors.

- [ ] **Step 3: Verify lint passes**

Run: `npm run lint`
Expected: no new lint errors.

- [ ] **Step 4: Manual check**

Run `npm run dev`, open `/editor`, add a compositor node with a video layer. Drag the scrub track in the card's `MiniTransport`:
- The playhead/preview follows the drag smoothly.
- Releasing the pointer leaves the playhead exactly at the release position (the `onUp` flush handles a between-frames final move).
- Step-back / step-forward / play / mute buttons still work (they call `onSeek`/`onTogglePlay` directly and are untouched).

- [ ] **Step 5: Commit**

```bash
git add lib/nodes/plugins/compositor/ui/MiniTransport.tsx
git commit -m "perf(compositor): coalesce MiniTransport scrub to one seek per frame

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Throttle the `LivePreview` playhead React commit (spec C1)

**Files:**
- Modify: `lib/nodes/plugins/compositor/component.tsx:124-140`

`LivePreview`'s `requestAnimationFrame` loop calls `onPlayheadChange` (wired to the parent card's `setCardPlayhead`) every frame — ~60 React state updates/sec, each re-rendering `LivePreview`, the Konva `<Stage>`, and `<MiniTransport>`. The video frames themselves are drawn independently at 60 fps by `Konva.Animation` (`Renderer.tsx:461-484`), so React does not need to re-render for playback to look correct — the React playhead is only consumed for activity gating (clip appear/disappear at time-window boundaries) and the scrubber/timecode display.

This task keeps an internal accumulator advancing every frame but samples it into React state at 10 Hz. Re-renders drop ~6×; activity-gating latency becomes ≤100 ms (imperceptible for a card preview); video stays smooth.

**Important:** the current loop does `next = playheadRef.current + dt`, where `playheadRef` tracks the `playhead` *prop*. Once the commit is throttled the prop no longer updates every frame, so the loop must accumulate into a **local** variable instead of reading the prop ref each frame — otherwise time stops advancing between commits.

- [ ] **Step 1: Rewrite the rAF loop to accumulate locally and commit throttled**

In `lib/nodes/plugins/compositor/component.tsx`, replace lines 124-140:

```typescript
    const playheadRef = useRef(playhead);
    playheadRef.current = playhead;
    useEffect(() => {
        if (!isPlaying) return;
        if (totalDuration <= 0) return;
        let raf: number | null = null;
        let last = performance.now();
        const tick = (now: number) => {
            const dt = (now - last) / 1000;
            last = now;
            const next = playheadRef.current + dt;
            onPlayheadChange(next >= totalDuration ? 0 : next);
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => { if (raf !== null) cancelAnimationFrame(raf); };
    }, [isPlaying, totalDuration, onPlayheadChange]);
```

with:

```typescript
    const playheadRef = useRef(playhead);
    playheadRef.current = playhead;
    useEffect(() => {
        if (!isPlaying) return;
        if (totalDuration <= 0) return;
        let raf: number | null = null;
        let last = performance.now();
        // The accumulator advances every frame so playback timing stays
        // exact. We only push it into React state every THROTTLE_MS — the
        // Konva <Stage> redraws video frames itself via Konva.Animation, so
        // a 60Hz React commit was pure waste. 10Hz keeps activity gating
        // (clip appear/disappear) within 100ms, which is imperceptible.
        const THROTTLE_MS = 100;
        let live = playheadRef.current;
        let lastCommit = last;
        const tick = (now: number) => {
            const dt = (now - last) / 1000;
            last = now;
            live += dt;
            if (live >= totalDuration) live = 0;
            if (now - lastCommit >= THROTTLE_MS) {
                lastCommit = now;
                onPlayheadChange(live);
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => {
            if (raf !== null) cancelAnimationFrame(raf);
            // Commit the final position so React state matches where
            // playback actually stopped (otherwise the preview can freeze up
            // to THROTTLE_MS behind the real playhead on pause).
            onPlayheadChange(live);
        };
    }, [isPlaying, totalDuration, onPlayheadChange]);
```

- [ ] **Step 2: Verify the build passes**

Run: `npm run build`
Expected: build completes with no new TypeScript errors.

- [ ] **Step 3: Verify lint passes**

Run: `npm run lint`
Expected: no new lint errors.

- [ ] **Step 4: Manual check — correctness**

Run `npm run dev`, open `/editor`, add a compositor node with a video layer.
1. Press play in the card's `MiniTransport`. The video plays smoothly; the scrubber advances (in ~100 ms steps — expected).
2. The playhead loops back to 0 at the end of the timeline.
3. Press pause. The preview freezes at the current frame (the cleanup commit keeps React state in sync — no visible snap-back).
4. If the compositor has two clips at different `startTime`s, each clip still appears/disappears as the playhead crosses its window (within ~100 ms).

- [ ] **Step 5: Manual check — performance**

With the React DevTools Profiler (or the browser Performance panel) recording, play a video clip for a few seconds.
Expected: `CompositorNode` / `LivePreview` React commits drop from ~60/sec to ~10/sec. Video playback itself stays at full frame rate (Konva.Animation is unaffected).

- [ ] **Step 6: Commit**

```bash
git add lib/nodes/plugins/compositor/component.tsx
git commit -m "perf(compositor): throttle LivePreview playhead commits to 10Hz

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- C1 (playhead re-render storm) → Task 5. Implemented as a 10 Hz throttle; deviation from the spec's "direct DOM write" documented in the header above and in the Task 5 intro.
- C2 (scrub fires per pointermove) → Task 4.
- C3 (over-broad memo deps) → Task 3. Scope corrected: the spec also named `snapTargetsByLayerId` and the Timeline clip-row duration calc; inspection showed `snapTargetsByLayerId` is already correctly memoized (deps `[layers, sourceKindByLayerId, intrinsicDurations, total]`, none of which is `playhead`) and the clip-row calc is negligible arithmetic. Only the genuine issue (`hasVideo`) is in scope. This narrowing is intentional and consistent with the spec's "hot-path only" mandate.
- N1 (per-frame store notify) → Task 2.
- N2 (inline `panOnDrag` array) → Task 1.

All spec change items map to a task. No gaps.

**Placeholder scan:** No `TBD`/`TODO`/"handle edge cases"/"similar to Task N". Every code step shows complete code.

**Type consistency:** No new types or signatures are introduced. `setDragHoverGroupId` keeps its existing `(id: string | null) => void` signature. `onPlayheadChange`, `onSeek`, `onTotalDurationChange` are used exactly as already typed in their components.
