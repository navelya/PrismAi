# Characters Feature — Plan 1: Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the data layer, the `character` node plugin, the `/api/characters` CRUD surface, and the `/assets` page with a quick-add creation modal — so a user can create, browse, edit, delete, and manually drop characters on the workflow canvas. (Chat `@`-mention integration is Plan 2.)

**Architecture:** A new `characters` Postgres table (user-owned, soft-deletable, LoRA-prepared) backs a dedicated `characters` storage bucket. A new ephemeral `character` node plugin (registered in the three node registries) outputs its reference images as an `image_array`. A typed `charactersApi` + `useCharacters` hook feed both the Assets page (grid + modal) and, later, the chat picker.

**Tech Stack:** Next.js 14 App Router, Supabase (Postgres + Storage + RLS), Zustand, React Flow, Tailwind, Sharp (server thumbnails), `@google/generative-ai` (auto-describe), `lucide-react`.

**Verification note:** This repo has **no test runner** (per CLAUDE.md). Verification is `npx tsc --noEmit` (authoritative — `npm run lint`/`build` are unreliable here per project memory) plus manual browser testing on `npm run dev`. Every task ends with a typecheck + a manual check, not unit tests.

**Reference spec:** `docs/superpowers/specs/2026-05-21-characters-feature-design.md`

---

## File Structure

**New files:**
- `supabase/migrations/20260521_characters.sql` — table, indexes, updated_at trigger, RLS, storage bucket + policies
- `lib/nodes/plugins/character/definition.ts` — shared def (`CharacterConfig`, handles, aiSchema)
- `lib/nodes/plugins/character/component.tsx` — React Flow node + client def
- `lib/nodes/plugins/character/executor.server.ts` — server executor (returns reference images as `ImageObject[]`)
- `lib/nodes/plugins/character/index.ts` — barrel exports
- `app/api/characters/route.ts` — `GET` list, `POST` create
- `app/api/characters/[id]/route.ts` — `PATCH` edit, `DELETE` soft-delete
- `app/api/characters/auto-describe/route.ts` — Gemini Vision description draft
- `lib/hooks/use-characters.ts` — fetch/create/update/delete hook
- `app/assets/page.tsx` — Assets page with Characters tab
- `components/assets/CharacterGrid.tsx` — grid + empty/loading states
- `components/assets/CharacterCard.tsx` — single card + hover menu
- `components/assets/CharacterModal.tsx` — quick-add/edit modal

**Modified files:**
- `lib/nodes/core/shared-registry.ts` — register `character`
- `lib/nodes/core/client-registry.ts` — register `character`
- `lib/nodes/core/server-registry.ts` — register `character`
- `lib/api/client.ts` — add `charactersApi`
- `components/layout/Sidebar.tsx` — add Assets nav item

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20260521_characters.sql`

- [ ] **Step 1: Write the migration**

Follow the existing convention from `supabase/migrations/20260430_workflow_templates.sql` (CREATE TABLE IF NOT EXISTS, indexes, updated_at trigger, RLS policies using `auth.uid()`, a service-role policy, and a closing RAISE NOTICE).

```sql
-- Migration: characters table + storage bucket
-- Date: 2026-05-21
-- Description: User-owned reusable characters (named reference-image bundles)
--              referenced from chat via @ mentions and dropped on the canvas as
--              `character` nodes. Soft-deletable so saved workflows survive.
--              LoRA columns are present-but-null for a future fine-tuning upgrade.

-- 1. CREATE TABLE
CREATE TABLE IF NOT EXISTS public.characters (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  description      TEXT,
  -- array of { url, path }; index 0 is the primary reference image
  reference_images JSONB NOT NULL DEFAULT '[]',
  thumbnail_url    TEXT,
  weight           INT NOT NULL DEFAULT 70 CHECK (weight >= 0 AND weight <= 100),
  -- v1.1 LoRA fields (nullable now, no migration needed later)
  lora_url         TEXT,
  lora_status      TEXT CHECK (lora_status IN ('training', 'ready', 'failed')),
  lora_training_id TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ,
  last_used_at     TIMESTAMPTZ
);

-- 2. PERFORMANCE INDEXES
CREATE INDEX IF NOT EXISTS idx_characters_user_recent
  ON public.characters (user_id, deleted_at, last_used_at DESC);
CREATE INDEX IF NOT EXISTS idx_characters_user_name
  ON public.characters (user_id, deleted_at, name);

-- 3. AUTO-UPDATE updated_at
CREATE OR REPLACE FUNCTION public.set_characters_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_characters_updated_at ON public.characters;
CREATE TRIGGER trg_characters_updated_at
  BEFORE UPDATE ON public.characters
  FOR EACH ROW EXECUTE FUNCTION public.set_characters_updated_at();

-- 4. ROW LEVEL SECURITY
ALTER TABLE public.characters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read their own characters" ON public.characters;
CREATE POLICY "Users read their own characters"
  ON public.characters FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users create their own characters" ON public.characters;
CREATE POLICY "Users create their own characters"
  ON public.characters FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users update their own characters" ON public.characters;
CREATE POLICY "Users update their own characters"
  ON public.characters FOR UPDATE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users delete their own characters" ON public.characters;
CREATE POLICY "Users delete their own characters"
  ON public.characters FOR DELETE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role manages all characters" ON public.characters;
CREATE POLICY "Service role manages all characters"
  ON public.characters FOR ALL
  USING (auth.role() = 'service_role');

-- 5. STORAGE BUCKET (public-read, user-scoped writes under {userId}/...)
INSERT INTO storage.buckets (id, name, public)
VALUES ('characters', 'characters', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read characters bucket" ON storage.objects;
CREATE POLICY "Public read characters bucket"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'characters');

DROP POLICY IF EXISTS "Users upload to own characters folder" ON storage.objects;
CREATE POLICY "Users upload to own characters folder"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'characters'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users delete own characters folder" ON storage.objects;
CREATE POLICY "Users delete own characters folder"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'characters'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 6. SYSTEM NOTICE
DO $$
BEGIN
  RAISE NOTICE '✅ characters table + storage bucket created and secured.';
END $$;
```

- [ ] **Step 2: Apply the migration to the live Supabase project**

This repo applies SQL by hand (no migration CLI in the loop). Open the Supabase SQL editor for the project in `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`) and run the file's contents.
Expected: "Success. No rows returned" and the `✅ characters table...` notice. Verify the table exists:
```sql
SELECT column_name FROM information_schema.columns WHERE table_name = 'characters' ORDER BY ordinal_position;
```
Expected columns: `id, user_id, name, description, reference_images, thumbnail_url, weight, lora_url, lora_status, lora_training_id, created_at, updated_at, deleted_at, last_used_at`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260521_characters.sql
git commit -m "feat(characters): add characters table + storage bucket migration"
```

---

## Task 2: Character node — shared definition

**Files:**
- Create: `lib/nodes/plugins/character/definition.ts`

- [ ] **Step 1: Write the shared def**

Mirror `lib/nodes/plugins/media_input/definition.ts`. The config is a *snapshot* (see spec §2). `family: 'input'` makes the node ephemeral automatically (`isEphemeralNode` keys off `family !== 'generative'` — there is no `EPHEMERAL_HANDLERS` to edit).

```ts
import { NodeSharedDef } from '../../core/types';

/**
 * Character Node — a snapshot of a reusable character.
 * Config is a frozen copy (not a live DB reference) so saved workflows render
 * even after the source character is edited or deleted. `characterId` is kept
 * for a future opt-in "character changed — refresh node?" affordance.
 */
export interface CharacterConfig {
    characterId: string;
    name: string;
    referenceImages: string[]; // snapshot URLs, 1-5; index 0 = primary
    description?: string;
    weight?: number;           // 0-100
}

export const characterSharedDef: NodeSharedDef<CharacterConfig> = {
    type: 'character',
    family: 'input',
    category: 'input',
    meta: {
        label: 'Character',
        description: 'A reusable character (reference images + identity) fed into reference-aware generators',
        color: '#a855f7',
        icon: 'UserCircle',
    },
    handles: {
        inputs: [],
        outputs: [{ id: 'character_out', label: 'Character', dataType: 'image_array' }],
    },
    defaultConfig: {
        characterId: '',
        name: '',
        referenceImages: [],
        description: '',
        weight: 70,
    },
    aiSchema: {
        type: 'object',
        properties: {
            characterId: { type: 'string', description: 'ID of an existing character the user referenced. The server fills in name/images/description/weight from this id — do not invent these.' },
        },
        required: ['characterId'],
    },
};
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `character/definition.ts`. (The plugin is not yet registered, so unused-import errors won't appear; a clean run is fine.)

- [ ] **Step 3: Commit**

```bash
git add lib/nodes/plugins/character/definition.ts
git commit -m "feat(characters): add character node shared definition"
```

---

## Task 3: Character node — server executor

**Files:**
- Create: `lib/nodes/plugins/character/executor.server.ts`

- [ ] **Step 1: Write the executor**

Mirror `media_input/executor.server.ts`. Returns the snapshot reference images as `ImageObject[]`; the engine's `toResultDataForType('image', ...)` extracts the URLs for downstream nodes.

```ts
import { ExecutionContext, NodeExecutionResult, ImageObject } from '../../types';
import { CharacterConfig } from './definition';

export const characterExecutor = async (
    config: CharacterConfig,
    _input: any,
    _context: ExecutionContext
): Promise<NodeExecutionResult> => {
    try {
        const urls = Array.isArray(config?.referenceImages) ? config.referenceImages : [];
        if (urls.length === 0) {
            return {
                success: false,
                data: null,
                error: `Character "${config?.name || 'unknown'}" has no reference images.`,
            };
        }

        const imageObjects: ImageObject[] = urls.map((url, index) => ({
            url,
            resolution: { width: 800, height: 600 },
            metadata: {
                title: `${config.name || 'Character'} reference ${index + 1}`,
                source: 'Character',
                format: typeof url === 'string' && url.includes('image/png') ? 'png' : 'jpg',
            },
        }));

        return { success: true, data: imageObjects };
    } catch (error) {
        return {
            success: false,
            data: null,
            error: error instanceof Error ? error.message : 'Failed to resolve character reference images',
        };
    }
};
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `character/executor.server.ts`. If `ImageObject` is not exported from `lib/nodes/types`, confirm the import path matches `media_input/executor.server.ts` (it imports from `../../types`).

- [ ] **Step 3: Commit**

```bash
git add lib/nodes/plugins/character/executor.server.ts
git commit -m "feat(characters): add character node server executor"
```

---

## Task 4: Character node — client component + barrel

**Files:**
- Create: `lib/nodes/plugins/character/component.tsx`
- Create: `lib/nodes/plugins/character/index.ts`

- [ ] **Step 1: Write the node component**

A read-only canvas card (characters are created/edited in the modal, not on canvas). Mirror the `BaseNode` usage from `media_input/component.tsx`.

```tsx
'use client';

import React, { memo } from 'react';
import { NodeProps } from 'reactflow';
import { cn } from '@/lib/utils';
import BaseNode from '@/lib/nodes/core/canvas/BaseNode';
import { UserCircle } from 'lucide-react';
import { CharacterConfig } from './definition';

interface CharacterNodeData {
    label: string;
    config: CharacterConfig;
}

function CharacterNode({ data, id, selected }: NodeProps<CharacterNodeData>) {
    const config = data.config || ({} as CharacterConfig);
    const images = Array.isArray(config.referenceImages) ? config.referenceImages : [];
    const primary = images[0];

    return (
        <BaseNode
            id={id}
            type="character"
            label={data.label}
            selected={selected}
            nodeData={data}
            isNew={(data as any).isNew}
            renderInputs={false}
            hideStatus={true}
            width=""
            style={{ width: 'max-content', minWidth: 240, maxWidth: 300 }}
        >
            <div className="flex flex-col gap-2 p-1">
                <div className="relative w-full aspect-square rounded-xl overflow-hidden bg-white/5 border border-white/10">
                    {primary ? (
                        <img src={primary} alt={config.name || 'Character'} className="w-full h-full object-cover" />
                    ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-content-tertiary">
                            <UserCircle className="w-10 h-10" />
                        </div>
                    )}
                    {images.length > 1 && (
                        <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded-md bg-black/60 text-white text-[10px] font-medium">
                            +{images.length - 1}
                        </span>
                    )}
                </div>
                <div className="px-1">
                    <p className="text-sm font-semibold text-content-primary truncate">{config.name || 'Character'}</p>
                    {config.description && (
                        <p className={cn('text-xs text-content-tertiary line-clamp-2')}>{config.description}</p>
                    )}
                </div>
            </div>
        </BaseNode>
    );
}

export default memo(CharacterNode);

import { NodeClientDef } from '../../core/types';
import { characterSharedDef } from './definition';

export const characterClientDef: NodeClientDef = {
    ...characterSharedDef,
    component: memo((props: any) => <CharacterNode {...props} type="character" />),
};
```

- [ ] **Step 2: Write the barrel**

Mirror `media_input/index.ts`.

```ts
export { characterSharedDef, type CharacterConfig } from './definition';
export { characterClientDef, default as CharacterNode } from './component';
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors. Confirm `BaseNode` default-export path `@/lib/nodes/core/canvas/BaseNode` resolves (same import `media_input/component.tsx` uses).

- [ ] **Step 4: Commit**

```bash
git add lib/nodes/plugins/character/component.tsx lib/nodes/plugins/character/index.ts
git commit -m "feat(characters): add character node component + barrel"
```

---

## Task 5: Register the character node in all three registries

**Files:**
- Modify: `lib/nodes/core/shared-registry.ts`
- Modify: `lib/nodes/core/client-registry.ts`
- Modify: `lib/nodes/core/server-registry.ts`

- [ ] **Step 1: Register in the shared registry**

In `lib/nodes/core/shared-registry.ts`, add the import after the existing `aiGeneratorSharedDef` import:
```ts
import { characterSharedDef } from '../plugins/character/definition';
```
And add to the `sharedRegistry` object (after the `ai_generator` line, before `group_container`):
```ts
    character: characterSharedDef,
```

- [ ] **Step 2: Register in the client registry**

In `lib/nodes/core/client-registry.ts`, add the import:
```ts
import { characterClientDef } from '../plugins/character';
```
And add to the `clientRegistry` object:
```ts
    character: characterClientDef,
```

- [ ] **Step 3: Register in the server registry**

In `lib/nodes/core/server-registry.ts`, add the imports:
```ts
import { characterSharedDef } from '../plugins/character/definition';
import { characterExecutor } from '../plugins/character/executor.server';
```
And add to the `serverRegistry` object:
```ts
    character: { ...characterSharedDef, executor: characterExecutor },
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verify (dev server)**

Run: `npm run dev`. Open a chat/editor, manually add a `character` node if the add-node panel exposes registry types (or defer visual check to Task 11 where the modal/grid populate it). At minimum confirm the dev server compiles with no runtime error mentioning `character`.

- [ ] **Step 6: Commit**

```bash
git add lib/nodes/core/shared-registry.ts lib/nodes/core/client-registry.ts lib/nodes/core/server-registry.ts
git commit -m "feat(characters): register character node in shared/client/server registries"
```

---

## Task 6: `/api/characters` — list + create

**Files:**
- Create: `app/api/characters/route.ts`

- [ ] **Step 1: Write the route**

Mirror `app/api/sessions/route.ts` for auth + shape. `GET` lists non-deleted characters ordered by recency; `POST` creates one. Reference images and thumbnail are uploaded client-side before POST (Task 9), so the body carries URLs/paths.

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';

export const dynamic = 'force-dynamic';

const MAX_REFERENCE_IMAGES = 5;

interface RefImage { url: string; path: string; }

function sanitizeRefImages(raw: any): RefImage[] {
    if (!Array.isArray(raw)) return [];
    const out: RefImage[] = [];
    for (const item of raw) {
        const url = typeof item?.url === 'string' ? item.url : undefined;
        const path = typeof item?.path === 'string' ? item.path : '';
        if (!url) continue;
        out.push({ url, path });
        if (out.length >= MAX_REFERENCE_IMAGES) break;
    }
    return out;
}

/** GET /api/characters — list the user's non-deleted characters, most-recently-used first */
export async function GET() {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;

    const { data, error } = await supabase
        .from('characters')
        .select('id, name, description, reference_images, thumbnail_url, weight, created_at, updated_at, last_used_at')
        .eq('user_id', user.id)
        .is('deleted_at', null)
        .order('last_used_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ characters: data });
}

/** POST /api/characters — create a character */
export async function POST(request: NextRequest) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;

    let body: any;
    try { body = await request.json(); }
    catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

    const referenceImages = sanitizeRefImages(body?.referenceImages);
    if (referenceImages.length === 0) {
        return NextResponse.json({ error: 'At least one reference image is required' }, { status: 400 });
    }

    const description = typeof body?.description === 'string' ? body.description : null;
    const weightRaw = Number(body?.weight);
    const weight = Number.isFinite(weightRaw) ? Math.min(100, Math.max(0, Math.round(weightRaw))) : 70;
    const thumbnailUrl = typeof body?.thumbnailUrl === 'string' ? body.thumbnailUrl : referenceImages[0].url;

    const { data, error } = await supabase
        .from('characters')
        .insert({
            user_id: user.id,
            name,
            description,
            reference_images: referenceImages,
            thumbnail_url: thumbnailUrl,
            weight,
        })
        .select('id, name, description, reference_images, thumbnail_url, weight, created_at, updated_at, last_used_at')
        .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ character: data }, { status: 201 });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verify**

With `npm run dev` running and logged in, in the browser devtools console:
```js
await fetch('/api/characters').then(r => r.json())
```
Expected: `{ characters: [] }` (empty array for a fresh user). A `POST` without name returns 400.

- [ ] **Step 4: Commit**

```bash
git add app/api/characters/route.ts
git commit -m "feat(characters): add list + create API route"
```

---

## Task 7: `/api/characters/[id]` — edit + soft-delete

**Files:**
- Create: `app/api/characters/[id]/route.ts`

- [ ] **Step 1: Write the route**

`PATCH` updates editable fields; `DELETE` soft-deletes (sets `deleted_at`). Both rely on RLS to scope to the owner, with an explicit `user_id` filter as defense-in-depth.

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';

export const dynamic = 'force-dynamic';

const MAX_REFERENCE_IMAGES = 5;

function sanitizeRefImages(raw: any): { url: string; path: string }[] {
    if (!Array.isArray(raw)) return [];
    const out: { url: string; path: string }[] = [];
    for (const item of raw) {
        const url = typeof item?.url === 'string' ? item.url : undefined;
        const path = typeof item?.path === 'string' ? item.path : '';
        if (!url) continue;
        out.push({ url, path });
        if (out.length >= MAX_REFERENCE_IMAGES) break;
    }
    return out;
}

/** PATCH /api/characters/[id] — edit a character */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;

    const id = params.id;
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    let body: any;
    try { body = await request.json(); }
    catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

    const update: Record<string, any> = {};
    if (typeof body?.name === 'string') {
        const name = body.name.trim();
        if (!name) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 });
        update.name = name;
    }
    if (typeof body?.description === 'string' || body?.description === null) {
        update.description = body.description;
    }
    if (body?.referenceImages !== undefined) {
        const imgs = sanitizeRefImages(body.referenceImages);
        if (imgs.length === 0) return NextResponse.json({ error: 'At least one reference image is required' }, { status: 400 });
        update.reference_images = imgs;
    }
    if (body?.weight !== undefined) {
        const w = Number(body.weight);
        if (Number.isFinite(w)) update.weight = Math.min(100, Math.max(0, Math.round(w)));
    }
    if (typeof body?.thumbnailUrl === 'string') update.thumbnail_url = body.thumbnailUrl;

    if (Object.keys(update).length === 0) {
        return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });
    }

    const { data, error } = await supabase
        .from('characters')
        .update(update)
        .eq('id', id)
        .eq('user_id', user.id)
        .is('deleted_at', null)
        .select('id, name, description, reference_images, thumbnail_url, weight, created_at, updated_at, last_used_at')
        .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Character not found' }, { status: 404 });
    return NextResponse.json({ character: data });
}

/** DELETE /api/characters/[id] — soft delete */
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;

    const id = params.id;
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const { error } = await supabase
        .from('characters')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', user.id)
        .is('deleted_at', null);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "app/api/characters/[id]/route.ts"
git commit -m "feat(characters): add edit + soft-delete API route"
```

---

## Task 8: `/api/characters/auto-describe` — Gemini Vision draft

**Files:**
- Create: `app/api/characters/auto-describe/route.ts`

- [ ] **Step 1: Write the route**

Uses `@google/generative-ai` directly (the shared `getGeminiModel` injects a workflow-builder system prompt unsuitable here). Accepts a public image URL, fetches it server-side, sends it inline to a vision model, returns a short character description. Degrades gracefully if `GEMINI_API_KEY` is unset.

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const dynamic = 'force-dynamic';

const PROMPT =
    'Describe this character for an image-generation reference in one or two sentences. ' +
    'Focus on stable visual identity: age range, hair, eyes, distinctive facial features, ' +
    'build, and signature clothing. Do not mention the background or pose. Plain text only.';

export async function POST(request: NextRequest) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return NextResponse.json({ error: 'Auto-describe unavailable (GEMINI_API_KEY not set)' }, { status: 503 });
    }

    let body: any;
    try { body = await request.json(); }
    catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

    const imageUrl = typeof body?.imageUrl === 'string' ? body.imageUrl : '';
    if (!imageUrl || !/^https?:\/\//.test(imageUrl)) {
        return NextResponse.json({ error: 'A valid imageUrl is required' }, { status: 400 });
    }

    try {
        const resp = await fetch(imageUrl);
        if (!resp.ok) throw new Error(`Failed to fetch image (HTTP ${resp.status})`);
        const mimeType = resp.headers.get('content-type') || 'image/jpeg';
        const base64 = Buffer.from(await resp.arrayBuffer()).toString('base64');

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const result = await model.generateContent([
            PROMPT,
            { inlineData: { mimeType, data: base64 } },
        ]);
        const description = result.response.text().trim();

        return NextResponse.json({ description });
    } catch (err: any) {
        console.error('[characters/auto-describe] error:', err);
        return NextResponse.json({ error: err?.message || 'Auto-describe failed' }, { status: 500 });
    }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. Confirm `@google/generative-ai` exports `GoogleGenerativeAI` (it does — `lib/ai/gemini-client.ts` imports it).

- [ ] **Step 3: Commit**

```bash
git add app/api/characters/auto-describe/route.ts
git commit -m "feat(characters): add Gemini Vision auto-describe route"
```

---

## Task 9: `charactersApi` client + `useCharacters` hook

**Files:**
- Modify: `lib/api/client.ts`
- Create: `lib/hooks/use-characters.ts`

- [ ] **Step 1: Add `charactersApi` to the client**

Append to `lib/api/client.ts` (after the existing `sessionsApi` block; keep the shared `apiFetch` helper). The `Character` type is exported for reuse by the hook and (later) the chat picker.

```ts
// ─── Character APIs ────────────────────────────────────────────────────

export interface CharacterRefImage { url: string; path: string; }

export interface Character {
    id: string;
    name: string;
    description: string | null;
    reference_images: CharacterRefImage[];
    thumbnail_url: string | null;
    weight: number;
    created_at: string;
    updated_at: string;
    last_used_at: string | null;
}

export interface CharacterInput {
    name: string;
    description?: string | null;
    referenceImages: CharacterRefImage[];
    thumbnailUrl?: string;
    weight?: number;
}

export const charactersApi = {
    list: () => apiFetch<{ characters: Character[] }>('/api/characters', { cache: 'no-store' }),

    create: (input: CharacterInput) =>
        apiFetch<{ character: Character }>('/api/characters', {
            method: 'POST',
            body: JSON.stringify(input),
        }),

    update: (id: string, input: Partial<CharacterInput>) =>
        apiFetch<{ character: Character }>(`/api/characters/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(input),
        }),

    delete: (id: string) =>
        apiFetch<{ success: boolean }>(`/api/characters/${id}`, { method: 'DELETE' }),

    autoDescribe: (imageUrl: string) =>
        apiFetch<{ description: string }>('/api/characters/auto-describe', {
            method: 'POST',
            body: JSON.stringify({ imageUrl }),
        }),
};
```

- [ ] **Step 2: Write the hook**

```ts
'use client';

import { useCallback, useEffect, useState } from 'react';
import { charactersApi, type Character, type CharacterInput } from '@/lib/api/client';

export function useCharacters() {
    const [characters, setCharacters] = useState<Character[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            setLoading(true);
            const { characters } = await charactersApi.list();
            setCharacters(characters);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load characters');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const createCharacter = useCallback(async (input: CharacterInput) => {
        const { character } = await charactersApi.create(input);
        setCharacters((prev) => [character, ...prev]);
        return character;
    }, []);

    const updateCharacter = useCallback(async (id: string, input: Partial<CharacterInput>) => {
        const { character } = await charactersApi.update(id, input);
        setCharacters((prev) => prev.map((c) => (c.id === id ? character : c)));
        return character;
    }, []);

    const deleteCharacter = useCallback(async (id: string) => {
        setCharacters((prev) => prev.filter((c) => c.id !== id));
        await charactersApi.delete(id);
    }, []);

    return { characters, loading, error, load, createCharacter, updateCharacter, deleteCharacter };
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/api/client.ts lib/hooks/use-characters.ts
git commit -m "feat(characters): add charactersApi client + useCharacters hook"
```

---

## Task 10: Creation/edit modal (`CharacterModal`)

**Files:**
- Create: `components/assets/CharacterModal.tsx`

Uploads use the existing `uploadApi.upload(file, { ... })` (see `media_input/component.tsx`), which posts to `/api/upload` and returns `{ publicUrl, path }`. NOTE: `/api/upload` writes to the `chat-assets` bucket; for v1 that is acceptable (still user-scoped). A future refinement can target the `characters` bucket — out of scope for this task.

- [ ] **Step 1: Write the modal**

```tsx
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { X, Upload, Sparkles, Star, Loader2 } from 'lucide-react';
import { uploadApi, charactersApi, type Character, type CharacterRefImage, type CharacterInput } from '@/lib/api/client';

interface CharacterModalProps {
    open: boolean;
    initial?: Character | null;
    onClose: () => void;
    onSave: (input: CharacterInput, id?: string) => Promise<void>;
}

const MAX_IMAGES = 5;

export default function CharacterModal({ open, initial, onClose, onSave }: CharacterModalProps) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [weight, setWeight] = useState(70);
    const [images, setImages] = useState<CharacterRefImage[]>([]);
    const [uploading, setUploading] = useState(false);
    const [describing, setDescribing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (open) {
            setName(initial?.name ?? '');
            setDescription(initial?.description ?? '');
            setWeight(initial?.weight ?? 70);
            setImages(Array.isArray(initial?.reference_images) ? initial!.reference_images : []);
            setErrorMsg(null);
        }
    }, [open, initial]);

    if (!open) return null;

    const handleFiles = async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        setUploading(true);
        setErrorMsg(null);
        let failures = 0;
        try {
            const room = MAX_IMAGES - images.length;
            const chosen = Array.from(files).slice(0, Math.max(0, room));
            const results = await Promise.all(
                chosen.map(async (file) => {
                    if (!file.type.startsWith('image/')) { failures++; return null; }
                    try {
                        const r = await uploadApi.upload(file, { filename: `character-${Date.now()}-${file.name}` });
                        return { url: r.publicUrl, path: r.path } as CharacterRefImage;
                    } catch { failures++; return null; }
                })
            );
            const ok = results.filter((r): r is CharacterRefImage => r !== null);
            if (ok.length > 0) setImages((prev) => [...prev, ...ok].slice(0, MAX_IMAGES));
            if (failures > 0) setErrorMsg(`${failures} image(s) failed to upload`);
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const removeImage = (index: number) => setImages((prev) => prev.filter((_, i) => i !== index));
    const makePrimary = (index: number) =>
        setImages((prev) => {
            if (index === 0) return prev;
            const copy = [...prev];
            const [picked] = copy.splice(index, 1);
            return [picked, ...copy];
        });

    const handleAutoDescribe = async () => {
        if (images.length === 0) { setErrorMsg('Add a reference image first'); return; }
        setDescribing(true);
        setErrorMsg(null);
        try {
            const { description } = await charactersApi.autoDescribe(images[0].url);
            setDescription(description);
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : 'Auto-describe failed');
        } finally {
            setDescribing(false);
        }
    };

    const handleSave = async () => {
        if (!name.trim()) { setErrorMsg('Name is required'); return; }
        if (images.length === 0) { setErrorMsg('At least one reference image is required'); return; }
        setSaving(true);
        setErrorMsg(null);
        try {
            await onSave(
                {
                    name: name.trim(),
                    description: description.trim() || null,
                    referenceImages: images,
                    thumbnailUrl: images[0].url,
                    weight,
                },
                initial?.id
            );
            onClose();
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : 'Failed to save character');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
            <div
                className="w-full max-w-md rounded-2xl bg-surface-primary border border-stroke-subtle shadow-2xl p-5 space-y-4"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold text-content-primary">{initial ? 'Edit Character' : 'New Character'}</h2>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-interactive-hover text-content-tertiary">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Images */}
                <div className="flex flex-wrap gap-2">
                    {images.map((img, index) => (
                        <div key={img.path || img.url} className="relative w-16 h-16 rounded-lg overflow-hidden group border border-stroke-subtle">
                            <img src={img.url} alt="" className="w-full h-full object-cover" />
                            {index === 0 && (
                                <span className="absolute top-0.5 left-0.5 text-amber-300"><Star className="w-3 h-3 fill-current" /></span>
                            )}
                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                                {index !== 0 && (
                                    <button onClick={() => makePrimary(index)} title="Make primary" className="p-1 text-white hover:text-amber-300">
                                        <Star className="w-3.5 h-3.5" />
                                    </button>
                                )}
                                <button onClick={() => removeImage(index)} title="Remove" className="p-1 text-white hover:text-red-400">
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    ))}
                    {images.length < MAX_IMAGES && (
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="w-16 h-16 rounded-lg border border-dashed border-stroke-subtle flex items-center justify-center text-content-tertiary hover:text-accent-primary hover:border-accent-primary/50"
                        >
                            {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
                        </button>
                    )}
                </div>
                <p className="text-xs text-content-tertiary -mt-2">First image (★) is the primary. Up to {MAX_IMAGES}.</p>

                {/* Name */}
                <div>
                    <label className="block text-xs font-medium text-content-secondary mb-1">Name *</label>
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Alice"
                        className="w-full px-3 py-2 rounded-lg bg-surface-tertiary border border-stroke-subtle text-content-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
                    />
                </div>

                {/* Description */}
                <div>
                    <div className="flex items-center justify-between mb-1">
                        <label className="block text-xs font-medium text-content-secondary">Description</label>
                        <button
                            type="button"
                            onClick={handleAutoDescribe}
                            disabled={describing}
                            className="flex items-center gap-1 text-xs text-accent-primary hover:underline disabled:opacity-50"
                        >
                            {describing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                            Auto-describe
                        </button>
                    </div>
                    <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={3}
                        placeholder="red hair, freckles, green eyes, leather jacket..."
                        className="w-full px-3 py-2 rounded-lg bg-surface-tertiary border border-stroke-subtle text-content-primary resize-none focus:outline-none focus:ring-2 focus:ring-accent-primary"
                    />
                </div>

                {/* Weight */}
                <div>
                    <label className="block text-xs font-medium text-content-secondary mb-1">Reference weight: {weight}</label>
                    <input type="range" min={0} max={100} value={weight} onChange={(e) => setWeight(Number(e.target.value))} className="w-full accent-accent-primary" />
                </div>

                {errorMsg && <p className="text-xs text-red-400">{errorMsg}</p>}

                <div className="flex justify-end gap-2 pt-1">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg text-content-secondary hover:bg-interactive-hover">Cancel</button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-hover disabled:opacity-50 flex items-center gap-2"
                    >
                        {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                        Save Character
                    </button>
                </div>

                <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={(e) => handleFiles(e.target.files)} className="hidden" />
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. Confirm `uploadApi.upload` signature matches usage (it accepts `(file, { sessionId?, nodeId?, filename? })` per `media_input/component.tsx`; here we pass only `{ filename }`).

- [ ] **Step 3: Commit**

```bash
git add components/assets/CharacterModal.tsx
git commit -m "feat(characters): add create/edit modal with auto-describe"
```

---

## Task 11: Assets page + grid + card

**Files:**
- Create: `components/assets/CharacterCard.tsx`
- Create: `components/assets/CharacterGrid.tsx`
- Create: `app/assets/page.tsx`

- [ ] **Step 1: Write the card**

Mirror the visual language of `WorkflowCard`/`WorkflowList`. Hover menu exposes Edit and Delete.

```tsx
'use client';

import React from 'react';
import { Pencil, Trash2, UserCircle } from 'lucide-react';
import type { Character } from '@/lib/api/client';

interface CharacterCardProps {
    character: Character;
    onEdit: (c: Character) => void;
    onDelete: (id: string) => void;
}

export default function CharacterCard({ character, onEdit, onDelete }: CharacterCardProps) {
    const thumb = character.thumbnail_url || character.reference_images?.[0]?.url;

    return (
        <div className="group relative rounded-2xl overflow-hidden border border-stroke-subtle bg-surface-tertiary hover:border-accent-primary/40 transition-all">
            <div className="aspect-square w-full bg-white/5">
                {thumb ? (
                    <img src={thumb} alt={character.name} className="w-full h-full object-cover" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-content-tertiary">
                        <UserCircle className="w-12 h-12" />
                    </div>
                )}
            </div>
            <div className="p-3">
                <p className="font-semibold text-content-primary truncate">{character.name}</p>
                {character.description && (
                    <p className="text-xs text-content-tertiary line-clamp-2 mt-0.5">{character.description}</p>
                )}
            </div>
            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => onEdit(character)} title="Edit" className="p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80">
                    <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => onDelete(character.id)} title="Delete" className="p-1.5 rounded-lg bg-black/60 text-white hover:bg-red-500">
                    <Trash2 className="w-3.5 h-3.5" />
                </button>
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Write the grid**

Mirror `WorkflowList` loading/empty/grid states.

```tsx
'use client';

import React from 'react';
import { Loader2, UserCircle, Plus } from 'lucide-react';
import CharacterCard from './CharacterCard';
import type { Character } from '@/lib/api/client';

interface CharacterGridProps {
    characters: Character[];
    loading: boolean;
    onCreate: () => void;
    onEdit: (c: Character) => void;
    onDelete: (id: string) => void;
}

export default function CharacterGrid({ characters, loading, onCreate, onEdit, onDelete }: CharacterGridProps) {
    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-accent-primary" />
            </div>
        );
    }

    if (characters.length === 0) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="text-center space-y-4">
                    <div className="w-16 h-16 rounded-full bg-surface-tertiary flex items-center justify-center mx-auto">
                        <UserCircle className="w-8 h-8 text-content-tertiary" />
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-content-primary">No characters yet</h3>
                        <p className="text-content-secondary mt-1">Create a character to reuse them across generations</p>
                    </div>
                    <button onClick={onCreate} className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-premium text-white rounded-xl">
                        <Plus className="w-4 h-4" /> New Character
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {characters.map((c) => (
                <CharacterCard key={c.id} character={c} onEdit={onEdit} onDelete={onDelete} />
            ))}
        </div>
    );
}
```

- [ ] **Step 3: Write the Assets page**

Tabs for `Characters` (live) and disabled `Styles`/`Props`. Mirrors the Library page header + search pattern.

```tsx
'use client';

import React, { useState } from 'react';
import { Search, Plus } from 'lucide-react';
import { useCharacters } from '@/lib/hooks/use-characters';
import type { Character, CharacterInput } from '@/lib/api/client';
import CharacterGrid from '@/components/assets/CharacterGrid';
import CharacterModal from '@/components/assets/CharacterModal';

const TABS = [
    { id: 'characters', label: 'Characters', enabled: true },
    { id: 'styles', label: 'Styles', enabled: false },
    { id: 'props', label: 'Props', enabled: false },
] as const;

export default function AssetsPage() {
    const { characters, loading, createCharacter, updateCharacter, deleteCharacter } = useCharacters();
    const [activeTab, setActiveTab] = useState<'characters' | 'styles' | 'props'>('characters');
    const [search, setSearch] = useState('');
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<Character | null>(null);

    const filtered = characters.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));

    const openCreate = () => { setEditing(null); setModalOpen(true); };
    const openEdit = (c: Character) => { setEditing(c); setModalOpen(true); };

    const handleSave = async (input: CharacterInput, id?: string) => {
        if (id) await updateCharacter(id, input);
        else await createCharacter(input);
    };

    return (
        <div className="w-full h-full overflow-y-auto bg-surface-secondary">
            <div className="max-w-7xl mx-auto p-8 space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-content-primary">Assets</h1>
                        <p className="text-content-secondary mt-1">Reusable characters for your generations</p>
                    </div>
                    <button onClick={openCreate} className="flex items-center gap-2 px-6 py-3 bg-gradient-premium text-white rounded-xl hover:shadow-lg hover:shadow-accent-primary/25 transition-all">
                        <Plus className="w-5 h-5" />
                        <span>New Character</span>
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex gap-1 border-b border-stroke-subtle">
                    {TABS.map((tab) => (
                        <button
                            key={tab.id}
                            disabled={!tab.enabled}
                            onClick={() => tab.enabled && setActiveTab(tab.id)}
                            className={`relative px-4 py-2 text-sm font-medium transition-colors ${
                                activeTab === tab.id
                                    ? 'text-accent-primary'
                                    : tab.enabled
                                        ? 'text-content-secondary hover:text-content-primary'
                                        : 'text-content-tertiary cursor-not-allowed'
                            }`}
                        >
                            {tab.label}
                            {!tab.enabled && <span className="ml-1 text-[10px] uppercase tracking-wide text-content-tertiary">soon</span>}
                            {activeTab === tab.id && <span className="absolute left-0 -bottom-px h-0.5 w-full bg-accent-primary" />}
                        </button>
                    ))}
                </div>

                {activeTab === 'characters' && (
                    <>
                        <div className="relative group">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-content-tertiary group-focus-within:text-accent-primary transition-colors" />
                            <input
                                type="text"
                                placeholder="Search characters..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="w-full pl-12 pr-4 py-3 bg-surface-tertiary border border-stroke-subtle rounded-xl text-content-primary placeholder:text-content-tertiary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
                            />
                        </div>
                        <CharacterGrid
                            characters={filtered}
                            loading={loading}
                            onCreate={openCreate}
                            onEdit={openEdit}
                            onDelete={deleteCharacter}
                        />
                    </>
                )}

                <CharacterModal open={modalOpen} initial={editing} onClose={() => setModalOpen(false)} onSave={handleSave} />
            </div>
        </div>
    );
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. Confirm `bg-gradient-premium` exists (used by the Library page) — it does.

- [ ] **Step 5: Manual verify (golden path)**

`npm run dev`, navigate to `/assets`:
1. Empty state shows "No characters yet" + New Character button.
2. Click New Character → modal opens. Drag/select an image → thumbnail appears with ★. Type a name. Click Auto-describe → a description populates (or a graceful error if no `GEMINI_API_KEY`). Save.
3. Card appears in the grid. Hover → Edit/Delete buttons. Edit → modal pre-fills; change name; Save updates the card. Delete → card disappears.
4. Reload the page → the created character persists (DB round-trip).
5. Search box filters by name.

- [ ] **Step 6: Commit**

```bash
git add components/assets/CharacterCard.tsx components/assets/CharacterGrid.tsx app/assets/page.tsx
git commit -m "feat(characters): add Assets page, character grid + card"
```

---

## Task 12: Sidebar nav entry

**Files:**
- Modify: `components/layout/Sidebar.tsx`

- [ ] **Step 1: Add the nav item**

In `components/layout/Sidebar.tsx`, add `UserCircle` to the `lucide-react` import line, then add an entry to the `navItems` array between `Library` and `Nodes`:
```ts
    { name: 'Assets', path: '/assets', icon: UserCircle, desktopOnly: false },
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verify**

`npm run dev`: the sidebar shows an "Assets" item (desktop tooltip + mobile drawer). Clicking it routes to `/assets` and highlights as active.

- [ ] **Step 4: Commit**

```bash
git add components/layout/Sidebar.tsx
git commit -m "feat(characters): add Assets nav item to sidebar"
```

---

## Task 13: End-to-end foundation verification

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: clean (no errors).

- [ ] **Step 2: Manual end-to-end on dev server**

`npm run dev`:
1. Sidebar → Assets → create a character "Alice" with 2 reference images + description + weight 80.
2. Reload `/assets`; Alice persists with both images (open Edit to confirm 2 images, ★ on the first).
3. Confirm the row in Supabase: `SELECT name, jsonb_array_length(reference_images), weight FROM characters;` → `Alice | 2 | 80`.
4. Delete Alice; confirm she vanishes from the grid and `SELECT deleted_at FROM characters WHERE name='Alice';` is non-null (soft delete, row still present).

- [ ] **Step 3: Confirm node registration**

In a dev session, verify `character` is a known node type: open the browser console on a chat/editor page and check the client registry is loaded without error. (Full canvas wiring of the node is exercised in Plan 2 when the chat brain emits it; manual drag-to-canvas is optional here.)

- [ ] **Step 4: Final commit (if any stragglers)**

```bash
git status
# commit anything outstanding with an appropriate message
```

---

## Self-review checklist (completed by plan author)

- **Spec coverage:** §1 data model → Task 1. §2 node → Tasks 2–5. §3 page/modal/API → Tasks 6–12. §6 edge cases: soft-delete (Task 7), partial-upload notice (Task 10), auto-describe graceful degrade (Tasks 8/10), thumbnail fallback (Task 6 `thumbnailUrl ?? primary`, Card/Grid fallbacks). §5 chat brain + §4 `@` picker are **Plan 2** (intentionally out of scope here).
- **Placeholder scan:** every code step contains full code; no TODO/TBD.
- **Type consistency:** `Character`/`CharacterInput`/`CharacterRefImage` defined in Task 9 are used consistently in Tasks 10–11; `CharacterConfig` defined in Task 2 used in Tasks 3–4; API field names (`reference_images` DB ↔ `referenceImages` request body) handled explicitly in route mappers (Tasks 6–7).
- **Known v1 compromise:** `CharacterModal` uploads via the existing `/api/upload` (`chat-assets` bucket) rather than the new `characters` bucket; noted in Task 10. Server-side thumbnail generation with Sharp is deferred — `thumbnail_url` defaults to the primary image URL (Task 6). Both are acceptable for v1 and flagged for later refinement.
