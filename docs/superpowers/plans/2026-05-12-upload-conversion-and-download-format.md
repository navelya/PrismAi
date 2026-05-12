# Upload conversion limits and lightbox download format selector — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cap Supabase Storage usage by enforcing per-attachment size limits on user uploads in chat, and let users pick the file format when downloading an image from the lightbox.

**Architecture:** Images keep flowing through the existing pipeline (client converts to WebP → data URL → server-side service-role upload), but `convertImageToWebP` gains a quality-then-resize ladder targeting a 5MB ceiling. Videos use a new client-side direct-to-Supabase upload at file-pick time (because 50MB data URLs would blow the request body limit) and arrive at the server as ready-made public URLs. The lightbox's download button becomes a split button with a format selector backed by a new `convertImageFormat` helper that re-encodes via `<canvas>.toBlob()`.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Supabase JS (browser + service-role clients), `<canvas>` 2D API, Tailwind, lucide-react icons.

**Source spec:** [docs/superpowers/specs/2026-05-11-upload-conversion-and-download-format-design.md](../specs/2026-05-11-upload-conversion-and-download-format-design.md)

**Testing note:** This project has no test runner — `npm run lint` and `npm run build` are the static gates, and behavior verification is by running `npm run dev` and exercising the UI in a browser. Each task includes the browser steps to confirm the change works.

---

## Phase 1 — Image upload: quality + resize ladder

### Task 1: Extend `convertImageToWebP` with size-targeted ladder

**Files:**
- Modify: `lib/utils/image-processing.ts:7-32`

- [ ] **Step 1: Replace the body of `convertImageToWebP` with the ladder algorithm.**

Replace lines 1-32 of `lib/utils/image-processing.ts` with:

```ts
/**
 * Converts a file to WebP format using client-side canvas, targeting a 5MB ceiling.
 *
 * Strategy:
 *   1. Encode at quality 0.8 → if ≤ 5MB, return.
 *   2. Retry at 0.6, then 0.4.
 *   3. If still oversized, scale longest edge to 4096px and retry 0.8 → 0.6 → 0.4.
 *   4. If even that fails, throw `ImageTooLargeError`.
 *
 * @param file The input file (image)
 * @returns Promise<Blob> The WebP blob, guaranteed ≤ 5MB on success.
 */
const TARGET_IMAGE_BYTES = 5 * 1024 * 1024;
const QUALITY_LADDER = [0.8, 0.6, 0.4] as const;
const MAX_LONGEST_EDGE = 4096;

export class ImageTooLargeError extends Error {
    constructor() {
        super('Image too large, even after compression');
        this.name = 'ImageTooLargeError';
    }
}

function decodeFileToImage(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = (err) => reject(err);
        img.src = URL.createObjectURL(file);
    });
}

function encodeCanvasToWebP(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (blob) resolve(blob);
                else reject(new Error('WebP conversion failed'));
            },
            'image/webp',
            quality
        );
    });
}

function drawToCanvas(img: HTMLImageElement, width: number, height: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context not supported');
    ctx.drawImage(img, 0, 0, width, height);
    return canvas;
}

async function encodeAtNaturalSize(img: HTMLImageElement): Promise<Blob | null> {
    const canvas = drawToCanvas(img, img.width, img.height);
    for (const quality of QUALITY_LADDER) {
        const blob = await encodeCanvasToWebP(canvas, quality);
        if (blob.size <= TARGET_IMAGE_BYTES) return blob;
    }
    return null;
}

async function encodeAtScaledSize(img: HTMLImageElement): Promise<Blob | null> {
    const longest = Math.max(img.width, img.height);
    if (longest <= MAX_LONGEST_EDGE) return null; // no point resizing
    const scale = MAX_LONGEST_EDGE / longest;
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = drawToCanvas(img, w, h);
    for (const quality of QUALITY_LADDER) {
        const blob = await encodeCanvasToWebP(canvas, quality);
        if (blob.size <= TARGET_IMAGE_BYTES) return blob;
    }
    return null;
}

export async function convertImageToWebP(file: File): Promise<Blob> {
    const img = await decodeFileToImage(file);

    const naturalResult = await encodeAtNaturalSize(img);
    if (naturalResult) return naturalResult;

    const scaledResult = await encodeAtScaledSize(img);
    if (scaledResult) return scaledResult;

    throw new ImageTooLargeError();
}
```

- [ ] **Step 2: Update the signature note for callers — `convertImageToWebP` no longer accepts a `quality` argument.** Grep to confirm no caller passes one:

Run: `Grep convertImageToWebP\\( in lib and components`
Expected: only one call site in `lib/hooks/use-file-upload.ts:23` and it passes `file` only.

- [ ] **Step 3: Verify the file builds.**

Run: `npm run lint`
Expected: no errors in `lib/utils/image-processing.ts`. Warnings about other files are fine.

Run: `npm run build`
Expected: completes successfully.

- [ ] **Step 4: Manual browser test.**

Run: `npm run dev`
1. Open the chat at `http://localhost:3000/chat`.
2. Attach a normal-sized photo (1–3MB). Confirm it appears as a preview.
3. Send the message. Confirm it round-trips successfully (image rendered in the chat).
4. Open the network panel; confirm the request body for `/api/chat/stream` is reasonable (the data URL of a webp under 5MB).

If you have a very large image handy (e.g., a 20MP photo), repeat to confirm it still ends up ≤ 5MB. Inspect the resulting blob size in DevTools by adding a temporary `console.log('webp size', webpBlob.size)` next to the call in `use-file-upload.ts:23`, then remove the log before committing.

- [ ] **Step 5: Commit.**

```bash
git add lib/utils/image-processing.ts
git commit -m "feat(upload): cap image attachments at 5MB via quality + resize ladder"
```

---

### Task 2: Surface a toast when an image is too large to compress

**Files:**
- Modify: `lib/hooks/use-file-upload.ts:17-66`
- Modify: `lib/hooks/use-file-upload.ts:1-15` (constants, state, return value)

The hook already has an eviction-toast pattern. Mirror it for the "too large" case so the user gets feedback instead of a silent drop.

- [ ] **Step 1: Add state and message constant.**

Edit `lib/hooks/use-file-upload.ts:1-15` to introduce the new constant + state:

```ts
import { useState, useRef, useCallback } from 'react';
import { convertImageToWebP, ImageTooLargeError } from '@/lib/utils/image-processing';

const IMAGE_CAP = 4;
const EVICTION_TOAST_MSG = 'Removed earliest photo — chat keeps the 4 most recent images active.';
const IMAGE_TOO_LARGE_TOAST_MSG = 'Image too large, even after compression. Try a smaller file.';

export function useFileUpload() {
    const [attachedImages, setAttachedImages] = useState<string[]>([]);
    const [isDragOver, setIsDragOver] = useState(false);
    const [evictionToast, setEvictionToast] = useState(false);
    const [imageTooLargeToast, setImageTooLargeToast] = useState(false);
    const attachedBlobsRef = useRef<Blob[]>([]);

    const dismissEvictionToast = useCallback(() => {
        setEvictionToast(false);
    }, []);

    const dismissImageTooLargeToast = useCallback(() => {
        setImageTooLargeToast(false);
    }, []);
```

- [ ] **Step 2: Update `handleImageFiles` to set the toast on `ImageTooLargeError`.**

Replace the existing `handleImageFiles` body (lines 17-66) with:

```ts
    const handleImageFiles = useCallback(async (files: FileList | null) => {
        if (!files || files.length === 0) return;

        let tooLargeSeen = false;

        const promises = Array.from(files).map(async (file) => {
            if (file.type.startsWith('image/')) {
                try {
                    const webpBlob = await convertImageToWebP(file);
                    const preview = await new Promise<string>((resolve) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result as string);
                        reader.readAsDataURL(webpBlob);
                    });
                    return { blob: webpBlob, preview };
                } catch (e) {
                    if (e instanceof ImageTooLargeError) {
                        tooLargeSeen = true;
                    } else {
                        console.error("Image conversion failed", e);
                    }
                    return null;
                }
            }
            return null;
        });

        const results = await Promise.all(promises);
        const validResults = results.filter((r): r is { blob: Blob, preview: string } => r !== null);

        if (tooLargeSeen) setImageTooLargeToast(true);
        if (validResults.length === 0) return;

        let evicted = false;
        setAttachedImages(prev => {
            const combined = [...prev, ...validResults.map(r => r.preview)];
            if (combined.length > IMAGE_CAP) {
                evicted = true;
                return combined.slice(combined.length - IMAGE_CAP);
            }
            return combined;
        });

        const combinedBlobs = [...attachedBlobsRef.current, ...validResults.map(r => r.blob)];
        if (combinedBlobs.length > IMAGE_CAP) {
            attachedBlobsRef.current = combinedBlobs.slice(combinedBlobs.length - IMAGE_CAP);
            evicted = true;
        } else {
            attachedBlobsRef.current = combinedBlobs;
        }

        if (evicted) setEvictionToast(true);
    }, []);
```

- [ ] **Step 3: Add the new toast values to the hook's return.**

Edit `lib/hooks/use-file-upload.ts:102-115` to include the new toast:

```ts
    return {
        attachedImages,
        attachedBlobsRef,
        isDragOver,
        handleImageFiles,
        handleChatDragOver,
        handleChatDragLeave,
        handleChatDrop,
        removeAttachedImage,
        clearAttachments,
        evictionToast,
        evictionToastMessage: EVICTION_TOAST_MSG,
        dismissEvictionToast,
        imageTooLargeToast,
        imageTooLargeToastMessage: IMAGE_TOO_LARGE_TOAST_MSG,
        dismissImageTooLargeToast,
    };
```

- [ ] **Step 4: Wire the new toast in `ChatInterface.tsx`.**

Open `components/chat/ChatInterface.tsx`. Find the destructuring at line 93-106 and add the three new fields. Then locate the existing eviction toast render (search for `evictionToast` in that file) and add a sibling render for `imageTooLargeToast`. Mirror the eviction toast's JSX one-to-one — same component, same position, just bound to the new state.

Run: `Grep evictionToast in components/chat/ChatInterface.tsx`
Expected: a render block using `evictionToast`, `evictionToastMessage`, `dismissEvictionToast` — copy/paste it as a second block bound to `imageTooLargeToast` / `imageTooLargeToastMessage` / `dismissImageTooLargeToast`.

If `ChatEmptyState.tsx` also renders the eviction toast (it shares the upload hook), mirror it there too.

- [ ] **Step 5: Verify the file builds.**

Run: `npm run lint`
Expected: no errors.

Run: `npm run build`
Expected: completes successfully.

- [ ] **Step 6: Manual browser test (optional but recommended).**

You need a pathological image to trigger this. Easiest path: temporarily change `MAX_LONGEST_EDGE` in `image-processing.ts` to a tiny value (e.g., 64) and `TARGET_IMAGE_BYTES` to something tiny (e.g., 1024), then upload any normal photo. The toast should appear. Revert both constants before committing.

- [ ] **Step 7: Commit.**

```bash
git add lib/hooks/use-file-upload.ts components/chat/ChatInterface.tsx components/chat/ChatEmptyState.tsx
git commit -m "feat(upload): toast when an image is too large to compress under 5MB"
```

---

## Phase 2 — Video upload

### Task 3: Generalize `uploadImageToStorage` with optional extension/contentType

**Files:**
- Modify: `lib/utils/image-processing.ts:44-67`

- [ ] **Step 1: Add the optional `options` parameter.**

Replace the existing `uploadImageToStorage` definition (lines 44-67) with:

```ts
export interface UploadOptions {
    extension?: string;     // e.g. 'webp' | 'mp4' | 'mov'. Defaults to 'webp'.
    contentType?: string;   // e.g. 'image/webp' | 'video/mp4'. Defaults to 'image/webp'.
}

/**
 * Uploads a blob to Supabase Storage and returns path and public URL.
 * Defaults to webp/image-webp for backwards compatibility with existing image callers.
 *
 * @param file The blob to upload
 * @param userId User ID for folder organization
 * @param supabase Supabase client instance
 * @param options Optional extension + MIME type overrides
 * @returns Object with { path, publicUrl }
 */
export async function uploadImageToStorage(
    file: Blob,
    userId: string,
    supabase: any,
    options: UploadOptions = {}
): Promise<{ path: string, publicUrl: string }> {
    const extension = options.extension ?? 'webp';
    const contentType = options.contentType ?? 'image/webp';

    const timestamp = Date.now();
    fileCounter = (fileCounter + 1) % 1000;
    const random = Math.random().toString(36).substring(7);
    const filename = `${userId}/${timestamp}-${fileCounter}-${random}.${extension}`;

    const { data, error } = await supabase.storage
        .from('chat-assets')
        .upload(filename, file, {
            contentType,
            upsert: false
        });

    if (error) {
        console.error("Upload failed", error);
        throw error;
    }

    const publicUrl = supabase.storage.from('chat-assets').getPublicUrl(data.path).data.publicUrl;
    return { path: data.path, publicUrl };
}
```

- [ ] **Step 2: Verify existing callers are unaffected.**

Run: `Grep uploadImageToStorage in lib and app`
Expected: three calls, all with three arguments only (`blob, userId, supabase`). They keep working because `options` defaults to `{}`.

- [ ] **Step 3: Build check.**

Run: `npm run lint && npm run build`
Expected: completes successfully.

- [ ] **Step 4: Commit.**

```bash
git add lib/utils/image-processing.ts
git commit -m "feat(upload): add optional extension/contentType to uploadImageToStorage"
```

---

### Task 4: Verify (or add) RLS policy for client-side uploads to chat-assets

**Files:**
- (Possibly) Create: `supabase/migrations/<timestamp>_chat_assets_authenticated_insert.sql`

The new video flow uploads from the browser using the user's session-scoped anon client. The `chat-assets` bucket must allow authenticated users to INSERT into a path scoped to their own `auth.uid()`.

- [ ] **Step 1: Check the current policies in the Supabase dashboard.**

Open Supabase dashboard → Storage → Policies → `chat-assets`. Look for an existing INSERT policy on `storage.objects` scoped to `bucket_id = 'chat-assets'` with `authenticated` role. Either:
- A policy already exists with the right scope → skip to Task 5.
- A policy exists but is too restrictive (e.g., service-role-only) → relax it or add a sibling for authenticated.
- No relevant policy exists → continue to Step 2.

- [ ] **Step 2: If absent, add a migration file.**

Create `supabase/migrations/20260512_chat_assets_authenticated_insert.sql` (the convention in this repo is `YYYYMMDD_short_name.sql`):

```sql
-- Allow authenticated users to upload into chat-assets under their own user-id folder
create policy "Authenticated users can upload to their chat-assets folder"
    on storage.objects for insert
    to authenticated
    with check (
        bucket_id = 'chat-assets'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

-- Allow authenticated users to read from chat-assets (bucket may already be public; this is defensive)
create policy "Authenticated users can read chat-assets"
    on storage.objects for select
    to authenticated
    using ( bucket_id = 'chat-assets' );
```

Apply the migration with the project's usual mechanism (e.g., `supabase db push` if Supabase CLI is wired up, or paste into the dashboard SQL editor). Check `STARTUP.md` / `DEPLOYMENT.md` for the team's preferred path.

- [ ] **Step 3: Verify with a one-off browser test in the existing app.**

Open the browser DevTools console while signed in:

```js
const { createClient } = await import('/lib/supabase/client.js');
const sb = createClient();
const { data: { user } } = await sb.auth.getUser();
const blob = new Blob(['test'], { type: 'text/plain' });
const res = await sb.storage.from('chat-assets').upload(`${user.id}/rls-probe-${Date.now()}.txt`, blob, { contentType: 'text/plain' });
console.log(res);
```

Expected: `res.data` populated, `res.error` null.
If `res.error` is non-null with an RLS message, the policy isn't right yet.

(If the dynamic import path doesn't resolve in DevTools, paste this into a temporary `app/_probe/page.tsx`, view it once, and delete it.)

- [ ] **Step 4: Commit (only if you added a migration).**

```bash
git add supabase/migrations/
git commit -m "chore(supabase): allow authenticated client uploads to chat-assets"
```

---

### Task 5: Accept videos in `useFileUpload` with direct-to-Supabase upload

**Files:**
- Modify: `lib/hooks/use-file-upload.ts` (entire file)

This is the largest task. The hook now handles two media types: images (existing path) and videos (new direct-upload path). `attachedImages` still holds strings, but the strings can now be either data URLs (images) or HTTP URLs (videos). `attachedBlobsRef` is no longer the source of truth for what to send — the strings in `attachedImages` are.

- [ ] **Step 1: Rewrite `lib/hooks/use-file-upload.ts`.**

Replace the entire file with:

```ts
import { useState, useRef, useCallback } from 'react';
import { convertImageToWebP, ImageTooLargeError, uploadImageToStorage } from '@/lib/utils/image-processing';
import { createClient } from '@/lib/supabase/client';

const ATTACHMENT_CAP = 4;
const VIDEO_MAX_BYTES = 50 * 1024 * 1024;

const EVICTION_TOAST_MSG = 'Removed earliest attachment — chat keeps the 4 most recent files active.';
const IMAGE_TOO_LARGE_TOAST_MSG = 'Image too large, even after compression. Try a smaller file.';
const VIDEO_TOO_LARGE_TOAST_MSG = 'Video too large — 50MB max.';
const VIDEO_UPLOAD_FAILED_TOAST_MSG = 'Video upload failed. Please try again.';

function extensionFromFile(file: File): string {
    const dotIdx = file.name.lastIndexOf('.');
    if (dotIdx > 0 && dotIdx < file.name.length - 1) {
        return file.name.slice(dotIdx + 1).toLowerCase();
    }
    // Fall back to MIME type (e.g., 'video/mp4' → 'mp4')
    if (file.type && file.type.includes('/')) {
        return file.type.split('/')[1].toLowerCase();
    }
    return 'bin';
}

export function useFileUpload() {
    // Strings here can be data URLs (images) OR https URLs (videos uploaded directly).
    const [attachedImages, setAttachedImages] = useState<string[]>([]);
    const [isDragOver, setIsDragOver] = useState(false);
    const [evictionToast, setEvictionToast] = useState(false);
    const [imageTooLargeToast, setImageTooLargeToast] = useState(false);
    const [videoTooLargeToast, setVideoTooLargeToast] = useState(false);
    const [videoUploadFailedToast, setVideoUploadFailedToast] = useState(false);
    // attachedBlobsRef is retained for backwards compatibility with handleSend's signature,
    // but it only contains image webp blobs. Videos are not blob-tracked locally because
    // they've already been uploaded by the time they appear in attachedImages.
    const attachedBlobsRef = useRef<Blob[]>([]);

    const dismissEvictionToast = useCallback(() => setEvictionToast(false), []);
    const dismissImageTooLargeToast = useCallback(() => setImageTooLargeToast(false), []);
    const dismissVideoTooLargeToast = useCallback(() => setVideoTooLargeToast(false), []);
    const dismissVideoUploadFailedToast = useCallback(() => setVideoUploadFailedToast(false), []);

    const processImage = useCallback(async (file: File): Promise<{ preview: string; blob: Blob } | null> => {
        try {
            const webpBlob = await convertImageToWebP(file);
            const preview = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.readAsDataURL(webpBlob);
            });
            return { blob: webpBlob, preview };
        } catch (e) {
            if (e instanceof ImageTooLargeError) {
                setImageTooLargeToast(true);
            } else {
                console.error('Image conversion failed', e);
            }
            return null;
        }
    }, []);

    const processVideo = useCallback(async (file: File): Promise<string | null> => {
        if (file.size > VIDEO_MAX_BYTES) {
            setVideoTooLargeToast(true);
            return null;
        }
        try {
            const supabase = createClient();
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                console.error('Cannot upload video: no authenticated user');
                setVideoUploadFailedToast(true);
                return null;
            }
            const extension = extensionFromFile(file);
            const { publicUrl } = await uploadImageToStorage(file, user.id, supabase, {
                extension,
                contentType: file.type || `video/${extension}`,
            });
            return publicUrl;
        } catch (e) {
            console.error('Video upload failed', e);
            setVideoUploadFailedToast(true);
            return null;
        }
    }, []);

    const handleImageFiles = useCallback(async (files: FileList | null) => {
        if (!files || files.length === 0) return;

        const processed = await Promise.all(Array.from(files).map(async (file) => {
            if (file.type.startsWith('image/')) {
                const result = await processImage(file);
                return result ? { kind: 'image' as const, preview: result.preview, blob: result.blob } : null;
            }
            if (file.type.startsWith('video/')) {
                const url = await processVideo(file);
                return url ? { kind: 'video' as const, preview: url } : null;
            }
            return null;
        }));

        const valid = processed.filter((p): p is NonNullable<typeof p> => p !== null);
        if (valid.length === 0) return;

        let evicted = false;
        setAttachedImages(prev => {
            const combined = [...prev, ...valid.map(v => v.preview)];
            if (combined.length > ATTACHMENT_CAP) {
                evicted = true;
                return combined.slice(combined.length - ATTACHMENT_CAP);
            }
            return combined;
        });

        // Keep blob ref synced with images (video entries contribute no blob — push a placeholder
        // so the index alignment with attachedImages is preserved for removeAttachedImage).
        const newBlobs: Blob[] = valid.map(v => v.kind === 'image' ? v.blob : new Blob());
        const combinedBlobs = [...attachedBlobsRef.current, ...newBlobs];
        if (combinedBlobs.length > ATTACHMENT_CAP) {
            attachedBlobsRef.current = combinedBlobs.slice(combinedBlobs.length - ATTACHMENT_CAP);
            evicted = true;
        } else {
            attachedBlobsRef.current = combinedBlobs;
        }

        if (evicted) setEvictionToast(true);
    }, [processImage, processVideo]);

    const handleChatDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer.types.includes('Files')) {
            setIsDragOver(true);
        }
    }, []);

    const handleChatDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const relatedTarget = e.relatedTarget as HTMLElement | null;
        if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
            setIsDragOver(false);
        }
    }, []);

    const handleChatDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        handleImageFiles(e.dataTransfer.files);
    }, [handleImageFiles]);

    const removeAttachedImage = useCallback((index: number) => {
        setAttachedImages(prev => prev.filter((_, i) => i !== index));
        attachedBlobsRef.current = attachedBlobsRef.current.filter((_, i) => i !== index);
    }, []);

    const clearAttachments = useCallback(() => {
        setAttachedImages([]);
        attachedBlobsRef.current = [];
    }, []);

    return {
        attachedImages,
        attachedBlobsRef,
        isDragOver,
        handleImageFiles,
        handleChatDragOver,
        handleChatDragLeave,
        handleChatDrop,
        removeAttachedImage,
        clearAttachments,
        evictionToast,
        evictionToastMessage: EVICTION_TOAST_MSG,
        dismissEvictionToast,
        imageTooLargeToast,
        imageTooLargeToastMessage: IMAGE_TOO_LARGE_TOAST_MSG,
        dismissImageTooLargeToast,
        videoTooLargeToast,
        videoTooLargeToastMessage: VIDEO_TOO_LARGE_TOAST_MSG,
        dismissVideoTooLargeToast,
        videoUploadFailedToast,
        videoUploadFailedToastMessage: VIDEO_UPLOAD_FAILED_TOAST_MSG,
        dismissVideoUploadFailedToast,
    };
}
```

- [ ] **Step 2: Wire the new toasts in `ChatInterface.tsx`.**

Open `components/chat/ChatInterface.tsx`. Add `videoTooLargeToast`, `videoTooLargeToastMessage`, `dismissVideoTooLargeToast`, `videoUploadFailedToast`, `videoUploadFailedToastMessage`, `dismissVideoUploadFailedToast` to the destructuring (around line 93-106). Add two more render blocks beneath the image-too-large toast block (which you added in Task 2), mirroring its JSX.

If `ChatEmptyState.tsx` uses the same hook, mirror the additions there too.

- [ ] **Step 3: Build check.**

Run: `npm run lint && npm run build`
Expected: completes successfully. Watch for unused-variable warnings around the new toast fields; if any block isn't yet rendered, either render it or strip the destructured field.

- [ ] **Step 4: Manual browser test.** (Defer full end-to-end test until after Task 6 + 7 — without those, the file picker still rejects videos and the server still won't accept HTTP URLs.)

For now, just verify the hook compiles and existing image attachment still works:
1. `npm run dev`
2. Attach a normal photo, send a message. Confirm no regression.

- [ ] **Step 5: Commit.**

```bash
git add lib/hooks/use-file-upload.ts components/chat/ChatInterface.tsx components/chat/ChatEmptyState.tsx
git commit -m "feat(upload): handle video files in useFileUpload with direct Supabase upload"
```

---

### Task 6: Update file inputs to accept videos

**Files:**
- Modify: `components/chat/ChatInterface.tsx:374`
- Modify: `components/chat/ChatEmptyState.tsx:70`
- Modify: `components/chat/ChatEmptyState.tsx:141`

- [ ] **Step 1: Update `ChatInterface.tsx:374`.**

```diff
-                accept="image/*"
+                accept="image/*,video/*"
```

- [ ] **Step 2: Update both inputs in `ChatEmptyState.tsx`.**

Same diff at lines 70 and 141.

- [ ] **Step 3: Build check.**

Run: `npm run lint && npm run build`
Expected: completes successfully.

- [ ] **Step 4: Commit.**

```bash
git add components/chat/ChatInterface.tsx components/chat/ChatEmptyState.tsx
git commit -m "feat(upload): accept video files in chat file pickers"
```

---

### Task 7: Server route — pass through HTTP URLs in `attachedImages`

**Files:**
- Modify: `app/api/chat/stream/route.ts:435-445`

- [ ] **Step 1: Replace the upload loop body.**

Find the block at lines 435-445 of `app/api/chat/stream/route.ts`:

```ts
  for (const item of rawAttached) {
    const url: string | undefined = typeof item === 'string' ? item : item?.dataUrl ?? item?.url;
    if (!url || !/^data:image\//.test(url)) continue;
    try {
      const { publicUrl } = await uploadBase64ToStorage(url, folder, supabase);
      attachedImageUrls.push(publicUrl);
    } catch (err) {
      console.error('[chat] image upload failed:', err);
    }
    if (attachedImageUrls.length >= 4) break; // hard cap consistent with parseImageAttachments
  }
```

Replace with:

```ts
  for (const item of rawAttached) {
    const url: string | undefined = typeof item === 'string' ? item : item?.dataUrl ?? item?.url;
    if (!url) continue;

    // Already-uploaded HTTPS URLs (videos, or any pre-uploaded asset) pass through unchanged.
    if (/^https?:\/\//.test(url)) {
      attachedImageUrls.push(url);
    } else if (/^data:image\//.test(url)) {
      // Legacy path: client sends an image as a base64 data URL; we upload here via service-role.
      try {
        const { publicUrl } = await uploadBase64ToStorage(url, folder, supabase);
        attachedImageUrls.push(publicUrl);
      } catch (err) {
        console.error('[chat] image upload failed:', err);
      }
    }
    // Other prefixes (e.g., data:video/...) are ignored — videos must use direct upload.

    if (attachedImageUrls.length >= 4) break;
  }
```

- [ ] **Step 2: Confirm `parseImageAttachments` still filters videos out of the model's vision input.**

Run: `Read app/api/chat/stream/route.ts:16-28`
Expected: the regex `/^data:(image\/(?:webp|png|jpeg|gif));base64,(.+)$/` is intact. Video URLs (https) and `data:video/...` are both excluded by this regex automatically, so Claude never sees a video as a vision block. No change needed here.

- [ ] **Step 3: Build check.**

Run: `npm run lint && npm run build`
Expected: completes successfully.

- [ ] **Step 4: Commit.**

```bash
git add app/api/chat/stream/route.ts
git commit -m "feat(chat-api): accept pre-uploaded HTTPS URLs in attachedImages"
```

---

### Task 8: Render videos in user message attachments

**Files:**
- Modify: `components/chat/Message.tsx:243-251`

The renderer currently emits `<img>` for every entry in `message.images`. For video URLs it must emit `<video>`.

- [ ] **Step 1: Import the media detector.**

Add to the imports at the top of `components/chat/Message.tsx`:

```ts
import { detectMediaTypeFromUrl } from '@/lib/workflow/result-format';
```

(Check imports first — if it's already imported, skip this step.)

- [ ] **Step 2: Update the render block.**

Replace lines 243-251 with:

```tsx
                    {message.type === 'user' && message.images && message.images.length > 0 && (
                        <div className="flex gap-2 flex-wrap mb-1">
                            {message.images.map((src, index) => {
                                const isVideo = detectMediaTypeFromUrl(src) === 'video';
                                return (
                                    <div key={index} className="w-20 h-20 rounded-lg overflow-hidden bg-black/20 border border-white/10 shadow-sm">
                                        {isVideo ? (
                                            <video src={src} muted className="w-full h-full object-cover" />
                                        ) : (
                                            <img src={src} alt={`Attachment ${index + 1}`} className="w-full h-full object-cover" />
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
```

- [ ] **Step 3: Build check.**

Run: `npm run lint && npm run build`
Expected: completes successfully.

- [ ] **Step 4: Full end-to-end browser test.**

Run: `npm run dev`
1. Sign in to the app, open or create a chat.
2. Click the attach button → pick a small video file (~5MB). It should briefly upload (network panel shows a PUT to Supabase storage) then appear as a 80×80 thumbnail. The thumbnail should be a `<video>` element (inspect to confirm).
3. Try a >50MB video → confirm the "Video too large" toast appears, no upload happens.
4. Send the message with a small video attached.
5. Confirm in the chat history the video renders as a `<video>` thumb in the user message.
6. Click the thumbnail → ImageLightbox opens, plays the video.
7. Drag-and-drop a video onto the chat → same result as clicking the picker.
8. Drag-and-drop a mix of an image + a video → both attach correctly.
9. Send a regular image attachment after the video work → confirm image flow still works (no regression).

- [ ] **Step 5: Commit.**

```bash
git add components/chat/Message.tsx
git commit -m "feat(chat): render video attachments in user messages"
```

---

## Phase 3 — Lightbox download format selector

### Task 9: New `convertImageFormat` helper

**Files:**
- Create: `lib/utils/image-format.ts`

- [ ] **Step 1: Create the file with full contents.**

```ts
export type DownloadFormat = 'png' | 'jpeg' | 'webp';

const MIME_BY_FORMAT: Record<DownloadFormat, string> = {
    png: 'image/png',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
};

const QUALITY = 0.92;

/**
 * Fetch an image URL and re-encode it as the requested format using a canvas.
 *
 * - JPEG fills white before drawing (no alpha → otherwise transparent pixels render black).
 * - PNG ignores the `quality` arg.
 * - If decoding fails, throws so the caller can fall back to opening the original URL.
 */
export async function convertImageFormat(
    sourceUrl: string,
    format: DownloadFormat
): Promise<Blob> {
    const response = await fetch(sourceUrl);
    if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
    const sourceBlob = await response.blob();

    let bitmap: ImageBitmap | HTMLImageElement;
    let width: number;
    let height: number;

    if (typeof createImageBitmap === 'function') {
        const bm = await createImageBitmap(sourceBlob);
        bitmap = bm;
        width = bm.width;
        height = bm.height;
    } else {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = (e) => reject(e);
            i.src = URL.createObjectURL(sourceBlob);
        });
        bitmap = img;
        width = img.width;
        height = img.height;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context not supported');

    if (format === 'jpeg') {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(bitmap as CanvasImageSource, 0, 0);

    return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (blob) resolve(blob);
                else reject(new Error('Canvas encode failed'));
            },
            MIME_BY_FORMAT[format],
            format === 'png' ? undefined : QUALITY
        );
    });
}

/** Map a DownloadFormat to its conventional file extension. */
export function extensionForFormat(format: DownloadFormat): string {
    return format === 'jpeg' ? 'jpg' : format;
}

/** Check if a URL already ends with the requested format's extension. */
export function urlMatchesFormat(url: string, format: DownloadFormat): boolean {
    const ext = extensionForFormat(format);
    const lower = url.toLowerCase();
    if (format === 'jpeg') {
        return lower.endsWith('.jpg') || lower.endsWith('.jpeg');
    }
    return lower.endsWith(`.${ext}`);
}
```

- [ ] **Step 2: Build check.**

Run: `npm run lint && npm run build`
Expected: completes successfully.

- [ ] **Step 3: Commit.**

```bash
git add lib/utils/image-format.ts
git commit -m "feat(utils): convertImageFormat helper for canvas-based re-encoding"
```

---

### Task 10: Split-button download in `ImageLightbox`

**Files:**
- Modify: `components/ui/ImageLightbox.tsx` (multiple sections)

- [ ] **Step 1: Add new imports and state.**

Update the imports at the top of `components/ui/ImageLightbox.tsx`:

```tsx
'use client';

import React, { useEffect, useCallback, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight, Download, ChevronDown } from 'lucide-react';
import { detectMediaTypeFromUrl } from '@/lib/workflow/result-format';
import { convertImageFormat, extensionForFormat, urlMatchesFormat, type DownloadFormat } from '@/lib/utils/image-format';
```

Just below the existing `const [mounted, setMounted] = useState(false);` line, add:

```tsx
    const [downloadFormat, setDownloadFormat] = useState<DownloadFormat>('png');
    const [formatMenuOpen, setFormatMenuOpen] = useState(false);
    const formatMenuRef = useRef<HTMLDivElement>(null);

    // Load persisted format choice on mount.
    useEffect(() => {
        try {
            const stored = window.localStorage.getItem('prismai.lightbox.downloadFormat');
            if (stored === 'png' || stored === 'jpeg' || stored === 'webp') {
                setDownloadFormat(stored);
            }
        } catch {
            // localStorage unavailable; stick with default
        }
    }, []);

    const persistFormat = useCallback((fmt: DownloadFormat) => {
        setDownloadFormat(fmt);
        try {
            window.localStorage.setItem('prismai.lightbox.downloadFormat', fmt);
        } catch {
            // ignore
        }
    }, []);

    // Close format menu on outside click.
    useEffect(() => {
        if (!formatMenuOpen) return;
        const onPointer = (e: PointerEvent) => {
            if (formatMenuRef.current && !formatMenuRef.current.contains(e.target as Node)) {
                setFormatMenuOpen(false);
            }
        };
        window.addEventListener('pointerdown', onPointer);
        return () => window.removeEventListener('pointerdown', onPointer);
    }, [formatMenuOpen]);
```

- [ ] **Step 2: Replace `handleDownload` with format-aware logic.**

Replace the existing `handleDownload` function (lines 64-81) with:

```tsx
    const triggerBlobDownload = useCallback((blob: Blob, filename: string) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    }, []);

    const handleVideoDownload = useCallback(async () => {
        try {
            const response = await fetch(mediaSrc);
            const blob = await response.blob();
            triggerBlobDownload(blob, `output_${currentIndex + 1}.mp4`);
        } catch {
            window.open(mediaSrc, '_blank');
        }
    }, [mediaSrc, currentIndex, triggerBlobDownload]);

    const handleImageDownload = useCallback(async (format: DownloadFormat) => {
        const filename = `output_${currentIndex + 1}.${extensionForFormat(format)}`;
        try {
            // Fast path — already in the requested format; skip the canvas roundtrip.
            if (urlMatchesFormat(mediaSrc, format)) {
                const response = await fetch(mediaSrc);
                if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
                triggerBlobDownload(await response.blob(), filename);
                return;
            }
            const blob = await convertImageFormat(mediaSrc, format);
            triggerBlobDownload(blob, filename);
        } catch (err) {
            console.error('Image download failed:', err);
            window.open(mediaSrc, '_blank');
        }
    }, [mediaSrc, currentIndex, triggerBlobDownload]);

    const handleDownload = useCallback(() => {
        if (isVideo) {
            void handleVideoDownload();
        } else {
            void handleImageDownload(downloadFormat);
        }
    }, [isVideo, handleVideoDownload, handleImageDownload, downloadFormat]);

    const handleFormatChoice = useCallback((fmt: DownloadFormat) => {
        persistFormat(fmt);
        setFormatMenuOpen(false);
        void handleImageDownload(fmt);
    }, [persistFormat, handleImageDownload]);
```

- [ ] **Step 3: Replace the download button JSX with a split button.**

Find the existing single download button (lines 104-113):

```tsx
            {/* Download button */}
            <button
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); handleDownload(); }}
                className="absolute top-4 right-16 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                title="Download image"
            >
                <Download className="w-6 h-6" />
            </button>
```

Replace with:

```tsx
            {/* Download control — split button for images, single button for videos */}
            {isVideo ? (
                <button
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); handleDownload(); }}
                    className="absolute top-4 right-16 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                    title="Download video"
                >
                    <Download className="w-6 h-6" />
                </button>
            ) : (
                <div
                    ref={formatMenuRef}
                    className="absolute top-4 right-16 flex items-center"
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                >
                    <button
                        onClick={(e) => { e.stopPropagation(); handleDownload(); }}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-l-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                        title={`Download as ${downloadFormat.toUpperCase()}`}
                    >
                        <Download className="w-5 h-5" />
                        <span className="text-xs font-medium uppercase">{downloadFormat}</span>
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); setFormatMenuOpen(o => !o); }}
                        className="px-2 py-2 rounded-r-full bg-white/10 hover:bg-white/20 text-white transition-colors border-l border-white/10"
                        title="Choose download format"
                        aria-expanded={formatMenuOpen}
                        aria-haspopup="menu"
                    >
                        <ChevronDown className="w-4 h-4" />
                    </button>
                    {formatMenuOpen && (
                        <div
                            role="menu"
                            className="absolute top-full right-0 mt-2 w-32 rounded-lg bg-black/90 backdrop-blur border border-white/10 shadow-2xl overflow-hidden"
                        >
                            {(['png', 'jpeg', 'webp'] as const).map(fmt => (
                                <button
                                    key={fmt}
                                    role="menuitem"
                                    onClick={(e) => { e.stopPropagation(); handleFormatChoice(fmt); }}
                                    className={`w-full text-left px-3 py-2 text-sm uppercase tracking-wide transition-colors ${
                                        fmt === downloadFormat ? 'bg-white/15 text-white' : 'text-white/80 hover:bg-white/10'
                                    }`}
                                >
                                    {fmt}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
```

- [ ] **Step 4: Build check.**

Run: `npm run lint && npm run build`
Expected: completes successfully.

- [ ] **Step 5: Manual browser test.**

Run: `npm run dev`
1. Open any chat with images attached or workflow output images.
2. Click an image to open the lightbox.
3. Confirm the download control is now a split button reading "PNG" with a chevron.
4. Click the main button → an `output_N.png` file should download.
5. Open the file — confirm it's a valid PNG (preview thumbnail, not corrupt).
6. Open the lightbox again, click the chevron → menu appears with PNG / JPEG / WEBP. The current default (PNG) is highlighted.
7. Click JPEG → file downloads as `output_N.jpg`. Menu closes.
8. Reload the page, open the lightbox again → the default is now JPEG (persisted). The main button reads "JPEG".
9. Click WEBP from the menu → downloads as `output_N.webp`. If the source image was already a WebP (`chat-assets/.../...webp`), the file should be byte-identical to the source (fast path — no canvas roundtrip).
10. Open the lightbox on a video → confirm only the single Download button shows (no chevron, no menu).
11. Test JPEG download on a transparent PNG (use a workflow-output image with alpha if available) — confirm the transparent area is white, not black.

- [ ] **Step 6: Commit.**

```bash
git add components/ui/ImageLightbox.tsx
git commit -m "feat(lightbox): split-button download with PNG/JPEG/WebP format selector"
```

---

## Phase 4 — Final verification

### Task 11: End-to-end smoke test and cleanup

- [ ] **Step 1: Run the full lint + build.**

Run: `npm run lint`
Expected: no new errors.

Run: `npm run build`
Expected: completes successfully.

- [ ] **Step 2: Full happy-path walkthrough.**

Run: `npm run dev`
Walk through each scenario:

1. **Image upload, normal size:** attach a 1MB photo → sends → renders in chat.
2. **Image upload, very large:** attach a 20MP photo → ladder kicks in → sends successfully; the data URL in the request body for `/api/chat/stream` is well under 5MB worth (visible in network tab).
3. **Video upload, within limit:** attach a 10MB mp4 → uploads to Supabase from the browser (network tab shows PUT to `*.supabase.co/storage/v1/...`) → renders as a video thumb in the chat → playable in the lightbox.
4. **Video upload, over limit:** attach a >50MB mp4 → toast appears, no upload.
5. **Mixed attachments:** attach two images + one video in one batch → all appear correctly.
6. **Lightbox PNG download:** open an image in the lightbox, click Download → PNG saves.
7. **Lightbox format switch:** open the dropdown, switch to JPEG, download → JPEG saves; reload page, default is JPEG.
8. **Lightbox video download:** open a video in the lightbox → single Download button, no chevron, downloads the mp4.

- [ ] **Step 3: Check for any dead code / leftover console.logs.**

Run: `Grep "console\\.log\\(" in lib/utils/image-processing.ts lib/utils/image-format.ts lib/hooks/use-file-upload.ts components/ui/ImageLightbox.tsx`
Expected: only intentional `console.error` calls. Remove any stray debug logs.

- [ ] **Step 4: Done.**

No final commit needed if Steps 1-3 are clean. If you removed any debug logs, commit them:

```bash
git commit -am "chore: remove debug logs"
```

---

## Summary of files touched

**Modified:**
- `lib/utils/image-processing.ts` — image ladder + optional upload options
- `lib/hooks/use-file-upload.ts` — video support, direct Supabase upload, new toasts
- `components/chat/ChatInterface.tsx` — file input `accept`, render new toasts
- `components/chat/ChatEmptyState.tsx` — file inputs `accept`, render new toasts
- `components/chat/Message.tsx` — media-aware attachment rendering
- `components/ui/ImageLightbox.tsx` — split-button download + format dropdown
- `app/api/chat/stream/route.ts` — pass-through for HTTPS URLs in `attachedImages`

**Created:**
- `lib/utils/image-format.ts` — `convertImageFormat`, `extensionForFormat`, `urlMatchesFormat`
- (Conditionally) `supabase/migrations/<timestamp>_chat_assets_authenticated_insert.sql` — RLS policy

**No schema changes** to application tables. Existing message storage continues to hold attachment URLs in `message.images`.
