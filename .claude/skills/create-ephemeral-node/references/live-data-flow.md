# Live Data Flow

This file documents how live (non-finalized) data flows between ephemeral nodes via `nodeOutputs`. **Read this whenever you build a node whose output is a `video` or whose input is a `video`** — the rules here decide whether the node behaves correctly in the live preview path, or breaks the chain.

The pattern is implemented in two reference plugins. Treat them as the canonical models:
- **Producer of a live signal:** `lib/nodes/plugins/compositor/` (publishes a `GraphDescription` describing the timeline).
- **Consumer/transformer of a live signal:** `lib/nodes/plugins/blur/` (wraps the upstream graph in a `kind: 'filter'` node and re-publishes).

## The envelope contract

Every ephemeral node publishes into `nodeOutputs[id]` an envelope of this shape:

```ts
{ type: 'image' | 'video', data: [{ url?, graph?, resolution?, metadata? }] }
// OR
{ type: 'text', data: [string] }
```

For non-text items, **exactly one of `url` or `graph` is set per data item**:
- `url` — a static asset (uploaded MP4/webm, data URL, etc.). Consumers render via `<img src>` / `<video src>`.
- `graph` — a live `GraphDescription` (see `lib/nodes/plugins/compositor/shared.ts`). Consumers render frames on demand via `paintGraphFrame`.

> The `cssFilter` envelope-sibling field and the raw `HTMLCanvasElement` ref shape were **removed in 2026-05**. Filter information now lives exclusively inside `{ kind: 'filter', upstream, cssFilter }` graphs — never as a sibling of `url` on the envelope. Likewise, there is no `stream`/`canvas` on the envelope: live producers publish a `graph`, and consumers paint from it.

### Shape A — static URL (the finished-file case)

A regular MP4/webm that has a real URL. Used by `media_input` (file upload), AI video generators (Replicate), and any server executor that uploads its output to Supabase storage.

```ts
{
  type: 'video',
  data: [{
    url: 'https://.../clip.mp4',
    resolution: { width: 1920, height: 1080 },
    metadata: { ... },
  }]
}
```

Consumers attach `<video src={url}>` directly.

### Shape B — live graph (the in-browser pull-model case)

The video doesn't exist as a file yet — upstream publishes a `GraphDescription` describing the timeline. Used by `compositor` (`kind: 'compositor'`) and by filter nodes wrapping it (`kind: 'filter'`).

```ts
{
  type: 'video',
  data: [{
    url: '',                  // empty — no file yet
    graph: GraphDescription,  // pull-model description
    resolution: { width, height },
    metadata: { source, processedBy },
  }]
}
```

Consumers render the graph at their own playhead via `paintGraphFrame` from `lib/nodes/plugins/compositor/graph-renderer.ts`. Each consumer holds its own `GraphRenderCache` and pooled video handles, so independent play/pause and independent `currentTime` work out of the box.

## Producing a live signal (Shape B)

If your node IS a producer (it renders a timeline of layers — compositor, future timeline/mixer/etc.):

1. **Build a `GraphDescription`.** For a compositor, that's `{ kind: 'compositor', layers, canvasWidth, canvasHeight, duration, fps, intrinsicDurations }`. The renderer walks layers in z-order and supports nested graphs transparently.
2. **Publish to `nodeOutputs[id]`** as Shape B above. The `url` MUST be `''` — downstream code branches on `!url && !!graph`.
3. **Server executor produces Shape A**, NOT Shape B. The server has no browser canvas — it renders the timeline via ffmpeg (or similar), uploads, returns a real URL. That's what AI generators consume when the user clicks Run. Live Shape B is in-browser-only.

Reference: `lib/nodes/plugins/compositor/component.tsx` — search for `setNodeOutput(id, { type: 'video', ... graph ... })`.

## Consuming / chaining a live signal (Shape B)

If your node CAN receive video upstream (a filter, a transform, a preview surface):

1. **Extract from envelope.** The first data item may have `graph` instead of (or in addition to) `url`:
   ```ts
   const first = Array.isArray(normalized) ? normalized[0] : normalized;
   const url = typeof (first as any)?.url === 'string' ? (first as any).url : null;
   const upstreamGraph = (first as any)?.graph as GraphDescription | undefined;
   const resolution = (first as any)?.resolution as { width: number; height: number } | undefined;
   const hasGraphSource = !!upstreamGraph;
   ```
2. **Treat `hasGraphSource || url` as your "have data" signal** — empty URL alone doesn't mean "no input." A compositor upstream has empty URL but is real data.
3. **For filter-shaped nodes (blur/contrast/etc.) — don't bake the pixels; wrap the graph.** When upstream is already a graph, wrap it directly; when upstream is a raw video URL, synthesize a 1-layer compositor graph first and then wrap that. Either way your output is uniformly a `kind: 'filter'` graph:
   ```ts
   const ownFilter = `blur(${sigma}px)`;
   const baseGraph: GraphDescription = upstreamGraph
     ?? wrapUrlAsCompositorGraph(url!, resolution);
   const filterGraph: GraphDescription = {
     kind: 'filter',
     upstream: baseGraph,
     cssFilter: ownFilter,
   };
   return {
     type: 'video',
     data: [{ url: '', graph: filterGraph, resolution }],
   };
   ```
   The renderer flattens chained `kind: 'filter'` nodes and applies the combined CSS filter string during paint, so consumers never read `cssFilter` off the envelope. See `wrapUrlAsCompositorGraph` in `lib/nodes/plugins/blur/executor.client.ts` for the synthesis helper.
4. **Card preview rendering:** mount a `LayerSubgraph`-style surface (or use `paintGraphFrame` directly) keyed by the upstream graph. For static URLs fall back to `<video src>`. The compositor's `CompositorLayerNodes` in `lib/nodes/plugins/compositor/ui/Renderer.tsx` is the dispatcher reference: `graph` → `LayerSubgraph`, `url` (image/video) → `LayerImage`/`LayerVideo`, `text` → `LayerText`.
5. **Native dimensions:** prefer `upstreamItem.resolution` over loading the URL. Graph sources publish their canvas dims on the envelope; without it the preview scaling math can't run until the inner video's `onLoadedMetadata` fires.

Reference: `lib/nodes/plugins/blur/executor.client.ts` and `lib/nodes/plugins/blur/component.tsx`.

## Handle-compat narrowing for live-signal producers

If your node's output dataType is the polymorphic union `['image', 'video']` (because it can be either depending on inputs — compositor and blur both are), the static def alone won't narrow the type for the wire-drop validator. You need a small carve-out in `lib/editor/handle-compatibility.ts`:

1. Add a `resolve<YourNode>OutputKind(nodeId): 'image' | 'video' | null` helper alongside the existing `resolveBlurOutputKind` and `resolveCompositorOutputKind`. Walk the node's input edges, peek at upstream `nodeOutputs[upstream.id]`, and decide.
2. Trust the envelope's `.type` field over URL detection — live-graph sources have empty URLs but their envelope is `{ type: 'video', data: [...] }`. The existing helper already does this; mirror it.
3. Dispatch from `resolveDynamicOutputType` by node type.
4. When the runtime output type narrows on the card, call `pruneIncompatibleOutgoingEdges(id, newType)` from a `useEffect` keyed on the kind. This auto-removes downstream edges that no longer accept the new type.

Reference: `lib/editor/handle-compatibility.ts` (the `resolveBlurOutputKind` / `resolveCompositorOutputKind` functions and the `pruneIncompatibleOutgoingEdges` callsites in the components).

## Lightbox / fullscreen view for a live signal

`ImageLightbox` (the shared simple-player component used by blur and ai_video) takes a seekable URL. A live `GraphDescription` isn't a single seekable resource, so showing a lightbox over a live signal requires **rendering the graph into a recorded blob URL once** when the user opens it, then handing that blob URL to `ImageLightbox`. The compositor's lightbox path is the reference: while recording, show a `RecordingProgressOverlay`; once the blob is ready, swap to `ImageLightbox` with `type='video'`.

Don't try to drive `ImageLightbox` directly off a graph — it'll appear to work but the user can't scrub, the duration reads `Infinity`, and the native controls misbehave.

Reference: `lib/nodes/plugins/compositor/component.tsx` — search for `lightboxBlobUrl`.

## Server-side: live graph does NOT cross the network

The server executor for a live-signal-producing node still emits Shape A (real URL). The orchestrator runs the workflow with server outputs, so AI generators and other server consumers always see real URLs. Live Shape B is exclusively for in-browser preview flow via `nodeOutputs`.

This means: when designing a video-producing node, you build **both** paths:
- `executor.server.ts` → renders to a real file (ffmpeg/Sharp/Replicate/etc.), uploads, returns Shape A.
- `executor.client.ts` (or the component itself, for graph-producing nodes) → publishes Shape B into `nodeOutputs`.

The live preview chain runs entirely through Shape B; the run-time pipeline runs entirely through Shape A. They never mix.

## When to use which shape

| Producer type | What it emits | Why |
|---|---|---|
| `media_input` (file upload) | Shape A | The file already exists; URL is real. |
| AI generator producing video | Shape A | Server uploads the result. |
| Static-URL filter (blur of a file → video branch) | Shape B (wrap URL as graph, then `kind: 'filter'`) | Keep the chain uniformly graph-shaped; the renderer flattens filter chains. |
| Live graph renderer (compositor) | Shape B from in-browser; Shape A from server | Live preview can't wait for a file. |
| Filter consuming a live source | Shape B with `kind: 'filter'` wrapping the upstream graph | Keep the chain live; let the renderer compose filters. |

## Pitfalls

- **Empty-string URL guard.** `if (!url) return null` will reject Shape B. Use `if (!url && !hasGraphSource) return null`.
- **Don't bake live-signal filters into pixels.** A `drawImage(video)` + `toDataURL` step on a live source gives you a single frame, not a video. Wrap the upstream graph in `kind: 'filter'` and let `paintGraphFrame` apply CSS filters during paint.
- **Don't put `cssFilter` on the envelope.** Filter information lives inside the graph (`{ kind: 'filter', upstream, cssFilter }`); putting it on the envelope sibling is the legacy push-model shape and is no longer read by consumers.
- **One graph, many consumers, independent playheads.** Each consumer paints from its own `GraphRenderCache` so independent play/pause and `currentTime` work. Don't share a cache across nodes.
- **Server URL for AI generators.** Don't try to ship a `graph` to a server executor — it references browser-only resources. The orchestrator pulls server outputs (Shape A) which always have a real URL.
