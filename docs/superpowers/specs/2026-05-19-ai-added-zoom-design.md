# AI-Added Zoom — Design

## Goal

When the AI adds or rearranges nodes/groups via the chat brain, the canvas viewport smoothly follows so the user can see the result. The camera should feel like a human collaborator watching the work appear: stay out of the way when possible, follow when forced to, and re-center at the end of the turn.

## Scope

In scope:
- Camera moves triggered by **AI-driven** workflow patches arriving from the chat stream.

Out of scope:
- User-initiated additions (sidebar drag, paste, context-menu wire-drop, file drop). The user already chose where to put those — the existing wire-drop alignment logic in [EditorCanvas.tsx](../../../components/editor/EditorCanvas.tsx) is the right behavior.
- Workflow load (clicking a session in the sidebar). React Flow's `fitView` on init already handles this.
- Re-fitting on node removal. We don't auto-shrink the camera.

## UX summary

For a single chat turn (one user message → one assistant response):

1. **Streaming.** As patches arrive, we accumulate the set of nodes the AI "touched" (added, repositioned, or wired). If the bounding box of that set leaves the visible viewport, we smoothly pan/zoom to keep it in view. If it's already fully visible, the camera doesn't move.
2. **End of turn.** When the stream ends, we do one definitive smooth fit to the whole touched set with a slightly longer animation. This is the "settle" move.
3. **User override.** If the user pans, zooms, or scrolls the viewport at any point during the turn, all camera moves for the rest of that turn are suppressed. Manual control wins.

## The "AI-touched" set

A `Set<string>` of node ids, rebuilt each turn:

- Every id in `patch.addedNodes`
- Every id in `patch.updatedNodes` (covers position changes, `parentNode` changes such as moves into a group)
- For each `patch.addedEdges` entry, both `source` *and* `target` (so wiring a new node into an existing one frames *both* — typically what the user wants to see)
- Removals are not tracked.

The set is empty for text-only assistant replies; in that case the end-of-turn fit is skipped.

## Camera mechanics

Both during-stream and end-of-turn fits use React Flow's `fitBounds(bbox, { duration, padding })`. The bounding box is computed from `reactFlowInstance.getNodes()` filtered by the tracked ids, falling back to each node's `position` + default size (200x100) if the node hasn't been measured yet.

| Phase | Trigger | Duration | Padding | Notes |
|---|---|---|---|---|
| During stream | After a patch lands, debounced 150ms | 400ms | 0.2 | Skipped if tracked bbox is already inside the visible viewport with a 40px screen-pixel inset. |
| End of turn | Stream ends (`type === 'done'` or reader closes) | 700ms | 0.25 | Skipped if `userOverrodeViewport` or if tracked set is empty. Runs after one `requestAnimationFrame` so the last patch's nodes are measured. |

Both fits clamp `maxZoom` to 0.8 — matching the existing `FIT_VIEW_OPTIONS` constant in [EditorCanvas.tsx](../../../components/editor/EditorCanvas.tsx). Without this clamp, fitting a single newly-added node would zoom way in.

### "Already in view" check

The during-stream fit is skipped when the tracked bbox is already fully visible. Logic:

1. Get the viewport rect in flow space (via `reactFlowInstance.getViewport()` and the wrapper element's size).
2. Inset by 40 screen pixels (converted to flow units via the current zoom) so a node hugging the edge still counts as "needs to be brought in."
3. If the tracked bbox is inside this insetted rect, return without moving the camera.

## User override detection

A `userOverrodeViewport` boolean, per turn, set to `true` on the first user-initiated viewport change. Cleared at `beginAiTurn`.

The tricky part: React Flow's `onMove` fires for both user actions *and* our own `fitBounds` calls. We disambiguate via an `isProgrammaticMove` ref:

```
isProgrammaticMove.current = true;
reactFlowInstance.fitBounds(bbox, { duration: 400, padding: 0.2 });
// React Flow will fire onMove during the animation
setTimeout(() => { isProgrammaticMove.current = false; }, duration + 50);
```

The `onMove` handler ignores events while `isProgrammaticMove.current` is true. Anything else — wheel scroll, drag-pan, pinch-zoom — flips `userOverrodeViewport` to true and suppresses further fits this turn.

## Module layout

Three files, with the heaviest logic kept in one small new component:

### 1. Store — extend `lib/store/slices/ui-slice.ts`

Add a new slice section:

```ts
aiTurn: {
  active: boolean;
  touchedNodeIds: string[];    // serialized; the consumer turns this into a Set
  patchTick: number;           // bumped on each recorded patch so subscribers re-fire
} | null;

beginAiTurn: () => void;
recordAiPatch: (patch: WorkflowPatch) => void;
endAiTurn: () => void;
```

`beginAiTurn` resets to `{ active: true, touchedNodeIds: [], patchTick: 0 }`.
`recordAiPatch` merges new ids into `touchedNodeIds` (dedup) and bumps `patchTick`.
`endAiTurn` sets `active: false` and leaves `touchedNodeIds` intact so the consumer's "active → false" effect can read them for the final fit. The set is overwritten (not cleared) on the next `beginAiTurn`.

We use a plain array (not a `Set`) in store state because Zustand's persistence and devtools serialize the slice. The consumer hook converts to a `Set` for membership checks.

### 2. Stream consumer — `lib/hooks/use-chat-messages.ts`

Three small additions inside the existing stream loop:

- At stream start (the assistant message is created, just before the `while (true)` read loop): call `useAppStore.getState().beginAiTurn()`.
- Inside the existing `parsed.type === 'tool'` branch where patches land, after the `applyWorkflowPatch` call: `useAppStore.getState().recordAiPatch(parsed.patch)`.
- At stream end (the `type === 'done'` branch and the catch/finally paths): call `useAppStore.getState().endAiTurn()`.

No camera logic in this file — it only publishes state.

### 3. Camera driver — new `components/editor/AiAddedZoom.tsx`

A childless component mounted inside `<ReactFlow>` so it has access to `useReactFlow()`. Responsibilities:

- Subscribes to `aiTurn` from the store.
- Owns the debounce timer ref, `isProgrammaticMove` ref, and per-turn `userOverrodeViewport` ref.
- On `aiTurn.patchTick` change while `active` is true: schedules the debounced during-stream fit.
- On `aiTurn.active` going from `true` to `false`: runs the end-of-turn fit (after one `requestAnimationFrame` for measurement).
- Exports nothing visual. Returns `null`.

User-override wiring: `AiAddedZoom` subscribes to React Flow's internal store using `useStore` from `reactflow`, selecting the viewport `transform` tuple. Every time the transform changes, the component checks `isProgrammaticMove.current`: if false, the change was user-initiated and `userOverrodeViewport` is flipped to true. This avoids drilling an `onMove` prop through `EditorCanvas`.

## Edge cases

- **Empty workflow + first AI add.** `fitBounds` on a tiny bbox would zoom past `maxZoom`. The 0.8 clamp covers this.
- **AI updates a node but it's already on screen, fully visible.** During stream: no movement. End of turn: still re-fits with the longer animation — but if the bbox hasn't grown, the fit will be essentially a no-op visually because the camera is already there. That's acceptable.
- **AI adds 50+ nodes.** Bbox grows to encompass them all; `fitBounds` zooms out. The `maxZoom: 0.8` doesn't help here (we want to zoom *out*, not in). `minZoom` is already 0.1 in the canvas — fine.
- **User opens a session mid-turn / cancels mid-stream.** `beginAiTurn` clears state on the next turn, so a half-finished turn leaves no garbage that would re-fire later. The end-of-turn fit in the finally path covers the cancel.
- **Multiple turns in fast succession.** `beginAiTurn` always resets — there's no risk of one turn's tracked set bleeding into the next.
- **The AI removes a node but adds nothing.** Tracked set is empty, end-of-turn fit is skipped. Camera stays put.
- **Patch arrives but its node isn't measured yet.** Bbox falls back to `position + (200, 100)` defaults; the during-stream fit may be slightly off the final layout. The end-of-turn fit (after `requestAnimationFrame`) corrects it.

## Verification plan

No test runner exists in this repo (see [CLAUDE.md](../../../CLAUDE.md)). Verification is manual via the chat UI:

1. **Single add far off-screen.** Pan canvas to a far corner with no nodes visible. Ask AI to "generate an image of a cat." Camera should smoothly pan/zoom to the new node before stream ends, and re-settle at end of turn.
2. **Existing wire extension.** With an existing `ai_generator` in view, ask "add an upscaler to it." Both the new upscaler and the existing generator should be visible after the fit.
3. **Multi-node burst.** Ask for a 4-step pipeline. Camera should debounce, not jitter, and end the turn framing all four.
4. **User override.** Start a multi-node generation; mid-stream, scroll the canvas. End-of-turn fit must NOT fire — camera stays where the user left it.
5. **Already-visible add.** With a wide-zoomed-out view that already includes off-canvas space, the during-stream fit should NOT fire (no movement) for a node that lands inside the inset. End-of-turn fit is fine to fire (no visible change anyway).
6. **Text-only reply.** Ask the AI a question that doesn't add nodes. No camera move.
7. **Removal-only reply.** Ask the AI to delete a node. No camera move.

Verify with `npx tsc --noEmit` (per memory note — `npm run lint` / `next build` are unreliable in this repo).
