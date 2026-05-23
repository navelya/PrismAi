# Character Assets Isolation + Variants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop character reference images from leaking into the global Assets / Last-runs lists (with duplicates), and add a "Create variant" feature that restyles a character's look from a prompt into a new standalone character.

**Architecture:** The leak is fixed by flagging the `character` node `meta.ephemeral: true`, which reuses the existing finalization-cleanup + live-window-filter machinery (storage is untouched because character images live in a different bucket). A one-time script purges already-leaked rows. The variant feature extracts the character generation pipeline into a shared `lib/characters/` module reused by the existing `generate` route and a new `[id]/variant` streaming route, with a new modal + button on both character-card surfaces.

**Tech Stack:** Next.js (App Router) API routes, Supabase (service-role + RLS), Google GenAI (`gemini-2.5-flash-image`), React + framer-motion, plain `node` scripts for ad-hoc verification.

**Note on testing:** This repo has **no test runner** (see CLAUDE.md). Verification uses `npx tsc --noEmit` (the reliable check here — `npm run lint`/`build` are flaky), small `node` smoke scripts for pure logic, and documented manual checks for routes/UI.

---

## File Structure

**Goal 1 — leak fix:**
- Modify `lib/nodes/plugins/character/definition.ts` — add `meta.ephemeral: true`.
- Create `scripts/cleanup-character-assets.js` — one-time purge of leaked rows (pure predicate + runner).
- Create `scripts/cleanup-character-assets.smoke.js` — asserts the predicate.

**Goal 2 — variant feature:**
- Create `lib/characters/reference-set.ts` — shared prompts, Gemini helpers, uploader, streaming pose/face pipeline.
- Modify `app/api/characters/generate/route.ts` — use the shared module (no behavior change).
- Create `app/api/characters/[id]/variant/route.ts` — variant streaming endpoint.
- Modify `lib/api/client.ts` — add `generateCharacterVariantStream` + shared NDJSON reader.
- Create `components/assets/CharacterVariantModal.tsx` — style prompt → stream → review → save.
- Modify `components/assets/CharacterCard.tsx` — add variant button + `onVariant` prop.
- Modify `components/assets/CharacterGrid.tsx` — thread `onVariant`.
- Modify `app/assets/page.tsx` — host the variant modal.
- Modify `components/editor/CharactersPanel.tsx` — add variant button + host the modal.

---

## Task 1: Fix the leak — flag the character node ephemeral

**Files:**
- Modify: `lib/nodes/plugins/character/definition.ts:21-26`

- [ ] **Step 1: Add the ephemeral flag**

In the `meta` block of `characterSharedDef`, add `ephemeral: true`. The block becomes:

```ts
    meta: {
        label: 'Character',
        description: 'A reusable character (reference images + identity) fed into reference-aware generators',
        color: '#a855f7',
        icon: 'UserCircle',
        // Reference images are persisted on the `characters` record, not as
        // workflow outputs. Flagging the node ephemeral makes the engine clean
        // up its node_results rows after a run (orchestrator.cleanupEphemeralResults)
        // and hides them from the asset views (AssetsPanel live filter) — so a
        // character's references never pile up as duplicate "assets". The node's
        // own files live in the chat-assets bucket and are untouched by cleanup
        // (which only lists the workflow-ephemeral-tmp bucket).
        ephemeral: true,
    },
```

- [ ] **Step 2: Confirm the flag has no unintended consumers**

Run: `git grep -n "meta?.ephemeral\|meta\.ephemeral\|\.ephemeral" -- lib components app`
Expected: matches only in `components/editor/AssetsPanel.tsx` (live filter), `lib/workflow/orchestrator.ts` (cleanup), and node definitions. Confirm `lib/workflow/persist-node.ts` does NOT branch on `meta.ephemeral` (open it and check — it persists node state regardless; the character node renders thumbnails from `config.referenceImages`, not `node_results`, so no preview regression).

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual verification (document result in commit body)**

With a character node wired into a generator, run a workflow. After it finalizes:
- The character's reference images do NOT appear in "All assets" or "Last runs".
- The downstream generator still received the references (output looks right).
- Running again does not add duplicate character images.

- [ ] **Step 5: Commit**

```bash
git add lib/nodes/plugins/character/definition.ts
git commit -m "fix(characters): flag character node ephemeral so references don't leak into assets"
```

---

## Task 2: One-time cleanup script for already-leaked rows

**Files:**
- Create: `scripts/cleanup-character-assets.js`
- Create: `scripts/cleanup-character-assets.smoke.js`

- [ ] **Step 1: Write the smoke test (pure predicate)**

Create `scripts/cleanup-character-assets.smoke.js`:

```js
/**
 * Smoke test for the character-asset cleanup predicate.
 * Run: node scripts/cleanup-character-assets.smoke.js
 */
const assert = require('assert');
const { urlIsCharacterAsset, rowHasCharacterAsset } = require('./cleanup-character-assets');

// URL predicate: character images upload under `{userId}/characters/...`
assert.strictEqual(
  urlIsCharacterAsset('https://x.supabase.co/storage/v1/object/public/chat-assets/uid/characters/123-0-ab.png'),
  true,
);
assert.strictEqual(
  urlIsCharacterAsset('https://x.supabase.co/storage/v1/object/public/outputs/uid/gen/123.png'),
  false,
);
assert.strictEqual(urlIsCharacterAsset(42), false);
assert.strictEqual(urlIsCharacterAsset(null), false);

// Row predicate: only image rows with at least one character-path URL.
assert.strictEqual(
  rowHasCharacterAsset({ result_type: 'image', result_data: ['https://h/chat-assets/u/characters/a.png'] }),
  true,
);
assert.strictEqual(
  rowHasCharacterAsset({ result_type: 'image', result_data: ['https://h/outputs/u/a.png'] }),
  false,
);
assert.strictEqual(
  rowHasCharacterAsset({ result_type: 'video', result_data: ['https://h/chat-assets/u/characters/a.mp4'] }),
  false,
);
assert.strictEqual(rowHasCharacterAsset({ result_type: 'image', result_data: null }), false);

console.log('OK: cleanup-character-assets predicates');
```

- [ ] **Step 2: Run the smoke test, verify it fails (module missing)**

Run: `node scripts/cleanup-character-assets.smoke.js`
Expected: FAIL — `Cannot find module './cleanup-character-assets'`.

- [ ] **Step 3: Write the cleanup script**

Create `scripts/cleanup-character-assets.js`:

```js
/**
 * One-time cleanup: remove character reference images that leaked into
 * `node_results` (and thus into the Assets / Last-runs views) before the
 * character node was flagged ephemeral.
 *
 * Character images are the only thing uploaded under the `/characters/` storage
 * path (app/api/characters/generate/route.ts), so matching that path segment in
 * an image row's result_data is precise.
 *
 *   node scripts/cleanup-character-assets.js            # dry run (counts only)
 *   node scripts/cleanup-character-assets.js --apply    # actually delete
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the env.
 */
const { createClient } = require('@supabase/supabase-js');

function urlIsCharacterAsset(url) {
  return typeof url === 'string' && url.includes('/characters/');
}

function rowHasCharacterAsset(row) {
  return (
    !!row &&
    row.result_type === 'image' &&
    Array.isArray(row.result_data) &&
    row.result_data.some(urlIsCharacterAsset)
  );
}

async function run({ apply }) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.');
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  const pageSize = 1000;
  let from = 0;
  const toDelete = [];

  for (;;) {
    const { data, error } = await supabase
      .from('node_results')
      .select('id, result_type, result_data')
      .eq('result_type', 'image')
      .range(from, from + pageSize - 1);
    if (error) {
      console.error('Query failed:', error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    for (const row of data) {
      if (rowHasCharacterAsset(row)) toDelete.push(row.id);
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }

  console.log(`Found ${toDelete.length} character-asset node_results row(s).`);
  if (!apply) {
    console.log('Dry run — re-run with --apply to delete them.');
    return;
  }

  const chunk = 500;
  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += chunk) {
    const ids = toDelete.slice(i, i + chunk);
    const { error } = await supabase.from('node_results').delete().in('id', ids);
    if (error) {
      console.error('Delete failed:', error.message);
      process.exit(1);
    }
    deleted += ids.length;
  }
  console.log(`Deleted ${deleted} row(s).`);
}

if (require.main === module) {
  run({ apply: process.argv.includes('--apply') }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { urlIsCharacterAsset, rowHasCharacterAsset, run };
```

- [ ] **Step 4: Run the smoke test, verify it passes**

Run: `node scripts/cleanup-character-assets.smoke.js`
Expected: `OK: cleanup-character-assets predicates`

- [ ] **Step 5: Dry-run against the live DB (document the count)**

Run: `node scripts/cleanup-character-assets.js`
Expected: prints `Found N character-asset node_results row(s).` then the dry-run notice. Do NOT pass `--apply` yet — eyeball that N is plausible.

- [ ] **Step 6: Commit**

```bash
git add scripts/cleanup-character-assets.js scripts/cleanup-character-assets.smoke.js
git commit -m "chore(characters): add one-time script to purge leaked character assets"
```

> After Task 1 is deployed, run `node scripts/cleanup-character-assets.js --apply` once to clear existing duplicates. This is an operational step, not part of the commit.

---

## Task 3: Extract the shared character reference-set module

**Files:**
- Create: `lib/characters/reference-set.ts`
- Modify: `app/api/characters/generate/route.ts` (replace inline helpers with imports — no behavior change)

- [ ] **Step 1: Create the shared module**

Create `lib/characters/reference-set.ts`:

```ts
import { GoogleGenAI, Modality } from '@google/genai';
import type { SupabaseClient } from '@supabase/supabase-js';

// "Nano Banana" — Gemini 2.5 Flash Image (GA). If this id ever 404s, the
// preview alias is 'gemini-2.5-flash-image-preview'.
export const IMAGE_MODEL = 'gemini-2.5-flash-image';
export const STORAGE_BUCKET = 'chat-assets';

export const BASE_POSE = 'front view, facing the camera, neutral A-pose';
export const CONDITIONED_POSES = [
  'three-quarter left view',
  'left side profile view',
  'three-quarter right view',
  'back view, facing away',
];

export type GenImage = { mimeType: string; data: string };

export type RefSetEvent =
  | { type: 'start'; total: number }
  | { type: 'image'; index: number; url: string; path: string; role?: 'face' }
  | { type: 'pose_failed'; index: number }
  | { type: 'error'; message: string }
  | { type: 'done' };

export function basePrompt(description: string): string {
  return (
    `Full-body character reference image of: ${description}. ` +
    `${BASE_POSE}. A single character only, centered, head to toe in frame, ` +
    `plain solid white background, soft even studio lighting, no text, no watermark, no props.`
  );
}

export function conditionedPrompt(pose: string): string {
  return (
    `Generate the EXACT SAME character as in the provided image — identical face, ` +
    `hair, body, outfit, and colors — but now in a ${pose}. ` +
    `Full body, head to toe, centered, plain solid white background, soft even studio lighting, ` +
    `no text, no watermark, no props.`
  );
}

export function facePrompt(): string {
  return (
    `Generate a tight head-and-shoulders close-up PORTRAIT of the EXACT SAME character ` +
    `as in the provided image — identical face, hair, and skin tone — looking straight at ` +
    `the camera. Sharp focus on the face, plain solid white background, soft even studio ` +
    `lighting, no text, no watermark, no props.`
  );
}

// Variant: restyle the FULL-BODY base from the source character's own base
// image. Keeps the same person (face/body) but changes outfit, art-style, and
// palette to match the new style.
export function restyleBasePrompt(style: string): string {
  return (
    `Generate the EXACT SAME character as in the provided image — identical face, hair, and ` +
    `body proportions — but restyled: ${style}. Change the outfit, art-style, and color ` +
    `palette to match this new style while keeping the same person clearly recognizable. ` +
    `${BASE_POSE}. Full body, head to toe, centered, plain solid white background, ` +
    `soft even studio lighting, no text, no watermark, no props.`
  );
}

// Variant: restyle the face close-up from the source character's face image,
// preserving facial identity while applying the new style's art direction.
export function restyleFacePrompt(style: string): string {
  return (
    `Generate a tight head-and-shoulders close-up PORTRAIT of the EXACT SAME character as in ` +
    `the provided image — identical facial features, bone structure, and hair — restyled: ${style}. ` +
    `Apply the new style's art direction and color treatment while keeping the same person clearly ` +
    `recognizable, looking straight at the camera. Sharp focus on the face, plain solid white ` +
    `background, soft even studio lighting, no text, no watermark, no props.`
  );
}

export function firstImagePart(resp: any): GenImage | null {
  const parts = resp?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  for (const p of parts) {
    const inline = p?.inlineData;
    if (inline?.data && typeof inline.data === 'string') {
      return { mimeType: inline.mimeType || 'image/png', data: inline.data };
    }
  }
  return null;
}

/** Fetch a stored image URL and return it as inline base64 for image→image prompts. */
export async function fetchImageAsBase64(url: string): Promise<GenImage> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch source image (${res.status})`);
  const mimeType = res.headers.get('content-type') || 'image/png';
  const buffer = Buffer.from(await res.arrayBuffer());
  return { mimeType, data: buffer.toString('base64') };
}

/** Returns an uploader that writes generated images under `{userId}/characters/...`. */
export function makeCharacterImageUploader(supabase: SupabaseClient, userId: string) {
  return async (img: GenImage, index: number): Promise<{ url: string; path: string } | null> => {
    const ext = img.mimeType.includes('png') ? 'png' : img.mimeType.includes('webp') ? 'webp' : 'jpg';
    const path = `${userId}/characters/${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const buffer = Buffer.from(img.data, 'base64');
    const { error: upErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(path, buffer, { contentType: img.mimeType, upsert: false });
    if (upErr) {
      console.error('[reference-set] upload failed:', upErr.message);
      return null;
    }
    const { data: pub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
    return { url: pub.publicUrl, path };
  };
}

/**
 * Generate the 4 conditioned poses + the face close-up in parallel, streaming
 * each as it settles. Poses condition on `base` (so they inherit its outfit/
 * style); the face conditions on `faceSrc`. The caller produces + uploads +
 * streams the base (index 0) BEFORE calling this.
 */
export async function streamPosesAndFace(opts: {
  ai: GoogleGenAI;
  base: GenImage;
  faceSrc: GenImage;
  faceIndex: number;
  facePromptText: string;
  uploadImage: (img: GenImage, index: number) => Promise<{ url: string; path: string } | null>;
  send: (e: RefSetEvent) => void;
}): Promise<void> {
  const { ai, base, faceSrc, faceIndex, facePromptText, uploadImage, send } = opts;
  const genConfig = { responseModalities: [Modality.IMAGE] };

  const conditioned: { index: number; prompt: string; role?: 'face'; src: GenImage }[] = [
    ...CONDITIONED_POSES.map((pose, i) => ({ index: i + 1, prompt: conditionedPrompt(pose), src: base })),
    { index: faceIndex, prompt: facePromptText, role: 'face' as const, src: faceSrc },
  ];

  await Promise.all(
    conditioned.map(async ({ index, prompt, role, src }) => {
      try {
        const resp = await ai.models.generateContent({
          model: IMAGE_MODEL,
          contents: [{ inlineData: { mimeType: src.mimeType, data: src.data } }, { text: prompt }],
          config: genConfig,
        });
        const img = firstImagePart(resp);
        if (!img) {
          send({ type: 'pose_failed', index });
          return;
        }
        const up = await uploadImage(img, index);
        if (up) send({ type: 'image', index, url: up.url, path: up.path, ...(role ? { role } : {}) });
        else send({ type: 'pose_failed', index });
      } catch (e: any) {
        console.error('[reference-set] pose failed:', e?.message);
        send({ type: 'pose_failed', index });
      }
    }),
  );
}
```

- [ ] **Step 2: Refactor the generate route to use the module**

Replace the entire contents of `app/api/characters/generate/route.ts` with:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';
import { GoogleGenAI, Modality } from '@google/genai';
import {
  IMAGE_MODEL,
  CONDITIONED_POSES,
  type GenImage,
  basePrompt,
  conditionedPrompt,
  facePrompt,
  firstImagePart,
  makeCharacterImageUploader,
  streamPosesAndFace,
} from '@/lib/characters/reference-set';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Streams NDJSON so the client can fill each reference slot the moment that
 * pose is ready. Events: start / image / pose_failed / error / done.
 * The base (index 0) streams first because the other poses are conditioned on
 * it; the remaining poses run in parallel and stream as each settles.
 */
export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (auth.error) return auth.error;
  const { user, supabase } = auth;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Image generation unavailable (GEMINI_API_KEY not set)' }, { status: 503 });
  }

  let body: any;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const description = typeof body?.description === 'string' ? body.description.trim() : '';

  // Optional uploaded photo to build the character FROM. When present it becomes
  // the base (index 0) and every other reference is conditioned on it.
  const rawBase = body?.baseImage;
  const uploadedBase: GenImage | null =
    rawBase && typeof rawBase.data === 'string' && rawBase.data.length > 0
      ? { mimeType: typeof rawBase.mimeType === 'string' ? rawBase.mimeType : 'image/png', data: rawBase.data }
      : null;

  if (!uploadedBase && description.length < 3) {
    return NextResponse.json({ error: 'Please describe the character first (at least a few words), or upload a photo.' }, { status: 400 });
  }

  const ai = new GoogleGenAI({ apiKey });
  const genConfig = { responseModalities: [Modality.IMAGE] };
  const uploadImage = makeCharacterImageUploader(supabase, user.id);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: any) => controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'));

      try {
        const faceIndex = 1 + CONDITIONED_POSES.length;
        send({ type: 'start', total: faceIndex + 1 });

        // Establish ONE canonical base (index 0) BEFORE anything else, so every
        // pose inherits its details. Uploaded photo → clean front view via
        // image→image; text only → text→image.
        let base: GenImage | null;
        if (uploadedBase) {
          const frontResp = await ai.models.generateContent({
            model: IMAGE_MODEL,
            contents: [
              { inlineData: { mimeType: uploadedBase.mimeType, data: uploadedBase.data } },
              { text: conditionedPrompt('front view, facing the camera, full-body head-to-toe neutral A-pose') },
            ],
            config: genConfig,
          });
          base = firstImagePart(frontResp);
          if (!base) {
            send({ type: 'error', message: 'Could not generate a front view from your photo. Try a clearer, well-lit image.' });
            controller.close();
            return;
          }
        } else {
          const baseResp = await ai.models.generateContent({
            model: IMAGE_MODEL,
            contents: basePrompt(description),
            config: genConfig,
          });
          base = firstImagePart(baseResp);
          if (!base) {
            send({ type: 'error', message: 'The model did not return a base image. Try a more descriptive prompt.' });
            controller.close();
            return;
          }
        }

        const baseUp = await uploadImage(base, 0);
        if (!baseUp) {
          send({ type: 'error', message: 'Could not save the generated image. Please try again.' });
          controller.close();
          return;
        }
        send({ type: 'image', index: 0, url: baseUp.url, path: baseUp.path });

        // The face conditions on the real uploaded photo when we have one
        // (highest facial fidelity), else on the base.
        const faceSrc = uploadedBase ?? base;
        await streamPosesAndFace({
          ai,
          base,
          faceSrc,
          faceIndex,
          facePromptText: facePrompt(),
          uploadImage,
          send,
        });

        send({ type: 'done' });
        controller.close();
      } catch (err: any) {
        console.error('[characters/generate] error:', err);
        try { send({ type: 'error', message: err?.message || 'Character generation failed' }); } catch {}
        try { controller.close(); } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  });
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual smoke (document result)**

Open the New Character modal, generate from a description, confirm the base + 4 poses + face still stream in as before (behavior unchanged).

- [ ] **Step 5: Commit**

```bash
git add lib/characters/reference-set.ts app/api/characters/generate/route.ts
git commit -m "refactor(characters): extract shared reference-set generation module"
```

---

## Task 4: Variant API route

**Files:**
- Create: `app/api/characters/[id]/variant/route.ts`

- [ ] **Step 1: Write the route**

Create `app/api/characters/[id]/variant/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';
import { GoogleGenAI, Modality } from '@google/genai';
import {
  IMAGE_MODEL,
  CONDITIONED_POSES,
  type GenImage,
  restyleBasePrompt,
  restyleFacePrompt,
  firstImagePart,
  fetchImageAsBase64,
  makeCharacterImageUploader,
  streamPosesAndFace,
} from '@/lib/characters/reference-set';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/characters/[id]/variant — restyle an existing character into a new
 * look from a style prompt, streaming NDJSON identical to /generate. Preserves
 * identity by conditioning the new base on the source character's own base
 * image, and the face close-up on the source face image.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getAuthenticatedUser();
  if (auth.error) return auth.error;
  const { user, supabase } = auth;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Image generation unavailable (GEMINI_API_KEY not set)' }, { status: 503 });
  }

  const id = params.id;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  let body: any;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const style = typeof body?.style === 'string' ? body.style.trim() : '';
  if (style.length < 3) {
    return NextResponse.json({ error: 'Describe the new style first (at least a few words).' }, { status: 400 });
  }

  const { data: character, error } = await supabase
    .from('characters')
    .select('id, name, reference_images')
    .eq('id', id)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .single();
  if (error || !character) {
    return NextResponse.json({ error: 'Character not found' }, { status: 404 });
  }

  const refs: { url?: string; role?: string }[] = Array.isArray(character.reference_images)
    ? character.reference_images
    : [];
  const baseRef = refs[0];
  if (!baseRef?.url) {
    return NextResponse.json({ error: 'Source character has no base image to restyle.' }, { status: 400 });
  }
  const faceRef = refs.find((r) => r?.role === 'face') ?? baseRef;

  const ai = new GoogleGenAI({ apiKey });
  const genConfig = { responseModalities: [Modality.IMAGE] };
  const uploadImage = makeCharacterImageUploader(supabase, user.id);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: any) => controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'));

      try {
        const faceIndex = 1 + CONDITIONED_POSES.length;
        send({ type: 'start', total: faceIndex + 1 });

        // Pull the source base + face down as inline base64 for image→image.
        let sourceBase: GenImage;
        let sourceFace: GenImage;
        try {
          sourceBase = await fetchImageAsBase64(baseRef.url!);
          sourceFace = faceRef.url && faceRef.url !== baseRef.url
            ? await fetchImageAsBase64(faceRef.url)
            : sourceBase;
        } catch {
          send({ type: 'error', message: 'Could not load the original character images.' });
          controller.close();
          return;
        }

        // Restyle the canonical base (index 0) from the source base.
        const baseResp = await ai.models.generateContent({
          model: IMAGE_MODEL,
          contents: [
            { inlineData: { mimeType: sourceBase.mimeType, data: sourceBase.data } },
            { text: restyleBasePrompt(style) },
          ],
          config: genConfig,
        });
        const newBase = firstImagePart(baseResp);
        if (!newBase) {
          send({ type: 'error', message: 'Could not restyle the base image. Try a different style description.' });
          controller.close();
          return;
        }
        const baseUp = await uploadImage(newBase, 0);
        if (!baseUp) {
          send({ type: 'error', message: 'Could not save the generated image. Please try again.' });
          controller.close();
          return;
        }
        send({ type: 'image', index: 0, url: baseUp.url, path: baseUp.path });

        // Poses condition on the NEW base (so they carry the new style); the
        // face restyles from the SOURCE face (identity anchor) + new style.
        await streamPosesAndFace({
          ai,
          base: newBase,
          faceSrc: sourceFace,
          faceIndex,
          facePromptText: restyleFacePrompt(style),
          uploadImage,
          send,
        });

        send({ type: 'done' });
        controller.close();
      } catch (err: any) {
        console.error('[characters/variant] error:', err);
        try { send({ type: 'error', message: err?.message || 'Variant generation failed' }); } catch {}
        try { controller.close(); } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add "app/api/characters/[id]/variant/route.ts"
git commit -m "feat(characters): add variant generation endpoint"
```

---

## Task 5: Client stream helper for variants

**Files:**
- Modify: `lib/api/client.ts:267-313` (refactor `generateCharacterStream` to share its NDJSON reader, add `generateCharacterVariantStream`)

- [ ] **Step 1: Replace the stream function with a shared reader + two callers**

Replace the `generateCharacterStream` function (lines ~267-313, the whole `export async function generateCharacterStream(...) { ... }` block) with:

```ts
/** Shared NDJSON line-reader for character generation streams. */
async function consumeCharacterStream(res: Response, handlers: GenerateCharacterHandlers): Promise<void> {
    if (!res.ok || !res.body) {
        let message = `Generation failed (${res.status})`;
        try { const j = await res.json(); if (j?.error) message = j.error; } catch { /* not json */ }
        handlers.onError?.(message);
        return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    const handleLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let evt: any;
        try { evt = JSON.parse(trimmed); } catch { return; }
        switch (evt.type) {
            case 'start': handlers.onStart?.(typeof evt.total === 'number' ? evt.total : 0); break;
            case 'image': handlers.onImage({ index: evt.index, url: evt.url, path: evt.path, role: evt.role === 'face' ? 'face' : undefined }); break;
            case 'pose_failed': handlers.onPoseFailed?.(evt.index); break;
            case 'error': handlers.onError?.(evt.message || 'Generation failed'); break;
            case 'done': handlers.onDone?.(); break;
        }
    };

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
            handleLine(buf.slice(0, nl));
            buf = buf.slice(nl + 1);
        }
    }
    if (buf.trim()) handleLine(buf);
}

/**
 * Stream character-reference generation. The server emits NDJSON, one line per
 * event, so each pose can fill its slot the moment it's ready.
 */
export async function generateCharacterStream(
    params: GenerateCharacterParams,
    handlers: GenerateCharacterHandlers,
): Promise<void> {
    const res = await fetch('/api/characters/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: params.description, baseImage: params.baseImage }),
    });
    await consumeCharacterStream(res, handlers);
}

/**
 * Stream a character VARIANT: restyle an existing character into a new look.
 * Same NDJSON event protocol as generateCharacterStream.
 */
export async function generateCharacterVariantStream(
    characterId: string,
    params: { style: string },
    handlers: GenerateCharacterHandlers,
): Promise<void> {
    const res = await fetch(`/api/characters/${characterId}/variant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ style: params.style }),
    });
    await consumeCharacterStream(res, handlers);
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/api/client.ts
git commit -m "feat(characters): add variant stream client helper"
```

---

## Task 6: CharacterVariantModal component

**Files:**
- Create: `components/assets/CharacterVariantModal.tsx`

- [ ] **Step 1: Write the modal**

Create `components/assets/CharacterVariantModal.tsx`:

```tsx
'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, Wand2, ScanFace, Star } from 'lucide-react';
import { generateCharacterVariantStream, type Character, type CharacterRefImage, type CharacterInput } from '@/lib/api/client';
import ImageLightbox from '@/components/ui/ImageLightbox';

type GenSlot = CharacterRefImage | null | 'failed';

interface CharacterVariantModalProps {
    open: boolean;
    source: Character | null;
    onClose: () => void;
    onSave: (input: CharacterInput) => Promise<void>;
}

const MAX_IMAGES = 6;

export default function CharacterVariantModal({ open, source, onClose, onSave }: CharacterVariantModalProps) {
    const [style, setStyle] = useState('');
    const [name, setName] = useState('');
    const [images, setImages] = useState<CharacterRefImage[]>([]);
    const [genSlots, setGenSlots] = useState<GenSlot[]>([]);
    const [generating, setGenerating] = useState(false);
    const [saving, setSaving] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    useEffect(() => {
        if (open) {
            setStyle('');
            setName(source ? `${source.name} (variant)` : '');
            setImages([]);
            setGenSlots([]);
            setGenerating(false);
            setSaving(false);
            setErrorMsg(null);
            setLightboxIndex(null);
        }
    }, [open, source]);

    const runGeneration = async () => {
        if (!source) return;
        if (style.trim().length < 3) { setErrorMsg('Describe the new style first (at least a few words)'); return; }
        setGenerating(true);
        setErrorMsg(null);
        setImages([]);
        setGenSlots([]);

        const slots: GenSlot[] = [];
        try {
            await generateCharacterVariantStream(source.id, { style: style.trim() }, {
                onStart: (total) => {
                    slots.length = 0;
                    for (let i = 0; i < total; i++) slots.push(null);
                    setGenSlots([...slots]);
                },
                onImage: ({ index, url, path, role }) => {
                    if (index >= 0 && index < slots.length) slots[index] = role ? { url, path, role } : { url, path };
                    setGenSlots([...slots]);
                },
                onPoseFailed: (index) => {
                    if (index >= 0 && index < slots.length && slots[index] === null) slots[index] = 'failed';
                    setGenSlots([...slots]);
                },
                onError: (message) => { setErrorMsg(message); },
                onDone: () => {
                    const final = slots.filter((s): s is CharacterRefImage => !!s && s !== 'failed');
                    if (final.length > 0) setImages(final.slice(0, MAX_IMAGES));
                },
            });
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : 'Variant generation failed');
        } finally {
            setGenerating(false);
            setGenSlots([]);
        }
    };

    const handleSave = async () => {
        if (!name.trim()) { setErrorMsg('Name is required'); return; }
        if (images.length === 0) { setErrorMsg('Generate the variant first'); return; }
        setSaving(true);
        setErrorMsg(null);
        try {
            await onSave({
                name: name.trim(),
                description: style.trim() || null,
                referenceImages: images,
                thumbnailUrl: images[0].url,
                weight: source?.weight ?? 70,
            });
            onClose();
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : 'Failed to save variant');
        } finally {
            setSaving(false);
        }
    };

    if (!mounted) return null;

    const sourceThumb = source?.thumbnail_url || source?.reference_images?.[0]?.url;

    return createPortal(
        <AnimatePresence>
            {open && source && (
                <motion.div
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
                    onClick={onClose}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18, ease: 'easeOut' }}
                >
                    <motion.div
                        className="w-full max-w-md rounded-2xl bg-surface-primary border border-stroke-subtle shadow-2xl p-5 space-y-4"
                        onClick={(e) => e.stopPropagation()}
                        initial={{ opacity: 0, scale: 0.96, y: 12 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, y: 12 }}
                        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    >
                        <div className="flex items-center justify-between">
                            <h2 className="text-lg font-bold text-content-primary">Create variant</h2>
                            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-interactive-hover text-content-tertiary">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-lg overflow-hidden border border-stroke-subtle bg-white/5 shrink-0">
                                {sourceThumb && <img src={sourceThumb} alt={source.name} className="w-full h-full object-cover" />}
                            </div>
                            <p className="text-xs text-content-tertiary">
                                Restyle <span className="text-content-secondary font-medium">{source.name}</span> with a new look —
                                same person, new outfit/art-style. All positions are regenerated.
                            </p>
                        </div>

                        {generating ? (
                            <div className="flex flex-wrap gap-2">
                                {genSlots.map((slot, index) => (
                                    <div key={index} className="relative w-16 h-16 rounded-lg overflow-hidden border border-stroke-subtle">
                                        {slot && slot !== 'failed' ? (
                                            <>
                                                <img src={slot.url} alt="" className="w-full h-full object-cover animate-in fade-in duration-300" />
                                                {slot.role === 'face' && (
                                                    <span className="absolute top-0.5 right-0.5 text-sky-300"><ScanFace className="w-3.5 h-3.5" /></span>
                                                )}
                                            </>
                                        ) : slot === 'failed' ? (
                                            <div className="w-full h-full flex items-center justify-center bg-surface-tertiary text-content-tertiary">
                                                <X className="w-4 h-4" />
                                            </div>
                                        ) : (
                                            <div className="w-full h-full bg-surface-tertiary animate-pulse" />
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : images.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                                {images.map((img, index) => (
                                    <div key={img.path || img.url} className="relative w-16 h-16 rounded-lg overflow-hidden border border-stroke-subtle">
                                        <img src={img.url} alt="" onClick={() => setLightboxIndex(index)} className="w-full h-full object-cover cursor-zoom-in" />
                                        {index === 0 && (
                                            <span className="absolute top-0.5 left-0.5 text-amber-300 pointer-events-none"><Star className="w-3 h-3 fill-current" /></span>
                                        )}
                                        {img.role === 'face' && (
                                            <span className="absolute top-0.5 right-0.5 text-sky-300 pointer-events-none"><ScanFace className="w-3.5 h-3.5" /></span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : null}

                        <div>
                            <label className="block text-xs font-medium text-content-secondary mb-1">New style *</label>
                            <textarea
                                value={style}
                                onChange={(e) => setStyle(e.target.value)}
                                rows={4}
                                placeholder="cyberpunk streetwear, neon palette, glossy jacket..."
                                className="w-full px-3 py-2 rounded-lg bg-surface-tertiary border border-stroke-subtle text-content-primary resize-y min-h-[5rem] focus:outline-none focus:ring-2 focus:ring-accent-primary"
                            />
                        </div>

                        <button
                            type="button"
                            onClick={runGeneration}
                            disabled={generating}
                            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-accent-primary/30 bg-accent-primary/10 text-sm text-accent-primary hover:bg-accent-primary/20 disabled:opacity-60"
                        >
                            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                            {generating ? 'Generating…' : images.length > 0 ? 'Regenerate' : 'Generate variant'}
                        </button>

                        <div>
                            <label className="block text-xs font-medium text-content-secondary mb-1">Name *</label>
                            <input
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="Alice (cyberpunk)"
                                className="w-full px-3 py-2 rounded-lg bg-surface-tertiary border border-stroke-subtle text-content-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
                            />
                        </div>

                        {errorMsg && <p className="text-xs text-red-400">{errorMsg}</p>}

                        <div className="flex justify-end gap-2 pt-1">
                            <button onClick={onClose} className="px-4 py-2 rounded-lg text-content-secondary hover:bg-interactive-hover">Cancel</button>
                            <button
                                onClick={handleSave}
                                disabled={saving || generating || images.length === 0}
                                className="px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-hover disabled:opacity-50 flex items-center gap-2"
                            >
                                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                                Save variant
                            </button>
                        </div>
                    </motion.div>

                    {lightboxIndex !== null && images.length > 0 && (
                        <ImageLightbox
                            media={images.map((i) => i.url)}
                            type="any"
                            initialIndex={Math.min(lightboxIndex, images.length - 1)}
                            onClose={() => setLightboxIndex(null)}
                        />
                    )}
                </motion.div>
            )}
        </AnimatePresence>,
        document.body,
    );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add components/assets/CharacterVariantModal.tsx
git commit -m "feat(characters): add CharacterVariantModal"
```

---

## Task 7: Wire the variant button into the /assets page

**Files:**
- Modify: `components/assets/CharacterCard.tsx`
- Modify: `components/assets/CharacterGrid.tsx`
- Modify: `app/assets/page.tsx`

- [ ] **Step 1: Add the variant button to CharacterCard**

In `components/assets/CharacterCard.tsx`:

Change the import line to add `Wand2`:

```tsx
import { Pencil, Trash2, UserCircle, Wand2 } from 'lucide-react';
```

Add `onVariant` to the props interface:

```tsx
interface CharacterCardProps {
    character: Character;
    onEdit: (c: Character) => void;
    onDelete: (id: string) => void;
    onVariant: (c: Character) => void;
}
```

Update the destructure:

```tsx
export default function CharacterCard({ character, onEdit, onDelete, onVariant }: CharacterCardProps) {
```

Add the button as the FIRST button in the hover overlay (before Edit):

```tsx
            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => onVariant(character)} title="Create variant" className="p-1.5 rounded-lg bg-black/60 text-white hover:bg-accent-primary">
                    <Wand2 className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => onEdit(character)} title="Edit" className="p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80">
                    <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => onDelete(character.id)} title="Delete" className="p-1.5 rounded-lg bg-black/60 text-white hover:bg-red-500">
                    <Trash2 className="w-3.5 h-3.5" />
                </button>
            </div>
```

- [ ] **Step 2: Thread onVariant through CharacterGrid**

In `components/assets/CharacterGrid.tsx`:

Add to the props interface:

```tsx
interface CharacterGridProps {
    characters: Character[];
    loading: boolean;
    onCreate: () => void;
    onEdit: (c: Character) => void;
    onDelete: (id: string) => void;
    onVariant: (c: Character) => void;
}
```

Update the destructure:

```tsx
export default function CharacterGrid({ characters, loading, onCreate, onEdit, onDelete, onVariant }: CharacterGridProps) {
```

Pass it to the card:

```tsx
                <CharacterCard key={c.id} character={c} onEdit={onEdit} onDelete={onDelete} onVariant={onVariant} />
```

- [ ] **Step 3: Host the variant modal in the assets page**

In `app/assets/page.tsx`:

Add the import:

```tsx
import CharacterVariantModal from '@/components/assets/CharacterVariantModal';
```

Add state next to the other modal state (after `pendingDelete`):

```tsx
    const [variantSource, setVariantSource] = useState<Character | null>(null);
```

Pass `onVariant` to the grid:

```tsx
                        <CharacterGrid
                            characters={filtered}
                            loading={loading}
                            onCreate={openCreate}
                            onEdit={openEdit}
                            onDelete={(id) => setPendingDelete(characters.find((c) => c.id === id) ?? null)}
                            onVariant={(c) => setVariantSource(c)}
                        />
```

Render the modal next to `CharacterModal`:

```tsx
                <CharacterVariantModal
                    open={!!variantSource}
                    source={variantSource}
                    onClose={() => setVariantSource(null)}
                    onSave={(input) => createCharacter(input).then(() => undefined)}
                />
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Manual verification (document result)**

On `/assets` → Characters tab, hover a card → wand button appears → opens modal → enter a style → Generate → 6 images stream → edit name → Save → new card appears. Confirm the variant's images do NOT appear in the Assets tab.

- [ ] **Step 6: Commit**

```bash
git add components/assets/CharacterCard.tsx components/assets/CharacterGrid.tsx app/assets/page.tsx
git commit -m "feat(characters): add Create-variant button to the assets page"
```

---

## Task 8: Wire the variant button into the editor Characters panel

**Files:**
- Modify: `components/editor/CharactersPanel.tsx`

- [ ] **Step 1: Add imports + modal state + handler in CharactersPanel**

In `components/editor/CharactersPanel.tsx`:

Add `Wand2` to the lucide import:

```tsx
import { Users, UserCircle, Plus, X, Sparkles, Wand2 } from 'lucide-react';
```

Add the modal import:

```tsx
import CharacterVariantModal from '@/components/assets/CharacterVariantModal';
```

In `CharactersPanel`, add variant state next to `modalOpen`:

```tsx
    const [variantSource, setVariantSource] = useState<Character | null>(null);
```

Pass an `onVariant` callback into the inline card render (update the `.map`):

```tsx
                                {characters.map((c, i) => (
                                    <CharacterCard key={c.id} character={c} index={i} onVariant={setVariantSource} />
                                ))}
```

Render the variant modal right after the existing `<CharacterModal ... />`:

```tsx
            <CharacterVariantModal
                open={!!variantSource}
                source={variantSource}
                onClose={() => setVariantSource(null)}
                onSave={async (input) => { await createCharacter(input); }}
            />
```

- [ ] **Step 2: Add the variant button to the inline CharacterCard**

Still in `components/editor/CharactersPanel.tsx`, update the local `CharacterCard` component.

Change its signature to accept `onVariant`:

```tsx
function CharacterCard({ character, index, onVariant }: { character: Character; index: number; onVariant: (c: Character) => void }) {
```

Add a wand button inside the card's root `motion.div`, as the first child (so it sits above the gradient/name overlay). Insert it immediately after the opening `<motion.div ...>` ... `>`:

```tsx
            <button
                onClick={(e) => { e.stopPropagation(); onVariant(character); }}
                title="Create variant"
                className="absolute top-1.5 left-1.5 z-10 p-1.5 rounded-lg bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-accent-primary"
            >
                <Wand2 className="w-3.5 h-3.5" />
            </button>
```

(`e.stopPropagation()` prevents the card's `onClick` from also dropping a character node on the canvas.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual verification (document result)**

In the editor, open the Characters side panel → hover a card → wand button (top-left) appears → clicking it opens the variant modal WITHOUT dropping a node on the canvas → generate + save works → new character appears in the panel.

- [ ] **Step 5: Commit**

```bash
git add components/editor/CharactersPanel.tsx
git commit -m "feat(characters): add Create-variant button to the editor characters panel"
```

---

## Final verification

- [ ] Run `npx tsc --noEmit` — clean.
- [ ] Run `node scripts/cleanup-character-assets.smoke.js` — prints OK.
- [ ] Goal 1 end-to-end: character node in a run → no leak, no dupes; downstream still gets references.
- [ ] Goal 2 end-to-end on both surfaces: variant generates with preserved identity + new style, saves as a new standalone character, and its images don't leak into assets.
- [ ] Operational: run `node scripts/cleanup-character-assets.js --apply` once to clear pre-existing duplicates.
```
