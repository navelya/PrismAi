# Ephemeral Output Envelope Unification

**Date:** 2026-05-20
**Status:** Draft — awaiting user review
**Scope:** Client-side live-preview only. Server execution unchanged.

## Background

Live ephemeral output flows between nodes via a published envelope at `nodeOutputs[nodeId]`. Today, the envelope's data items carry up to **five** orthogonal shapes that downstream consumers must dispatch on:

1. `url` — static media (image / video file)
2. `graph` — a `GraphDescription` for pull-mode live rendering
3. `canvas` — a raw `HTMLCanvasElement` ref (legacy push model)
4. `cssFilter` — accumulated CSS filter string from upstream effect nodes
5. `text` — plain string for Prompt-derived sources

Two of these are dead-but-still-handled:

- **`canvas` (push model)** — No producer in the current codebase emits this. `LayerCanvas` (the consumer) exists in [Renderer.tsx:467-643](lib/nodes/plugins/compositor/ui/Renderer.tsx#L467-L643) and is dispatched at [Renderer.tsx:1036-1040](lib/nodes/plugins/compositor/ui/Renderer.tsx#L1036-L1040), `outputKind` checks for it at [component.tsx:597-600](lib/nodes/plugins/compositor/component.tsx#L597-L600), but Compositor now publishes only `graph` ([component.tsx:736-746](lib/nodes/plugins/compositor/component.tsx#L736-L746)) and Blur publishes graph + sibling cssFilter ([blur/executor.client.ts:127-148](lib/nodes/plugins/blur/executor.client.ts#L127-L148)). The branch is reachable only by hand-crafted external producers, of which there are none.
- **`cssFilter` envelope field** — duplicates information already inside the graph (`{ kind: 'filter', upstream, cssFilter }`). Blur emits both. Renderer reads from both depending on the source shape. Two truths, one of which can drift.

The branching across five shapes is where bugs hide: every new node plugin has to either handle every shape or quietly miss one. The renderer's per-layer dispatch in [Renderer.tsx:1014-1219](lib/nodes/plugins/compositor/ui/Renderer.tsx#L1014-L1219) is the largest concentration of this.

## Goal

Collapse to **one** live-signal shape: a `GraphDescription`. Every ephemeral node publishes a graph. Downstream consumers branch on `graph ? render(graph) : url ? render(url) : text ? render(text) : null` — three cases, not five.

## Non-goals

- **No WebCodecs / OffscreenCanvas / WebGL pipeline change.** Konva + Canvas2D + CSS-filter chaining stays.
- **No server-side ephemeral execution change.** [handlers.ts](lib/workflow/handlers.ts) and the Sharp-based pipeline are untouched.
- **No materialization boundary change.** The path from ephemeral → AI input continues to use server-side resolution.
- **No invalidation propagation change.** `useNodeAutoCompute`'s existing dependency tracking is correct; the bug surface is in the dispatch, not the propagation.

## Design

### Producer rules

| Node type             | What it publishes into `nodeOutputs[id]`                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `media_input`         | `{ type: 'image' \| 'video', data: [{ url, resolution }] }` (unchanged)                                             |
| `prompt`              | `{ type: 'text', data: [string] }` (unchanged)                                                                      |
| `ai_generator`        | `{ type: 'image' \| 'video', data: [{ url, resolution }] }` after Run completes (unchanged)                         |
| `compositor` (live)   | `{ type: 'video', data: [{ url: '', graph, resolution }] }` — **no `cssFilter` sibling**                            |
| `compositor` (server) | `{ type: 'video', data: [{ url: <stored-mp4>, resolution }] }` after Run (unchanged)                                |
| `blur` (live, video)  | `{ type: 'video', data: [{ url: '', graph: { kind: 'filter', upstream, cssFilter }, resolution }] }` — graph always |
| `blur` (live, image)  | `{ type: 'image', data: [{ url: <data-url> }] }` (unchanged — image path bakes pixels)                              |
| `levels`              | (image only — unchanged)                                                                                            |

**Rule restated:** the `cssFilter` sibling field disappears from every emitted envelope. CSS filter information lives **only** inside the graph as `{ kind: 'filter', upstream, cssFilter }`.

### Blur's "always emits a graph" path

When blur's upstream is a static video URL (e.g. a MediaInput feeding directly into blur, with no compositor between them), blur synthesizes a single-layer compositor graph wrapping that URL, then wraps it in a filter node:

```ts
const FALLBACK_LAYER_ID = '__blur_wrap__';
const w = resolution?.width ?? 1920;
const h = resolution?.height ?? 1080;
const synthesizedLayer: CompositorLayer = {
  id: FALLBACK_LAYER_ID,
  name: 'wrap',
  sourceHandleId: FALLBACK_LAYER_ID,
  selectedIndex: 0,
  transform: {
    x: 0, y: 0, width: w, height: h,
    rotation: 0, opacity: 1, flipX: false, flipY: false,
    isAutoCentered: true, crop: null,
  },
  visible: true, locked: false,
  startTime: 0, duration: null,
  trimIn: 0, trimOut: null,
  speed: 1, muted: false,
  transition: { type: 'none', duration: 0 },
};

const wrappingGraph: GraphDescription = {
  kind: 'filter',
  cssFilter: blurFilterString(config.radius ?? 5),
  upstream: {
    kind: 'compositor',
    layers: [{ layer: synthesizedLayer, source: { kind: 'media', url, mediaKind: 'video' } }],
    canvasWidth: w,
    canvasHeight: h,
    duration: 0,
    fps: 30,
    intrinsicDurations: {},
  },
};
```

Notes:

- The synthesized layer's `duration: null` + empty `intrinsicDurations` means `isLayerActiveAt` falls through to "always on after startTime ≥ 0" — the layer renders at every `t`, which is the correct behavior for a leaf wrap.
- The graph's top-level `duration: 0` is fine. `graphDuration()` is consumed only at compositor-card UI level to size the transport scrubber; a filter-wrapped leaf graph used as upstream to a downstream compositor never has its `duration` queried directly.
- `resolution` comes from the upstream envelope's data item when present; otherwise default 1920×1080. The actual rendered size is bounded by the downstream consumer's compositor size anyway.

Result: blur's output is uniformly a filter-over-graph regardless of whether upstream was already a graph or just a URL.

### Consumer rules (renderer)

In `CompositorLayerNodes` the per-layer dispatch becomes:

```
if (resolved.graph)             → LayerSubgraph
else if (url && image)          → LayerImage
else if (url && video)          → LayerVideo (no cssFilter prop)
else if (text)                  → LayerText
else                            → skip
```

Gone:

- `LayerCanvas` component (the whole file/section — ~180 lines).
- `cssFilter` extraction at [Renderer.tsx:1045-1048](lib/nodes/plugins/compositor/ui/Renderer.tsx#L1045-L1048).
- `cssFilter` prop on `LayerVideo`. The per-layer offscreen-canvas-with-filter draw loop ([Renderer.tsx:290-320](lib/nodes/plugins/compositor/ui/Renderer.tsx#L290-L320)) is removed; filtered video reaches the renderer only through `LayerSubgraph` → `paintGraphFrame`, which handles filters internally.
- `canvas` branch in Compositor's `outputKind` computation ([component.tsx:597-600](lib/nodes/plugins/compositor/component.tsx#L597-L600)).

### Envelope equality

`envelopeContentEqual` in [use-node-auto-compute.ts:35-68](lib/hooks/use-node-auto-compute.ts#L35-L68) compares data items shallowly. After this change:

- `cssFilter` is no longer a key on data items, so the loop stops checking it.
- `graph` continues to compare by reference (writers stabilize it by content equality at the publish site, so ref-equality is correct).
- `canvas` is no longer a key.

No structural change to the function — its key-loop just sees fewer keys. The header comment is updated to reflect the new contract.

### Skill documentation

The plugin-authoring skills assume the legacy shapes:

- `.claude/skills/create-ephemeral-node/references/live-data-flow.md` — rewrite to reference only graph / url / text.
- `.claude/skills/update-ephemeral-node/references/change-types.md` — same.
- The references' code recipes for video-aware nodes (where blur was the template) must show the "always synthesize a graph" pattern.

## Files touched

| File                                                              | Change                                                            |
| ----------------------------------------------------------------- | ----------------------------------------------------------------- |
| `lib/nodes/plugins/compositor/ui/Renderer.tsx`                    | Delete `LayerCanvas`. Delete `cssFilter` prop + per-layer filter draw on `LayerVideo`. Simplify dispatch. |
| `lib/nodes/plugins/compositor/component.tsx`                      | Drop `cssFilter: ''` from published envelope. Remove `canvas` branch in `outputKind`. |
| `lib/nodes/plugins/blur/executor.client.ts`                       | Stop emitting sibling `cssFilter`. Synthesize wrapping compositor graph when upstream is a raw video URL. |
| `lib/nodes/plugins/blur/component.tsx`                            | Audit any envelope reads for stray `cssFilter` consumption.       |
| `lib/hooks/use-node-auto-compute.ts`                              | Update header comment; key loop unchanged.                        |
| `.claude/skills/create-ephemeral-node/references/live-data-flow.md` | Rewrite to one-shape contract.                                  |
| `.claude/skills/update-ephemeral-node/references/change-types.md` | Sync to new contract.                                             |
| `.claude/skills/create-ephemeral-node/references/node-recipes.md` | Update video-aware recipe.                                        |

Estimated lines: ~250 deleted, ~50 added.

## Risks and verification

**Risk: a third-party path still emits `canvas` or `cssFilter`.** Mitigation: grep the codebase before deletion to confirm no producers; the renderer's removed branches will only break a producer that doesn't exist.

**Risk: blur's image-path (data-URL bake) regresses.** The image branch is independent of this work — it doesn't use graphs. Untouched.

**Risk: chained-compositor playback regression.** `LayerSubgraph` already handles compositor → compositor chains in pull mode ([Renderer.tsx:661-826](lib/nodes/plugins/compositor/ui/Renderer.tsx#L661-L826)). Removing `LayerCanvas` only removes the never-taken fallback.

**Verification:**

1. `npx tsc --noEmit` — type integrity (memory note: `npm run lint` / `next build` are unreliable here).
2. Manual smoke in browser:
   - MediaInput (image) → Compositor → preview shows image.
   - MediaInput (video) → Compositor → preview plays, scrub works.
   - MediaInput (video) → Blur → Compositor → preview plays with blur applied.
   - MediaInput (video) → Compositor A → Blur → Compositor B → B plays with A's pixels blurred, B has its own playhead independent of A.
   - AI Generator (after Run) → Compositor → preview shows generated image / video.
   - Two compositors fed from the same upstream MediaInput video, scrubbing one does not move the other.
3. Confirm no console errors during 60 seconds of canvas interaction with a non-trivial graph.

## Out of scope, deferred

- WebCodecs-backed `getFrame(t)` interface (the original proposal). Reconsider only if Konva+Canvas2D hits a wall we haven't hit yet.
- Materialization in the browser at the AI boundary. Server-side path remains authoritative.
- 1-frame LRU cache layer. Konva.Animation already reads sources per frame; explicit caching has no current win.
- `result_url` caching by `input_hash`. Pre-existing PLAN.md feature; orthogonal.

## Definition of done

- `LayerCanvas` source no longer exists.
- No file in `lib/nodes/plugins/` emits an envelope data item containing the literal key `cssFilter`.
- No file in `lib/nodes/plugins/` or `lib/hooks/` reads the literal key `cssFilter` off an envelope data item.
- Compositor's `outputKind` has no `HTMLCanvasElement` check.
- All five smoke scenarios above pass in a manual browser session.
- `npx tsc --noEmit` clean.
- Skill reference docs updated.
