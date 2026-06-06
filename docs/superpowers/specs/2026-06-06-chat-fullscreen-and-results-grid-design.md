# Chat fullscreen shell + 4-up results grid + expected-count skeletons

**Date:** 2026-06-06
**Status:** Approved — implementing on `main`

## Problem

Three connected gaps in the in-session AI chat:

1. **Fullscreen is shallow.** Clicking the chat's fullscreen toggle only widens the
   floating chat panel; the compact floating sidebar overlay stays. It does not look
   like the roomy new-chat (`/chat`) page the user expects.
2. **Results stack vertically.** A run that produces several images renders them in a
   single vertical column ([RunMediaGallery](../../../components/chat/RunMediaGallery.tsx)),
   which wastes horizontal space and reads poorly for multi-output runs.
3. **Skeletons are a guess.** While a run is in flight the inline skeleton count is
   `Math.min(2, terminalIds.length)` — unrelated to how many images the run will
   actually emit (which depends on per-node `iterations`).

## Goals

- Fullscreen reuses the **empty-page shell**: regular **docked** sidebar filling the
  page, chat centered in the remaining region. Minimize animates smoothly back to the
  floating canvas-side panel.
- Fullscreen chat content is **wider** (`max-w-5xl` ≈ 1024px, up from `max-w-3xl`).
- Results render in a **4-column grid**, wrapping to rows of 4. In narrow views the 4
  columns keep a minimum tile width and the row **scrolls sideways**.
- Skeletons reflect the **real expected output count** (iteration-aware) and use the
  same 4-up grid.

## Decisions (from brainstorming)

- Fullscreen target: **reuse empty-page shell** (docked sidebar, full page).
- Grid scope: **everywhere** (narrow canvas panel scrolls sideways; fullscreen grows).
- Overflow: **wrap into rows of 4**.
- Fullscreen content width: **~1024px (`max-w-5xl`)**.

## Design

### 1. Fullscreen = empty-page shell

- **`AppLayout.tsx`** — sidebar variant becomes
  `(isCanvasRoute && !isChatFullscreen) ? 'floating' : 'docked'`. In fullscreen the
  docked sidebar fills page height and pushes the chat into the `flex-1` region.
  AppLayout subscribes to `isChatFullscreen` from the store.
- **`WorkspaceLayout.tsx`** — when `isChatFullscreen` (canvas mode), the chat LAYER‑2
  `motion.div` animates to fill its region (`left/top/right/bottom: 0`, `100%×100%`),
  drops the glass card styling (rounded/border/backdrop) for a solid `surface-secondary`
  background, and the canvas (LAYER 1) + tool rail (LAYER 4) are hidden (canvas stays
  mounted but covered/blurred; rail hidden since the docked sidebar provides nav).
- **Minimize** keeps the existing handler
  (`setIsChatFullscreen(false) + setIsCopilotMinimized(true)`): the chat panel tweens
  out (0.22s easeOut), the canvas un-blurs (0.4s), and the sidebar variant flips back to
  floating behind the canvas fade.
- *Known caveat:* the docked sidebar changes container width instantly while the chat box
  animates, so a small first-frame jump on enter/exit is possible. Tune transitions to
  minimize; a full rework is out of scope.

### 2. Wider fullscreen content

- **`MessageList.tsx`** content wrapper switches `max-w-3xl` → `max-w-5xl` when
  `isChatFullscreen`. Bubbles, results, and the composer share that column. The composer
  (`ChatInput`) max-width is aligned to the same value. Empty/new-chat page unchanged.

### 3. Results 4-up grid

- **`RunMediaGallery.tsx`** — container becomes a CSS grid inside an `overflow-x-auto`
  wrapper: `grid-template-columns: repeat(4, minmax(MIN, 1fr))`. Always 4 columns; >4
  items auto-wrap into rows of 4. `MIN` ≈ 120px so the narrow (340px) canvas panel
  overflows → horizontal scroll; in fullscreen `1fr` lets tiles grow (~230px). Each tile
  keeps its own aspect ratio; the per-tile `maxWidth` cap is removed (grid cell defines
  width).

### 4. Expected-count skeletons (iteration-aware)

- **`run-plan.ts`** — `RunPlan` gains `expectedResultCount` = Σ over terminal nodes of
  `(type === 'ai_generator' ? clamp(iterations, 1, 10) : 1)`.
- **`run-plan.ts` consumers / `use-chat-messages.ts`** — carry `expectedResultCount` onto
  the message's `runProposal` at the 3 update sites; persist it via `persistRunProposal`.
- **`store/types.ts`** — add `expectedResultCount?: number` to the runProposal shape.
- **`RunMediaGallery.tsx`** — render `max(items.length, skeletonCount)` cells: filled
  cells show arrived media, the rest stay skeletons. Live runs pass
  `skeletonCount = expectedResultCount` (4 skeletons show immediately, each swapping to
  its image as it lands). Frozen results pass `skeletonCount = 0` → exactly the real
  items, even if a run returned fewer than expected.
- **`InlineRunResults.tsx`** — replace the `Math.min(2, …)` guess with the message's
  `expectedResultCount` (falling back to `terminalIds.length`).
- **`Message.tsx`** — frozen-result gallery call passes no skeleton padding.

## Files touched

- `components/layout/AppLayout.tsx`
- `components/layout/WorkspaceLayout.tsx`
- `components/chat/MessageList.tsx`
- `components/chat/RunMediaGallery.tsx`
- `components/chat/InlineRunResults.tsx`
- `components/chat/Message.tsx`
- `components/chat/ChatInput*` (composer max-width alignment)
- `lib/billing/run-plan.ts`
- `lib/hooks/use-chat-messages.ts`
- `lib/store/types.ts`

## Verification

- `npx tsc --noEmit` clean (lint/build are unreliable in this repo).
- In-app E2E: enter a session, toggle fullscreen (docked sidebar fills page, wider
  content), minimize (smooth return to floating panel), run a multi-iteration generator
  (4 skeletons in a grid, swapping to images; >4 wraps; narrow panel scrolls sideways).
