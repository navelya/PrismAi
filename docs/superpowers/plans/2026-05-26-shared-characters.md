# Shared (Prisfol) Characters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins mark their own characters as shared so every user can view and use them (read-only) in the editor's "Shared" tab and the chat @-mention picker.

**Architecture:** Add an `is_shared` column to `public.characters` with widened SELECT RLS (everyone reads shared rows), owner-only UPDATE/DELETE (read-only for non-owners), and an admin-only trigger guarding the share flag. The API gains a `scope=shared` list filter and an admin-gated `isShared` PATCH. The `useCharacters` hook optionally fetches the shared pool; the assets page adds an admin-only share toggle, the side panel un-disables its "Shared" tab, and the @-mention picker renders own characters first then a labeled shared group.

**Tech Stack:** Next.js (App Router), TypeScript, Supabase (Postgres + RLS), React, Tailwind, lucide-react.

**Verification note:** This repo has **no test runner**. The reliable type check is `npx tsc --noEmit` (NOT `npm run lint`/`build`). Pure logic is verified with ad-hoc smoke scripts run via `npx tsx scripts/<file>.ts`, mirroring [scripts/character-mention-parse-smoke.ts](../../../scripts/character-mention-parse-smoke.ts). Runtime/UI behavior is verified manually against `npm run dev`.

---

## File Structure

- **Create** `supabase/migrations/20260526_shared_characters.sql` — `is_shared` column, RLS, admin-only-share trigger, index.
- **Modify** `app/api/characters/route.ts` — GET `scope` param + select `is_shared`; POST selects `is_shared`.
- **Modify** `app/api/characters/[id]/route.ts` — PATCH accepts admin-gated `isShared` + selects `is_shared`.
- **Modify** `lib/api/client.ts` — `Character.is_shared`, `list({ scope })`, `setShared()`.
- **Modify** `lib/hooks/use-characters.ts` — `includeShared` option, `sharedCharacters`, `setShared`.
- **Modify** `components/chat/CharacterMentionPicker.tsx` — `buildMentionResults` helper + grouped rendering.
- **Create** `scripts/character-mention-group-smoke.ts` — smoke test for `buildMentionResults`.
- **Modify** `components/chat/ChatInput.tsx` — fetch shared, grouped picker, merged mention extraction.
- **Modify** `components/assets/CharacterCard.tsx` — admin share toggle + "Shared" badge.
- **Modify** `components/assets/CharacterGrid.tsx` — thread `isAdmin` + `onToggleShare`.
- **Modify** `app/assets/page.tsx` — fetch admin flag, wire share toggle.
- **Modify** `components/editor/CharactersPanel.tsx` — enable "Shared" tab, render shared pool.

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20260526_shared_characters.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260526_shared_characters.sql`:

```sql
-- Migration: shared (Prisfol) characters
-- Date: 2026-05-26
-- Description: Adds is_shared to characters so admins can publish their own
--              characters to everyone (read-only for non-owners). SELECT widens
--              to include shared rows; UPDATE/DELETE stay owner-only. A trigger
--              guards the share flag so only admins (or service_role) can set it.

-- 1. COLUMN
ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS is_shared BOOLEAN NOT NULL DEFAULT false;

-- 2. INDEX (fast shared-pool listing)
CREATE INDEX IF NOT EXISTS idx_characters_shared
  ON public.characters (is_shared, deleted_at)
  WHERE is_shared = true;

-- 3. WIDEN SELECT: own rows OR any shared row
DROP POLICY IF EXISTS "Users read their own characters" ON public.characters;
DROP POLICY IF EXISTS "Users read own or shared characters" ON public.characters;
CREATE POLICY "Users read own or shared characters"
  ON public.characters FOR SELECT
  USING (user_id = auth.uid() OR is_shared = true);

-- UPDATE/DELETE policies are intentionally left unchanged (owner-only):
-- that is what makes shared characters read-only for non-owners.

-- 4. ADMIN-ONLY SHARE GUARD (defense-in-depth on top of the route check)
CREATE OR REPLACE FUNCTION public.enforce_admin_only_share()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Only gate the transition INTO shared. Unsharing and unrelated edits by the
  -- owner are never blocked.
  IF NEW.is_shared = true
     AND (TG_OP = 'INSERT' OR COALESCE(OLD.is_shared, false) = false)
     AND auth.role() <> 'service_role'
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can share characters';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_characters_enforce_share ON public.characters;
CREATE TRIGGER trg_characters_enforce_share
  BEFORE INSERT OR UPDATE ON public.characters
  FOR EACH ROW EXECUTE FUNCTION public.enforce_admin_only_share();

-- 5. SYSTEM NOTICE
DO $$
BEGIN
  RAISE NOTICE '✅ characters.is_shared added; SELECT widened; admin-only share guard installed.';
END $$;
```

- [ ] **Step 2: Apply the migration against Supabase**

This repo applies SQL migrations manually against the live Supabase project (there is no local migrate runner). Run the file's contents in the Supabase SQL editor (or via the project's usual migration apply step).

Verify the column exists by running in the SQL editor:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'characters' AND column_name = 'is_shared';
```
Expected: one row returning `is_shared`.

Verify `public.is_admin()` (the function the trigger depends on) exists:

```sql
SELECT proname FROM pg_proc WHERE proname = 'is_admin';
```
Expected: at least one row. (Defined in `supabase/migrations/20260313_fix_admin_rls.sql`.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260526_shared_characters.sql
git commit -m "feat(characters): add is_shared column, RLS, admin-only share trigger"
```

---

## Task 2: API + client types

**Files:**
- Modify: `app/api/characters/route.ts`
- Modify: `app/api/characters/[id]/route.ts`
- Modify: `lib/api/client.ts`

- [ ] **Step 1: Add `scope` to GET and select `is_shared` (list)**

In `app/api/characters/route.ts`, replace the body of `GET` (the block from `const includeDrafts = ...` through the `return NextResponse.json({ characters: data });`) with:

```ts
    const includeDrafts = request.nextUrl.searchParams.get('includeDrafts') === 'true';
    const scope = request.nextUrl.searchParams.get('scope') === 'shared' ? 'shared' : 'mine';

    const COLUMNS =
        'id, name, description, reference_images, thumbnail_url, weight, created_at, updated_at, last_used_at, is_draft, is_shared';

    let query = supabase.from('characters').select(COLUMNS).is('deleted_at', null);

    if (scope === 'shared') {
        // Shared pool: everyone's shared characters EXCEPT the caller's own
        // (those already show under scope=mine), never drafts.
        query = query.eq('is_shared', true).eq('is_draft', false).neq('user_id', user.id);
    } else {
        query = query.eq('user_id', user.id);
        if (!includeDrafts) query = query.eq('is_draft', false);
    }

    const { data, error } = await query
        .order('last_used_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ characters: data });
```

- [ ] **Step 2: Add `is_shared` to the POST select**

In `app/api/characters/route.ts`, in the `POST` handler, change the `.select(...)` on the insert (currently ends with `is_draft`) to include `is_shared`:

```ts
        .select('id, name, description, reference_images, thumbnail_url, weight, created_at, updated_at, last_used_at, is_draft, is_shared')
```

- [ ] **Step 3: Add admin-gated `isShared` to PATCH and select it**

In `app/api/characters/[id]/route.ts`, change the import line:

```ts
import { getAuthenticatedUser, requireAdmin } from '@/lib/api/auth';
```

Then, inside `PATCH`, immediately AFTER the `thumbnailUrl` line:

```ts
    if (typeof body?.thumbnailUrl === 'string') update.thumbnail_url = body.thumbnailUrl;
```

insert:

```ts
    // Sharing is admin-only. Only run the admin check when the client is actually
    // changing the share flag, so ordinary owner edits stay non-admin.
    if (typeof body?.isShared === 'boolean') {
        const adminAuth = await requireAdmin();
        if (adminAuth.error) return adminAuth.error;
        update.is_shared = body.isShared;
    }
```

And change the PATCH `.select(...)` (the one ending in `is_draft`) to include `is_shared`:

```ts
        .select('id, name, description, reference_images, thumbnail_url, weight, created_at, updated_at, last_used_at, is_draft, is_shared')
```

(The existing `.eq('user_id', user.id)` on the update stays, so an admin can only share characters they own.)

- [ ] **Step 4: Update client types + API helpers**

In `lib/api/client.ts`, add `is_shared` to the `Character` interface (after `is_draft`):

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
    is_shared: boolean;
}
```

Replace the `charactersApi.list` method with one that supports `scope`:

```ts
    list: (opts?: { includeDrafts?: boolean; scope?: 'mine' | 'shared' }) => {
        const params = new URLSearchParams();
        if (opts?.includeDrafts) params.set('includeDrafts', 'true');
        if (opts?.scope) params.set('scope', opts.scope);
        const qs = params.toString();
        return apiFetch<{ characters: Character[] }>(
            `/api/characters${qs ? `?${qs}` : ''}`,
            { cache: 'no-store' },
        );
    },
```

Add a `setShared` method to `charactersApi` (after `delete`):

```ts
    setShared: (id: string, shared: boolean) =>
        apiFetch<{ character: Character }>(`/api/characters/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ isShared: shared }),
        }),
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (The smoke script's `mk()` helper omits `is_shared` but is typed `any`, so it still compiles.)

- [ ] **Step 6: Commit**

```bash
git add app/api/characters/route.ts app/api/characters/[id]/route.ts lib/api/client.ts
git commit -m "feat(characters): scope=shared list + admin-gated isShared PATCH"
```

---

## Task 3: `useCharacters` hook — shared pool + setShared

**Files:**
- Modify: `lib/hooks/use-characters.ts`

- [ ] **Step 1: Add `includeShared`, `sharedCharacters`, and `setShared`**

Replace the entire contents of `lib/hooks/use-characters.ts` with:

```ts
'use client';

import { useCallback, useEffect, useState } from 'react';
import { charactersApi, type Character, type CharacterInput } from '@/lib/api/client';

export function useCharacters(opts?: { includeDrafts?: boolean; includeShared?: boolean }) {
    const includeDrafts = opts?.includeDrafts ?? false;
    const includeShared = opts?.includeShared ?? false;
    const [characters, setCharacters] = useState<Character[]>([]);
    const [sharedCharacters, setSharedCharacters] = useState<Character[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            setLoading(true);
            const [mine, shared] = await Promise.all([
                charactersApi.list({ includeDrafts }),
                includeShared
                    ? charactersApi.list({ scope: 'shared' })
                    : Promise.resolve({ characters: [] as Character[] }),
            ]);
            setCharacters(mine.characters);
            setSharedCharacters(shared.characters);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load characters');
        } finally {
            setLoading(false);
        }
    }, [includeDrafts, includeShared]);

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

    // Admin-only: toggle whether one of the user's OWN characters is shared.
    const setShared = useCallback(async (id: string, shared: boolean) => {
        const { character } = await charactersApi.setShared(id, shared);
        setCharacters((prev) => prev.map((c) => (c.id === id ? character : c)));
        return character;
    }, []);

    return {
        characters,
        sharedCharacters,
        loading,
        error,
        load,
        createCharacter,
        createDraft,
        updateCharacter,
        deleteCharacter,
        setShared,
    };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/hooks/use-characters.ts
git commit -m "feat(characters): useCharacters includeShared + setShared"
```

---

## Task 4: `buildMentionResults` helper + grouped picker (TDD)

**Files:**
- Modify: `components/chat/CharacterMentionPicker.tsx`
- Create: `scripts/character-mention-group-smoke.ts`

- [ ] **Step 1: Write the failing smoke test**

Create `scripts/character-mention-group-smoke.ts`:

```ts
/**
 * Verifies buildMentionResults: own-first ordering, shared grouping, dedup of a
 * character that is both owned and shared, and query filtering across groups.
 * Run: npx tsx scripts/character-mention-group-smoke.ts
 */
import { buildMentionResults } from '../components/chat/CharacterMentionPicker';

function assert(cond: any, msg: string) {
    if (!cond) { console.error('FAIL:', msg); process.exit(1); }
    console.log('PASS:', msg);
}

const mk = (id: string, name: string): any => ({
    id, name, reference_images: [], thumbnail_url: null, description: null,
    weight: 70, created_at: '', updated_at: '', last_used_at: null,
    is_draft: false, is_shared: false,
});

const mine = [mk('m1', 'Alice'), mk('m2', 'Bob')];
const shared = [mk('s1', 'Zara'), mk('s2', 'Quinn')];

// own first, then shared; counts reflect the split
{
    const r = buildMentionResults(mine, shared, '');
    assert(r.ownCount === 2 && r.sharedCount === 2, `counts split (own ${r.ownCount}, shared ${r.sharedCount})`);
    assert(JSON.stringify(r.items.map((c) => c.id)) === JSON.stringify(['m1', 'm2', 's1', 's2']),
        `own-first flat order (got ${JSON.stringify(r.items.map((c) => c.id))})`);
}

// dedup: a character present in BOTH own and shared appears only in own
{
    const dup = mk('m1', 'Alice'); // same id as mine[0]
    const r = buildMentionResults(mine, [dup, ...shared], '');
    const ids = r.items.map((c) => c.id);
    assert(ids.filter((x) => x === 'm1').length === 1, `no duplicate of owned id (got ${JSON.stringify(ids)})`);
    assert(r.sharedCount === 2, `dup excluded from shared count (got ${r.sharedCount})`);
}

// query filters both groups
{
    const r = buildMentionResults(mine, shared, 'a'); // matches Alice (own), Zara (shared)
    const ids = r.items.map((c) => c.id);
    assert(ids.includes('m1') && ids.includes('s1') && !ids.includes('m2') && !ids.includes('s2'),
        `query filters both groups (got ${JSON.stringify(ids)})`);
}

console.log('\nAll mention-group checks passed.');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx scripts/character-mention-group-smoke.ts`
Expected: FAIL — module has no export `buildMentionResults` (import error / runtime crash).

- [ ] **Step 3: Add the helper + grouped rendering**

Replace the entire contents of `components/chat/CharacterMentionPicker.tsx` with:

```tsx
'use client';

import React from 'react';
import { UserCircle, Plus } from 'lucide-react';
import type { Character } from '@/lib/api/client';

interface CharacterMentionPickerProps {
    own: Character[];
    shared: Character[];
    query: string;
    activeIndex: number;
    onSelect: (c: Character) => void;
    onCreateNew: () => void;
}

const TOP_N = 5;

export function filterCharacters(characters: Character[], query: string): Character[] {
    const q = query.trim().toLowerCase();
    if (!q) return characters.slice(0, TOP_N); // already recency-ordered from the API
    return characters.filter((c) => c.name.toLowerCase().includes(q));
}

export interface MentionResults {
    /** Flat, ordered list (own first, then shared) — index maps directly to a
     *  character for keyboard navigation. */
    items: Character[];
    ownCount: number;
    sharedCount: number;
}

/**
 * Build the grouped @-mention results: the user's own characters first, then
 * shared-by-others. Shared entries whose id is already owned are dropped so a
 * character never appears twice. `items` is the concatenation used for keyboard
 * navigation; `ownCount`/`sharedCount` tell the picker where to draw the header.
 */
export function buildMentionResults(own: Character[], shared: Character[], query: string): MentionResults {
    const ownResults = filterCharacters(own, query);
    const ownIds = new Set(own.map((c) => c.id));
    const sharedResults = filterCharacters(shared.filter((c) => !ownIds.has(c.id)), query);
    return {
        items: [...ownResults, ...sharedResults],
        ownCount: ownResults.length,
        sharedCount: sharedResults.length,
    };
}

/**
 * Parse free text for `@<character name>` tokens and return the referenced
 * characters in order of first appearance (deduped). The mention lives inline
 * in the prompt text, so order/position carries meaning — this derives the
 * read-only roster and the ordered ids sent to the brain. Matching is
 * boundary-aware: `@` must start the string or follow whitespace, and the name
 * must not be immediately followed by another word char (so `@Alice` doesn't
 * match when only "Ali" is a character, and emails like `x@alice.com` are
 * ignored). Longer names win naturally because each character is matched on its
 * own full name.
 */
export function extractMentionedCharacters(text: string, characters: Character[]): Character[] {
    if (!text || characters.length === 0) return [];
    const lower = text.toLowerCase();
    const found: { c: Character; idx: number }[] = [];
    for (const c of characters) {
        const name = c.name?.trim();
        if (!name) continue;
        const token = ('@' + name).toLowerCase();
        let from = 0;
        while (true) {
            const idx = lower.indexOf(token, from);
            if (idx === -1) break;
            const before = idx === 0 ? '' : text[idx - 1];
            const afterPos = idx + token.length;
            const after = afterPos >= text.length ? '' : text[afterPos];
            const boundaryBefore = before === '' || /\s/.test(before);
            const boundaryAfter = after === '' || !/[A-Za-z0-9]/.test(after);
            if (boundaryBefore && boundaryAfter) {
                found.push({ c, idx });
                break;
            }
            from = idx + 1;
        }
    }
    found.sort((a, b) => a.idx - b.idx);
    const seen = new Set<string>();
    const ordered: Character[] = [];
    for (const { c } of found) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        ordered.push(c);
    }
    return ordered;
}

export default function CharacterMentionPicker({
    own,
    shared,
    query,
    activeIndex,
    onSelect,
    onCreateNew,
}: CharacterMentionPickerProps) {
    const { items, ownCount, sharedCount } = buildMentionResults(own, shared, query);

    const renderItem = (c: Character, i: number) => (
        <button
            key={c.id}
            type="button"
            onMouseDown={(e) => { e.preventDefault(); onSelect(c); }}
            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors ${
                i === activeIndex ? 'bg-accent-primary/10' : 'hover:bg-interactive-hover'
            }`}
        >
            <span className="w-8 h-8 rounded-md overflow-hidden bg-surface-tertiary flex-shrink-0 flex items-center justify-center">
                {c.thumbnail_url || c.reference_images?.[0]?.url ? (
                    <img src={c.thumbnail_url || c.reference_images[0].url} alt="" className="w-full h-full object-cover" />
                ) : (
                    <UserCircle className="w-5 h-5 text-content-tertiary" />
                )}
            </span>
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-content-primary truncate">{c.name}</span>
                {c.description && (
                    <span className="block text-xs text-content-tertiary truncate">{c.description}</span>
                )}
            </span>
        </button>
    );

    return (
        <div className="absolute bottom-full left-0 mb-2 w-72 max-h-72 overflow-y-auto rounded-xl border border-stroke-subtle bg-surface-primary shadow-2xl z-50 p-1">
            {items.length === 0 ? (
                <div className="px-3 py-3 text-sm text-content-tertiary">
                    No characters match "{query}"
                </div>
            ) : (
                <>
                    {/* Your characters — no header */}
                    {items.slice(0, ownCount).map((c, i) => renderItem(c, i))}

                    {/* Shared group — thin divider + small label, only when present */}
                    {sharedCount > 0 && (
                        <>
                            {ownCount > 0 && <div className="h-px bg-stroke-subtle my-1" />}
                            <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-content-tertiary">
                                Shared characters
                            </div>
                            {items.slice(ownCount).map((c, i) => renderItem(c, ownCount + i))}
                        </>
                    )}
                </>
            )}
            <div className="h-px bg-stroke-subtle my-1" />
            <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); onCreateNew(); }}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-sm text-accent-primary hover:bg-interactive-hover"
            >
                <Plus className="w-4 h-4" /> Create new character
            </button>
        </div>
    );
}
```

- [ ] **Step 4: Run the smoke test to verify it passes**

Run: `npx tsx scripts/character-mention-group-smoke.ts`
Expected: all lines `PASS:` and final `All mention-group checks passed.`

- [ ] **Step 5: Run the existing mention-parse smoke test (no regression)**

Run: `npx tsx scripts/character-mention-parse-smoke.ts`
Expected: all `PASS:` (the `extractMentionedCharacters` export is unchanged).

- [ ] **Step 6: Commit**

(Note: `ChatInput.tsx` still imports the old picker props and will not type-check until Task 5; that's expected — commit the picker + smoke test together and complete Task 5 next.)

```bash
git add components/chat/CharacterMentionPicker.tsx scripts/character-mention-group-smoke.ts
git commit -m "feat(chat): buildMentionResults + grouped mention picker"
```

---

## Task 5: ChatInput wiring

**Files:**
- Modify: `components/chat/ChatInput.tsx`

- [ ] **Step 1: Update the import**

In `components/chat/ChatInput.tsx`, change the picker import (currently `import CharacterMentionPicker, { filterCharacters, extractMentionedCharacters } from './CharacterMentionPicker';`) to:

```ts
import CharacterMentionPicker, { buildMentionResults, extractMentionedCharacters } from './CharacterMentionPicker';
```

- [ ] **Step 2: Fetch the shared pool**

Change the hook call (currently `const { characters, createCharacter, createDraft } = useCharacters();`) to:

```ts
        const { characters, sharedCharacters, createCharacter, createDraft } = useCharacters({ includeShared: true });
```

- [ ] **Step 3: Extract mentions from the merged (deduped) list**

Replace the `mentionedCharacters` memo (currently `const mentionedCharacters = useMemo(() => extractMentionedCharacters(value, characters), [value, characters]);`) with:

```ts
        // Mentions can reference either the user's own characters or any shared
        // one, so extraction runs against the merged, deduped set.
        const allMentionable = useMemo(() => {
            const ownIds = new Set(characters.map((c) => c.id));
            return [...characters, ...sharedCharacters.filter((c) => !ownIds.has(c.id))];
        }, [characters, sharedCharacters]);

        const mentionedCharacters = useMemo(
            () => extractMentionedCharacters(value, allMentionable),
            [value, allMentionable],
        );
```

- [ ] **Step 4: Update keyboard navigation to the grouped flat list**

In the `onKeyDown` handler, replace the line:

```ts
                                const results = filterCharacters(characters, mentionQuery);
```

with:

```ts
                                const results = buildMentionResults(characters, sharedCharacters, mentionQuery).items;
```

(The surrounding ArrowDown/ArrowUp/Enter/Tab logic already indexes into `results`, so no further change is needed there.)

- [ ] **Step 5: Pass own + shared to the picker**

Replace the picker usage:

```tsx
                    {mentionQuery !== null && (
                        <CharacterMentionPicker
                            characters={characters}
                            query={mentionQuery}
                            activeIndex={mentionActiveIndex}
                            onSelect={insertCharacterMention}
                            onCreateNew={() => { setMentionQuery(null); setCreateCharacterOpen(true); }}
                        />
                    )}
```

with:

```tsx
                    {mentionQuery !== null && (
                        <CharacterMentionPicker
                            own={characters}
                            shared={sharedCharacters}
                            query={mentionQuery}
                            activeIndex={mentionActiveIndex}
                            onSelect={insertCharacterMention}
                            onCreateNew={() => { setMentionQuery(null); setCreateCharacterOpen(true); }}
                        />
                    )}
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors (resolves the Task 4 deferred mismatch — picker props now match).

- [ ] **Step 7: Manual verification**

Run `npm run dev`. In chat, type `@`. Expected: your own characters appear first with no header; if shared characters exist, a thin divider + "SHARED CHARACTERS" label appears with them below; arrow keys move through both groups; Enter inserts the highlighted one.

- [ ] **Step 8: Commit**

```bash
git add components/chat/ChatInput.tsx
git commit -m "feat(chat): grouped @-mentions with shared characters"
```

---

## Task 6: Assets page share control (admin)

**Files:**
- Modify: `components/assets/CharacterCard.tsx`
- Modify: `components/assets/CharacterGrid.tsx`
- Modify: `app/assets/page.tsx`

- [ ] **Step 1: Add share toggle + badge to `CharacterCard`**

Replace the entire contents of `components/assets/CharacterCard.tsx` with:

```tsx
'use client';

import React from 'react';
import { Pencil, Trash2, UserCircle, Wand2, Globe } from 'lucide-react';
import type { Character } from '@/lib/api/client';

interface CharacterCardProps {
    character: Character;
    isAdmin?: boolean;
    onEdit: (c: Character) => void;
    onDelete: (id: string) => void;
    onVariant: (c: Character) => void;
    onToggleShare?: (c: Character) => void;
}

export default function CharacterCard({ character, isAdmin, onEdit, onDelete, onVariant, onToggleShare }: CharacterCardProps) {
    const thumb = character.thumbnail_url || character.reference_images?.[0]?.url;

    return (
        <div className="group relative rounded-2xl overflow-hidden border border-stroke-subtle bg-surface-tertiary hover:border-accent-primary/40 transition-all">
            <div className="relative aspect-square w-full bg-white/5">
                {character.is_draft ? (
                    <span className="absolute top-2 left-2 z-10 px-2 py-0.5 rounded-md bg-amber-500/90 text-white text-[10px] font-semibold uppercase tracking-wide">
                        Draft
                    </span>
                ) : character.is_shared ? (
                    <span className="absolute top-2 left-2 z-10 px-2 py-0.5 rounded-md bg-accent-primary/90 text-white text-[10px] font-semibold uppercase tracking-wide">
                        Shared
                    </span>
                ) : null}
                {thumb ? (
                    <img src={thumb} alt={character.name || 'Untitled draft'} className="w-full h-full object-cover" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-content-tertiary">
                        <UserCircle className="w-12 h-12" />
                    </div>
                )}
            </div>
            <div className="p-3">
                <p className="font-semibold text-content-primary truncate">{character.name || 'Untitled draft'}</p>
                {character.description && (
                    <p className="text-xs text-content-tertiary line-clamp-2 mt-0.5">{character.description}</p>
                )}
            </div>
            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {isAdmin && !character.is_draft && onToggleShare && (
                    <button
                        onClick={() => onToggleShare(character)}
                        title={character.is_shared ? 'Stop sharing' : 'Share with everyone'}
                        className={`p-1.5 rounded-lg text-white ${character.is_shared ? 'bg-accent-primary hover:bg-accent-primary/80' : 'bg-black/60 hover:bg-black/80'}`}
                    >
                        <Globe className="w-3.5 h-3.5" />
                    </button>
                )}
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
        </div>
    );
}
```

- [ ] **Step 2: Thread `isAdmin` + `onToggleShare` through `CharacterGrid`**

In `components/assets/CharacterGrid.tsx`, replace the `CharacterGridProps` interface and the component signature + the `.map(...)` render line.

Interface:

```tsx
interface CharacterGridProps {
    characters: Character[];
    loading: boolean;
    isAdmin?: boolean;
    onCreate: () => void;
    onEdit: (c: Character) => void;
    onDelete: (id: string) => void;
    onVariant: (c: Character) => void;
    onToggleShare?: (c: Character) => void;
}
```

Signature:

```tsx
export default function CharacterGrid({ characters, loading, isAdmin, onCreate, onEdit, onDelete, onVariant, onToggleShare }: CharacterGridProps) {
```

Render line (inside the final grid `.map`):

```tsx
                <CharacterCard key={c.id} character={c} isAdmin={isAdmin} onEdit={onEdit} onDelete={onDelete} onVariant={onVariant} onToggleShare={onToggleShare} />
```

- [ ] **Step 3: Wire admin detection + share handler in the assets page**

In `app/assets/page.tsx`:

Change the imports line `import { Search, Plus } from 'lucide-react';` to also import React hooks if needed — `useState` is already imported. Add `useEffect` to the React import:

```tsx
import React, { useState, useEffect } from 'react';
```

Add `userApi` to the client import (currently `import type { Character, CharacterInput } from '@/lib/api/client';`):

```tsx
import { userApi, type Character, type CharacterInput } from '@/lib/api/client';
```

Add `setShared` to the hook destructure (currently `const { characters, loading, createCharacter, createDraft, updateCharacter, deleteCharacter } = useCharacters({ includeDrafts: true });`):

```tsx
    const { characters, loading, createCharacter, createDraft, updateCharacter, deleteCharacter, setShared } = useCharacters({ includeDrafts: true });
```

Add admin state + fetch, right after the existing `useState` declarations (after the `variantSource` state line):

```tsx
    const [isAdmin, setIsAdmin] = useState(false);

    useEffect(() => {
        let active = true;
        userApi.me()
            .then(({ user }) => { if (active) setIsAdmin(user?.is_admin === true); })
            .catch(() => { /* not admin / not signed in */ });
        return () => { active = false; };
    }, []);

    const handleToggleShare = async (c: Character) => {
        await setShared(c.id, !c.is_shared);
    };
```

Pass the new props to `CharacterGrid` (the `<CharacterGrid ... />` usage):

```tsx
                        <CharacterGrid
                            characters={filtered}
                            loading={loading}
                            isAdmin={isAdmin}
                            onCreate={openCreate}
                            onEdit={openEdit}
                            onDelete={(id) => setPendingDelete(characters.find((c) => c.id === id) ?? null)}
                            onVariant={(c) => setVariantSource(c)}
                            onToggleShare={handleToggleShare}
                        />
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run `npm run dev` as an admin user, open `/assets` → Characters. Expected: each non-draft card shows a globe button on hover; clicking it flips a "Shared" badge on the card. As a non-admin, no globe button appears. (Verifying a non-admin requires a second account; at minimum confirm the button is hidden when `isAdmin` is false.)

- [ ] **Step 6: Commit**

```bash
git add components/assets/CharacterCard.tsx components/assets/CharacterGrid.tsx app/assets/page.tsx
git commit -m "feat(assets): admin share toggle + shared badge on character cards"
```

---

## Task 7: Side panel — enable the "Shared" tab

**Files:**
- Modify: `components/editor/CharactersPanel.tsx`

- [ ] **Step 1: Enable + relabel the tab and render the shared pool**

In `components/editor/CharactersPanel.tsx`:

Change the hook call (currently `const { characters, loading, createCharacter, createDraft } = useCharacters();`) to:

```tsx
    const { characters, sharedCharacters, loading, createCharacter, createDraft } = useCharacters({ includeShared: true });
```

Replace the `PillTabs` `items` array so the second tab is enabled and relabeled:

```tsx
                <PillTabs<CharacterScope>
                    items={[
                        { value: 'mine', label: 'My Characters', icon: UserCircle },
                        { value: 'all', label: 'Shared', icon: Users },
                    ]}
                    value={scope}
                    onChange={setScope}
                />
```

Add a derived list just before the `return (` of `CharactersPanel`:

```tsx
    const visible = scope === 'all' ? sharedCharacters : characters;
```

In the body JSX, replace the three references that use `characters` for rendering — the `characters.length === 0` check, the `<EmptyState .../>` branch, and the `characters.map(...)` — so they use `visible` and show a scope-appropriate empty state:

```tsx
                {loading ? (
                    <div className="p-3">
                        <div className="grid grid-cols-2 gap-2">
                            {Array.from({ length: 6 }).map((_, i) => (
                                <Skeleton key={i} className="aspect-square rounded-xl border border-stroke-subtle" />
                            ))}
                        </div>
                    </div>
                ) : visible.length === 0 ? (
                    scope === 'all' ? (
                        <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center">
                            <Users className="w-7 h-7 text-content-tertiary/50" />
                            <p className="text-xs text-content-tertiary leading-relaxed max-w-[200px]">
                                No shared characters yet. Shared characters published by the team appear here.
                            </p>
                        </div>
                    ) : (
                        <EmptyState onCreate={() => setModalOpen(true)} />
                    )
                ) : (
                    <div className="p-3">
                        <div className="grid grid-cols-2 gap-2">
                            <AnimatePresence initial={false}>
                                {visible.map((c, i) => (
                                    <CharacterCard key={c.id} character={c} index={i} onVariant={setVariantSource} />
                                ))}
                            </AnimatePresence>
                        </div>
                    </div>
                )}
```

(The local `CharacterCard` in this file already supports click/drag-to-canvas; shared characters work read-only because the reference images live on the public `characters` bucket. The `Users` icon is already imported.)

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verification**

Run `npm run dev`, open the editor's Characters side panel. Expected: the "Shared" tab is clickable; switching to it lists shared characters (or the empty-state message); clicking/dragging a shared character adds it to the canvas.

- [ ] **Step 4: Commit**

```bash
git add components/editor/CharactersPanel.tsx
git commit -m "feat(editor): enable Shared characters tab in side panel"
```

---

## Self-Review

**Spec coverage:**
- Admin shares own characters (toggle on card) → Task 6. ✅
- Read-only for non-owners (RLS UPDATE/DELETE owner-only) → Task 1. ✅
- Shared section / blocked tab enabled → Task 7. ✅
- @ picker: own first (no header), divider + "Shared characters" label → Tasks 4 + 5. ✅
- Admin-only enforcement (route + DB trigger) → Tasks 1 + 2. ✅
- `last_used_at` non-issue (RLS no-ops the bump) → no task needed, documented in spec. ✅

**Type consistency:** `is_shared` (snake_case DB/Character field) vs `isShared` (camelCase API body) used consistently; `setShared(id, shared)`, `charactersApi.setShared(id, shared)`, `buildMentionResults(own, shared, query)` with `{ items, ownCount, sharedCount }` match across Tasks 2–7. Picker props renamed `characters` → `own`/`shared` in both the component (Task 4) and its only caller `ChatInput` (Task 5).

**Placeholder scan:** none — every code step shows full content.

**Cross-task ordering note:** Task 4 intentionally leaves `ChatInput` un-typechecked (old props) until Task 5; both must land before the tree type-checks. This is called out in Task 4 Step 6.
