# Store result originals + unified, type-agnostic download

**Date:** 2026-06-16
**Status:** Approved for planning

## Problem

Some AI nodes return SVG (vector) image results. Two things break the "view as image, download the real SVG" expectation:

1. **Storage rasterizes it.** Every result with `resultType === 'image'` is force-re-encoded to WebP in [media-mirror.ts](../../../lib/workflow/media-mirror.ts) (`prepareImageForStorage` → `sharp(buffer).webp()`). `sharp` reads SVG via librsvg, so it *succeeds* — silently flattening the vector into a raster WebP. The stored file is `.webp`, never `.svg`. The vector is gone before any download path even runs.
2. **Download paths guess the extension.** Even with correctly-stored bytes, several download handlers hardcode or heuristically guess the extension (`png` else `jpg`, or hardcoded `.png`), so an SVG would save as `output_1.jpg` — right bytes, wrong name.

Video, audio, and 3d results are *already* stored byte-for-byte; only images were being converted. So the root storage fix is narrow ("stop converting images"), but the download surface is fragmented and must be unified.

## Goal

- **Store every result byte-for-byte**, exactly as the provider returned it, for all media types (image incl. SVG, video, audio, future 3d). No format conversion at storage time.
- **Every download delivers that original file** with the correct extension, through one shared, type-agnostic helper — no per-format guessing, no divergent implementations.
- Thumbnails/posters are **unchanged** — still baked for fast previews.

## Out of scope (deferred)

- **Download-time format conversion** (e.g. "download this SVG as PNG/JPEG/WebP", or transcode video). The current request is satisfied by always delivering the original. A converter is a separate later spec.
- **Backfill.** Existing SVG results already in storage are already rasterized WebP and cannot be recovered. This change is forward-only; only new generations benefit. No DB migration — the storage-path convention is unchanged.
- **Input/upload pipeline.** User chat uploads keep their existing WebP conversion + size caps (see `2026-05-11-upload-conversion-and-download-format-design.md`). This spec only touches *result* storage and *result* download.

## Architecture

One new pure module holds the canonical format knowledge; storage and download both depend on it. This is the single point you edit to support a new format (e.g. 3d `glb`/`usdz`).

```
lib/workflow/media-formats.ts   (NEW — pure, no sharp / no DOM)
        ▲                  ▲
        │                  │
media-mirror.ts        download-output.ts
(server: storage)      (client: download helper)
                            ▲        ▲        ▲
                    ImageLightbox  ImageModal  AssetsGallery / EditorCanvas
```

### New module: `lib/workflow/media-formats.ts`

Pure data + functions, importable from both server (media-mirror) and client (components). MUST NOT import `sharp` or touch the DOM.

```ts
// Canonical extension ⇄ content-type table, grouped by kind. Adding a format
// (e.g. a new 3d type) is a single row here — every storage and download path
// picks it up automatically.
export interface FormatEntry { ext: string; contentType: string; kind: NodeResultType; }

export const MEDIA_FORMATS: FormatEntry[] = [
  // image
  { ext: 'png',  contentType: 'image/png',     kind: 'image' },
  { ext: 'jpg',  contentType: 'image/jpeg',    kind: 'image' },
  { ext: 'jpeg', contentType: 'image/jpeg',    kind: 'image' },
  { ext: 'webp', contentType: 'image/webp',    kind: 'image' },
  { ext: 'gif',  contentType: 'image/gif',     kind: 'image' },
  { ext: 'svg',  contentType: 'image/svg+xml', kind: 'image' },
  { ext: 'avif', contentType: 'image/avif',    kind: 'image' },
  { ext: 'bmp',  contentType: 'image/bmp',     kind: 'image' },
  { ext: 'tiff', contentType: 'image/tiff',    kind: 'image' },
  // video
  { ext: 'mp4',  contentType: 'video/mp4',     kind: 'video' },
  { ext: 'webm', contentType: 'video/webm',    kind: 'video' },
  { ext: 'mov',  contentType: 'video/quicktime', kind: 'video' },
  // audio
  { ext: 'mp3',  contentType: 'audio/mpeg',    kind: 'audio' },
  { ext: 'wav',  contentType: 'audio/wav',     kind: 'audio' },
  { ext: 'ogg',  contentType: 'audio/ogg',     kind: 'audio' },
  { ext: 'm4a',  contentType: 'audio/mp4',     kind: 'audio' },
  { ext: 'flac', contentType: 'audio/flac',    kind: 'audio' },
  // 3d
  { ext: 'glb',  contentType: 'model/gltf-binary', kind: '3d' },
  { ext: 'gltf', contentType: 'model/gltf+json',   kind: '3d' },
  { ext: 'usdz', contentType: 'model/vnd.usdz+zip', kind: '3d' },
];

// ext (no dot, lowercased) → content-type, e.g. 'svg' → 'image/svg+xml'
export function contentTypeForExt(ext: string): string | null;
// content-type (header value, params stripped) → ext, e.g. 'image/svg+xml' → 'svg'
export function extForContentType(contentType: string): string | null;
// last path-segment extension off a URL (query/hash stripped), lowercased, or null
export function extFromUrl(url: string): string | null;
// fallback extension for a result kind, e.g. 'image' → 'png', '3d' → 'glb'
export function defaultExtForType(kind: NodeResultType): string;
```

These subsume the ad-hoc helpers currently scattered across `download-output.ts` (`extensionFromUrl`, `extensionFromEnvelopeType`) and `AssetsGallery.tsx` (`extFromUrl`, `extFromType`). Those call sites are refactored to import from here.

### Resolving the stored extension + content-type (storage side)

In `media-mirror.ts`, after fetching the source bytes, resolve `(ext, contentType)` in this priority order — **type-agnostic, same logic for every kind**:

1. **Response `Content-Type` header** (strip `; charset=...`) via `extForContentType` — most reliable when a provider URL has no extension. Gives both ext and contentType.
2. **URL extension** via `extFromUrl` → `contentTypeForExt`.
3. **SVG byte-sniff** (defensive): if the leading bytes (trimmed) start with `<svg` or `<?xml` and contain `<svg`, treat as `svg` / `image/svg+xml`. Catches providers that mislabel SVG as `text/plain` or `application/octet-stream`.
4. **Type default** via `defaultExtForType(resultType)` + `contentTypeForExt`.

Then upload the **original buffer** with that `contentType` and store under `…/result_…_{i}.{ext}`. No `sharp` re-encode. `prepareImageForStorage` is **deleted** (and its `RESULT_WEBP_QUALITY` / `IMAGE_EXT_CONTENT_TYPES` constants).

Both write paths get this treatment:
- `mirrorMediaToStorage` (Replicate / poll-based providers, fetches from a URL — has the response header).
- `uploadResultBuffer` (sync adapters e.g. ElevenLabs, already hold raw bytes + a passed `ext` — use URL/ext/sniff path; no header). Adapters that pass an explicit `ext` keep it; the image WebP branch is removed.

### Thumbnails — unchanged

`uploadThumbnailBestEffort` / `generateThumbnailBuffer` still run on the **stored original bytes**. `sharp` rasterizes SVG (and reads PNG/JPEG/WebP/GIF) into the sibling `.thumb.webp`; `encodeVideoPoster` is untouched. A missing thumbnail remains best-effort/non-fatal. So previews stay fast and nothing in the gallery changes.

### Unified download helper (download side)

Add to [download-output.ts](../../../lib/workflow/download-output.ts):

```ts
// Fetch a hosted result and save it AS-IS with the correct extension.
// Type-agnostic: works for image/svg/video/audio/3d identically.
export async function downloadUrlAsFile(url: string, baseName: string): Promise<void>;
```

Extension resolution: `extFromUrl(url)` → else `extForContentType(blob.type)` → else `'bin'`. Filename = `sanitizeLabel(baseName).{ext}`. Saves via the existing `triggerBlobDownload`. On fetch failure, fall back to `window.open(url, '_blank')` (matches current lightbox behavior).

`collectNodeMediaBlobs` keeps its bulk/zip shape but its inline ext logic is swapped to the shared `extFromUrl` + `extForContentType(blob.type)` so it can't drift from the single-file helper.

### Download call sites routed through the shared logic

| Call site | Today | After |
|---|---|---|
| `collectNodeMediaBlobs` (card + bulk) | `extensionFromUrl` (local) | shared `extFromUrl` / `extForContentType` |
| `EditorCanvas` bulk zip | via `collectNodeMediaBlobs` | unchanged (inherits fix) |
| `AssetsGallery` zip | local `extFromUrl`/`extFromType` | shared `extFromUrl` / `defaultExtForType` |
| `ImageLightbox.handleDownload` | `png` else `jpg` guess | `downloadUrlAsFile(url, 'output_N')` |
| `ImageModal.handleDownload` | hardcoded `.png`, "Download PNG" | `downloadUrlAsFile(url, 'prism-image')`, button "Download" |
| `compositor` download | server ffmpeg render (mp4/still) | unchanged — bespoke render, not a stored original |

Compositor stays bespoke on purpose: it renders an artifact server-side rather than saving a stored file, so it has no "original" to pass through.

## Data flow (after)

```
Provider returns result URL/bytes (any kind, incl. image/svg+xml)
   ↓
media-mirror: fetch bytes → resolve (ext, contentType) [header → url → sniff → default]
   ↓ store ORIGINAL bytes  (+ best-effort .thumb.webp)
Public URL ends in the real extension (….svg, ….mp4, ….glb)
   ↓
Any download button → downloadUrlAsFile(url, name) / collectNodeMediaBlobs
   ↓ ext from URL → content-type → 'bin'
Saved file = byte-identical original with correct name
```

## Files touched

- **New:** [lib/workflow/media-formats.ts](../../../lib/workflow/media-formats.ts) — canonical format table + `contentTypeForExt` / `extForContentType` / `extFromUrl` / `defaultExtForType`.
- [lib/workflow/media-mirror.ts](../../../lib/workflow/media-mirror.ts) — delete `prepareImageForStorage` + image WebP branch in both `mirrorMediaToStorage` and `uploadResultBuffer`; resolve `(ext, contentType)` via the new module + SVG sniff; store originals. Thumbnail calls unchanged.
- [lib/workflow/download-output.ts](../../../lib/workflow/download-output.ts) — add `downloadUrlAsFile`; refactor `collectNodeMediaBlobs` ext logic to the shared module; drop local `extensionFromUrl`/`extensionFromEnvelopeType`.
- [components/ui/ImageLightbox.tsx](../../../components/ui/ImageLightbox.tsx) — `handleDownload` → `downloadUrlAsFile`.
- [components/ui/ImageModal.tsx](../../../components/ui/ImageModal.tsx) — `handleDownload` → `downloadUrlAsFile`; relabel button.
- [components/assets/AssetsGallery.tsx](../../../components/assets/AssetsGallery.tsx) — swap local `extFromUrl`/`extFromType` for the shared helpers.

## Verification

- `npx tsc --noEmit` clean (the repo's reliable check; `lint`/`build` are flaky here).
- Manual E2E: generate an SVG-returning node → confirm the stored result URL ends `.svg` and renders as an image on the node; card Download, lightbox Download, Image modal Download, Assets-page download, and multi-select zip each yield a `.svg` that opens as vector.
- Regression: a normal PNG/JPEG generation still displays and downloads correctly (now as its original format, not WebP); video/audio downloads unchanged.
