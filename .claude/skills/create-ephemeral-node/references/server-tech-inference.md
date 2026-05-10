# Server Tech Inference

The skill picks the server-side library/service from the user's description. The user does NOT need to specify what to use — they describe what they want, the skill picks. Always state the choice and why in the Phase 2 plan; the user can override.

## Decision tree

### "blur / sharpen / resize / rotate / flip / crop / color adjustment / format conversion / threshold / grayscale / invert / channel mix / overlay / mask"

**→ Sharp.** Already a dependency. The fastest path. Documented at <https://sharp.pixelplumbing.com/>.

```ts
import sharp from 'sharp';

const buffer = await sharp(inputBuffer)
  .resize(targetW, targetH, { fit: 'fill' })
  .blur(radius)
  .toBuffer();
```

Reference: `lib/nodes/plugins/blur/executor.server.ts`, `lib/nodes/plugins/compositor/executor.server.ts`.

### "video — concat / trim / extract frame / change speed / rotate / scale / convert format / extract audio"

**→ ffmpeg-wasm-server.** This is `@ffmpeg/ffmpeg` running on the server. Heavy ops will be slow under serverless time limits — for anything beyond ~30 seconds, recommend a queued background job pattern (out of scope for the first version of a node; flag it).

```ts
import { FFmpeg } from '@ffmpeg/ffmpeg';
const ffmpeg = new FFmpeg();
await ffmpeg.load();
await ffmpeg.writeFile('input.mp4', new Uint8Array(buffer));
await ffmpeg.exec(['-i', 'input.mp4', '-vf', 'scale=640:480', 'output.mp4']);
const out = await ffmpeg.readFile('output.mp4');
```

If `@ffmpeg/ffmpeg` is not in `package.json`, the skill must call this out in Phase 2 — adding a dependency needs explicit approval before the build phase.

### "audio — trim / fade / convert / extract / mix"

**→ ffmpeg-wasm-server** (same as video).

For pure waveform analysis (RMS, peak, FFT for visualization) on short clips, `web-audio-api` polyfill server-side or pre-compute in client-only mode (no server work needed).

### "3D — convert format / decimate / re-bake textures / center / scale"

**→ Unclear.** No standard tool in this repo yet. Pause and ask the user before committing. Possible options:
- `three.js` server-side (limited, requires JSDOM hacks).
- A hosted service (Replicate, Meshy, etc.) — in which case it's a Replicate model, not an ephemeral node (use `ai_models` DB row).

### "background removal / upscale / style transfer / face restoration / inpaint / outpaint / depth estimation / super-resolution / colorization / cartoonify / any image-to-image AI thing"

**→ STOP.** This is a hosted ML model. Do NOT build a new ephemeral plugin.

Tell the user:
- Add a row to the `ai_models` Supabase table with the Replicate model ID, the `inputs_schema` (controls + handles), and `outputs_schema`.
- The existing `ai_generator` plugin will automatically expose it in the node palette with the right handles + controls.
- No new plugin code is needed.

The ONLY reason to build a new plugin for this is if the operation goes through a non-Replicate API (OpenAI, custom internal service, etc.) — and even then, the new plugin should structurally mirror `ai_generator`, not be ephemeral.

The Python `rembg` microservice on port 8000 is BEING DELETED — do not route to it. Background removal is now exclusively done via Replicate models.

### "transcribe / summarize / chat / translate / classify / generate text"

**→ STOP.** Same as above — hosted ML model. Use a Replicate model + `ai_generator` (or, for non-Replicate text models like OpenAI/Anthropic, follow ai_generator's pattern but with a different backend).

### "OCR / barcode / QR detection / object detection / pose estimation"

**→ Depends on accuracy/cost requirements.**
- For lightweight client-side: `tesseract.js` (OCR), `jsQR` (QR), etc. — these can run in `executor.client.ts` only, with `executor.server.ts` doing the same thing redundantly OR returning a placeholder. Live preview is high-quality.
- For accurate server-side: hosted ML model → `ai_generator` pattern.

For the first version of any vision-detection node, recommend client-side via a lightweight library. Server-side detection is usually a Replicate model.

### "color picker / palette extraction"

**→ Sharp.** Use `.stats()` for dominant colors, or `.raw()` + custom histogram for palette extraction.

### "render LaTeX / Markdown / SVG to image"

**→ Resvg / sharp.** Use `@resvg/resvg-js` for SVG, then composite with sharp. For markdown, render to HTML first with `marked` then to SVG via `satori` (`@vercel/satori`) — though this adds dependencies; flag it.

### "render text on image / overlay watermark"

**→ Sharp's text overlay** (Sharp 0.33+ has native text via `text` create). Or `satori` + sharp composite. Reach for sharp's built-in first.

## Output contract for any server tech

Regardless of tech choice, the executor must:

1. Return `NodeExecutionResult { success: boolean, data, error? }`.
2. For binary outputs (image, video, audio), upload to the `workflow-ephemeral-tmp` Supabase bucket using `createServiceClient` from `@/lib/supabase/service`.
3. Path convention: `${context.executionId}/${context.nodeId}/<type>_${Date.now()}.<ext>`.
4. Set `cacheControl: '3600'` on the upload. The `workflow-ephemeral-tmp` bucket is TTL'd via pg_cron — don't try to keep results.
5. Return `data: [ImageObject]` (or array of strings/objects) — the runtime extracts URLs via `result.data.map(d => d.url)` for images, falls back to `inferResultTypeFromValue` for unknown shapes.

NEVER upload to `workflow-assets` (that's the persistent bucket for finalized outputs) or `chat-assets` (chat-attached files only). Ephemeral outputs go to `workflow-ephemeral-tmp` exclusively.

## Adding new dependencies

If the chosen tech requires a package not already in `package.json`, the skill must:

1. Call it out explicitly in the Phase 2 plan.
2. Get user approval before installing.
3. Use `npm install <pkg>` (NOT yarn — the project uses npm).
4. Document the new dependency in the Phase 4 summary.

Don't silently add dependencies. The dep list is small and intentional.
