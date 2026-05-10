# Client Preview Inference

Every ephemeral node has `executor.client.ts` for live preview. The skill picks the in-browser approach based on data type.

## Decision by data type

### `image` outputs

**→ Canvas 2D + CSS filters.**

Pattern:

```ts
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');
const img = new Image();
img.crossOrigin = 'anonymous';
img.onload = () => {
  canvas.width = img.width;
  canvas.height = img.height;
  ctx.filter = 'blur(5px)';      // CSS filter — fast, GPU-accelerated
  ctx.drawImage(img, 0, 0);
  const dataUrl = canvas.toDataURL('image/png');
  resolve(dataUrl);
};
img.src = url + (url.includes('?') ? '&' : '?') + 'notaint=1';   // cache-bust to avoid CORS taint
```

CSS filters available: `blur(Npx)`, `brightness(N)`, `contrast(N)`, `grayscale(N)`, `hue-rotate(Ndeg)`, `invert(N)`, `opacity(N)`, `saturate(N)`, `sepia(N)`, `drop-shadow(...)`. Stack multiple with spaces.

For pixel-level operations (channel mix, threshold, custom convolution), use `ctx.getImageData()` → manipulate the `data` Uint8ClampedArray → `ctx.putImageData()`. Slower but full control.

Reference: `lib/nodes/plugins/blur/executor.client.ts`.

### `image_array` (multiple images)

Same as image but loop over the array. The preview can show a grid (CSS `grid-cols-2`) or just the first image — depends on the node's UX.

### `video` outputs

**→ `<video>` element + MediaSource API or canvas frame extraction.**

For video transforms (trim, scale, color):
- Load source via `<video src={url}>`.
- For lightweight effects (CSS filters on play): set `style.filter = 'brightness(1.2)'` on the video element directly — no executor needed for that case.
- For frame-by-frame manipulation: draw video frames to canvas with `ctx.drawImage(videoEl, 0, 0)` on each `requestVideoFrameCallback`.

Live preview of complex video edits in browser is often impractical (CPU-bound). For those:
- `executor.client.ts` returns `null` (no preview).
- Document why in a comment.
- The user sees only the canvas card + a "running on server" indicator.

### `audio` outputs

**→ Web Audio API + `<canvas>` waveform.**

```ts
const audioCtx = new AudioContext();
const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
// Render waveform to canvas
const data = audioBuffer.getChannelData(0);
// ... draw bars/lines from sample data
```

For audio effects (gain, filter, reverb): create AudioNodes (`GainNode`, `BiquadFilterNode`, `ConvolverNode`), connect them, render via `OfflineAudioContext` to get a processed buffer, then offer playback + waveform.

For simple audio properties (duration, format detection), no AudioContext needed — just read metadata from a hidden `<audio>` element's `loadedmetadata` event.

### `3d` outputs (.glb, .gltf, .obj)

**→ `<model-viewer>` web component or Three.js.**

`<model-viewer>` from Google is the lightest option — `npm install @google/model-viewer` and use as a custom element. Renders glTF directly with built-in camera controls.

For Three.js, you control more but write more boilerplate. Use only when `<model-viewer>` doesn't fit (animations, custom shaders).

If `@google/model-viewer` isn't in `package.json`, flag it as a new dependency in Phase 2.

### `text` outputs

**→ Just render the string.**

The executor returns `{ type: 'text', data: [text] }`. The canvas card displays it directly with `<pre>` (preserve whitespace) or `<p>` (flow text). No "preview" computation needed in `executor.client.ts` beyond passing the value through.

For text transforms (uppercase, summarize, translate locally): apply the transform in JS and return the result. Pure string ops are trivially client-safe.

### `json` outputs

**→ Render structured data as a tree or formatted JSON.**

The canvas card shows `<pre>{JSON.stringify(data, null, 2)}</pre>` or a custom tree view. The `executor.client.ts` is mostly a pass-through.

### Multi-input (compositor / layered)

**→ Mirror the server-side compositing logic in Canvas 2D.**

Read each layer's URL from `inputs[layer.sourceHandleId]`, load images in parallel, draw onto an offscreen canvas with the per-layer transform (translate, rotate, scale, flip, opacity), `canvas.toDataURL('image/png')` for the result.

Reference: `lib/nodes/plugins/compositor/executor.client.ts`.

## Common pitfalls

### CORS taint on `canvas.toDataURL()`

Browsers block `toDataURL` if the canvas was painted with a cross-origin image without proper CORS headers. The Supabase storage URLs serve `Access-Control-Allow-Origin: *` so this works, BUT the browser caches the image WITHOUT the CORS header on a first non-CORS load.

Workaround: append a cache-busting query param to force a re-fetch:

```ts
const safeUrl = url.startsWith('data:')
  ? url
  : url + (url.includes('?') ? '&' : '?') + 'notaint=1';
img.src = safeUrl;
```

This is in every existing client executor — copy it.

### `typeof window === 'undefined'` guard

The first thing in every `executor.client.ts` should be:

```ts
export const fooClientExecutor: ClientExecutor = async (config, inputs) => {
  if (typeof window === 'undefined') return null;
  // ... rest
};
```

This makes the file safe to import accidentally during SSR or in a test.

### Returning the right envelope shape

Always return `{ type: <NodeDataType>, data: [<value>] }` (or `null` for "no preview yet"). Examples:

- Image: `{ type: 'image', data: [{ url: dataUrl }] }` (full ImageObject)
- Text: `{ type: 'text', data: [text] }`
- Multi-image: `{ type: 'image', data: [{url: u1}, {url: u2}] }`

Downstream consumers (`useNodeAutoCompute`, `toLegacyRenderableOutput`) expect this exact envelope.

### Debouncing

`useNodeAutoCompute` already debounces calls by 150ms. Don't add another layer of debouncing inside the executor — it'll feel sluggish.

### Heavy operations

If the operation takes more than ~500ms in the browser, the live preview will feel laggy. Options:
- Compute a downscaled preview (resize input to 512px, run the op, return the small result).
- Return `null` (no preview) and document why.
- Move expensive parts to a Web Worker (advanced — only if you really need it).

Most ephemeral image transforms run in single-digit ms on the browser side. If yours doesn't, reconsider whether a faster approximation is acceptable for the live preview (e.g. CSS filters instead of pixel math).

## Output contract

Same envelope as the server side: `{ type: NodeDataType, data: any[] }` or `null`. The runtime treats them identically — server output and client output flow through the same `nodeOutputs[id]` Zustand state.
