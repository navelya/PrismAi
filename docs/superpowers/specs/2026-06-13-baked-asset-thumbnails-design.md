# Baked asset thumbnails — design

**Date:** 2026-06-13
**Status:** Approved design, pending implementation plan

## Problem

Asset previews load slowly because we serve full-resolution media into small tiles:

- **Images** — the Assets page ([AssetsGallery.tsx](../../../components/assets/AssetsGallery.tsx)) and the editor side panel ([AssetsPanel.tsx](../../../components/editor/AssetsPanel.tsx)) rendered the full-res `result_url` directly into ~300–500px tiles. (An interim fix already routes these through Supabase's `/render/image/` transform via `toThumbnailUrl` — see "Relationship to the interim fix" below.)
- **Videos** — both galleries do `<video src={fullMp4} preload="auto">` on **every** tile, downloading every full clip up front. Supabase's image-transform endpoint **cannot** thumbnail video, so the URL-rewrite trick does nothing here. This is the biggest gap.

We also want to **stop depending on Supabase-specific features** ahead of a possible future migration off Supabase. The `/render/image/` rewrite is Supabase-only; a baked thumbnail file is portable.

## Goal

Generate our own thumbnail (a small static image) for every image and video result, stored as a portable sibling file, and serve it in all preview tiles. Fast previews now; migration-proof later.

## Approach: convention-based sibling file

Store each thumbnail as a sibling of its result in the same `chat-assets` bucket, with a `.thumb.webp` suffix replacing the original extension:

```
{userId}/{sessionId}/results/{nodeId}/result_{ts}_{i}.mp4    →  result_{ts}_{i}.thumb.webp
{userId}/{sessionId}/results/{nodeId}/result_{ts}_{i}.webp   →  result_{ts}_{i}.thumb.webp
```

The reader derives the thumbnail URL from the result URL by string transform and falls back to the original on error.

**Why this over a DB column:** results are persisted through the `claim_node_completion` RPC with `result_data` as a `string[]`, and `mirrorMediaToStorage` returns that `string[]` to three callers (replicate webhook, sweep-pending, complete-job). Many consumers (downstream nodes, chat, orchestrator) read `result_data` items as plain URL strings. A parallel `result_thumbnails` column would require modifying that RPC (the claim/billing path) and three caller signatures for no functional gain. The sibling-file convention needs **no schema change, no RPC change, and no caller changes** — `mirrorMediaToStorage` keeps returning `string[]` and just writes one extra file per result internally. It is also *more* migration-proof: the thumb is a file in the same bucket, so any future bucket move carries it automatically.

**Trade-off accepted:** the path-derivation rule lives in two places (the writer in media-mirror and the reader helper). It is a single small helper on each side, and the reader's onError fallback makes missing thumbnails self-healing (old/un-backfilled assets just show full-res, exactly as today).

## Components

### 1. Thumbnail generation — `lib/workflow/thumbnail.ts` (new) + `lib/workflow/media-mirror.ts`

A shared generator:

```
generateThumbnailBuffer(buffer: Buffer, resultType: NodeResultType): Promise<Buffer | null>
```

- **image** — `sharp(buffer).resize(512, 512, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 70 })`.
- **video** — write bytes to a temp file; lazy-import the same `fluent-ffmpeg` + `@ffmpeg-installer` + `@ffprobe-installer` stack that [extract_frame/executor.server.ts](../../../lib/nodes/plugins/extract_frame/executor.server.ts) already uses (and that [next.config.js](../../../next.config.js) already bundles for Vercel); grab the frame at `-ss 0` (1 frame), then pipe that frame through the same Sharp resize → WebP. Clean up the temp file.
- **audio / 3d** — return `null` (no thumbnail).

Video bytes are **never** modified — we only read a frame. No re-encode, no `+faststart` remux.

Integration: inside `mirrorMediaToStorage`'s `processOne`, after the result upload succeeds, call the generator on the buffer already in memory and upload the result to the sibling `.thumb.webp` path. The same hook is added to `uploadResultBuffer` (sync adapters); only its image branch produces a thumb, audio adapters get `null`.

**Best-effort contract:** thumbnail generation and upload are wrapped in try/catch. Any failure is logged and swallowed — it must never fail the result, never throw out of `mirrorMediaToStorage`/`uploadResultBuffer`, and never cause the node to be marked failed. A result without a thumbnail is valid; the reader falls back to full-res.

Thumbnail upload uses `upsert: true` (idempotent, matches the result upload) and the same `chat-assets` bucket. The bucket already allows `image/webp`.

### 2. Reader — `lib/utils/supabase-image.ts` (add helper) + 4 components

Add:

```
bakedThumbUrl(resultUrl: string | null | undefined): string | undefined
```

Strips the extension before any query string and appends `.thumb.webp`. Pass-through (returns input unchanged) for `data:`, `blob:`, and any non-`/storage/v1/object/public/` URL, so it is always safe to call.

Consumers:

- **Image tiles** — [AssetsGallery.tsx](../../../components/assets/AssetsGallery.tsx), [AssetsPanel.tsx](../../../components/editor/AssetsPanel.tsx), the ai_generator preview ([ai_generator/component.tsx](../../../lib/nodes/plugins/ai_generator/component.tsx)), and [BlurryImage.tsx](../../../components/ui/BlurryImage.tsx): `src = bakedThumbUrl(url)`, `onError` → original full-res (guarded so a genuinely broken original doesn't loop).
- **Video tiles** — AssetsGallery and AssetsPanel: `<video poster={bakedThumbUrl(url)} preload="none">`, with an **IntersectionObserver** that flips the tile to background-download the full clip (`preload="auto"`, or sets `src`) once it scrolls into view. On-screen tiles become hover-ready in the background; off-screen tiles (up to ~200 results) never download. Drag-to-canvas payloads and the lightbox continue to use the full-res `result_url` — only the tile preview is affected.

### 3. Backfill — `scripts/backfill-thumbnails.js` (new)

Walks `node_results` where `status = 'completed'` and `result_type in ('image','video')`, ordered newest-first. For each result URL: check whether the sibling `.thumb.webp` already exists (storage list/HEAD); if not, download the result, run `generateThumbnailBuffer`, and upload the thumb. Idempotent and resumable (existing thumbs are skipped), logs running counts and any per-item failures. Run manually against live Supabase + service role: `node scripts/backfill-thumbnails.js`. Reuses the same generator as the runtime path.

## Relationship to the interim fix

An interim change already shipped: image tiles in AssetsGallery and AssetsPanel request a Supabase `/render/image/` thumbnail via `toThumbnailUrl`, with onError fallback to the original. That is a Supabase-only stopgap. Once baked thumbnails exist (and the backfill has run), the baked `.thumb.webp` becomes the primary preview source for image tiles and the `toThumbnailUrl` render call is redundant. We may keep `toThumbnailUrl` as a secondary image-only fallback during the backfill window, then remove it from these tiles. `toThumbnailUrl`'s other use — the 32px LQIP placeholder in BlurryImage — is independent and stays.

## Data flow

1. Provider returns media URL(s) → `mirrorMediaToStorage` downloads bytes, re-encodes images to WebP, uploads the result.
2. Same pass: generate thumbnail buffer from the in-memory bytes → upload to sibling `.thumb.webp` (best-effort).
3. Result URL persisted unchanged via `claim_node_completion` (no thumb URL stored — it's derivable).
4. A preview component derives `bakedThumbUrl(resultUrl)` and uses it as image `src` / video `poster`; onError → full-res.

## Error handling

- Thumbnail generation/upload failure: logged, swallowed, result unaffected (reader falls back to full-res).
- ffmpeg unavailable / corrupt video: caught in the generator, returns `null`, no poster (full-res video still works).
- Sharp can't read an image: returns `null`, image tile falls back to full-res.
- Reader: `onError` on `<img>` swaps to the original once (guarded against loops); a missing video poster just shows the native blank video frame until the background download paints, same as today.
- Backfill: per-item try/catch, continues on failure, reports a tally.

## Testing

No automated test runner in this repo (per CLAUDE.md). Verification:

- `npx tsc --noEmit` clean (the reliable check here).
- Manual E2E: run an image-generating node and a video-generating node; confirm a `.thumb.webp` sibling appears in storage and the tile shows it (network panel shows the thumb, not the full file, on initial paint).
- Assets page: confirm image tiles load the thumb; video tiles show a poster instantly and only download clips as they scroll into view.
- Run the backfill against a handful of existing results; confirm idempotency on a second run.

## Out of scope

- `+faststart` remux of stored video (separate hover-loop-freeze concern; not needed for poster + background-download).
- Audio / 3d thumbnails.
- A DB column / queryable thumbnail index (the convention + storage listing covers backfill).
- Changing the lightbox or drag-to-canvas behaviour (still full-res).

## Files touched

- `lib/workflow/thumbnail.ts` — new shared generator.
- `lib/workflow/media-mirror.ts` — call generator + upload sibling thumb in `processOne` and `uploadResultBuffer`.
- `lib/utils/supabase-image.ts` — add `bakedThumbUrl`.
- `components/assets/AssetsGallery.tsx`, `components/editor/AssetsPanel.tsx` — image `src` + video `poster` + IntersectionObserver background download.
- `lib/nodes/plugins/ai_generator/component.tsx`, `components/ui/BlurryImage.tsx` — prefer baked thumb for image previews.
- `scripts/backfill-thumbnails.js` — new one-time backfill.

No migration, no RPC change, no `mirrorMediaToStorage` signature change, no `result_data` shape change.
