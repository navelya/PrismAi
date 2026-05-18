# Live Data Flow

This file documents how live (non-finalized) data flows between ephemeral nodes via `nodeOutputs`. **Read this whenever you build a node whose output is a `video` or whose input is a `video`** — the rules here decide whether the node behaves correctly in the live preview path, or breaks the chain.

The pattern is implemented in two reference plugins. Treat them as the canonical models:
- **Producer of a live signal:** `lib/nodes/plugins/compositor/` (Konva canvas → captureStream).
- **Consumer of a live signal:** `lib/nodes/plugins/blur/` (passes the live signal through with a CSS filter chain).

## The two video shapes

`type: 'video'` envelopes can arrive in two distinct shapes. Every video-aware executor and component MUST handle both.

### Shape A — static URL (the finished-file case)

A regular MP4/webm that has a real URL. Used by `media_input` (file upload), AI video generators (Replicate), and any server executor that uploads its output to Supabase storage.

```ts
{
  type: 'video',
  data: [{
    url: 'https://.../clip.mp4',
    resolution: { width: 1920, height: 1080 },
    metadata: { ... },
    cssFilter?: string,   // accumulated from upstream filter nodes
  }]
}
```

Consumers attach `<video src={url}>` and apply `cssFilter` at render time.

### Shape B — live signal (the in-browser-canvas case)

The video doesn't exist as a file yet — it's a live signal coming off a `<canvas>` via `canvas.captureStream(fps)`. Used by `compositor` when any layer is video or temporal: there's no MP4 until the server runs.

```ts
{
  type: 'video',
  data: [{
    url: '',                          // empty — no file yet
    stream: MediaStream,              // live track from captureStream
    canvas: HTMLCanvasElement,        // the source canvas (for per-frame drawImage)
    cssFilter: '',                   // start-of-chain marker; consumers append
    resolution: { width, height },
    metadata: { source, processedBy },
  }]
}
```

Consumers attach `<video srcObject={stream}>` (NOT `src`), and apply `cssFilter`. Pausing the `<video>` element pauses the local display only — the upstream stream keeps producing frames. Streams can be shared across multiple `<video>` elements safely.

## Producing a live signal (Shape B)

If your node IS a producer (it renders into a canvas continuously — compositor, timeline, mixer, etc.):

1. **Render into an HTMLCanvasElement** — Konva's `<Stage>` exposes one via `stage.getLayers()[0].getCanvas()._canvas`. Or use a raw `<canvas>` you draw into yourself.
2. **Capture a MediaStream** with `canvas.captureStream(fps)`. Older Safari lacks this — guard with `typeof (canvas as any).captureStream === 'function'` and gracefully degrade.
3. **Publish to `nodeOutputs[id]`** as Shape B above. The `url` MUST be `''` (empty string is the contract — downstream code branches on `!url && !!stream`). `cssFilter: ''` is the "start of chain" marker.
4. **Server executor produces Shape A**, NOT Shape B. The server has no browser canvas — it renders the timeline via ffmpeg (or similar), uploads, returns a real URL. That's what AI generators consume when the user clicks Run. Live-stream Shape B is in-browser-only.

Reference: `lib/nodes/plugins/compositor/component.tsx` — search for `setNodeOutput(id, { type: 'video', ... canvas, stream, cssFilter: '' ... })`.

## Consuming a live signal (Shape B)

If your node CAN receive video upstream (a filter, a transform, a preview surface):

1. **Extract from envelope correctly.** The first data item may have `stream` / `canvas` instead of (or in addition to) `url`:
   ```ts
   const first = Array.isArray(normalized) ? normalized[0] : normalized;
   const url = (first as any).url || null;       // may be ''
   const stream = (first as any).stream as MediaStream | undefined;
   const liveCanvas = (first as any).canvas as HTMLCanvasElement | undefined;
   const upstreamCssFilter = (first as any).cssFilter ?? null;
   const hasLiveSource = !!(stream || liveCanvas);
   ```
2. **Treat `hasLiveSource || url` as your "have data" signal** — empty URL alone doesn't mean "no input." A compositor upstream has empty URL but is real data.
3. **For filter-shaped nodes (blur/contrast/etc.) — don't bake the pixels.** Pass the stream/canvas/url through with `cssFilter` appended:
   ```ts
   const ownFilter = `blur(${sigma}px)`;
   const cssFilter = upstreamCssFilter ? `${upstreamCssFilter} ${ownFilter}` : ownFilter;
   return {
     type: 'video',
     data: [{ url: url ?? '', stream, canvas: liveCanvas, cssFilter, resolution }],
   };
   ```
   The browser composes filters as CSS layers — chained filters compose naturally. Zero re-encoding, fully live. The card-side preview reads `cssFilter` and applies it on its own `<video>` element.
4. **Card preview JSX:** use `srcObject` when a stream is present, `src` otherwise. `srcObject` can't be set declaratively in JSX, so do it in a `useEffect`:
   ```tsx
   useEffect(() => {
     const v = videoRef.current;
     if (!v) return;
     if (liveStream) {
       if (v.srcObject !== liveStream) {
         v.srcObject = liveStream;
         v.play().catch(() => {});
       }
     } else if (v.srcObject) {
       v.srcObject = null;
     }
   }, [liveStream]);
   ```
   In JSX: `<video {...(liveStream ? {} : { src: mediaUrl as string })} autoPlay={!!liveStream} ... />`.
5. **Native dimensions:** prefer `upstreamItem.resolution` over loading the URL. Live sources publish their canvas dims immediately; without it the preview-blur scaling math can't run until `onLoadedMetadata` fires.

Reference: `lib/nodes/plugins/blur/executor.client.ts` and `lib/nodes/plugins/blur/component.tsx`.

## Handle-compat narrowing for live-signal producers

If your node's output dataType is the polymorphic union `['image', 'video']` (because it can be either depending on inputs — compositor and blur both are), the static def alone won't narrow the type for the wire-drop validator. You need a small carve-out in `lib/editor/handle-compatibility.ts`:

1. Add a `resolve<YourNode>OutputKind(nodeId): 'image' | 'video' | null` helper alongside the existing `resolveBlurOutputKind` and `resolveCompositorOutputKind`. Walk the node's input edges, peek at upstream `nodeOutputs[upstream.id]`, and decide.
2. Trust the envelope's `.type` field over URL detection — live-stream sources have empty URLs but their envelope is `{ type: 'video', data: [...] }`. The existing helper already does this; mirror it.
3. Dispatch from `resolveDynamicOutputType` by node type.
4. When the runtime output type narrows on the card, call `pruneIncompatibleOutgoingEdges(id, newType)` from a `useEffect` keyed on the kind. This auto-removes downstream edges that no longer accept the new type.

Reference: `lib/editor/handle-compatibility.ts` (the `resolveBlurOutputKind` / `resolveCompositorOutputKind` functions and the `pruneIncompatibleOutgoingEdges` callsites in the components).

## Lightbox / fullscreen view for a live signal

`ImageLightbox` (the shared simple-player component used by blur and ai_video) takes a seekable URL. Live `MediaStream` isn't seekable, so showing a lightbox over a live signal requires **recording the stream to a blob URL once** when the user opens it, then handing that blob URL to `ImageLightbox`. The compositor's lightbox path is the reference: while recording, show a `RecordingProgressOverlay`; once the blob is ready, swap to `ImageLightbox` with `type='video'`.

Don't try to feed `srcObject` into `ImageLightbox` directly — it'll appear to work but the user can't scrub, the duration reads `Infinity`, and the native controls misbehave.

Reference: `lib/nodes/plugins/compositor/component.tsx` — search for `lightboxBlobUrl`.

## Server-side: live signal does NOT cross the network

The server executor for a live-signal-producing node still emits Shape A (real URL). The orchestrator runs the workflow with server outputs, so AI generators and other server consumers always see real URLs. Live Shape B is exclusively for in-browser preview flow via `nodeOutputs`.

This means: when designing a video-producing node, you build **both** paths:
- `executor.server.ts` → renders to a real file (ffmpeg/Sharp/Replicate/etc.), uploads, returns Shape A.
- `executor.client.ts` (or the component itself, for canvas-rendered nodes) → publishes Shape B into `nodeOutputs`.

The live preview chain runs entirely through Shape B; the run-time pipeline runs entirely through Shape A. They never mix.

## When to use which shape

| Producer type | What it emits | Why |
|---|---|---|
| `media_input` (file upload) | Shape A | The file already exists; URL is real. |
| AI generator producing video | Shape A | Server uploads the result. |
| Static-URL filter (blur of a file) | Shape A pass-through with `cssFilter` | Filter is a descriptor, not a bake. |
| Live canvas renderer (compositor) | Shape B from in-browser; Shape A from server | Live preview can't wait for a file. |
| Filter consuming a live source | Shape B pass-through with `cssFilter` chain | Keep the chain live; let CSS compose. |

## Pitfalls

- **Empty-string URL guard.** `if (!url) return null` will reject Shape B. Use `if (!url && !hasLiveSource) return null`.
- **Don't bake live-signal filters into pixels.** A `drawImage(video)` + `toDataURL` step on a live stream gives you a single frame, not a video. Use the `cssFilter` chain.
- **`srcObject` can't be on JSX as a prop.** Set it via effect/ref.
- **One canvas, one `currentTime`.** The shared video pool means two LivePreview instances can't have different playheads on the same source. Independent play/pause works (it's the `<video>` element's display state); independent scrub doesn't.
- **Server URL for AI generators.** Don't try to ship a `stream` or `canvas` to a server executor — they're not serializable. The orchestrator pulls server outputs (Shape A) which always have a real URL.
