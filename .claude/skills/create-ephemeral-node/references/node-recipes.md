# Node Shape Recipes

Every ephemeral node falls into one of four shapes. Pick the closest existing plugin as a structural reference and adapt — don't synthesize from scratch.

## 1. Transform — "in → out"

Single image (or other media) input, single output, a few inline numeric/select controls. The classic image filter.

**Reference plugin:** `lib/nodes/plugins/blur/`

**Examples:** `blur`, `levels`, `brightness`, `contrast`, `grayscale`, `rotate`, `resize`.

### Skeleton

- **`definition.ts`**: `family: 'utility'`, `category: 'utility'`, `meta.ephemeral: true`. One input handle (typically `image`), one output (typically `image_out`). 1–4 controls in `defaultConfig`. `aiSchema` lists the controls with `min/max/default/description`.
- **`executor.server.ts`**: Sharp pipeline. `fetch(imageUrl)` → `Buffer` → `sharp(...).filter().toBuffer()` → upload to `workflow-ephemeral-tmp` → return `{ success, data: [ImageObject] }`.
- **`executor.client.ts`**: Canvas 2D + CSS filters where possible (e.g. `ctx.filter = 'blur(Npx)'`). For more complex filters, pixel-level operations on the ImageData. Returns `{ type: 'image', data: [{ url: dataUrl }] }`.
- **`component.tsx`**: `BaseNode` + image preview at top + 1–3 controls below. Controls update via `updateNodeConfig`. `useNodeAutoCompute(id)` to wire the live preview.
- **No** `properties.tsx`, **no** `ui/` folder.

### Video-aware variant (filter that must accept compositor/graph upstream)

If the transform is video-capable (blur, contrast, grayscale of a clip…), its client executor must NOT bake pixels. Instead it wraps the upstream into a `kind: 'filter'` `GraphDescription` and re-publishes a graph envelope. See [live-data-flow.md](live-data-flow.md) for the full envelope contract; the canonical implementation is `lib/nodes/plugins/blur/executor.client.ts`.

Sketch:

```ts
import { GraphDescription } from '../compositor/shared';
import { CompositorLayer } from '../compositor/definition';
// Reuse the synthesis helper from blur, or copy the pattern:
//   wrapUrlAsCompositorGraph(url, resolution): GraphDescription
// (one-layer compositor graph around a raw URL). See blur/executor.client.ts.

// In the video branch of the executor:
const baseGraph: GraphDescription =
    upstreamGraph ?? wrapUrlAsCompositorGraph(url!, resolution);

const filterGraph: GraphDescription = {
    kind: 'filter',
    upstream: baseGraph,
    cssFilter: '<your css filter string>',
};

return {
    type: 'video',
    data: [{ url: '', graph: filterGraph, resolution }],
};
```

Notes:
- `cssFilter` belongs **inside the graph**, never as a sibling on the envelope data item.
- Output is uniformly a `kind: 'filter'` graph whether upstream was raw URL or already a graph — downstream consumers see one shape.
- The image branch stays a baked data URL as before; only the video branch produces a graph.

### Common pitfalls

- Don't carry forward UI-rescale logic from a Sharp call (e.g. `(radius/100)*20`). The runtime expects raw values consistent with what handlers.ts used historically. Check `git log -p lib/workflow/handlers.ts` (in pre-refactor history) for the canonical behavior.
- Default control values should produce a visually obvious effect — if `radius: 0` is the default, the user sees no preview and assumes the node is broken.

## 2. Source — "no input → out"

No upstream connections. The node IS the input UI: file upload, text entry, color picker, etc. The user manipulates the card directly to produce output.

**Reference plugin:** `lib/nodes/plugins/media_input/` (file upload), `lib/nodes/plugins/prompt/` (text entry)

**Examples:** `media_input` (image upload), `prompt` (text), and future `audio_recorder`, `color_picker`, `webcam_capture`, etc.

### Skeleton

- **`definition.ts`**: `family: 'input'`, `category: 'input'`, `meta.ephemeral: true` (live preview from user input — but for media_input the URLs are persistent so `ephemeral` may be false). `handles.inputs: []` (no inputs!). One output handle for the value the user produces. `aiSchema` describes how the AI brain should provide the input data when it generates this node from chat.
- **`executor.server.ts`**: Often just unwraps `config` into the output shape. For media_input this is `images: [{ url, path }]` already-uploaded URLs.
- **`executor.client.ts`**: Often a no-op or simple passthrough. The canvas card itself drives the live state via `updateNodeConfig`; the executor just normalizes the output envelope.
- **`component.tsx`**: The interactive UI lives here. File drop zones, drag-and-drop, recording controls, text fields, etc. This is where most of the work goes.

### Common pitfalls

- Source nodes often use Supabase Storage upload directly from the browser (see media_input's `handleFileUpload`). The skill should follow this pattern for any new file-upload-style source.
- The `aiSchema` is critical here — the chat brain needs to know how to populate this node from natural language. For prompt, the brain just sets `text`. For media_input, the brain needs to be told it can pre-populate `images` array entries with base64 strings.

## 3. Layered — "many inputs → composited out"

Multiple inputs (often via a single static handle with the array flag), heavy custom UI for arranging the layers, often a full-screen editor modal.

**Reference plugin:** `lib/nodes/plugins/compositor/`

**Examples:** `compositor` (image layers with transform), and future `video_timeline`, `audio_mix`, `multi_view_3d`.

### Skeleton

- **`definition.ts`**: `family: 'output'` (or `'utility'`), `category: 'utility'`. ONE input handle named `'<plural>'` (e.g. `layers`) with `is_array: true`. The handle's `expectedType` may be a union (`['image', 'text']`) if multiple types are accepted. `defaultConfig` includes `<plural>: []` (empty array of layer descriptors). `aiSchema` describes the layer item shape comprehensively — the brain needs to generate one layer entry per input edge.
- **`executor.server.ts`**: Read `inputs[layer.sourceHandleId]` for each layer. CRITICAL: `layer.sourceHandleId` is the EDGE ID, not a static handle name. The orchestrator's input map keys by both handle id and edge id; reach for `inputs[layer.sourceHandleId]` and trust the runtime. Process layers in `Promise.all`. Composite onto a base canvas (Sharp's `.composite()` for images, ffmpeg's `concat` for video timelines, etc.). Upload result, return `ImageObject`.
- **`executor.client.ts`**: Mirror the server compositing logic in browser-equivalent (Canvas 2D for image layers, etc.). Read inputs the same way (`inputs[layer.sourceHandleId]`).
- **`component.tsx`**: Card shows the composited preview + a button to open the editor modal. NOT inline controls — the editor modal is where the user manipulates layers.
- **`ui/EditorModal.tsx`**: The full-screen editor. Konva-based for images. Layer list (using `Reorder` from framer-motion), per-layer transform controls, canvas preview, presets, etc. Subscribes to upstream values via `useAppStore` + `useShallow` so it updates as the upstream nodes complete.
- **`shared.ts`**: Per-layer transform math (init centered, fit to canvas, etc.). Used by both server and client executors plus the EditorModal.
- The store's `workflow-slice.ts` has helpers to auto-create layer entries when an edge connects to a compositor (`buildAutoLayerForEdge`). New layered nodes following this pattern need analogous store wiring — point this out in Phase 2's plan.

### Common pitfalls

- Forgetting that `layer.sourceHandleId === edge.id`. Server-side input lookup MUST work via `inputs[edge.id]`, which the orchestrator and start route both populate via dual-keying.
- The aiSchema must include the layer item shape with `required: ['id', 'name', 'sourceHandleId', 'transform']`. Without this, the brain can't generate a valid compositor from chat.
- Keep the EditorModal in `ui/` — it's heavy and node-specific. Don't try to use a property panel.

## 4. Generative wrapper — "input → hosted ML model → out"

The node calls a Replicate model (or similar hosted service). The execution is async; the webhook completes the result. This is what `ai_generator` already does for any model in the `ai_models` DB table.

**Reference plugin:** `lib/nodes/plugins/ai_generator/`

### When NOT to make this a new ephemeral plugin

If the user asks for a node that:
- Removes a background
- Upscales an image
- Applies a hosted style transfer
- Generates an image/video/audio from a prompt
- Anything else that runs on a remote ML model

→ this is NOT an ephemeral node. Tell the user to instead **add a row to the `ai_models` table** in Supabase. The existing `ai_generator` plugin will then automatically expose it in the node palette with the right handles + controls, derived from the model's `inputs_schema` JSONB column. No new code needed.

The skill should refuse to build a new plugin for this case and point at the DB row instead.

### When IS this a legitimate new plugin

Only if the operation is genuinely different from the standard "input → Replicate → output" pattern, e.g.:
- Calls a non-Replicate hosted API (OpenAI, Gemini, custom internal service).
- Requires multi-step orchestration (call A, then B, then upload).
- Has a fundamentally different webhook flow.

In those cases, model on `ai_generator` and adapt — but this is rare and the user should be confident the answer isn't "just add a Replicate model row."

## Choosing the right shape

Quick decision tree:

- User wants media in via upload, mic, camera, text, etc. → **Source**.
- User wants to combine multiple inputs into one → **Layered**.
- User wants to call a hosted ML model → recommend **DB row in `ai_models`**, NOT a new plugin.
- Otherwise (single input → transformed single output) → **Transform**.
