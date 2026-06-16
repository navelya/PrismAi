# Store Result Originals + Unified Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store every workflow result byte-for-byte (no WebP re-encode, so SVG stays SVG) and route every download through one shared, type-agnostic helper that saves the original file with the correct extension.

**Architecture:** A new pure module `lib/workflow/media-formats.ts` holds the canonical extension⇄content-type table and four lookup helpers. The server storage path (`media-mirror.ts`) stops re-encoding images and resolves the stored extension/content-type from response header → URL → SVG byte-sniff → type default. The client download path adds `downloadUrlAsFile()` and refactors all existing download call sites to reuse the shared helpers. Thumbnails are untouched.

**Tech Stack:** TypeScript, Next.js, Supabase Storage, `sharp` (thumbnails only after this change). No test runner in this repo — the verification gate per task is `npx tsc --noEmit`, with a manual E2E checklist at the end (matches repo practice).

---

## Spec

Design doc: [docs/superpowers/specs/2026-06-16-store-result-originals-and-unified-download-design.md](../specs/2026-06-16-store-result-originals-and-unified-download-design.md)

## File Structure

- **Create** `lib/workflow/media-formats.ts` — canonical format table + `contentTypeForExt` / `extForContentType` / `extFromUrl` / `defaultExtForType`. Pure: no `sharp`, no DOM. Importable from both server and client.
- **Modify** `lib/workflow/media-mirror.ts` — delete `prepareImageForStorage` + WebP branch; add `resolveStoredFormat`; store originals. Remove now-unused `sharp` import.
- **Modify** `lib/workflow/download-output.ts` — add `downloadUrlAsFile`; refactor `collectNodeMediaBlobs` ext logic onto the shared module; delete local `extensionFromUrl` / `extensionFromEnvelopeType`.
- **Modify** `components/ui/ImageLightbox.tsx` — `handleDownload` → `downloadUrlAsFile`.
- **Modify** `components/ui/ImageModal.tsx` — `handleDownload` → `downloadUrlAsFile`; relabel button.
- **Modify** `components/assets/AssetsGallery.tsx` — swap local `extFromUrl`/`extFromType` for shared helpers.

---

## Task 1: Canonical media-formats module

**Files:**
- Create: `lib/workflow/media-formats.ts`

- [ ] **Step 1: Create the module**

```ts
import { NodeResultType } from '@/lib/workflow/result-format';

/**
 * Single source of truth for how a media result's bytes map to a file
 * extension and HTTP content-type. Storage (media-mirror) and every download
 * path read from this table, so supporting a new format (e.g. another 3d
 * container) is a one-row change here — no new code paths.
 *
 * Pure module: MUST NOT import `sharp` or touch the DOM, so it is safe to
 * import from both server (media-mirror) and client (components).
 */
export interface FormatEntry {
  ext: string;
  contentType: string;
  kind: NodeResultType;
}

// Order matters for content-type → ext resolution: the FIRST matching entry
// wins, so the canonical extension for a content-type is listed first
// (e.g. image/jpeg → 'jpg', not 'jpeg').
export const MEDIA_FORMATS: FormatEntry[] = [
  // image
  { ext: 'png', contentType: 'image/png', kind: 'image' },
  { ext: 'jpg', contentType: 'image/jpeg', kind: 'image' },
  { ext: 'jpeg', contentType: 'image/jpeg', kind: 'image' },
  { ext: 'webp', contentType: 'image/webp', kind: 'image' },
  { ext: 'gif', contentType: 'image/gif', kind: 'image' },
  { ext: 'svg', contentType: 'image/svg+xml', kind: 'image' },
  { ext: 'avif', contentType: 'image/avif', kind: 'image' },
  { ext: 'bmp', contentType: 'image/bmp', kind: 'image' },
  { ext: 'tiff', contentType: 'image/tiff', kind: 'image' },
  // video
  { ext: 'mp4', contentType: 'video/mp4', kind: 'video' },
  { ext: 'webm', contentType: 'video/webm', kind: 'video' },
  { ext: 'mov', contentType: 'video/quicktime', kind: 'video' },
  // audio
  { ext: 'mp3', contentType: 'audio/mpeg', kind: 'audio' },
  { ext: 'wav', contentType: 'audio/wav', kind: 'audio' },
  { ext: 'ogg', contentType: 'audio/ogg', kind: 'audio' },
  { ext: 'm4a', contentType: 'audio/mp4', kind: 'audio' },
  { ext: 'flac', contentType: 'audio/flac', kind: 'audio' },
  // 3d
  { ext: 'glb', contentType: 'model/gltf-binary', kind: '3d' },
  { ext: 'gltf', contentType: 'model/gltf+json', kind: '3d' },
  { ext: 'usdz', contentType: 'model/vnd.usdz+zip', kind: '3d' },
];

const DEFAULT_EXT_BY_KIND: Record<NodeResultType, string> = {
  image: 'png',
  video: 'mp4',
  audio: 'mp3',
  '3d': 'glb',
  text: 'txt',
  json: 'json',
};

/** Extension (with or without a leading dot, any case) → content-type, or null. */
export function contentTypeForExt(ext: string): string | null {
  const e = ext.toLowerCase().replace(/^\./, '');
  const hit = MEDIA_FORMATS.find((f) => f.ext === e);
  return hit ? hit.contentType : null;
}

/** Content-type header value (params stripped) → canonical extension, or null. */
export function extForContentType(contentType: string): string | null {
  const ct = contentType.split(';')[0].trim().toLowerCase();
  const hit = MEDIA_FORMATS.find((f) => f.contentType === ct);
  return hit ? hit.ext : null;
}

/** Last path-segment extension of a URL (query/hash stripped), lowercased, or null. */
export function extFromUrl(url: string): string | null {
  const path = url.split('?')[0].split('#')[0];
  const m = path.match(/\.([a-z0-9]{1,5})$/i);
  return m ? m[1].toLowerCase() : null;
}

/** Fallback extension for a result kind, e.g. 'image' → 'png', '3d' → 'glb'. */
export function defaultExtForType(kind: NodeResultType): string {
  return DEFAULT_EXT_BY_KIND[kind] ?? 'bin';
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no errors). If `NodeResultType` import path is wrong, confirm it is exported from `lib/workflow/result-format.ts` (it is — `export type NodeResultType`).

- [ ] **Step 3: Commit**

```bash
git add lib/workflow/media-formats.ts
git commit -m "feat(media): canonical extension/content-type format table"
```

---

## Task 2: Store result originals (stop the WebP re-encode)

**Files:**
- Modify: `lib/workflow/media-mirror.ts`

- [ ] **Step 1: Replace the imports + delete the re-encode helper/constants**

Replace the top of the file (current lines 1–49: the `sharp` import, the `RESULT_WEBP_QUALITY` constant, the `IMAGE_EXT_CONTENT_TYPES` map, and the entire `prepareImageForStorage` function) with:

```ts
import { createServiceClient } from '@/lib/supabase/service';
import { NodeResultType } from '@/lib/workflow/result-format';
import { generateThumbnailBuffer, toThumbStoragePath, THUMB_CONTENT_TYPE } from '@/lib/workflow/thumbnail';
import {
  contentTypeForExt,
  extForContentType,
  extFromUrl,
  defaultExtForType,
} from '@/lib/workflow/media-formats';

// Results are stored byte-for-byte exactly as the provider returned them — no
// transcoding for ANY type (image incl. SVG, video, audio, 3d). The only
// derived data is the sibling `.thumb.webp` (see thumbnail.ts), which never
// replaces the original. The extension + content-type are resolved from the
// response header, then the URL, then an SVG byte-sniff, then the type default.

/**
 * Cheap defensive check: some providers serve SVG as text/plain or
 * application/octet-stream with no .svg in the URL. SVG is XML text, so the
 * leading bytes start with `<?xml` or `<svg`.
 */
function sniffSvg(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 256).toString('utf8').trimStart().toLowerCase();
  return head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'));
}

/**
 * Resolve the storage extension + content-type for a result's bytes.
 * Priority: response Content-Type header → URL extension → SVG sniff →
 * type default. Type-agnostic — identical logic for every media kind.
 */
function resolveStoredFormat(
  buffer: Buffer,
  headerContentType: string | null,
  sourceUrl: string | null,
  resultType: NodeResultType
): { ext: string; contentType: string } {
  if (headerContentType) {
    const ext = extForContentType(headerContentType);
    if (ext) return { ext, contentType: contentTypeForExt(ext)! };
  }
  if (sourceUrl) {
    const urlExt = extFromUrl(sourceUrl);
    if (urlExt) {
      const ct = contentTypeForExt(urlExt);
      if (ct) return { ext: urlExt, contentType: ct };
    }
  }
  if (resultType === 'image' && sniffSvg(buffer)) {
    return { ext: 'svg', contentType: 'image/svg+xml' };
  }
  const ext = defaultExtForType(resultType);
  return { ext, contentType: contentTypeForExt(ext) ?? 'application/octet-stream' };
}
```

Note: `uploadThumbnailBestEffort`, `WEBHOOK_MEDIA_EXTENSIONS`, `WEBHOOK_MEDIA_CONTENT_TYPES`, `fetchWithRetry`, and `MIRROR_CONCURRENCY` (current lines 51–117) stay exactly as they are — do not touch them.

- [ ] **Step 2: Update `uploadResultBuffer` to store originals**

In `uploadResultBuffer`, replace the image re-encode block (currently):

```ts
  let outBuffer = buffer;
  let outExt = ext;
  let outContentType = WEBHOOK_MEDIA_CONTENT_TYPES[resultType];
  if (resultType === 'image') {
    const prepared = await prepareImageForStorage(buffer, ext);
    outBuffer = prepared.buffer;
    outExt = prepared.ext;
    outContentType = prepared.contentType;
  }
```

with:

```ts
  // Store original bytes. The caller-supplied `ext` is treated as the format
  // hint (sync adapters know their own output format); fall back to sniff/default.
  const outBuffer = buffer;
  const { ext: outExt, contentType: outContentType } = resolveStoredFormat(
    buffer,
    contentTypeForExt(ext),
    null,
    resultType
  );
```

Everything below it in `uploadResultBuffer` (the `storagePath` using `outExt`, the upload using `outContentType`, the thumbnail call, the public-URL return) is unchanged.

- [ ] **Step 3: Update `mirrorMediaToStorage` (`processOne`) to store originals**

In `processOne`, replace the block (currently):

```ts
    const response = await fetchWithRetry(sourceUrl);
    const arrayBuffer = await response.arrayBuffer();
    let buffer: Buffer = Buffer.from(arrayBuffer);

    const extMatch = sourceUrl.match(/\.(png|jpe?g|webp|gif|mp4|webm|mov|avi|mkv|mp3|wav|ogg|m4a|aac|flac|glb|gltf|obj|fbx|stl|usd|usdz)(\?|$)/i);
    let ext = extMatch?.[1]?.toLowerCase() || WEBHOOK_MEDIA_EXTENSIONS[resultType];
    let contentType = WEBHOOK_MEDIA_CONTENT_TYPES[resultType];

    // Image results are re-encoded to full-resolution WebP before storage;
    // video/audio/3d keep their original bytes and extension.
    if (resultType === 'image') {
      const prepared = await prepareImageForStorage(buffer, ext);
      buffer = prepared.buffer;
      ext = prepared.ext;
      contentType = prepared.contentType;
    }
```

with:

```ts
    const response = await fetchWithRetry(sourceUrl);
    const headerContentType = response.headers.get('content-type');
    const arrayBuffer = await response.arrayBuffer();
    const buffer: Buffer = Buffer.from(arrayBuffer);

    // Store original bytes for every type; resolve ext/content-type from the
    // response header, then URL, then SVG sniff, then the type default.
    const { ext, contentType } = resolveStoredFormat(
      buffer,
      headerContentType,
      sourceUrl,
      resultType
    );
```

The rest of `processOne` (the `storagePath`, the `upload`, `uploadThumbnailBestEffort(supabase, buffer, resultType, storagePath)`, and the `getPublicUrl`) is unchanged. The thumbnail now receives the original bytes — correct (sharp rasterizes SVG; reads PNG/JPEG/WebP).

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS. If it complains about an unused `WEBHOOK_MEDIA_EXTENSIONS` / `WEBHOOK_MEDIA_CONTENT_TYPES`, leave them — they are exported and used elsewhere (verify with `grep -rn "WEBHOOK_MEDIA_CONTENT_TYPES" --include=*.ts`); they remain exported.

- [ ] **Step 5: Commit**

```bash
git add lib/workflow/media-mirror.ts
git commit -m "feat(media): store result originals byte-for-byte (no WebP re-encode)"
```

---

## Task 3: Shared download helper

**Files:**
- Modify: `lib/workflow/download-output.ts`

- [ ] **Step 1: Add the import**

At the top of `download-output.ts`, add:

```ts
import { extFromUrl, extForContentType, defaultExtForType } from '@/lib/workflow/media-formats';
```

- [ ] **Step 2: Delete the two local ext helpers**

Delete the local `extensionFromUrl` function (current lines 185–189) and the local `extensionFromEnvelopeType` function (current lines 191–199). They are replaced by the shared module.

- [ ] **Step 3: Repoint `collectNodeMediaBlobs` onto the shared helpers**

In `collectNodeMediaBlobs`, the graph-branch fallback line:

```ts
        const fallbackExt = extensionFromEnvelopeType(output) || 'mp4';
```

becomes:

```ts
        const fallbackExt = isOutputEnvelope(output)
          ? defaultExtForType(normalizeNodeResultType(output.type))
          : 'mp4';
```

And in BOTH media loops (the graph-branch loop and the main loop), replace the per-URL extension line:

```ts
            const ext = extensionFromUrl(url) || fallbackExt;
```

and (main loop):

```ts
        const ext = extensionFromUrl(url) || fallbackExt || 'bin';
```

with a fetch-then-name shape. For the **main loop**, replace its body so the blob is fetched first and the extension can fall back to the blob's content-type:

```ts
    for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const suffix = urls.length === 1 ? '' : `-${i + 1}`;
        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const blob = await resp.blob();
            const ext = extFromUrl(url) || extForContentType(blob.type) || fallbackExt || 'bin';
            items.push({ filename: `${safeLabel}${suffix}.${ext}`, blob });
        } catch (err) {
            console.error('[collectNodeMediaBlobs] fetch failed', url, err);
        } finally {
            onUnit?.();
        }
    }
```

where `fallbackExt` for the main loop is computed just above the loop as:

```ts
    const fallbackExt = isOutputEnvelope(output)
      ? defaultExtForType(normalizeNodeResultType(output.type))
      : null;
```

(replacing the current `const fallbackExt = extensionFromEnvelopeType(output);`).

For the **graph-branch** plain-URL loop, apply the same fetch-then-name pattern:

```ts
        for (let i = 0; i < urls.length; i++) {
            const url = urls[i];
            try {
                const resp = await fetch(url);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const blob = await resp.blob();
                const ext = extFromUrl(url) || extForContentType(blob.type) || fallbackExt;
                items.push({ filename: `${safeLabel}-${i + 1}.${ext}`, blob });
            } catch (err) {
                console.error('[collectNodeMediaBlobs] fetch failed', url, err);
            } finally {
                onUnit?.();
            }
        }
```

Confirm `normalizeNodeResultType` is already imported at the top of the file (it is — first import line). `isOutputEnvelope` is too.

- [ ] **Step 4: Add `downloadUrlAsFile`**

Add this exported function (next to `triggerBlobDownload`, reusing the existing `sanitizeLabel` and `triggerBlobDownload` already in the file):

```ts
/**
 * Fetch a single hosted result and save it AS-IS with the correct extension.
 * Type-agnostic: image / svg / video / audio / 3d all flow through identically.
 * Extension resolves from the URL, then the blob's content-type, then 'bin'.
 * On failure, falls back to opening the URL in a new tab.
 */
export async function downloadUrlAsFile(url: string, baseName: string): Promise<void> {
    const safe = sanitizeLabel(baseName);
    try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        const ext = extFromUrl(url) || extForContentType(blob.type) || 'bin';
        triggerBlobDownload(blob, `${safe}.${ext}`);
    } catch (err) {
        console.error('[downloadUrlAsFile] failed, opening in new tab', url, err);
        if (typeof window !== 'undefined') window.open(url, '_blank');
    }
}
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/workflow/download-output.ts
git commit -m "feat(download): shared downloadUrlAsFile + reuse canonical ext helpers"
```

---

## Task 4: Route ImageLightbox through the shared helper

**Files:**
- Modify: `components/ui/ImageLightbox.tsx`

- [ ] **Step 1: Add the import**

Add near the top imports:

```ts
import { downloadUrlAsFile } from '@/lib/workflow/download-output';
```

- [ ] **Step 2: Replace `handleDownload`**

Replace the entire `handleDownload` function (current lines 106–128) with:

```ts
    // Download handler — saves the original file as-is with the correct
    // extension (incl. .svg) via the shared helper.
    const handleDownload = async () => {
        await downloadUrlAsFile(mediaSrc, `output_${currentIndex + 1}`);
    };
```

`isVideo` / `isAudio` stay — they are still used for rendering.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/ui/ImageLightbox.tsx
git commit -m "fix(download): lightbox saves original file (fixes SVG saved as .jpg)"
```

---

## Task 5: Route ImageModal through the shared helper

**Files:**
- Modify: `components/ui/ImageModal.tsx`

- [ ] **Step 1: Add the import**

Add near the top imports:

```ts
import { downloadUrlAsFile } from '@/lib/workflow/download-output';
```

- [ ] **Step 2: Replace `handleDownload`**

Replace the `handleDownload` function (current lines 31–49) with:

```ts
    const handleDownload = async () => {
        setIsDownloading(true);
        try {
            await downloadUrlAsFile(imageUrl, 'prism-image');
        } finally {
            setIsDownloading(false);
        }
    };
```

- [ ] **Step 3: Relabel the button**

The button text currently reads `Download PNG` (current line 115). Change it from:

```tsx
                    {isDownloading ? 'Downloading...' : 'Download PNG'}
```

to:

```tsx
                    {isDownloading ? 'Downloading...' : 'Download'}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/ui/ImageModal.tsx
git commit -m "fix(download): image modal saves original format (was hardcoded PNG)"
```

---

## Task 6: AssetsGallery reuses the shared helpers

**Files:**
- Modify: `components/assets/AssetsGallery.tsx`

- [ ] **Step 1: Add the import**

Add to the imports:

```ts
import { extFromUrl, defaultExtForType } from '@/lib/workflow/media-formats';
```

- [ ] **Step 2: Delete the two local helpers**

Delete the local `extFromUrl` function (current lines 42–48) and the local `extFromType` function (current lines 50–57).

- [ ] **Step 3: Repoint the zip naming**

In `handleDownload`, change (current line 295):

```ts
                    const ext = extFromUrl(a.result_url) ?? extFromType(a.result_type);
```

to:

```ts
                    const ext = extFromUrl(a.result_url) ?? defaultExtForType(a.result_type);
```

`a.result_type` is an `AssetType` (`'image' | 'video' | 'audio' | '3d'`), a subset of `NodeResultType`, so it is assignable to `defaultExtForType`'s parameter. If `tsc` reports otherwise, the fix is a widening cast `defaultExtForType(a.result_type as NodeResultType)` with `NodeResultType` imported from `@/lib/workflow/result-format` — but try without the cast first.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/assets/AssetsGallery.tsx
git commit -m "refactor(assets): reuse canonical ext helpers for bulk download"
```

---

## Task 7: Final verification

- [ ] **Step 1: Full type-check**

Run: `npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 2: Confirm no orphaned references**

Run: `git grep -n "prepareImageForStorage\|extensionFromEnvelopeType\|extFromType\b"`
Expected: no matches in `lib/` or `components/` (only possibly in `docs/`). If a source match remains, it was missed above — fix it.

- [ ] **Step 3: Manual E2E (requires `npm run dev` + a live SVG-returning model)**

Verify each, with an SVG-returning AI node:
  - The stored result URL ends in `.svg` and the node renders it as an image.
  - **Card Download** (node card button) saves a `.svg` that opens as vector.
  - **Lightbox Download** saves `.svg`.
  - **Image modal Download** saves `.svg`.
  - **Assets page** single + multi-select zip contain `.svg`.
  - Regression: a normal PNG/JPEG generation still displays and downloads (now as its original format, not `.webp`); a video result still downloads as `.mp4`.

- [ ] **Step 4: Note the forward-only caveat**

No backfill: SVG results generated before this change are already rasterized WebP in storage and cannot be recovered. Only new generations carry true SVG. (Documented in the spec — no action, just confirm understanding before closing the task.)

---

## Self-Review Notes

- **Spec coverage:** Part A (store originals) → Task 2; new `media-formats` module → Task 1; `downloadUrlAsFile` + collect refactor → Task 3; lightbox/image-modal/assets call sites → Tasks 4/5/6; thumbnails untouched (Task 2 passes original bytes to the unchanged `uploadThumbnailBestEffort`); compositor intentionally untouched. Deferred converter is out of scope (not in any task, as intended).
- **Type consistency:** `extFromUrl`, `extForContentType`, `contentTypeForExt`, `defaultExtForType` are defined once in Task 1 and used with those exact names/signatures in Tasks 2/3/6. `downloadUrlAsFile(url, baseName)` defined in Task 3, called with that signature in Tasks 4/5.
- **No backfill / no migration:** confirmed — storage-path convention unchanged.
