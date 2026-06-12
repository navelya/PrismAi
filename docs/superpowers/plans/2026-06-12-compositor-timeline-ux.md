# Compositor Timeline UX Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the compositor timeline closer to a real NLE: trim from the start (true trim-in), split a clip into two clips on the same row (blade), a gentler playhead, a zoom slider, and a drag-resizable timeline height.

**Architecture:** "Layers-as-clips" — a *clip* is one `CompositorLayer`; a *row* is all layers sharing one `sourceHandleId`. Splitting clones a layer (same `sourceHandleId`, new `id`) into two contiguous entries. The existing per-layer renderer/executor and the store's edge-sync (which drops all layers for a removed edge) already tolerate multiple layers per edge, so no data-model rewrite or migration is needed. Session-only view state for zoom + timeline height.

**Tech Stack:** Next.js, React, Zustand store, Konva (canvas render), ffmpeg (server render via filter graphs), Radix UI (context menu), Tailwind.

---

## Testing note (read first)

This repo has **no test runner** (see CLAUDE.md) and `npm run lint` / `next build` are unreliable here — **verify every task with `npx tsc --noEmit`** (memory: [verification-commands]). The one genuinely pure function (`splitLayerAtPlayhead`) gets an ad-hoc `node` script under `scripts/` matching the repo's integration-script convention. All UI tasks are verified with `npx tsc --noEmit` plus the explicit manual E2E steps listed in **Task 8**.

`crypto.randomUUID()` is the repo's id generator (`lib/utils.ts`). Do **not** use `Math.random()`/`Date.now()` for ids.

---

## File structure

| File | Responsibility | Change |
|------|----------------|--------|
| `lib/nodes/plugins/compositor/shared.ts` | Pure timeline/layer helpers | **Add** `splitLayerAtPlayhead`, `getSourceSeekTime` |
| `lib/nodes/plugins/compositor/ui/Renderer.tsx` | Konva preview render loop | Honor `trimIn` in video `localTime` |
| `lib/nodes/plugins/compositor/ui/CompositorAudio.tsx` | Headless audio preview | Honor `trimIn` in seek; gate on finite `duration` |
| `lib/nodes/plugins/compositor/executor.server.ts` | ffmpeg server render | Honor `trimIn` in `trim`/`atrim`; add `trimIn` to `ProcessedLayer` |
| `lib/nodes/plugins/compositor/ui/ClipBlock.tsx` | One clip block + drag | **Add** left trim-in handle (`trim-start` kind), `onTrimStart` |
| `lib/nodes/plugins/compositor/ui/Timeline.tsx` | Timeline panel | Row grouping by `sourceHandleId`, per-row toggles, Radix clip/row context menus, zoom slider + `pixelsPerSecond` state, gentler playhead |
| `lib/nodes/plugins/compositor/ui/EditorModal.tsx` | Editor host | `handleSplitLayer` / `handleDeleteClip` / `handleToggleRow` / `handleTrimStart`; resizable timeline height; thread new props |
| `scripts/check-split-layer.js` | Ad-hoc verification of split math | **Create** |

**No change needed** in `lib/store/slices/workflow-slice.ts`: its edge-sync already keeps/drops layers by matching `sourceHandleId` (`workflow-slice.ts:659`), so "remove edge → all clips on that row vanish" works for free, and a persisting edge keeps all its clips.

---

## Task 1: Engine honors `trimIn` (preview + server)

Foundation — do this BEFORE the UI that produces `trimIn`, so a trimmed clip renders identically in preview and final output. Today `trimIn` is only read to clamp resize (`Timeline.tsx:327`); preview and server ignore it.

**Files:**
- Modify: `lib/nodes/plugins/compositor/ui/Renderer.tsx:964-967`
- Modify: `lib/nodes/plugins/compositor/ui/CompositorAudio.tsx:124-153`
- Modify: `lib/nodes/plugins/compositor/executor.server.ts` (interface + 3 construction sites + 2 filter lines)

- [ ] **Step 1: Preview video — offset the source seek by `trimIn`**

In `Renderer.tsx`, the video branch computes the source seek time. Change `localTime` so the pooled `<video>` seeks to `playhead − startTime + trimIn` (activity gating stays timeline-space and is untouched — it's computed separately via `isLayerActiveAt` at line 915).

Replace lines 964-967:

```tsx
                    const localTime =
                        typeof playhead === 'number'
                            ? Math.max(0, playhead - (layer.startTime || 0)) + Math.max(0, layer.trimIn || 0)
                            : undefined;
```

- [ ] **Step 2: Preview audio — offset seek by `trimIn`, gate on finite `duration`**

In `CompositorAudio.tsx`, `local` (line 125) is used BOTH for the active-window gate and the seek target. The seek must include `trimIn`; the gate must NOT (it is timeline-space). Also make the gate respect a finite configured `duration` so split/trimmed audio clips stop at their clip end (today it only checks intrinsic length).

Replace lines 124-132:

```tsx
    const start = Math.max(0, layer.startTime || 0);
    const trimIn = Math.max(0, layer.trimIn || 0);
    const local = playhead - start;
    // Active window is timeline-space: a finite configured `duration` wins
    // (set by right-trim or split); else fall back to the source's intrinsic
    // length. `trimIn` shifts only the SOURCE seek, never this gate.
    const withinDuration =
        typeof layer.duration === 'number' && layer.duration > 0
            ? local < layer.duration
            : intrinsicDuration && intrinsicDuration > 0
                ? local < intrinsicDuration
                : true;
    const within = local >= 0 && withinDuration;
    const active = !!layer.visible && within;
    // Mute outside the active window so a clip can't leak sound when the
    // playhead is parked before/after it.
    const effectiveMuted = muted || !active;
```

Then change the seek target at line 140 to add `trimIn`:

```tsx
        const target = Math.max(0, local) + trimIn;
```

And add `layer.duration` to the effect dep array (line 154) so the gate re-evaluates when a split sets a finite duration. Replace `[isPlaying, active, local, effectiveMuted]` with:

```tsx
    }, [isPlaying, active, local, effectiveMuted, trimIn]);
```

(`active` already folds in `local`/`duration`, so adding `trimIn` is sufficient.)

- [ ] **Step 3: Server — add `trimIn` to `ProcessedLayer`**

In `executor.server.ts`, the `ProcessedLayer` interface (around line 385-395) has `startTime: number;`. Add a sibling field:

```ts
    startTime: number;         // seconds
    trimIn: number;            // seconds trimmed from the source's start
```

- [ ] **Step 4: Server — populate `trimIn` at each `ProcessedLayer` construction**

There are three construction sites that set `startTime: Math.max(0, layer.startTime || 0),` (around lines 487, 546, 624). Immediately after each `startTime:` line, add:

```ts
                    trimIn: Math.max(0, layer.trimIn || 0),
```

(Match the exact indentation of the neighboring `startTime:` line at each site.)

- [ ] **Step 5: Server — apply `trimIn` to the video filter**

In the `visual.forEach` block, replace line 740-746. The video/image trim must start at `trimIn` (for image/text `trimIn` is always 0, so `start=0` is a harmless no-op):

```ts
            const idx = processed.indexOf(p);
            const { width: w, height: h } = effTransform(p);
            const eff = p.effectiveDuration;
            const startT = p.startTime;
            const inT = p.trimIn;
            const setpts = `setpts=PTS-STARTPTS+${startT.toFixed(3)}/TB`;

            const layerLabel = `L${idx}`;
            filters.push(
                `[${idx}:v]trim=start=${inT.toFixed(3)}:duration=${eff.toFixed(3)},${setpts},scale=${w}:${h}:flags=bilinear,format=rgba[${layerLabel}]`,
            );
```

- [ ] **Step 6: Server — apply `trimIn` to the audio filter**

Replace the `atrim` push (lines 793-800) so audio also seeks into the source by `trimIn`:

```ts
                audible.forEach(({ p, idx }) => {
                    const startMs = Math.max(0, Math.round(p.startTime * 1000));
                    const delays = new Array(8).fill(startMs).join('|');
                    const label = `A${idx}`;
                    filters.push(
                        `[${idx}:a]atrim=start=${p.trimIn.toFixed(3)}:duration=${p.effectiveDuration.toFixed(3)},asetpts=PTS-STARTPTS,adelay=${delays}[${label}]`,
                    );
                    audioLabels.push(label);
                });
```

- [ ] **Step 7: Verify types**

Run: `npx tsc --noEmit`
Expected: no new errors. (Behavior is verified end-to-end in Task 8 against a trimmed clip — preview and rendered mp4 must match.)

- [ ] **Step 8: Commit**

```bash
git add lib/nodes/plugins/compositor/ui/Renderer.tsx lib/nodes/plugins/compositor/ui/CompositorAudio.tsx lib/nodes/plugins/compositor/executor.server.ts
git commit -m "feat(compositor): honor layer trimIn in preview + server render"
```

---

## Task 2: `splitLayerAtPlayhead` + `getSourceSeekTime` helpers

**Files:**
- Modify: `lib/nodes/plugins/compositor/shared.ts` (append near `getEffectiveDuration`)
- Create: `scripts/check-split-layer.js`

- [ ] **Step 1: Add the helpers to `shared.ts`**

Append after `getEffectiveDuration` (after line 153). `splitLayerAtPlayhead` returns `[left, right]` when the playhead is strictly inside the clip, else `[layer, null]`. Both halves get a concrete finite `duration` (even if the source was `null`-duration), and the right half's `trimIn` advances by the left half's length so its source content stays time-locked.

```ts
/**
 * Source-relative seek time for a layer at a given timeline time.
 * `trimIn` shifts the source forward; activity gating is separate (timeline
 * space). Shared so preview (Renderer/CompositorAudio) and any future caller
 * agree on the mapping.
 */
export function getSourceSeekTime(layer: CompositorLayer, timelineTime: number): number {
    const local = Math.max(0, timelineTime - Math.max(0, layer.startTime || 0));
    return local + Math.max(0, layer.trimIn || 0);
}

/** Minimum clip length (seconds) — prevents zero/negative-width splits. */
export const MIN_CLIP_DURATION = 0.05;

/**
 * Split one layer into two contiguous clips at the playhead (blade cut).
 *
 * - The left clip keeps `startTime`/`trimIn`, gets a finite `duration` up to
 *   the playhead.
 * - The right clip gets a fresh `id`, starts at the playhead, advances
 *   `trimIn` by the left length (so its source content is time-locked), and
 *   gets the remaining duration.
 *
 * Returns `[left, null]` (no split) when the playhead is not strictly inside
 * `(startTime, startTime + effectiveDuration)`. Caller passes the resolved
 * effective duration (handles `null`-duration image/video uniformly).
 */
export function splitLayerAtPlayhead(
    layer: CompositorLayer,
    playhead: number,
    effectiveDuration: number,
): [CompositorLayer, CompositorLayer | null] {
    const start = Math.max(0, layer.startTime || 0);
    const end = start + effectiveDuration;
    if (playhead <= start + MIN_CLIP_DURATION || playhead >= end - MIN_CLIP_DURATION) {
        return [layer, null];
    }
    const leftDur = playhead - start;
    const rightDur = end - playhead;
    const left: CompositorLayer = { ...layer, duration: leftDur };
    const right: CompositorLayer = {
        ...layer,
        id: `layer_${crypto.randomUUID()}`,
        startTime: playhead,
        duration: rightDur,
        trimIn: Math.max(0, layer.trimIn || 0) + leftDur,
    };
    return [left, right];
}
```

- [ ] **Step 2: Write the ad-hoc verification script**

Create `scripts/check-split-layer.js`. This repo runs ad-hoc scripts with `node` (CLAUDE.md). Inline the split math (the script can't import the TS module without a build) and assert the invariants: contiguity, conserved total duration, advanced trimIn, distinct id, and the no-op-outside case.

```js
// Ad-hoc check for splitLayerAtPlayhead invariants. Run: node scripts/check-split-layer.js
// Mirrors lib/nodes/plugins/compositor/shared.ts:splitLayerAtPlayhead.
const MIN = 0.05;
function split(layer, playhead, eff) {
  const start = Math.max(0, layer.startTime || 0);
  const end = start + eff;
  if (playhead <= start + MIN || playhead >= end - MIN) return [layer, null];
  const leftDur = playhead - start;
  const rightDur = end - playhead;
  const left = { ...layer, duration: leftDur };
  const right = { ...layer, id: 'layer_NEW', startTime: playhead, duration: rightDur, trimIn: (layer.trimIn || 0) + leftDur };
  return [left, right];
}
function assert(cond, msg) { if (!cond) { console.error('FAIL:', msg); process.exit(1); } }

// Video clip: start=2, trimIn=1, eff=6 (source window [1,7)), split at t=5.
const base = { id: 'L1', startTime: 2, trimIn: 1, duration: 6 };
const [l, r] = split(base, 5, 6);
assert(r !== null, 'should split inside');
assert(Math.abs(l.duration - 3) < 1e-9, 'left duration = playhead - start = 3');
assert(Math.abs(r.startTime - 5) < 1e-9, 'right starts at playhead');
assert(Math.abs(r.duration - 3) < 1e-9, 'right duration = 3');
assert(Math.abs((l.duration + r.duration) - 6) < 1e-9, 'durations conserved = eff');
assert(Math.abs(r.trimIn - 4) < 1e-9, 'right trimIn = 1 + 3 = 4 (time-locked source)');
assert(r.id !== l.id, 'right has a fresh id');
assert(Math.abs(l.startTime - 2) < 1e-9, 'left start unchanged');

// Playhead outside (before) → no split.
assert(split(base, 2.01, 6)[1] === null, 'no split just after start');
// Playhead outside (after) → no split.
assert(split(base, 7.99, 6)[1] === null, 'no split just before end');

console.log('OK: splitLayerAtPlayhead invariants hold');
```

- [ ] **Step 3: Run the script**

Run: `node scripts/check-split-layer.js`
Expected: `OK: splitLayerAtPlayhead invariants hold`

- [ ] **Step 4: Verify types**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add lib/nodes/plugins/compositor/shared.ts scripts/check-split-layer.js
git commit -m "feat(compositor): splitLayerAtPlayhead + getSourceSeekTime helpers"
```

---

## Task 3: EditorModal handlers (split / delete-clip / per-row toggle / trim-start)

Add the logic layer first. These compile and are correct on their own; Task 5 surfaces them via the Timeline UI. `handleUpdateLayer` and `deleteSelectedLayer` already exist; reuse `updateLayers` (the store-fresh mutation helper at `EditorModal.tsx:275`).

**Files:**
- Modify: `lib/nodes/plugins/compositor/ui/EditorModal.tsx` (new imports + handlers near `handleUpdateLayer` at line 734; new state near other view state)

- [ ] **Step 1: Import the new helpers + types**

Find the import of `shared` helpers in `EditorModal.tsx` (it already imports from `'../shared'`). Add `splitLayerAtPlayhead`, `computeTimelineDuration`, and `getEffectiveDuration` to that import if not already present. Example (merge into the existing line — do not duplicate names already imported):

```ts
import {
    splitLayerAtPlayhead,
    computeTimelineDuration,
    getEffectiveDuration,
    // ...existing imports from '../shared'
} from '../shared';
```

- [ ] **Step 2: Add the split handler**

Insert directly after `handleUpdateLayer` (after line 736). It reads fresh config, resolves the clip's effective duration, splits at the current `playhead`, and replaces the layer in place with the two halves (contiguity invariant).

```ts
    /** Blade-cut the clip at the current playhead into two clips on the same row. */
    const handleSplitLayer = useCallback((layerId: string) => {
        const node = useAppStore.getState().currentWorkflow?.nodes.find((n) => n.id === nodeId);
        const cfg = (node?.data?.config as CompositorConfig) || initialConfig;
        const list = cfg.layers || [];
        const layer = list.find((l) => l.id === layerId);
        if (!layer) return;
        const kind = sourceKindByLayerId[layerId] ?? 'unknown';
        const intrinsic = intrinsicDurations[layerId] ?? null;
        const total = computeTimelineDuration(list, cfg.timelineDuration ?? null, intrinsicDurations);
        const eff = getEffectiveDuration(layer, kind, intrinsic, total);
        const [left, right] = splitLayerAtPlayhead(layer, playhead, eff);
        if (!right) return; // playhead outside the clip — nothing to cut
        updateLayers((prev) => {
            const i = prev.findIndex((l) => l.id === layerId);
            if (i < 0) return prev;
            const copy = [...prev];
            copy.splice(i, 1, left, right);
            return copy;
        });
    }, [nodeId, initialConfig, sourceKindByLayerId, intrinsicDurations, playhead, updateLayers]);
```

- [ ] **Step 3: Add the per-clip delete handler (row removed only when last clip goes)**

```ts
    /**
     * Delete a single clip. If other clips still share its source row, drop
     * just this layer (the edge/connection survives). If it is the LAST clip
     * on the row, remove the edge — the store cascade drops the layer and the
     * "row" disappears entirely (the "remove only when row completely deleted"
     * rule).
     */
    const handleDeleteClip = useCallback((layerId: string) => {
        const node = useAppStore.getState().currentWorkflow?.nodes.find((n) => n.id === nodeId);
        const cfg = (node?.data?.config as CompositorConfig) || initialConfig;
        const list = cfg.layers || [];
        const layer = list.find((l) => l.id === layerId);
        if (!layer) return;
        const siblings = list.filter((l) => l.sourceHandleId === layer.sourceHandleId);
        if (siblings.length > 1) {
            updateLayers((prev) => prev.filter((l) => l.id !== layerId));
            setSelectedLayerIds((prev) => prev.filter((id) => id !== layerId));
        } else {
            deleteSelectedLayer(layerId); // removes the edge; store strips the layer
        }
    }, [nodeId, initialConfig, updateLayers, deleteSelectedLayer]);
```

- [ ] **Step 4: Add the per-row toggle + explicit row-remove handlers**

Visibility / lock / mute apply to **every** clip on the row (all layers sharing the `sourceHandleId`). "Remove row" always drops the edge.

```ts
    /** Toggle a boolean flag across every clip sharing a source row. */
    const handleToggleRow = useCallback((sourceHandleId: string, field: 'visible' | 'locked' | 'muted') => {
        updateLayers((prev) => {
            const rowLayers = prev.filter((l) => l.sourceHandleId === sourceHandleId);
            if (rowLayers.length === 0) return prev;
            // Drive all clips to the negation of the FIRST clip's value, so the
            // row toggles as a unit even if clips drifted out of sync.
            const next = !rowLayers[0][field];
            return prev.map((l) => l.sourceHandleId === sourceHandleId ? { ...l, [field]: next } : l);
        });
    }, [updateLayers]);

    /** Remove an entire row (drops the upstream edge → all its clips). */
    const handleRemoveRow = useCallback((sourceHandleId: string) => {
        useAppStore.getState().onEdgesChange([{ id: sourceHandleId, type: 'remove' } as any]);
        setSelectedLayerIds([]);
    }, []);
```

- [ ] **Step 5: Add the trim-start handler**

The left-trim drag commits three fields atomically.

```ts
    /** Commit a left-edge trim-in (startTime + duration + trimIn move together). */
    const handleTrimStart = useCallback((layerId: string, startTime: number, duration: number, trimIn: number) => {
        handleUpdateLayer(layerId, { startTime, duration, trimIn });
    }, [handleUpdateLayer]);
```

- [ ] **Step 6: Verify types**

Run: `npx tsc --noEmit`
Expected: no new errors. (Handlers are referenced in Task 5; an "unused variable" is acceptable here but tsc does not error on unused `useCallback` results.)

- [ ] **Step 7: Commit**

```bash
git add lib/nodes/plugins/compositor/ui/EditorModal.tsx
git commit -m "feat(compositor): split/delete-clip/per-row/trim-start editor handlers"
```

---

## Task 4: ClipBlock left trim-in handle

Add a left-edge handle mirroring the right one, with a new `trim-start` drag kind. The right edge stays pinned; dragging the left edge moves `startTime`, shrinks `duration`, and (for video/audio) advances `trimIn`. For image/text, `trimIn` stays 0 (no source time) and the clip just grows/shrinks leftward.

**Files:**
- Modify: `lib/nodes/plugins/compositor/ui/ClipBlock.tsx`

- [ ] **Step 1: Extend props + drag state**

Add `onTrimStart`, `onSplit`, `onDelete` to `ClipBlockProps` (after `onResizeRight`, line 25):

```tsx
    onResizeRight: (newDuration: number) => void;
    /** Commit a left-edge trim: new startTime, new duration, new trimIn. */
    onTrimStart: (newStartTime: number, newDuration: number, newTrimIn: number) => void;
```

Destructure `onTrimStart` in the component signature (after `onResizeRight,` at line 81).

Add a ref for it alongside the others (after `onResizeRightRef`, line 98):

```tsx
    const onTrimStartRef = useRef(onTrimStart);
    onTrimStartRef.current = onTrimStart;
    const sourceKindRef = useRef(sourceKind);
    sourceKindRef.current = sourceKind;
```

Widen the `dragRef` kind union and add trim bookkeeping (lines 110-117):

```tsx
    const dragRef = useRef<{
        kind: 'move' | 'resize' | 'trim-start';
        startX: number;
        startTime: number;
        duration: number;
        trimIn: number;
        lastStartTime: number;
        lastDuration: number;
        lastTrimIn: number;
    } | null>(null);
```

- [ ] **Step 2: Capture trimIn at pointer-down and widen the kind param**

Change the `onPointerDown` signature (line 119) to accept the new kind, and populate the new drag fields (replace lines 119-133):

```tsx
    const onPointerDown = useCallback((e: React.PointerEvent, kind: 'move' | 'resize' | 'trim-start') => {
        if (layer.locked) return;
        e.preventDefault();
        e.stopPropagation();
        const target = e.target as HTMLElement;
        target.setPointerCapture?.(e.pointerId);
        const start = Math.max(0, layer.startTime || 0);
        const inT = Math.max(0, layer.trimIn || 0);
        dragRef.current = {
            kind,
            startX: e.clientX,
            startTime: start,
            duration: effectiveDuration,
            trimIn: inT,
            lastStartTime: start,
            lastDuration: effectiveDuration,
            lastTrimIn: inT,
        };
        if (kind === 'move' || kind === 'trim-start') onSelectRef.current?.();
```

- [ ] **Step 3: Handle the `trim-start` branch in `onMoveEvt`**

Inside `onMoveEvt`, after the existing `else` (resize) branch closes at line 188, the structure is `if (move) {...} else {...}`. Restructure to three branches. Replace the whole `if (drag.kind === 'move') { ... } else { ... }` block (lines 147-188) with:

```tsx
            if (drag.kind === 'move') {
                const raw = Math.max(0, drag.startTime + deltaT);
                const trailing = raw + drag.duration;
                const snappedLeading = snap(raw, targets, pps);
                const snappedTrailing = snap(trailing, targets, pps);
                const leadingSnapped = snappedLeading !== raw;
                const trailingSnapped = snappedTrailing !== trailing;
                let finalStart = raw;
                if (leadingSnapped && trailingSnapped) {
                    if (Math.abs(snappedLeading - raw) <= Math.abs(snappedTrailing - trailing)) {
                        finalStart = snappedLeading;
                        activeSnap = snappedLeading;
                    } else {
                        finalStart = Math.max(0, snappedTrailing - drag.duration);
                        activeSnap = snappedTrailing;
                    }
                } else if (leadingSnapped) {
                    finalStart = snappedLeading;
                    activeSnap = snappedLeading;
                } else if (trailingSnapped) {
                    finalStart = Math.max(0, snappedTrailing - drag.duration);
                    activeSnap = snappedTrailing;
                }
                drag.lastStartTime = finalStart;
                node.style.left = `${finalStart * pps}px`;
            } else if (drag.kind === 'trim-start') {
                const MIN = 0.1;
                const rightEdge = drag.startTime + drag.duration; // pinned
                const isAV = sourceKindRef.current === 'video' || sourceKindRef.current === 'audio';
                // Left bound: video/audio can't trim before source 0 (startTime - trimIn);
                // image/text have no source limit (only >= 0).
                const minStart = isAV ? Math.max(0, drag.startTime - drag.trimIn) : 0;
                let rawStart = drag.startTime + deltaT;
                rawStart = Math.min(rawStart, rightEdge - MIN);
                rawStart = Math.max(minStart, rawStart);
                const snapped = snap(rawStart, targets, pps);
                if (snapped !== rawStart && snapped >= minStart && snapped <= rightEdge - MIN) {
                    rawStart = snapped;
                    activeSnap = snapped;
                }
                const newDuration = rightEdge - rawStart;
                const newTrimIn = isAV ? drag.trimIn + (rawStart - drag.startTime) : drag.trimIn;
                drag.lastStartTime = rawStart;
                drag.lastDuration = newDuration;
                drag.lastTrimIn = Math.max(0, newTrimIn);
                node.style.left = `${rawStart * pps}px`;
                node.style.width = `${Math.max(8, newDuration * pps)}px`;
            } else {
                let raw = Math.max(0.1, drag.duration + deltaT);
                if (max !== null) raw = Math.min(raw, max);
                const trailing = drag.startTime + raw;
                const snappedTrailing = snap(trailing, targets, pps);
                let finalDuration = raw;
                if (snappedTrailing !== trailing) {
                    finalDuration = Math.max(0.1, snappedTrailing - drag.startTime);
                    if (max !== null) finalDuration = Math.min(finalDuration, max);
                    activeSnap = snappedTrailing;
                }
                drag.lastDuration = finalDuration;
                node.style.width = `${Math.max(8, finalDuration * pps)}px`;
            }
```

- [ ] **Step 4: Commit the trim on pointer-up**

In `onUp` (lines 200-204), add the `trim-start` commit. Replace the commit block:

```tsx
            if (drag.kind === 'move') {
                onMoveRef.current?.(drag.lastStartTime);
            } else if (drag.kind === 'trim-start') {
                onTrimStartRef.current?.(drag.lastStartTime, drag.lastDuration, drag.lastTrimIn);
            } else {
                onResizeRightRef.current?.(drag.lastDuration);
            }
```

- [ ] **Step 5: Add the left handle element + render the right handle unchanged**

In the returned JSX, add a left handle as a sibling of the existing right handle (after line 232, before the right-handle block). Mirror the right handle's styling on the left edge:

```tsx
            {!layer.locked && (
                <div
                    className="absolute top-0 left-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-white/30 z-10"
                    onPointerDown={(e) => onPointerDown(e, 'trim-start')}
                />
            )}
```

- [ ] **Step 6: Update the `onPointerDown` dependency array**

The handler now reads `layer.trimIn`. Update the dep array (line 209) from `[layer.locked, layer.startTime, effectiveDuration]` to:

```tsx
    }, [layer.locked, layer.startTime, layer.trimIn, effectiveDuration]);
```

- [ ] **Step 7: Verify types**

Run: `npx tsc --noEmit`
Expected: no new errors. (`ClipBlock` now requires `onTrimStart`; Task 5 supplies it. tsc will flag the missing prop at the Timeline call site — that is expected and resolved in Task 5. If running tasks out of order, temporarily pass a no-op.)

- [ ] **Step 8: Commit**

```bash
git add lib/nodes/plugins/compositor/ui/ClipBlock.tsx
git commit -m "feat(compositor): ClipBlock left trim-in handle (true NLE trim)"
```

---

## Task 5: Timeline row grouping + per-row toggles + context menus

Group layers into rows by `sourceHandleId`; render multiple `ClipBlock`s per row; the label column shows one entry per row with per-row toggles; right-click a clip → Split at playhead / Delete clip; right-click a row label → Remove row. Uses Radix `@radix-ui/react-context-menu` (already a dependency).

**Files:**
- Modify: `lib/nodes/plugins/compositor/ui/Timeline.tsx`
- Modify: `lib/nodes/plugins/compositor/ui/EditorModal.tsx` (pass the new props at the `<Timeline>` site, line 1289-1304)

- [ ] **Step 1: Extend `TimelineProps`**

Add the new callbacks (after `onUpdateLayer`, line 28):

```tsx
    onUpdateLayer: (layerId: string, patch: Partial<CompositorLayer>) => void;
    onTrimStart: (layerId: string, startTime: number, duration: number, trimIn: number) => void;
    onSplitLayer: (layerId: string) => void;
    onDeleteClip: (layerId: string) => void;
    onToggleRow: (sourceHandleId: string, field: 'visible' | 'locked' | 'muted') => void;
    onRemoveRow: (sourceHandleId: string) => void;
```

Destructure them in the component signature (after `onUpdateLayer,` at line 74).

- [ ] **Step 2: Import Radix context menu**

Add at the top of `Timeline.tsx` (after line 4):

```tsx
import * as ContextMenu from '@radix-ui/react-context-menu';
import { Scissors, Trash2 } from 'lucide-react';
```

- [ ] **Step 3: Build the row grouping (preserves z-order + contiguity)**

After `displayLayers` (line 83), add a memo that groups the (already reversed) display layers by `sourceHandleId` into ordered rows. Because clips sharing a source are contiguous in `config.layers`, they stay contiguous after the reverse, so each group is a clean run.

```tsx
    // Group display layers into rows by sourceHandleId. One row = all clips
    // fed by the same upstream connection. Order follows displayLayers, so
    // z-order and the contiguity invariant are preserved.
    const rows = useMemo(() => {
        const out: { sourceHandleId: string; layers: CompositorLayer[] }[] = [];
        const indexByHandle = new Map<string, number>();
        for (const layer of displayLayers) {
            const key = layer.sourceHandleId;
            let i = indexByHandle.get(key);
            if (i === undefined) {
                i = out.length;
                indexByHandle.set(key, i);
                out.push({ sourceHandleId: key, layers: [] });
            }
            out[i].layers.push(layer);
        }
        return out;
    }, [displayLayers]);
```

- [ ] **Step 4: Rewrite the label column to render one entry per row**

Replace the label-column map (lines 240-284 — the `displayLayers.map(...)` block inside `labelScrollRef`) so it iterates `rows`. Each row uses its first clip for the name and drives the toggles via `onToggleRow`. A row is "selected" if any of its clips is the selected layer. Right-click the row label → Remove row.

```tsx
                        {rows.map((row) => {
                            const head = row.layers[0];
                            const kind = sourceKindByLayerId[head.id] ?? 'unknown';
                            const rowSelected = row.layers.some((l) => l.id === selectedLayerId);
                            const clipCount = row.layers.length;
                            return (
                                <ContextMenu.Root key={row.sourceHandleId}>
                                    <ContextMenu.Trigger asChild>
                                        <div
                                            className={cn(
                                                'flex items-center gap-1.5 px-2 border-b border-white/[0.03]',
                                                rowSelected && 'bg-white/[0.04]',
                                            )}
                                            style={{ height: ROW_HEIGHT }}
                                            onClick={() => onSelectLayer(head.id)}
                                        >
                                            <Play className="w-3 h-3 text-white/40 flex-shrink-0" />
                                            <span className="text-[11px] text-white/70 truncate flex-1 cursor-default select-none">
                                                {head.name}{clipCount > 1 ? ` (${clipCount})` : ''}
                                            </span>
                                            {(kind === 'video' || kind === 'audio') && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); onToggleRow(row.sourceHandleId, 'muted'); }}
                                                    className="p-0.5 text-white/40 hover:text-white/80 transition-colors"
                                                    title={head.muted ? 'Unmute row' : 'Mute row'}
                                                >
                                                    {head.muted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
                                                </button>
                                            )}
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onToggleRow(row.sourceHandleId, 'visible'); }}
                                                className="p-0.5 text-white/40 hover:text-white/80 transition-colors"
                                                title={head.visible ? 'Hide row' : 'Show row'}
                                            >
                                                {head.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                                            </button>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onToggleRow(row.sourceHandleId, 'locked'); }}
                                                className="p-0.5 text-white/40 hover:text-white/80 transition-colors"
                                                title={head.locked ? 'Unlock row' : 'Lock row'}
                                            >
                                                {head.locked
                                                    ? <Lock className="w-3 h-3 text-amber-500" />
                                                    : <Unlock className="w-3 h-3" />}
                                            </button>
                                        </div>
                                    </ContextMenu.Trigger>
                                    <ContextMenu.Portal>
                                        <ContextMenu.Content className="z-[200] min-w-[160px] rounded-lg border border-white/10 bg-surface-elevated/95 backdrop-blur-md p-1 shadow-xl">
                                            <ContextMenu.Item
                                                onSelect={() => onRemoveRow(row.sourceHandleId)}
                                                className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-white/80 rounded-md cursor-pointer outline-none data-[highlighted]:bg-white/10"
                                            >
                                                <Trash2 className="w-3 h-3" /> Remove row
                                            </ContextMenu.Item>
                                        </ContextMenu.Content>
                                    </ContextMenu.Portal>
                                </ContextMenu.Root>
                            );
                        })}
```

- [ ] **Step 5: Rewrite the clip lane to render rows with multiple clips each**

Replace the clip-rows map (lines 317-360 — the `displayLayers.map(...)` block plus the empty-state) so it iterates `rows`, rendering one row container with every clip in it. Each clip is wrapped in a Radix context menu (Split / Delete). `maxDuration`, `eff`, snap targets are still per-clip.

```tsx
                        {/* Clip rows — one per source row; clips share the row */}
                        <div className="relative">
                            {rows.map((row) => {
                                const rowSelected = row.layers.some((l) => l.id === selectedLayerId);
                                return (
                                    <div
                                        key={row.sourceHandleId}
                                        className={cn(
                                            'relative border-b border-white/[0.03]',
                                            rowSelected && 'bg-white/[0.04]',
                                        )}
                                        style={{ height: ROW_HEIGHT }}
                                    >
                                        {row.layers.map((layer) => {
                                            const kind = sourceKindByLayerId[layer.id] ?? 'unknown';
                                            const intrinsic = intrinsicDurations[layer.id] ?? null;
                                            const eff = getEffectiveDuration(layer, kind, intrinsic, total);
                                            const isSelected = selectedLayerId === layer.id;
                                            const maxDuration = (kind === 'video' || kind === 'audio') && intrinsic !== null
                                                ? Math.max(0.1, intrinsic - (layer.trimIn || 0))
                                                : null;
                                            return (
                                                <ContextMenu.Root key={layer.id}>
                                                    <ContextMenu.Trigger asChild>
                                                        <div className="contents">
                                                            <ClipBlock
                                                                layer={layer}
                                                                sourceKind={kind}
                                                                effectiveDuration={eff}
                                                                pixelsPerSecond={pixelsPerSecond}
                                                                maxDuration={maxDuration}
                                                                isSelected={isSelected}
                                                                onSelect={() => onSelectLayer(layer.id)}
                                                                onMove={(startTime) => onUpdateLayer(layer.id, { startTime })}
                                                                onResizeRight={(duration) => onUpdateLayer(layer.id, { duration })}
                                                                onTrimStart={(startTime, duration, trimIn) => onTrimStart(layer.id, startTime, duration, trimIn)}
                                                                snapTargets={snapTargetsByLayerId[layer.id] || [0]}
                                                                onSnapChange={setActiveSnap}
                                                            />
                                                        </div>
                                                    </ContextMenu.Trigger>
                                                    <ContextMenu.Portal>
                                                        <ContextMenu.Content className="z-[200] min-w-[160px] rounded-lg border border-white/10 bg-surface-elevated/95 backdrop-blur-md p-1 shadow-xl">
                                                            <ContextMenu.Item
                                                                onSelect={() => onSplitLayer(layer.id)}
                                                                className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-white/80 rounded-md cursor-pointer outline-none data-[highlighted]:bg-white/10"
                                                            >
                                                                <Scissors className="w-3 h-3" /> Split at playhead
                                                            </ContextMenu.Item>
                                                            <ContextMenu.Item
                                                                onSelect={() => onDeleteClip(layer.id)}
                                                                className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-white/80 rounded-md cursor-pointer outline-none data-[highlighted]:bg-white/10"
                                                            >
                                                                <Trash2 className="w-3 h-3" /> Delete clip
                                                            </ContextMenu.Item>
                                                        </ContextMenu.Content>
                                                    </ContextMenu.Portal>
                                                </ContextMenu.Root>
                                            );
                                        })}
                                    </div>
                                );
                            })}
                            {rows.length === 0 && (
                                <div className="h-12 flex items-center justify-center text-[10px] text-white/30">
                                    Connect layers to see them on the timeline.
                                </div>
                            )}
                        </div>
```

> Note: `ClipBlock` is absolutely positioned (`absolute top-1 bottom-1` with inline `left`/`width`), so multiple clips in one relative row container lay out at their own `startTime` without overlap concerns. The `div.contents` wrapper lets the Radix Trigger forward the right-click to the clip without adding a layout box.

- [ ] **Step 6: Reference `pixelsPerSecond` (introduced in Task 6) — temporary constant**

This task still uses the module constant. In Step 5 the `ClipBlock` receives `pixelsPerSecond={pixelsPerSecond}`. Until Task 6 promotes it to state, add a local alias right after the `rows` memo so this task compiles standalone:

```tsx
    const pixelsPerSecond = PIXELS_PER_SECOND;
```

(Task 6 deletes this line and replaces it with `useState`.)

- [ ] **Step 7: Pass the new props at the `<Timeline>` call site**

In `EditorModal.tsx` (lines 1289-1304), add the new props to `<Timeline ...>`:

```tsx
                            onUpdateLayer={handleUpdateLayer}
                            onTrimStart={handleTrimStart}
                            onSplitLayer={handleSplitLayer}
                            onDeleteClip={handleDeleteClip}
                            onToggleRow={handleToggleRow}
                            onRemoveRow={handleRemoveRow}
```

- [ ] **Step 8: Verify types**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 9: Commit**

```bash
git add lib/nodes/plugins/compositor/ui/Timeline.tsx lib/nodes/plugins/compositor/ui/EditorModal.tsx
git commit -m "feat(compositor): timeline row grouping, per-row toggles, split/delete context menus"
```

---

## Task 6: Zoom slider + adaptive ruler + gentler playhead

**Files:**
- Modify: `lib/nodes/plugins/compositor/ui/Timeline.tsx`

- [ ] **Step 1: Promote `pixelsPerSecond` to state**

Replace the temporary alias from Task 5 Step 6 (`const pixelsPerSecond = PIXELS_PER_SECOND;`) with zoom state. Keep the `PIXELS_PER_SECOND = 40` constant as the default. Add near the other `useState` hooks (after `activeSnap`, line 127):

```tsx
    // Timeline zoom — pixels per second. Session-only view state (never
    // persisted to node config). Default matches the historical fixed value.
    const [pixelsPerSecond, setPixelsPerSecond] = useState(PIXELS_PER_SECOND);
    const PPS_MIN = 10;
    const PPS_MAX = 120;
```

(Delete the `const pixelsPerSecond = PIXELS_PER_SECOND;` alias line.)

- [ ] **Step 2: Replace every `PIXELS_PER_SECOND` usage in render math with `pixelsPerSecond`**

These references currently use the constant and must use the state value: the scrub conversion (lines 171, 183), `playheadX` (line 207), `totalWidth` (line 208), the ruler tick `left` (line 307). Update each:

```tsx
            const t = Math.max(0, Math.min(rulerLengthSeconds, x / pixelsPerSecond));
```
```tsx
                const x = Math.max(0, Math.min(rulerLengthSeconds * pixelsPerSecond, clientX - rect.left));
```
```tsx
    const playheadX = playhead * pixelsPerSecond;
    const totalWidth = rulerLengthSeconds * pixelsPerSecond;
```
```tsx
                                    style={{ left: t * pixelsPerSecond }}
```

Also add `pixelsPerSecond` to the `startScrub` dependency array (line 205): `[rulerLengthSeconds, onSeek, pixelsPerSecond]`.

And the snap-guide line (line 368): `style={{ left: activeSnap * pixelsPerSecond }}`.

- [ ] **Step 3: Make the ruler tick interval adapt to zoom**

The fixed 5s major tick crowds at high zoom and spreads too thin at low zoom. Replace the `tickMarks` memo (lines 85-90) so the interval keeps a sane minimum pixel gap:

```tsx
    const tickStep = useMemo(() => {
        // Choose the smallest "nice" step whose on-screen gap is >= 48px.
        const NICE = [1, 2, 5, 10, 15, 30, 60, 120, 300];
        const minPx = 48;
        for (const s of NICE) {
            if (s * pixelsPerSecond >= minPx) return s;
        }
        return NICE[NICE.length - 1];
    }, [pixelsPerSecond]);

    const tickMarks = useMemo(() => {
        const marks: number[] = [];
        for (let t = 0; t <= rulerLengthSeconds + tickStep; t += tickStep) marks.push(t);
        return marks;
    }, [rulerLengthSeconds, tickStep]);
```

- [ ] **Step 4: Add the zoom slider to the timeline header**

Mount a compact slider in the `Transport` row area. Add it just below the `<Transport .../>` block (after line 221), as its own thin bar:

```tsx
            <div className="flex items-center gap-2 px-3 py-1 border-b border-white/5 bg-black/20">
                <span className="text-[9px] uppercase tracking-widest text-white/30">Zoom</span>
                <input
                    type="range"
                    min={PPS_MIN}
                    max={PPS_MAX}
                    step={1}
                    value={pixelsPerSecond}
                    onChange={(e) => setPixelsPerSecond(Number(e.target.value))}
                    className="w-40 h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-accent-primary"
                />
                <span className="text-[9px] tabular-nums text-white/40 w-10">{pixelsPerSecond}px/s</span>
            </div>
```

- [ ] **Step 5: Gentler playhead**

Replace the playhead overlay block (lines 376-386). Use a thin neutral line (no `bg-accent-primary`, no glow) and a small flat top grip instead of the chunky accent triangle:

```tsx
                        {/* Playhead — thin neutral line; small flat grip at top.
                            Line is pointer-events-none so clicks pass to clips. */}
                        <div
                            ref={playheadOverlayRef}
                            className="absolute top-0 bottom-0 w-px bg-white/70 pointer-events-none z-20"
                            style={{ left: playheadX }}
                        >
                            <div
                                className="absolute -top-0.5 -left-1 w-2 h-2 rounded-sm bg-white/80 cursor-ew-resize pointer-events-auto"
                                onPointerDown={startScrub}
                            />
                        </div>
```

- [ ] **Step 6: Verify types**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add lib/nodes/plugins/compositor/ui/Timeline.tsx
git commit -m "feat(compositor): timeline zoom slider, adaptive ruler, gentler playhead"
```

---

## Task 7: Drag-resizable timeline height

**Files:**
- Modify: `lib/nodes/plugins/compositor/ui/EditorModal.tsx`

- [ ] **Step 1: Add timeline-height state**

Near the other view-state `useState` calls in `EditorModal` (e.g. by `stageZoom` at line 536), add:

```tsx
    // Timeline panel height — session-only; drag the top border to resize.
    const [timelineHeight, setTimelineHeight] = useState(260);
    const TIMELINE_MIN_H = 140;
    const TIMELINE_MAX_H = 560;
```

- [ ] **Step 2: Add the drag handler**

Add a `useCallback` that drives a pointer drag on the top border. Dragging UP grows the panel (timeline gets taller), so height increases as `clientY` decreases.

```tsx
    const startTimelineResize = useCallback((e: React.PointerEvent) => {
        e.preventDefault();
        const startY = e.clientY;
        const startH = timelineHeight;
        const onMove = (ev: PointerEvent) => {
            const next = Math.max(TIMELINE_MIN_H, Math.min(TIMELINE_MAX_H, startH + (startY - ev.clientY)));
            setTimelineHeight(next);
        };
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }, [timelineHeight]);
```

- [ ] **Step 3: Apply the height + add the drag handle**

Replace the timeline container (line 1288, `<div className="h-[260px] flex-shrink-0 border-t border-white/10">`) with an inline-height version plus a thin grab handle on its top border:

```tsx
                    <div
                        className="flex-shrink-0 border-t border-white/10 relative"
                        style={{ height: timelineHeight }}
                    >
                        <div
                            className="absolute -top-1 left-0 right-0 h-2 cursor-ns-resize z-30 group"
                            onPointerDown={startTimelineResize}
                            title="Drag to resize timeline"
                        >
                            <div className="absolute top-1 left-0 right-0 h-px bg-transparent group-hover:bg-accent-primary/60 transition-colors" />
                        </div>
                        <Timeline
```

Then ensure the closing of this `<div>` (currently at line 1305-1306) still matches — the `<Timeline ... />` and its wrapper close unchanged; only the opening wrapper `<div>` changed.

- [ ] **Step 4: Verify types**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add lib/nodes/plugins/compositor/ui/EditorModal.tsx
git commit -m "feat(compositor): drag-resizable timeline height"
```

---

## Task 8: End-to-end manual verification

No automated UI tests exist in this repo. Verify behavior by running the app and exercising the compositor editor.

- [ ] **Step 1: Type-check the whole change**

Run: `npx tsc --noEmit`
Expected: clean (no new errors).

- [ ] **Step 2: Start the app**

Run: `npm run dev`
Open a workflow, add a `compositor`, connect at least one **video** input and one **audio** input, and open the editor modal.

- [ ] **Step 3: Verify split + per-row model (feature 1)**

  - Move the playhead into the middle of the video clip, right-click it → **Split at playhead**. Confirm **two clips appear on the same row**, meeting exactly at the playhead, with no gap/overlap.
  - Confirm the right clip's content is **time-locked** (scrub across the cut — the frame is continuous, not jumping back to source start). This validates Task 1 trim-in + Task 2 split math together.
  - Right-click the **first** clip → **Delete clip**. Confirm the other clip and the **connection/edge remain** (row still present, source still wired).
  - Delete the remaining clip → confirm the **row disappears AND the input edge is removed** (the "remove only when row completely deleted" rule).

- [ ] **Step 4: Verify left trim-in (feature 1)**

  - On a video clip, drag the **left** edge to the right. Confirm the clip's left edge moves in, the right edge stays pinned, and the **revealed content starts later in the source** (earlier frames are hidden), staying time-locked. Drag it back left and confirm you can't trim before the source's start.
  - On an **image/text** clip, drag the left edge — confirm it just moves the start (no source limit, no errors).

- [ ] **Step 5: Verify render parity (feature 1)**

  - With a trimmed/split video clip, **Run** the compositor (or Download). Confirm the rendered mp4 matches the preview (same in-points, same cut). This validates the Task 1 server ffmpeg `trim=start`/`atrim=start` changes against the preview.

- [ ] **Step 6: Verify playhead, zoom, height (features 2-4)**

  - Playhead is now a **thin neutral line with a small flat grip** — no neon/glow.
  - Drag the **Zoom** slider — clips and ruler expand/contract within the same panel width; ruler tick labels stay readable (no crowding) at both extremes.
  - Drag the timeline's **top border** up/down — the panel grows/shrinks between its min/max; the canvas above reflows.

- [ ] **Step 7: Regression sanity**

  - A compositor with only image/text layers (no transport) still opens and renders.
  - Existing saved workflows load unchanged (no migration; `trimIn` defaults to 0 → identical behavior to before).
  - Per-row mute/hide/lock toggles affect **all** clips on the row.

- [ ] **Step 8: Final commit (if any tweaks were needed)**

```bash
git add -A
git commit -m "test(compositor): manual E2E pass for timeline UX overhaul"
```

---

## Self-review notes

- **Spec coverage:** (1) trim-from-start → Task 4; split → Tasks 2+3+5; per-row delete rule → Task 3; trim-in render honesty → Task 1. (2) gentler playhead → Task 6 Step 5. (3) zoom slider → Task 6. (4) resizable height → Task 7. All four spec features mapped.
- **Type consistency:** `onTrimStart(startTime, duration, trimIn)` signature is identical across ClipBlock (Task 4), Timeline prop (Task 5), and EditorModal `handleTrimStart` (Task 3). `splitLayerAtPlayhead` returns `[CompositorLayer, CompositorLayer | null]` in both definition (Task 2) and consumer (Task 3). Per-row field union `'visible' | 'locked' | 'muted'` matches between `handleToggleRow` (Task 3) and `onToggleRow` (Task 5).
- **Ordering:** Task 1 (engine) precedes any UI that produces `trimIn`, so trimmed clips never render inconsistently. Task 4 introduces a required `ClipBlock` prop resolved in Task 5 (flagged in Task 4 Step 7). Task 5's temporary `pixelsPerSecond` alias is replaced by Task 6's state (flagged in both).
- **No migration / no store change:** verified `workflow-slice.ts:659` already drops layers by `sourceHandleId`, and `crypto.randomUUID()` gives split clips unique ids while sharing the source's `sourceHandleId`.
