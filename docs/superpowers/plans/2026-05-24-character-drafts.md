# Character Drafts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve an in-progress character as a "draft" when its editor is dismissed without clicking Cancel — drafts are hidden from the `@` mention picker and the side panel, shown only on the assets page (marked "Draft"), and can be saved without a name (but require ≥1 image).

**Architecture:** A single `is_draft` boolean column on `characters`. `GET /api/characters` hides drafts by default and exposes them via `?includeDrafts=true` (used only by the assets page). `POST` gains a `draft` mode that relaxes the name requirement; `PATCH` clears the draft flag on any successful edit (promotion). `CharacterModal` / `CharacterVariantModal` split their exit paths so Cancel discards while X/backdrop/Escape auto-save a draft.

**Tech Stack:** Next.js (App Router, route handlers), Supabase (Postgres + RLS), React + TypeScript, framer-motion. No test runner — verification is `npx tsc --noEmit` + manual UI checks (per CLAUDE.md and the project memory note on verification).

**Spec:** `docs/superpowers/specs/2026-05-24-character-drafts-design.md`

**Branch:** Work directly on `main` (per user instruction).

---

## File Structure

- **Modify** `supabase/migrations/` — new migration adding `is_draft`.
- **Modify** `lib/api/client.ts` — `Character` type + `charactersApi.list`/`create` options.
- **Modify** `app/api/characters/route.ts` — GET filter + POST draft mode.
- **Modify** `app/api/characters/[id]/route.ts` — PATCH promotion + select.
- **Modify** `lib/hooks/use-characters.ts` — `includeDrafts` option + `createDraft`.
- **Modify** `components/assets/CharacterModal.tsx` — `onSaveDraft`, dismiss split, Escape.
- **Modify** `components/assets/CharacterVariantModal.tsx` — same pattern.
- **Modify** `app/assets/page.tsx` — `includeDrafts` + `onSaveDraft` wiring.
- **Modify** `components/assets/CharacterCard.tsx` — "Draft" badge + name fallback.
- **Modify** `components/editor/CharactersPanel.tsx` — `onSaveDraft` wiring.

Tasks are ordered so the data layer lands before the UI that depends on it. Each task ends with a green `npx tsc --noEmit` and a commit.

---

### Task 1: Database migration + `Character` type

**Files:**
- Create: `supabase/migrations/20260524_character_drafts.sql`
- Modify: `lib/api/client.ts:197-207` (the `Character` interface)

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260524_character_drafts.sql`:

```sql
-- Character drafts: a character dismissed from the editor without Cancel is
-- kept as a draft. Drafts are hidden from the @ mention picker and the side
-- characters panel (the default list query filters is_draft = false) and shown
-- only on the assets page. Existing rows default to active (false).
alter table public.characters
  add column if not exists is_draft boolean not null default false;
```

- [ ] **Step 2: Apply the migration to the live database**

This repo runs against a live Supabase instance (no local migration runner). Apply the SQL via the Supabase SQL editor / `psql`, OR confirm with the user how migrations are applied here. The column must exist before the API code that selects it runs.

Run (if `psql`/Supabase CLI is configured): apply `supabase/migrations/20260524_character_drafts.sql`.
Expected: `ALTER TABLE` succeeds; `select is_draft from characters limit 1;` returns rows with `false`.

- [ ] **Step 3: Add `is_draft` to the `Character` type**

In `lib/api/client.ts`, the `Character` interface (lines 197-207) — add `is_draft` after `last_used_at`:

```ts
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
    is_draft: boolean;
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS. Most code obtains `Character` from API responses (the row already carries `is_draft` after Task 1's migration). If tsc flags any spot that constructs a `Character` object literal without `is_draft`, add `is_draft: false` (or the real value) there — that is the expected, correct fix.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260524_character_drafts.sql lib/api/client.ts
git commit -m "feat(characters): add is_draft column and Character.is_draft field"
```

---

### Task 2: `GET /api/characters` — hide drafts by default, opt-in via `?includeDrafts=true`

**Files:**
- Modify: `app/api/characters/route.ts:23-39` (the `GET` handler)

- [ ] **Step 1: Update the GET handler**

Replace the `GET` function (lines 23-39) with:

```ts
/** GET /api/characters — list the user's non-deleted characters, most-recently-used first.
 *  Drafts are hidden unless ?includeDrafts=true (used only by the assets page). */
export async function GET(request: NextRequest) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;

    const includeDrafts = request.nextUrl.searchParams.get('includeDrafts') === 'true';

    let query = supabase
        .from('characters')
        .select('id, name, description, reference_images, thumbnail_url, weight, created_at, updated_at, last_used_at, is_draft')
        .eq('user_id', user.id)
        .is('deleted_at', null);

    if (!includeDrafts) query = query.eq('is_draft', false);

    const { data, error } = await query
        .order('last_used_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ characters: data });
}
```

Note: `GET` now takes a `request: NextRequest` parameter. `NextRequest` is already imported at the top of the file.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/characters/route.ts
git commit -m "feat(characters): GET filters drafts by default, ?includeDrafts=true to include"
```

---

### Task 3: `POST /api/characters` — draft mode relaxes the name requirement

**Files:**
- Modify: `app/api/characters/route.ts:41-79` (the `POST` handler)

- [ ] **Step 1: Update the POST handler**

Replace the body of `POST` (lines 41-79) with:

```ts
/** POST /api/characters — create a character. With { draft: true } the name is
 *  optional (stored as '' if empty) and the row is marked is_draft; an image is
 *  still required. */
export async function POST(request: NextRequest) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;

    let body: any;
    try { body = await request.json(); }
    catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

    const isDraft = body?.draft === true;
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!isDraft && !name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

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
            is_draft: isDraft,
        })
        .select('id, name, description, reference_images, thumbnail_url, weight, created_at, updated_at, last_used_at, is_draft')
        .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ character: data }, { status: 201 });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/characters/route.ts
git commit -m "feat(characters): POST supports draft mode (optional name, is_draft=true)"
```

---

### Task 4: `PATCH /api/characters/[id]` — promote to active + return `is_draft`

**Files:**
- Modify: `app/api/characters/[id]/route.ts:21-70` (the `PATCH` handler)

- [ ] **Step 1: Force `is_draft = false` and add it to the returning select**

In `PATCH`, after the existing field-collection block and before the empty-update check (currently line 54), add a line that always clears the draft flag. The Save button is the only caller and enforces name + image, so a successful edit always yields a valid active character.

Change the empty-update guard region. Replace:

```ts
    if (typeof body?.thumbnailUrl === 'string') update.thumbnail_url = body.thumbnailUrl;

    if (Object.keys(update).length === 0) {
        return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });
    }
```

with:

```ts
    if (typeof body?.thumbnailUrl === 'string') update.thumbnail_url = body.thumbnailUrl;

    if (Object.keys(update).length === 0) {
        return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });
    }

    // A successful manual edit always promotes a draft to active. (The editor's
    // Save button enforces name + >=1 image client-side, and this route
    // re-validates them above, so the result is always a valid active row.)
    update.is_draft = false;
```

- [ ] **Step 2: Add `is_draft` to the returning select**

In the same `PATCH`, update the `.select(...)` (currently line 64) to include `is_draft`:

```ts
        .select('id, name, description, reference_images, thumbnail_url, weight, created_at, updated_at, last_used_at, is_draft')
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "app/api/characters/[id]/route.ts"
git commit -m "feat(characters): PATCH promotes draft to active and returns is_draft"
```

---

### Task 5: API client — `list({ includeDrafts })` and `create(input, { draft })`

**Files:**
- Modify: `lib/api/client.ts:217-240` (the `charactersApi` object)

- [ ] **Step 1: Update `list` and `create`**

Replace `list` and `create` in `charactersApi` (lines 218-224) with:

```ts
    list: (opts?: { includeDrafts?: boolean }) =>
        apiFetch<{ characters: Character[] }>(
            `/api/characters${opts?.includeDrafts ? '?includeDrafts=true' : ''}`,
            { cache: 'no-store' },
        ),

    create: (input: CharacterInput, opts?: { draft?: boolean }) =>
        apiFetch<{ character: Character }>('/api/characters', {
            method: 'POST',
            body: JSON.stringify(opts?.draft ? { ...input, draft: true } : input),
        }),
```

Leave `update`, `delete`, and `autoDescribe` unchanged.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (existing `charactersApi.list()` / `create(input)` calls still compile — both new params are optional).

- [ ] **Step 3: Commit**

```bash
git add lib/api/client.ts
git commit -m "feat(characters): client list(includeDrafts) and create(draft) options"
```

---

### Task 6: `useCharacters` — `includeDrafts` option + `createDraft`

**Files:**
- Modify: `lib/hooks/use-characters.ts` (whole file)

- [ ] **Step 1: Accept options, pass to list, add `createDraft`**

Replace the contents of `lib/hooks/use-characters.ts` with:

```ts
'use client';

import { useCallback, useEffect, useState } from 'react';
import { charactersApi, type Character, type CharacterInput } from '@/lib/api/client';

export function useCharacters(opts?: { includeDrafts?: boolean }) {
    const includeDrafts = opts?.includeDrafts ?? false;
    const [characters, setCharacters] = useState<Character[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            setLoading(true);
            const { characters } = await charactersApi.list({ includeDrafts });
            setCharacters(characters);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load characters');
        } finally {
            setLoading(false);
        }
    }, [includeDrafts]);

    useEffect(() => { load(); }, [load]);

    const createCharacter = useCallback(async (input: CharacterInput) => {
        const { character } = await charactersApi.create(input);
        setCharacters((prev) => [character, ...prev]);
        return character;
    }, []);

    // Save an in-progress character as a draft (editor dismissed without Cancel).
    // Only surface it locally when this hook instance shows drafts (assets page);
    // otherwise (side panel) the draft must NOT flash into the active list.
    const createDraft = useCallback(async (input: CharacterInput) => {
        const { character } = await charactersApi.create(input, { draft: true });
        if (includeDrafts) setCharacters((prev) => [character, ...prev]);
        return character;
    }, [includeDrafts]);

    const updateCharacter = useCallback(async (id: string, input: Partial<CharacterInput>) => {
        const { character } = await charactersApi.update(id, input);
        setCharacters((prev) => prev.map((c) => (c.id === id ? character : c)));
        return character;
    }, []);

    const deleteCharacter = useCallback(async (id: string) => {
        setCharacters((prev) => prev.filter((c) => c.id !== id));
        await charactersApi.delete(id);
    }, []);

    return { characters, loading, error, load, createCharacter, createDraft, updateCharacter, deleteCharacter };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (existing `useCharacters()` callers compile; `createDraft` is additive).

- [ ] **Step 3: Commit**

```bash
git add lib/hooks/use-characters.ts
git commit -m "feat(characters): useCharacters includeDrafts option and createDraft"
```

---

### Task 7: `CharacterModal` — split exits, draft-save on dismiss, Escape

**Files:**
- Modify: `components/assets/CharacterModal.tsx`

- [ ] **Step 1: Add the `onSaveDraft` prop**

Update the props interface (lines 12-17):

```ts
interface CharacterModalProps {
    open: boolean;
    initial?: Character | null;
    onClose: () => void;
    onSave: (input: CharacterInput, id?: string) => Promise<void>;
    /** Called when a NEW character is dismissed without Cancel (X/backdrop/Escape)
     *  and has >=1 image — persists it as a draft. */
    onSaveDraft?: (input: CharacterInput) => Promise<void>;
}
```

And the destructure (line 35):

```ts
export default function CharacterModal({ open, initial, onClose, onSave, onSaveDraft }: CharacterModalProps) {
```

- [ ] **Step 2: Add `handleDismiss` and an Escape listener**

Insert directly after `handleSave` (after line 217, before `if (!mounted) return null;`):

```ts
    // Dismiss WITHOUT Cancel (X button, backdrop, Escape). For a brand-new
    // character with at least one image, persist what we have as a draft;
    // otherwise just close. Edits to an existing character are discarded.
    const handleDismiss = async () => {
        if (!initial && onSaveDraft && images.length > 0) {
            try {
                await onSaveDraft({
                    name: name.trim(),
                    description: description.trim() || null,
                    referenceImages: images,
                    thumbnailUrl: images[0].url,
                    weight,
                });
            } catch {
                // Best-effort: never block closing on a failed draft save.
            }
        }
        onClose();
    };

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') void handleDismiss(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
        // handleDismiss closes over current field state; re-bind when it changes.
    }, [open, initial, onSaveDraft, name, description, images, weight]);
```

- [ ] **Step 3: Route the backdrop and X button through `handleDismiss`**

The backdrop (line 226) `onClick={onClose}` → `onClick={() => void handleDismiss()}`.

The X button (line 242) `onClick={onClose}` → `onClick={() => void handleDismiss()}`.

Leave the **Cancel** button (line 378) as `onClick={onClose}` — Cancel must still discard.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/assets/CharacterModal.tsx
git commit -m "feat(characters): CharacterModal saves a draft on non-cancel dismiss"
```

---

### Task 8: `CharacterVariantModal` — same dismiss/draft/Escape pattern

**Files:**
- Modify: `components/assets/CharacterVariantModal.tsx`

- [ ] **Step 1: Add the `onSaveDraft` prop**

Update the props interface (lines 12-17):

```ts
interface CharacterVariantModalProps {
    open: boolean;
    source: Character | null;
    onClose: () => void;
    onSave: (input: CharacterInput) => Promise<void>;
    /** Called when the variant is dismissed without Cancel and has generated
     *  images — persists it as a draft. */
    onSaveDraft?: (input: CharacterInput) => Promise<void>;
}
```

And the destructure (line 21):

```ts
export default function CharacterVariantModal({ open, source, onClose, onSave, onSaveDraft }: CharacterVariantModalProps) {
```

- [ ] **Step 2: Add `handleDismiss` and an Escape listener**

Insert directly after `handleSave` (after line 104, before `if (!mounted) return null;`):

```ts
    // Dismiss WITHOUT Cancel (X/backdrop/Escape). A variant exists only after
    // generation, so persist as a draft when there are images.
    const handleDismiss = async () => {
        if (onSaveDraft && images.length > 0) {
            try {
                await onSaveDraft({
                    name: name.trim(),
                    description: style.trim() || null,
                    referenceImages: images,
                    thumbnailUrl: images[0].url,
                    weight: source?.weight ?? 70,
                });
            } catch {
                // Best-effort: never block closing on a failed draft save.
            }
        }
        onClose();
    };

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') void handleDismiss(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onSaveDraft, name, style, images, source]);
```

- [ ] **Step 3: Route the backdrop and X button through `handleDismiss`**

The backdrop (line 115) `onClick={onClose}` → `onClick={() => void handleDismiss()}`.

The X button (line 131) `onClick={onClose}` → `onClick={() => void handleDismiss()}`.

Leave the **Cancel** button (line 217) as `onClick={onClose}`.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/assets/CharacterVariantModal.tsx
git commit -m "feat(characters): variant modal saves a draft on non-cancel dismiss"
```

---

### Task 9: Assets page — show drafts, wire draft-save, badge on the card

**Files:**
- Modify: `app/assets/page.tsx`
- Modify: `components/assets/CharacterCard.tsx`

- [ ] **Step 1: Include drafts and pull `createDraft`**

In `app/assets/page.tsx`, update the hook call (line 21):

```ts
    const { characters, loading, createCharacter, createDraft, updateCharacter, deleteCharacter } = useCharacters({ includeDrafts: true });
```

- [ ] **Step 2: Pass `onSaveDraft` to both modals**

The `CharacterModal` (line 98):

```tsx
                <CharacterModal open={modalOpen} initial={editing} onClose={() => setModalOpen(false)} onSave={handleSave} onSaveDraft={(input) => createDraft(input)} />
```

The `CharacterVariantModal` (lines 100-105) — add `onSaveDraft`:

```tsx
                <CharacterVariantModal
                    open={!!variantSource}
                    source={variantSource}
                    onClose={() => setVariantSource(null)}
                    onSave={async (input) => { await createCharacter(input); }}
                    onSaveDraft={(input) => createDraft(input)}
                />
```

- [ ] **Step 3: Add the "Draft" badge and name fallback on the card**

In `components/assets/CharacterCard.tsx`:

Add the badge inside the thumbnail wrapper. Replace the `<div className="aspect-square ...">` block (lines 19-27) with:

```tsx
            <div className="relative aspect-square w-full bg-white/5">
                {character.is_draft && (
                    <span className="absolute top-2 left-2 z-10 px-2 py-0.5 rounded-md bg-amber-500/90 text-white text-[10px] font-semibold uppercase tracking-wide">
                        Draft
                    </span>
                )}
                {thumb ? (
                    <img src={thumb} alt={character.name} className="w-full h-full object-cover" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-content-tertiary">
                        <UserCircle className="w-12 h-12" />
                    </div>
                )}
            </div>
```

Update the name line (line 29) to fall back when empty:

```tsx
                <p className="font-semibold text-content-primary truncate">{character.name || 'Untitled draft'}</p>
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/assets/page.tsx components/assets/CharacterCard.tsx
git commit -m "feat(characters): assets page shows drafts with a Draft badge and saves them"
```

---

### Task 10: Side characters panel — wire draft-save (drafts stay hidden here)

**Files:**
- Modify: `components/editor/CharactersPanel.tsx`

- [ ] **Step 1: Pull `createDraft` and pass `onSaveDraft` to both modals**

Update the hook call (line 33):

```ts
    const { characters, loading, createCharacter, createDraft } = useCharacters();
```

(No `includeDrafts` here — the panel must keep showing active characters only. `createDraft` will not prepend in this instance.)

The `CharacterModal` (line 98):

```tsx
            <CharacterModal open={modalOpen} initial={null} onClose={() => setModalOpen(false)} onSave={handleSave} onSaveDraft={(input) => createDraft(input)} />
```

The `CharacterVariantModal` (lines 99-104) — add `onSaveDraft`:

```tsx
            <CharacterVariantModal
                open={!!variantSource}
                source={variantSource}
                onClose={() => setVariantSource(null)}
                onSave={async (input) => { await createCharacter(input); }}
                onSaveDraft={(input) => createDraft(input)}
            />
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/editor/CharactersPanel.tsx
git commit -m "feat(characters): side panel persists dismissed new characters as drafts"
```

---

### Task 11: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full type-check**

Run: `npx tsc --noEmit`
Expected: PASS, no errors.

- [ ] **Step 2: Manual verification (dev server)**

Run: `npm run dev` and exercise each path:

1. Open the side panel → New character → add an image (no name) → click the **X** → modal closes. Open the assets page → the character appears with a **"Draft"** badge labelled "Untitled draft". Confirm it does **not** appear in the side panel grid, and typing `@` in chat does **not** list it.
2. On the assets page, edit that draft → enter a name → **Save Character**. The badge disappears; it now appears in the side panel and in the `@` picker.
3. New character → add an image → click **Cancel** → nothing is saved (not on the assets page).
4. New character → open and immediately click the **backdrop** with no image → nothing is saved.
5. Create variant from any character → generate → click the **X** → it appears as a **Draft** on the assets page only.
6. Press **Escape** in the character editor with an image present → saved as a draft (same as X).

- [ ] **Step 3: Final commit (if any cleanup was needed)**

```bash
git add -A
git commit -m "chore(characters): draft feature verification cleanup"
```

(Skip if the working tree is clean.)

---

## Notes for the implementer

- **Migration application is environment-specific.** This repo has no local DB migration runner; the SQL file is the source of truth but must be applied to the live Supabase instance (Task 1, Step 2). If you cannot apply it, flag the user — every API change after Task 1 assumes the column exists.
- **Why `createDraft` is conditional:** the side panel and assets page each hold their own `useCharacters` state. A draft must surface on the assets page (which includes drafts) but must never flash into the side panel (active-only). The `includeDrafts`-gated prepend in Task 6 is what enforces that.
- **Promotion is implicit:** there is no separate "publish" call. Saving a draft through the normal editor (`PATCH`, Task 4) clears `is_draft`. The editor's Save button already requires a name + image, so a promoted character is always valid.
