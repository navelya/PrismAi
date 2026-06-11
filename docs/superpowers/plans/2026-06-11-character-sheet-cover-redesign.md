# Character Sheet + Cover Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 6-image character model with a single photographic *character sheet* (the real output) plus an AI-generated *cover* (display-only); all creation paths fan out to 4 candidate sheets.

**Architecture:** New `sheet_url`/`cover_url` columns on `characters` (existing rows migrated). The generation pipeline produces one composite contact-sheet image per candidate (4 parallel Gemini calls) instead of 6 poses; the chosen sheet drives one more Gemini call for the cover. The character node outputs the sheet as a single-element `image_array` (downstream wiring unchanged) and falls back to old `referenceImages` for pre-existing saved workflows. A 3-step wizard (method → 4 candidates → confirm) is shared between create and variant.

**Tech Stack:** Next.js (app router, `nodejs` runtime), Supabase (Postgres + storage), `@google/genai` (Gemini 2.5 Flash Image), React + framer-motion, Zustand.

**Verification:** This repo has **no test runner**. Verify every task with `npx tsc --noEmit` (lint/build are unreliable here). Runtime behavior is verified in-app at the end. Migrations are applied to live Supabase by the operator (the user) — the plan flags when.

---

## Reference: current → new shape

- `CharacterSnapshot` ([lib/utils/character-refs.ts](../../../lib/utils/character-refs.ts)): drop `faceImage`, add `sheetUrl: string`, `coverUrl?: string`; `referenceImages` becomes `[sheetUrl]`.
- `CharacterConfig` ([lib/nodes/plugins/character/definition.ts](../../../lib/nodes/plugins/character/definition.ts)): add `sheetUrl: string`, `coverUrl?: string`; keep `referenceImages?: string[]` (optional, only present on old snapshots).
- `Character` / `CharacterInput` ([lib/api/client.ts](../../../lib/api/client.ts)): add `sheet_url`/`sheet_path`/`cover_url`/`cover_path` and the camelCase input fields.

---

## Task 1: DB migration — sheet/cover columns + backfill

**Files:**
- Create: `supabase/migrations/20260611_character_sheet_cover.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Character sheet + cover redesign.
-- sheet_url is the real reference/output (a photographic contact sheet);
-- cover_url is a display-only hero portrait derived from it.
ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS sheet_url  TEXT,
  ADD COLUMN IF NOT EXISTS sheet_path TEXT,
  ADD COLUMN IF NOT EXISTS cover_url  TEXT,
  ADD COLUMN IF NOT EXISTS cover_path TEXT;

-- Backfill existing characters so they keep working in the new model:
-- old primary (reference_images[0]) becomes the sheet; thumbnail becomes the cover.
UPDATE public.characters SET
  sheet_url  = reference_images->0->>'url',
  sheet_path = reference_images->0->>'path',
  cover_url  = COALESCE(thumbnail_url, reference_images->0->>'url'),
  cover_path = reference_images->0->>'path'
WHERE sheet_url IS NULL
  AND jsonb_typeof(reference_images) = 'array'
  AND jsonb_array_length(reference_images) > 0;
```

- [ ] **Step 2: Commit** (migration is applied to live Supabase by the operator later — see Task 13)

```bash
git add supabase/migrations/20260611_character_sheet_cover.sql
git commit -m "feat(characters): add sheet_url/cover_url columns + backfill migration"
```

---

## Task 2: Types + client API

**Files:**
- Modify: [lib/api/client.ts](../../../lib/api/client.ts) (the `Character`, `CharacterInput`, `CharacterRefImage`, `generateCharacterStream`, `generateCharacterVariantStream`, `charactersApi` block — explorer located it at ~274-436)
- Modify: [lib/utils/character-refs.ts](../../../lib/utils/character-refs.ts) (`CharacterSnapshot`)

- [ ] **Step 1: Update `CharacterSnapshot`** in `lib/utils/character-refs.ts` — replace `faceImage` with sheet/cover:

```ts
export interface CharacterSnapshot {
  characterId: string;
  name: string;
  description: string | null;
  sheetUrl: string;        // the character sheet — the only reference fed downstream
  coverUrl?: string;       // display-only hero portrait
  referenceImages: string[]; // = [sheetUrl]; kept so consumers stay array-shaped
  weight: number;
}
```

- [ ] **Step 2: Update the `Character` type** in `lib/api/client.ts` — add the new fields (keep the old ones for back-compat):

```ts
  sheet_url: string | null;
  sheet_path: string | null;
  cover_url: string | null;
  cover_path: string | null;
```

- [ ] **Step 3: Update `CharacterInput`** — add the new fields; `referenceImages` becomes optional:

```ts
export interface CharacterInput {
  name: string;
  description?: string | null;
  sheetUrl: string;
  sheetPath?: string;
  coverUrl?: string;
  coverPath?: string;
  referenceImages?: CharacterRefImage[]; // legacy; no longer required
  thumbnailUrl?: string;
  weight?: number;
}
```

- [ ] **Step 4: Update the streaming params + event type.** Change the stream event union from `image`/`pose_failed` to `sheet`/`sheet_failed`, and the request params:

```ts
export type SheetSetEvent =
  | { type: 'start'; total: number }
  | { type: 'sheet'; index: number; url: string; path: string }
  | { type: 'sheet_failed'; index: number }
  | { type: 'error'; message: string }
  | { type: 'done' };

// generateCharacterStream params:
//   { description?: string; baseImage?: { mimeType: string; data: string }; changes?: string }
// handlers: { onStart?(total), onSheet({index,url,path}), onSheetFailed?(index), onError?(msg), onDone?() }
```

Update both `generateCharacterStream` and `generateCharacterVariantStream` (variant params become `{ changes: string }`) to parse the new event names. Keep the same NDJSON line-reading loop.

- [ ] **Step 5: Add `charactersApi.generateCover`**:

```ts
  generateCover: async (sheetUrl: string): Promise<{ url: string; path: string }> => {
    const res = await fetch('/api/characters/cover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheetUrl }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Cover generation failed');
    return res.json();
  },
```

- [ ] **Step 6: Verify** `npx tsc --noEmit` — expect errors only in the files that still consume the old fields (handlers, modals, routes, executor) — those are fixed in later tasks. Commit.

```bash
git add lib/api/client.ts lib/utils/character-refs.ts
git commit -m "feat(characters): sheet/cover types + cover API + sheet stream events"
```

---

## Task 3: Prompt research + rewrite `reference-set.ts`

**Files:**
- Modify: [lib/characters/reference-set.ts](../../../lib/characters/reference-set.ts)

- [ ] **Step 1: Research.** Use WebSearch/WebFetch for current best-practice prompts for "character reference sheet / model sheet / turnaround sheet" and consistent-identity image generation with Gemini 2.5 Flash Image (Nano Banana). Capture the phrasings that most reliably yield (a) the same person across frames and (b) a clean contact-sheet layout. This informs Step 2's exact wording.

- [ ] **Step 2: Replace the prompt builders + helpers.** Remove `BASE_POSE`, `CONDITIONED_POSES`, `basePrompt`, `conditionedPrompt`, `facePrompt`, `restyleBasePrompt`, `restyleFacePrompt`, `streamPosesAndFace`. Keep `IMAGE_MODEL`, `STORAGE_BUCKET`, `GenImage`, `firstImagePart`, `fetchImageAsBase64`, `makeCharacterImageUploader`. Add:

```ts
export type SheetSetEvent =
  | { type: 'start'; total: number }
  | { type: 'sheet'; index: number; url: string; path: string }
  | { type: 'sheet_failed'; index: number }
  | { type: 'error'; message: string }
  | { type: 'done' };

export const SHEET_CANDIDATES = 4;

// The exact contact-sheet layout every sheet prompt enforces.
const SHEET_LAYOUT =
  'Lay it out as a clean photographic contact sheet with TWO horizontal rows on a plain solid neutral background. ' +
  'TOP ROW: four full-body photographs of the SAME person, head-to-toe, evenly spaced — ' +
  '(1) facing the camera, (2) left-facing profile, (3) right-facing profile, (4) facing away from the camera. ' +
  'BOTTOM ROW: three close-up photographic head-and-shoulders portraits of the SAME person — ' +
  '(1) facing the camera, (2) left-facing profile, (3) right-facing profile. ' +
  'Identical face, hair, body, outfit, and colors in every frame. Photorealistic, soft even studio lighting, ' +
  'sharp focus, no text, no labels, no watermark, no props, no borders.';

// Text → sheet. (Refine wording with Step 1 findings.)
export function sheetFromDescriptionPrompt(description: string): string {
  return `Create a character reference sheet for this person: ${description}. ${SHEET_LAYOUT}`;
}

// Uploaded photo → sheet. Identity comes from the provided image; `changes` are
// optional user-requested edits (outfit, hair color, etc.).
export function sheetFromImagePrompt(changes?: string): string {
  const edit = changes && changes.trim()
    ? ` Apply these changes to the character while keeping them clearly the same person: ${changes.trim()}.`
    : '';
  return (
    `Create a character reference sheet of the EXACT SAME person shown in the provided image — ` +
    `identical face, hair, and body.${edit} ${SHEET_LAYOUT}`
  );
}

// Existing character SHEET → restyled sheet (variant). `changes` required.
export function sheetVariantPrompt(changes: string): string {
  return (
    `The provided image is a reference sheet of a character. Create a NEW reference sheet of the EXACT SAME ` +
    `person — identical facial features, bone structure, and body proportions — with these changes: ${changes.trim()}. ` +
    `Keep them clearly recognizable as the same person. ${SHEET_LAYOUT}`
  );
}

// Chosen sheet → single display-only hero portrait (the cover).
export function coverPrompt(): string {
  return (
    `From the character shown in this reference sheet, create ONE clean hero portrait — a single ` +
    `three-quarter upper-body shot of the SAME person facing the camera, centered, ` +
    `plain solid neutral background, soft studio lighting, photorealistic, sharp focus, ` +
    `no text, no watermark, no contact-sheet grid, no multiple frames.`
  );
}
```

- [ ] **Step 3: Add a streaming sheet-candidate generator** that runs N image→image or text→image calls in parallel and streams each as it lands:

```ts
import { GoogleGenAI, Modality } from '@google/genai';

/** Generate SHEET_CANDIDATES sheets in parallel, streaming each as it settles.
 *  `source` is the conditioning image for image→image flows (upload / variant);
 *  omit it for text→image (describe). */
export async function streamSheetCandidates(opts: {
  ai: GoogleGenAI;
  prompt: string;
  source?: GenImage;
  uploadImage: (img: GenImage, index: number) => Promise<{ url: string; path: string } | null>;
  send: (e: SheetSetEvent) => void;
}): Promise<void> {
  const { ai, prompt, source, uploadImage, send } = opts;
  const genConfig = { responseModalities: [Modality.IMAGE] };
  const contents = source
    ? [{ inlineData: { mimeType: source.mimeType, data: source.data } }, { text: prompt }]
    : prompt;

  await Promise.all(
    Array.from({ length: SHEET_CANDIDATES }, (_, index) =>
      (async () => {
        try {
          const resp = await ai.models.generateContent({ model: IMAGE_MODEL, contents, config: genConfig });
          const img = firstImagePart(resp);
          if (!img) { send({ type: 'sheet_failed', index }); return; }
          const up = await uploadImage(img, index);
          if (up) send({ type: 'sheet', index, url: up.url, path: up.path });
          else send({ type: 'sheet_failed', index });
        } catch (e: any) {
          console.error('[reference-set] sheet failed:', e?.message);
          send({ type: 'sheet_failed', index });
        }
      })(),
    ),
  );
}

/** Chosen sheet → one cover image. Returns null on failure. */
export async function generateCover(opts: {
  ai: GoogleGenAI;
  sheet: GenImage;
  uploadImage: (img: GenImage, index: number) => Promise<{ url: string; path: string } | null>;
}): Promise<{ url: string; path: string } | null> {
  const { ai, sheet, uploadImage } = opts;
  const resp = await ai.models.generateContent({
    model: IMAGE_MODEL,
    contents: [{ inlineData: { mimeType: sheet.mimeType, data: sheet.data } }, { text: coverPrompt() }],
    config: { responseModalities: [Modality.IMAGE] },
  });
  const img = firstImagePart(resp);
  if (!img) return null;
  return uploadImage(img, 0);
}
```

- [ ] **Step 4: Verify** `npx tsc --noEmit` (errors remain only in the not-yet-updated routes). Commit.

```bash
git add lib/characters/reference-set.ts
git commit -m "feat(characters): sheet + cover prompts and streaming generators"
```

---

## Task 4: Rewrite `/api/characters/generate`

**Files:**
- Modify: [app/api/characters/generate/route.ts](../../../app/api/characters/generate/route.ts)

- [ ] **Step 1: Rewrite the handler** to fan out to 4 candidate sheets. Input: `{ description }` for text, or `{ baseImage: { mimeType, data }, changes? }` for upload. Keep auth + `GEMINI_API_KEY` guard + NDJSON streaming response shape.

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';
import { GoogleGenAI } from '@google/genai';
import {
  type GenImage, type SheetSetEvent, SHEET_CANDIDATES,
  sheetFromDescriptionPrompt, sheetFromImagePrompt,
  makeCharacterImageUploader, streamSheetCandidates,
} from '@/lib/characters/reference-set';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (auth.error) return auth.error;
  const { user, supabase } = auth;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'Image generation unavailable (GEMINI_API_KEY not set)' }, { status: 503 });

  let body: any;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const description = typeof body?.description === 'string' ? body.description.trim() : '';
  const changes = typeof body?.changes === 'string' ? body.changes.trim() : '';
  const rawBase = body?.baseImage;
  const uploadedBase: GenImage | null =
    rawBase && typeof rawBase.data === 'string' && rawBase.data.length > 0
      ? { mimeType: typeof rawBase.mimeType === 'string' ? rawBase.mimeType : 'image/png', data: rawBase.data }
      : null;

  if (!uploadedBase && description.length < 3) {
    return NextResponse.json({ error: 'Please describe the character (a few words), or upload a photo.' }, { status: 400 });
  }

  const ai = new GoogleGenAI({ apiKey });
  const uploadImage = makeCharacterImageUploader(supabase, user.id);
  const prompt = uploadedBase ? sheetFromImagePrompt(changes || undefined) : sheetFromDescriptionPrompt(description);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: SheetSetEvent) => controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'));
      try {
        send({ type: 'start', total: SHEET_CANDIDATES });
        await streamSheetCandidates({ ai, prompt, source: uploadedBase ?? undefined, uploadImage, send });
        send({ type: 'done' });
        controller.close();
      } catch (err: any) {
        console.error('[characters/generate] error:', err);
        try { send({ type: 'error', message: err?.message || 'Character generation failed' }); } catch {}
        try { controller.close(); } catch {}
      }
    },
  });

  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' } });
}
```

- [ ] **Step 2: Verify** `npx tsc --noEmit`. Commit.

```bash
git add app/api/characters/generate/route.ts
git commit -m "feat(characters): generate route fans out to 4 candidate sheets"
```

---

## Task 5: Rewrite `/api/characters/[id]/variant`

**Files:**
- Modify: [app/api/characters/[id]/variant/route.ts](../../../app/api/characters/[id]/variant/route.ts)

- [ ] **Step 1: Rewrite** to read the source `sheet_url`, condition on it with `sheetVariantPrompt(changes)`, and stream 4 candidates. Input is `{ changes }`.

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';
import { GoogleGenAI } from '@google/genai';
import {
  type GenImage, type SheetSetEvent, SHEET_CANDIDATES,
  sheetVariantPrompt, fetchImageAsBase64, makeCharacterImageUploader, streamSheetCandidates,
} from '@/lib/characters/reference-set';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getAuthenticatedUser();
  if (auth.error) return auth.error;
  const { user, supabase } = auth;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'Image generation unavailable (GEMINI_API_KEY not set)' }, { status: 503 });

  const id = params.id;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  let body: any;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const changes = typeof body?.changes === 'string' ? body.changes.trim() : '';
  if (changes.length < 3) return NextResponse.json({ error: 'Describe the changes first (a few words).' }, { status: 400 });

  // Prefer the new sheet_url; fall back to the old primary reference image.
  const { data: character, error } = await supabase
    .from('characters')
    .select('id, name, sheet_url, reference_images')
    .eq('id', id).eq('user_id', user.id).is('deleted_at', null).single();
  if (error || !character) return NextResponse.json({ error: 'Character not found' }, { status: 404 });

  const sheetUrl: string | undefined =
    (character as any).sheet_url || (Array.isArray((character as any).reference_images) ? (character as any).reference_images[0]?.url : undefined);
  if (!sheetUrl) return NextResponse.json({ error: 'Source character has no sheet to restyle.' }, { status: 400 });

  const ai = new GoogleGenAI({ apiKey });
  const uploadImage = makeCharacterImageUploader(supabase, user.id);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: SheetSetEvent) => controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'));
      try {
        send({ type: 'start', total: SHEET_CANDIDATES });
        let source: GenImage;
        try { source = await fetchImageAsBase64(sheetUrl); }
        catch { send({ type: 'error', message: 'Could not load the source sheet.' }); controller.close(); return; }
        await streamSheetCandidates({ ai, prompt: sheetVariantPrompt(changes), source, uploadImage, send });
        send({ type: 'done' });
        controller.close();
      } catch (err: any) {
        console.error('[characters/variant] error:', err);
        try { send({ type: 'error', message: err?.message || 'Variant generation failed' }); } catch {}
        try { controller.close(); } catch {}
      }
    },
  });

  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' } });
}
```

- [ ] **Step 2: Verify** `npx tsc --noEmit`. Commit.

```bash
git add "app/api/characters/[id]/variant/route.ts"
git commit -m "feat(characters): variant route restyles the sheet into 4 candidates"
```

---

## Task 6: New `/api/characters/cover`

**Files:**
- Create: `app/api/characters/cover/route.ts`

- [ ] **Step 1: Write the route** — fetch the chosen sheet, generate one cover, return `{ url, path }`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';
import { GoogleGenAI } from '@google/genai';
import { fetchImageAsBase64, makeCharacterImageUploader, generateCover } from '@/lib/characters/reference-set';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (auth.error) return auth.error;
  const { user, supabase } = auth;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'Image generation unavailable (GEMINI_API_KEY not set)' }, { status: 503 });

  let body: any;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const sheetUrl = typeof body?.sheetUrl === 'string' ? body.sheetUrl : '';
  if (!sheetUrl) return NextResponse.json({ error: 'sheetUrl is required' }, { status: 400 });

  const ai = new GoogleGenAI({ apiKey });
  const uploadImage = makeCharacterImageUploader(supabase, user.id);
  try {
    const sheet = await fetchImageAsBase64(sheetUrl);
    const cover = await generateCover({ ai, sheet, uploadImage });
    if (!cover) return NextResponse.json({ error: 'Could not generate a cover from the sheet.' }, { status: 502 });
    return NextResponse.json(cover);
  } catch (err: any) {
    console.error('[characters/cover] error:', err);
    return NextResponse.json({ error: err?.message || 'Cover generation failed' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify** `npx tsc --noEmit`. Commit.

```bash
git add app/api/characters/cover/route.ts
git commit -m "feat(characters): cover route generates a display portrait from a sheet"
```

---

## Task 7: CRUD routes persist sheet/cover

**Files:**
- Modify: [app/api/characters/route.ts](../../../app/api/characters/route.ts)
- Modify: [app/api/characters/[id]/route.ts](../../../app/api/characters/[id]/route.ts)

- [ ] **Step 1: GET/POST in `route.ts`.** Add the new columns to the `COLUMNS` constant and both `.select(...)` strings: append `, sheet_url, sheet_path, cover_url, cover_path`. In POST, accept `sheetUrl`/`sheetPath`/`coverUrl`/`coverPath`, require `sheetUrl`, and write them. Make `referenceImages` optional (legacy). Replace the `referenceImages.length === 0` guard with a `sheetUrl` guard:

```ts
  const sheetUrl = typeof body?.sheetUrl === 'string' ? body.sheetUrl : '';
  if (!sheetUrl) return NextResponse.json({ error: 'A character sheet is required' }, { status: 400 });
  const sheetPath = typeof body?.sheetPath === 'string' ? body.sheetPath : null;
  const coverUrl  = typeof body?.coverUrl === 'string' ? body.coverUrl : sheetUrl;
  const coverPath = typeof body?.coverPath === 'string' ? body.coverPath : null;
  const referenceImages = sanitizeRefImages(body?.referenceImages); // legacy, may be []
```

In the `.insert({...})`, add `sheet_url: sheetUrl, sheet_path: sheetPath, cover_url: coverUrl, cover_path: coverPath` and set `thumbnail_url: thumbnailUrl ?? coverUrl`. Keep writing `reference_images` only if non-empty (else `[]`).

- [ ] **Step 2: PATCH in `[id]/route.ts`.** Add the new columns to the `.select(...)`. Accept optional `sheetUrl`/`sheetPath`/`coverUrl`/`coverPath` and map to `update.sheet_url` etc. when present. Keep the existing reference_images branch for legacy edits.

```ts
  if (typeof body?.sheetUrl === 'string') update.sheet_url = body.sheetUrl;
  if (typeof body?.sheetPath === 'string') update.sheet_path = body.sheetPath;
  if (typeof body?.coverUrl === 'string') { update.cover_url = body.coverUrl; update.thumbnail_url = body.coverUrl; }
  if (typeof body?.coverPath === 'string') update.cover_path = body.coverPath;
```

- [ ] **Step 3: DELETE cleanup.** Extend the storage-path collection to also remove `sheet_path` and `cover_path` (owner-prefixed) alongside `reference_images` paths. Select `sheet_path, cover_path` too.

- [ ] **Step 4: Verify** `npx tsc --noEmit`. Commit.

```bash
git add app/api/characters/route.ts "app/api/characters/[id]/route.ts"
git commit -m "feat(characters): CRUD persists + cleans up sheet/cover"
```

---

## Task 8: Character node — definition, executor, component

**Files:**
- Modify: [lib/nodes/plugins/character/definition.ts](../../../lib/nodes/plugins/character/definition.ts)
- Modify: [lib/nodes/plugins/character/executor.server.ts](../../../lib/nodes/plugins/character/executor.server.ts)
- Modify: [lib/nodes/plugins/character/component.tsx](../../../lib/nodes/plugins/character/component.tsx)

- [ ] **Step 1: `CharacterConfig`** — add sheet/cover, keep legacy optional:

```ts
export interface CharacterConfig {
  characterId: string;
  name: string;
  sheetUrl?: string;          // present on new snapshots
  coverUrl?: string;          // display-only
  referenceImages?: string[]; // legacy snapshots only
  description?: string;
  weight?: number;
}
```

- [ ] **Step 2: Executor** — output the sheet as a single-element array, falling back to legacy `referenceImages`:

```ts
export const characterExecutor = async (config: CharacterConfig, _input: any, _context: ExecutionContext): Promise<NodeExecutionResult> => {
  try {
    const urls = config?.sheetUrl
      ? [config.sheetUrl]
      : (Array.isArray(config?.referenceImages) ? config.referenceImages : []);
    if (urls.length === 0) {
      return { success: false, data: null, error: `Character "${config?.name || 'unknown'}" has no character sheet.` };
    }
    const imageObjects: ImageObject[] = urls.map((url, index) => ({
      url,
      resolution: { width: 800, height: 600 },
      metadata: { title: `${config.name || 'Character'} sheet`, source: 'Character', format: typeof url === 'string' && url.includes('image/png') ? 'png' : 'jpg' },
    }));
    return { success: true, data: imageObjects };
  } catch (error) {
    return { success: false, data: null, error: error instanceof Error ? error.message : 'Failed to resolve character sheet' };
  }
};
```

- [ ] **Step 3: Component** — show the cover (fallback sheet, then legacy primary). Remove the "+N more" badge:

```tsx
const coverUrl = config?.coverUrl || config?.sheetUrl || config?.referenceImages?.[0];
// render <img src={coverUrl}> ... fallback UserCircle icon when absent.
```

- [ ] **Step 4: Verify** `npx tsc --noEmit`. Commit.

```bash
git add lib/nodes/plugins/character
git commit -m "feat(characters): node outputs the sheet, displays the cover"
```

---

## Task 9: Chat hydration — snapshot + handlers

**Files:**
- Modify: [app/api/chat/stream/route.ts](../../../app/api/chat/stream/route.ts) (~573-594, the snapshot build)
- Modify: [lib/chat/tools/handlers.ts](../../../lib/chat/tools/handlers.ts) (~170-224, the hydration loop)

- [ ] **Step 1: Snapshot build** in `app/api/chat/stream/route.ts` — select `sheet_url, cover_url` and build the new snapshot shape:

```ts
      const { data: rows } = await supabase
        .from('characters')
        .select('id, name, description, sheet_url, cover_url, reference_images, weight')
        .or(`user_id.eq.${sessionOwner.user_id},is_shared.eq.true`)
        .is('deleted_at', null).eq('is_draft', false).in('id', mentionedCharacterIds);
      characterRefs = (rows ?? []).map((r: any) => {
        const legacy = Array.isArray(r.reference_images) ? r.reference_images : [];
        const sheetUrl: string =
          r.sheet_url || (typeof legacy[0] === 'string' ? legacy[0] : legacy[0]?.url) || '';
        return {
          characterId: r.id,
          name: r.name,
          description: r.description ?? null,
          sheetUrl,
          coverUrl: r.cover_url ?? undefined,
          referenceImages: sheetUrl ? [sheetUrl] : [],
          weight: typeof r.weight === 'number' ? r.weight : 70,
        };
      }).filter((s: any) => s.sheetUrl);
```

- [ ] **Step 2: Hydration loop** in `lib/chat/tools/handlers.ts` — remove the `multiCharacter` face/primary budget branch; every character hydrates to its single sheet. Set the node config:

```ts
    node.data.config = {
      characterId: snap.characterId,
      name: snap.name,
      sheetUrl: snap.sheetUrl,
      coverUrl: snap.coverUrl,
      referenceImages: [snap.sheetUrl],
      description: snap.description ?? '',
      weight: snap.weight,
    };
```

Delete the now-unused `multiCharacter`/`newCharIds`/`existingCharIds` computation and the comment block describing the per-character image budget (lines ~175-195). Update the surrounding comment to say each character feeds exactly its sheet.

- [ ] **Step 3: Verify** `npx tsc --noEmit`. Commit.

```bash
git add app/api/chat/stream/route.ts lib/chat/tools/handlers.ts
git commit -m "feat(characters): chat hydration feeds the single sheet per character"
```

---

## Task 10: Shared wizard components

**Files:**
- Create: `components/assets/character-wizard/SheetCandidateGrid.tsx`
- Create: `components/assets/character-wizard/CharacterConfirmStep.tsx`
- Create: `components/assets/character-wizard/types.ts`

These two components are reused by both `CharacterModal` and `CharacterVariantModal`.

- [ ] **Step 1: `types.ts`** — shared slot type:

```ts
import type { CharacterRefImage } from '@/lib/api/client';
export type SheetSlot = CharacterRefImage | null | 'failed';
```

- [ ] **Step 2: `SheetCandidateGrid.tsx`** — a 2×2 grid of large sheet tiles. Props:

```tsx
interface Props {
  slots: SheetSlot[];          // length = total candidates; null = loading, 'failed' = error
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  generating: boolean;
}
```

Render each slot at a large size (e.g. `aspect-[4/3]`, grid `grid-cols-2 gap-3`): show the image when present (click → `onSelect(index)`, ring highlight when `selectedIndex === index`), a pulsing skeleton when `null`, an X tile when `'failed'`. The contact sheet is wide — use `object-contain` on a neutral background so the whole sheet is visible.

- [ ] **Step 3: `CharacterConfirmStep.tsx`** — selected sheet + cover preview + fields. Props:

```tsx
interface Props {
  sheet: CharacterRefImage;
  cover: CharacterRefImage | null;   // null while generating
  coverLoading: boolean;
  name: string; onName: (v: string) => void;
  description: string; onDescription: (v: string) => void;
  weight: number; onWeight: (v: number) => void;
  onAutoDescribe: () => void; describing: boolean;
  onBack: () => void;          // back to candidate grid
}
```

Layout: left = selected sheet (large, `object-contain`); right = cover preview (square; spinner while `coverLoading`), Name input, Description textarea + Auto-describe button, weight slider. (Save lives in the parent modal footer.)

- [ ] **Step 4: Verify** `npx tsc --noEmit`. Commit.

```bash
git add components/assets/character-wizard
git commit -m "feat(characters): shared sheet-candidate grid + confirm step"
```

---

## Task 11: Rewrite `CharacterModal` into the wizard

**Files:**
- Modify: [components/assets/CharacterModal.tsx](../../../components/assets/CharacterModal.tsx)

- [ ] **Step 1: Replace the modal body with a 3-step state machine.** State: `step: 'method' | 'candidates' | 'confirm'`, plus `slots: SheetSlot[]`, `selectedSheet`, `cover`, `coverLoading`, and the existing `name`/`description`/`weight`. Widen the dialog to `max-w-3xl` for `candidates`/`confirm`.

  - **method step:** two choices — *Describe* (the existing description textarea + a "Generate sheets" button calling `runGeneration({ description })`) and *Upload image* (file picker → on file, downscale via `downscaleImageToBase64`, show preview + a **changes** textarea + "Generate sheets" calling `runGeneration({ baseImage, changes })`).
  - **candidates step:** render `<SheetCandidateGrid>`; a "Regenerate" button re-runs the last generation; selecting a tile sets `selectedSheet`, kicks `generateCover`, and advances to `confirm`.
  - **confirm step:** render `<CharacterConfirmStep>`; footer Save calls `onSave`.

- [ ] **Step 2: `runGeneration`** — adapt the existing streaming accumulator to the new `onSheet`/`onSheetFailed` handlers; on `start` create `total` null slots; advance to `step='candidates'`:

```tsx
const runGeneration = async (params: { description?: string; baseImage?: { mimeType: string; data: string }; changes?: string }) => {
  setGenerating(true); setErrorMsg(null); setStep('candidates');
  const slots: SheetSlot[] = [];
  try {
    await generateCharacterStream(params, {
      onStart: (total) => { slots.length = 0; for (let i = 0; i < total; i++) slots.push(null); setSlots([...slots]); },
      onSheet: ({ index, url, path }) => { if (index >= 0 && index < slots.length) slots[index] = { url, path }; setSlots([...slots]); },
      onSheetFailed: (index) => { if (slots[index] === null) slots[index] = 'failed'; setSlots([...slots]); },
      onError: (m) => setErrorMsg(m),
    });
  } catch (e) { setErrorMsg(e instanceof Error ? e.message : 'Generation failed'); }
  finally { setGenerating(false); }
};
```

- [ ] **Step 3: `handleSelectSheet`** — set the sheet, generate the cover in the background, advance:

```tsx
const handleSelectSheet = async (index: number) => {
  const slot = slots[index];
  if (!slot || slot === 'failed') return;
  setSelectedSheet(slot); setSelectedIndex(index); setCover(null); setStep('confirm');
  setCoverLoading(true);
  try { const c = await charactersApi.generateCover(slot.url); setCover({ url: c.url, path: c.path }); }
  catch { setCover(slot); /* fall back to the sheet as cover */ }
  finally { setCoverLoading(false); }
};
```

- [ ] **Step 4: `handleSave`** — send the new input shape:

```tsx
await onSave({
  name: name.trim(),
  description: description.trim() || null,
  sheetUrl: selectedSheet!.url, sheetPath: selectedSheet!.path,
  coverUrl: (cover ?? selectedSheet!).url, coverPath: (cover ?? selectedSheet!).path,
  weight,
}, initial?.id);
```

  Guard: require `name` and `selectedSheet`. Update `onSaveDraft` (dismiss path) the same way, only when a sheet is selected. For **edit mode** (`initial` present), seed `step='confirm'`, `selectedSheet` from `initial.sheet_url`, `cover` from `initial.cover_url`.

- [ ] **Step 5: Remove** the old multi-image management: `images`/`genSlots` 6-slot state, `handleFiles`/`makePrimary`/`toggleFace`/`removeImage`, `MAX_IMAGES`, the role/primary tile UI, and the `Star`/`ScanFace` imports. Auto-describe now points at `selectedSheet.url` (or `cover.url`).

- [ ] **Step 6: Verify** `npx tsc --noEmit`. Commit.

```bash
git add components/assets/CharacterModal.tsx
git commit -m "feat(characters): CharacterModal becomes a sheet/cover wizard"
```

---

## Task 12: Rewrite `CharacterVariantModal` to reuse the wizard

**Files:**
- Modify: [components/assets/CharacterVariantModal.tsx](../../../components/assets/CharacterVariantModal.tsx)

- [ ] **Step 1: Replace the single-shot flow** with: a **changes** textarea (replacing the "New style" box) → "Generate variants" calls `generateCharacterVariantStream(source.id, { changes }, handlers)` → `<SheetCandidateGrid>` → select → `generateCover` → `<CharacterConfirmStep>` (name defaults to `"${source.name} (variant)"`) → Save as a new character via `onSave` with the sheet/cover input shape (same as Task 11 Step 4). Reuse the exact `runGeneration`/`handleSelectSheet`/`handleSave` patterns from Task 11 (selecting from `slots`, background cover, new `CharacterInput`).

- [ ] **Step 2: Verify** `npx tsc --noEmit`. Commit.

```bash
git add components/assets/CharacterVariantModal.tsx
git commit -m "feat(characters): variant modal reuses the sheet/cover wizard"
```

---

## Task 13: Cards, hook, and final sweep

**Files:**
- Modify: [components/assets/CharacterCard.tsx](../../../components/assets/CharacterCard.tsx)
- Modify: [components/editor/CharactersPanel.tsx](../../../components/editor/CharactersPanel.tsx)
- Modify: [lib/hooks/use-characters.ts](../../../lib/hooks/use-characters.ts) (only if it references removed fields)

- [ ] **Step 1: Card thumbnails** — prefer `cover_url` then `sheet_url` then legacy:

```tsx
const thumb = character.cover_url || character.sheet_url || character.thumbnail_url || character.reference_images?.[0]?.url;
```

Apply in both `CharacterCard.tsx` and the inline card in `CharactersPanel.tsx`.

- [ ] **Step 2: Grep for stragglers** referencing the removed concepts, and fix each:

```bash
git grep -n "role: 'face'\|faceImage\|MAX_IMAGES\|pose_failed\|onImage\b\|referenceImages" -- "*.ts" "*.tsx"
```

Expect only legacy-compat fallbacks (executor, CRUD `reference_images`, snapshot fallback) to remain — anything in the modals/hook/cards should be gone.

- [ ] **Step 3: Final verify** `npx tsc --noEmit` — expect a clean pass across the whole repo.

- [ ] **Step 4: Commit.**

```bash
git add -A
git commit -m "feat(characters): card thumbnails use cover; final sheet/cover sweep"
```

---

## Task 14: Operator + runtime verification

- [ ] **Step 1: Apply the migration** to live Supabase (operator/user action): run `supabase/migrations/20260611_character_sheet_cover.sql`. Confirm the four columns exist and existing characters now have non-null `sheet_url`/`cover_url`.

- [ ] **Step 2: In-app E2E** (`npm run dev`):
  - Create **from description** → 4 sheets stream into the big view → pick one → cover generates → fill name → Save → node shows the cover; run the node and confirm it feeds the **sheet** to a generator.
  - Create **from uploaded image + changes** (e.g. "change hair color") → 4 sheets reflect the change → select → save.
  - **Variant** an existing character with changes → 4 candidates → select → saved as a new character.
  - Open an **old migrated character** → it still resolves (sheet = old front view) and runs.
  - @-mention a character in chat → the added node renders the cover and the generator receives one image.

---

## Self-review notes

- **Spec coverage:** sheet+cover model (T1,T8), migration/back-compat (T1,T8 fallback,T9 fallback,T5 fallback), AI cover (T3,T6,T11), 4 candidates all flows (T4,T5,T11,T12), per-source prompts + research (T3), wizard + shared components (T10–T12), node output stays image_array (T8), hydration to single sheet (T9), CRUD persistence (T7), client API (T2). All covered.
- **Type consistency:** `SheetSetEvent`/`sheet`/`sheet_failed`, `streamSheetCandidates`, `generateCover`, `SHEET_CANDIDATES`, `CharacterConfig.sheetUrl`, `CharacterSnapshot.sheetUrl`, `CharacterInput.sheetUrl/coverUrl` used consistently across tasks.
- **No billing path touched** — Gemini-direct, confirmed in spec.
