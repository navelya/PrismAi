# Upload conversion limits and lightbox download format selector

**Date:** 2026-05-11
**Status:** Approved for planning

## Goal

Cap Supabase Storage usage by enforcing per-attachment size limits on user uploads in chat, and let users pick the file format when downloading an image from the lightbox.

Three pieces:

1. **Image uploads** — keep the existing WebP conversion, but enforce a 5MB ceiling with quality + dimension fallbacks.
2. **Video uploads** — newly supported, hard-capped at 50MB. No transcoding.
3. **Lightbox download** — add a PNG/JPEG/WebP format selector (default PNG) that converts on the fly via `<canvas>`.

## Out of scope

- Server-side or browser-side video transcoding. Videos over 50MB are rejected with a toast; the user is responsible for shrinking them externally.
- Workflow-generated images and videos (the `extractAndUploadResultImages()` path in [lib/utils/image-processing.ts](../../../lib/utils/image-processing.ts)). If those need capping later, that's a separate spec.
- Chat brain / AI generator node consumption of video attachments. This spec only covers upload, storage, and lightbox download. Whether downstream code can use a video is a follow-up concern.

## Section 1 — Image upload pipeline

Extend `convertImageToWebP()` in [lib/utils/image-processing.ts](../../../lib/utils/image-processing.ts) to target a 5MB ceiling.

**Algorithm:**

1. Encode at WebP quality **0.8** → if size ≤ 5MB, return.
2. Retry at quality **0.6**, then **0.4**.
3. If still > 5MB at quality 0.4, **scale** the longest edge down to **4096px** (preserve aspect ratio) and retry 0.8 → 0.6 → 0.4.
4. If even the resized version at quality 0.4 is > 5MB, throw an error. The caller surfaces a toast: "Image too large, even after compression."

**Constants** to extract at the top of the module:

```ts
const TARGET_IMAGE_BYTES = 5 * 1024 * 1024;
const QUALITY_LADDER = [0.8, 0.6, 0.4];
const MAX_LONGEST_EDGE = 4096;
```

**Function signature stays the same** — returns a `Blob`. The conversion + resize is internal, so [lib/hooks/use-file-upload.ts](../../../lib/hooks/use-file-upload.ts) needs no changes for the image path.

## Section 2 — Video upload (new)

Three integration points:

1. **[components/chat/ChatInput.tsx](../../../components/chat/ChatInput.tsx)** — change the file input's `accept` from `"image/*"` to `"image/*,video/*"`.

2. **[lib/hooks/use-file-upload.ts](../../../lib/hooks/use-file-upload.ts)** — branch on `file.type.startsWith('video/')`:
   - If video and `file.size > 50 * 1024 * 1024` → reject with toast: `"Video too large — 50MB max."` Do not add it to the attachment list.
   - If video and within limit → skip the WebP conversion path. Upload the original `File` as-is.
   - If image → existing path (now with the size enforcement from Section 1).
   - Rename `IMAGE_CAP` to `ATTACHMENT_CAP` (value stays `4`) since the cap now covers images and videos together. Update the drag-and-drop handlers and any error messages that reference "image" to "attachment" or media-type-aware copy.
   - Also tighten the drag-and-drop handlers to use the same accept-and-reject logic. Currently `handleChatDrop` accepts anything starting with `image/`; it must now accept both prefixes and apply the size checks.

3. **[lib/utils/image-processing.ts](../../../lib/utils/image-processing.ts) `uploadImageToStorage()`** — **don't rename**. The function has server-side callers ([:80](../../../lib/utils/image-processing.ts#L80), [:128](../../../lib/utils/image-processing.ts#L128)) in the workflow-result upload path that aren't part of this feature. Instead, add an optional fourth argument `options?: { extension?: string; contentType?: string }` defaulting to `'webp'` / `'image/webp'`. Existing callers don't change; the new video path passes the actual extension and MIME type.

   Storage path: `chat-assets/{userId}/{timestamp}-{counter}-{random}.{ext}`. Bucket stays `chat-assets`.

**Extension extraction for videos:** Derive the extension from the original `File.name` (split on the last `.`). If the filename has no extension, fall back to deriving from `file.type` (e.g., `video/mp4` → `mp4`). If neither is available, use `bin`. This is a defensive edge case — the file picker normally produces well-named files.

**Metadata:** Existing attachment metadata storage (image URL inside chat messages) extends to video URLs with no schema change. Renderers consuming attachments need to be media-type-aware (already partially handled in `ImageLightbox` via `detectMediaTypeFromUrl`).

**Video upload architecture (resolved during planning):** A 50MB video as a base64 data URL inside a JSON request body would blow past Vercel's default 4.5MB serverless body limit, which is how images currently flow ([app/api/chat/stream/route.ts:439](../../../app/api/chat/stream/route.ts#L439)). To keep request bodies small, videos are **uploaded from the client directly to Supabase** at the moment the user picks the file (using the browser client from [lib/supabase/client.ts](../../../lib/supabase/client.ts)). The resulting public URL — not a data URL — is what gets pushed into the existing `attachedImages` array. The server-side handler in [route.ts:435-445](../../../app/api/chat/stream/route.ts#L435-L445) gains one branch: if the entry is already an `http(s)://` URL, push it straight to `attachedImageUrls` without re-uploading. The existing image flow (data URL → server-side upload via service role) is unchanged. Videos are automatically excluded from the model's vision attachments because `parseImageAttachments()` already requires a `data:image/...` prefix.

**RLS:** Client-side direct upload requires the `chat-assets` bucket to permit `authenticated` role INSERTs under the user's own folder. The plan includes a verification step; if the policy doesn't exist, the plan adds it via a Supabase migration.

**User message renderer:** [components/chat/Message.tsx:243-251](../../../components/chat/Message.tsx#L243-L251) currently renders every entry in `message.images` as `<img>`. It needs to detect media type (via `detectMediaTypeFromUrl`) and render `<video>` for video URLs.

## Section 3 — Lightbox format selector

In [components/ui/ImageLightbox.tsx](../../../components/ui/ImageLightbox.tsx), replace the single Download button with a split-button download control.

**UI:**

- For images: split button. Main button downloads in the currently selected format (default PNG). A small chevron next to it opens a dropdown listing PNG / JPEG / WebP. Selecting an option in the dropdown both updates the default *and* triggers a download immediately.
- For videos: keep the existing single Download button. No selector. Download the original file as-is.
- The split-button vs single-button choice is driven by `mediaType === 'image'`.

**Persistence:** Selected format is persisted in `localStorage` under key `prismai.lightbox.downloadFormat`. Default is `png` on first use. Read on mount, write on change. Wrap reads in a try/catch (some browsers throw when localStorage is disabled) and fall back to in-memory state.

**Conversion helper:** New file [lib/utils/image-format.ts](../../../lib/utils/image-format.ts) (new module — keeps `image-processing.ts` focused on the upload pipeline):

```ts
export type DownloadFormat = 'png' | 'jpeg' | 'webp';

export async function convertImageFormat(
  sourceUrl: string,
  format: DownloadFormat
): Promise<Blob>;
```

**Pipeline:**

1. `fetch(sourceUrl)` → `Blob`.
2. Decode via `createImageBitmap(blob)` (preferred — async, off-main-thread) or fall back to `<img>` + `onload` if `createImageBitmap` is unavailable.
3. Draw onto an offscreen `<canvas>` sized to the bitmap's natural dimensions.
4. For JPEG: fill the canvas with `#FFFFFF` before drawing the image (JPEG has no alpha — without the fill, transparent pixels render black).
5. `canvas.toBlob(callback, mimeType, quality)` where `mimeType` is `image/png` / `image/jpeg` / `image/webp` and `quality` is **0.92** for JPEG/WebP. PNG ignores quality.
6. Return the resulting `Blob`.

**Fast path:** If the source URL already ends with the requested extension (case-insensitive match on `.webp` / `.png` / `.jpg` / `.jpeg`), skip the canvas roundtrip and download the original blob. This avoids unnecessary re-encoding and quality loss when the user picks the format the file is already in.

**Filename:** Existing pattern `output_{N}.{ext}` stays. `{ext}` is now `png` / `jpg` / `webp` depending on the selected format (note: `jpeg` format → `.jpg` extension by convention).

**Error handling:** If conversion fails (CORS issue, image decode error, canvas tainted, etc.), fall through to the existing "open in new tab" fallback that's already in `handleDownload`. Show a toast: `"Couldn't convert — opened original in a new tab."`

## Data flow

```
User picks a file in ChatInput
    ↓
use-file-upload validates type
    ├── image/* → convertImageToWebP (5MB ladder) → uploadAttachmentToStorage(blob, userId, n, 'webp')
    └── video/* → size check (≤50MB) → uploadAttachmentToStorage(file, userId, n, originalExt)
    ↓
Supabase URL stored in message attachment metadata
    ↓
ImageLightbox renders image or video
    ↓
User clicks Download
    ├── image → convertImageFormat(url, selectedFormat) → blob download
    └── video → fetch original URL → blob download
```

## Files touched

- [lib/utils/image-processing.ts](../../../lib/utils/image-processing.ts) — extend `convertImageToWebP` with size ladder; add optional `options` arg to `uploadImageToStorage` (no rename).
- [lib/hooks/use-file-upload.ts](../../../lib/hooks/use-file-upload.ts) — accept videos, branch by media type, upload videos directly to Supabase, rename cap constant, update drag/drop handlers.
- [components/chat/ChatInterface.tsx](../../../components/chat/ChatInterface.tsx) — update file input `accept`.
- [components/chat/ChatEmptyState.tsx](../../../components/chat/ChatEmptyState.tsx) — update both file inputs (desktop + mobile) `accept`.
- [components/chat/Message.tsx](../../../components/chat/Message.tsx) — media-aware rendering for `message.images`.
- [app/api/chat/stream/route.ts](../../../app/api/chat/stream/route.ts) — recognize HTTP URLs in `attachedImages` and skip re-upload.
- [components/ui/ImageLightbox.tsx](../../../components/ui/ImageLightbox.tsx) — split-button UI, dropdown, conversion-on-download, localStorage persistence.
- **New:** [lib/utils/image-format.ts](../../../lib/utils/image-format.ts) — `convertImageFormat` helper.
