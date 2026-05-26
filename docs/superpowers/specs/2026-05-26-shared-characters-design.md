# Shared (Prisfol) Characters — Design

**Date:** 2026-05-26
**Status:** Approved (brainstorm)

## Goal

Let an **admin** mark their own characters as **shared**. Shared characters become
visible to every user (read-only) in two places:

1. The previously-disabled **"All Characters"** tab in the editor side panel
   (relabeled **"Shared"**) and as a browsable pool.
2. The **@-mention autocomplete** in chat, where the user's own characters appear
   first (no header), followed by a thin divider and a small **"Shared characters"**
   label above the shared ones.

Non-owners can **view and use** shared characters (tag them, drag them to canvas)
but cannot edit, delete, or change their sharing state.

## Decisions (from brainstorming)

- **Share scope:** an admin shares **their own** characters. The owner is the admin,
  so they manage/unshare from their normal "My Characters" list.
- **Permissions for non-owners:** view & use only (read-only). Enforced by RLS.
- **@ autocomplete order:** **My characters first** (no header), then a labeled
  **"Shared characters"** group. Matches the Slack/Notion/Linear convention of
  personal/most-relevant items first.
- **Share control placement:** a **toggle button on the character card** in the
  assets page (not inside the edit modal).
- **Blocked tab:** rename the disabled **"All Characters"** tab to **"Shared"** and
  enable it.

## 1. Data model

New migration `supabase/migrations/20260526_shared_characters.sql`:

- `ALTER TABLE public.characters ADD COLUMN is_shared BOOLEAN NOT NULL DEFAULT false;`
- Partial index for fast shared listing:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_characters_shared
    ON public.characters (is_shared, deleted_at)
    WHERE is_shared = true;
  ```
- **SELECT policy** widens so everyone can read shared characters:
  ```sql
  DROP POLICY IF EXISTS "Users read their own characters" ON public.characters;
  CREATE POLICY "Users read own or shared characters"
    ON public.characters FOR SELECT
    USING (user_id = auth.uid() OR is_shared = true);
  ```
- **UPDATE / DELETE policies stay owner-only** (`user_id = auth.uid()`), unchanged.
  This is what makes shared characters read-only for non-owners — there is no code
  path that lets a non-owner mutate someone else's row.
- **Admin-only-share trigger** (defense-in-depth, mirrors
  `prevent_admin_self_elevation` in `20260505_admin_role_hardening.sql`, reusing
  `public.is_admin()`):
  ```sql
  CREATE OR REPLACE FUNCTION public.prevent_non_admin_share()
  RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
  BEGIN
    IF NEW.is_shared = true
       AND (TG_OP = 'INSERT' OR COALESCE(OLD.is_shared, false) = false)
       AND auth.role() <> 'service_role'
       AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'Only admins can share characters';
    END IF;
    RETURN NEW;
  END;
  $$;
  -- BEFORE INSERT OR UPDATE trigger on public.characters
  ```

## 2. API

- **`GET /api/characters`** ([app/api/characters/route.ts](../../../app/api/characters/route.ts))
  gains a `?scope=mine|shared` param (default `mine`):
  - `mine` → current behavior (`user_id = me`, draft filter as today).
  - `shared` → `is_shared = true AND user_id <> me AND is_draft = false`,
    ordered by `last_used_at`/`created_at` like the mine list.
  - Both selects add the `is_shared` column.
- **`PATCH /api/characters/[id]`** ([app/api/characters/[id]/route.ts](../../../app/api/characters/[id]/route.ts))
  accepts `{ isShared: boolean }`. If `isShared` is present in the body, the route
  first calls `requireAdmin()` and returns its 403 error for non-admins (route-level
  gate layered over the DB trigger). When allowed, it updates `is_shared`. The select
  list adds `is_shared`.
- **`lib/api/client.ts`**:
  - `Character` interface gains `is_shared: boolean`.
  - `charactersApi.list({ scope })` supports `'mine' | 'shared'`.
  - New `charactersApi.setShared(id, shared)` → PATCH `{ isShared: shared }`.

## 3. `useCharacters` hook

[lib/hooks/use-characters.ts](../../../lib/hooks/use-characters.ts):

- New opt-in option `includeShared?: boolean`.
- When set, the hook additionally fetches `scope=shared` and exposes
  `sharedCharacters: Character[]`. The default `characters` list (your own) is
  unchanged, so existing single-list consumers need no edits.
- **Dedup rule:** a character you own is never duplicated into `sharedCharacters`
  (the `shared` API scope already excludes `user_id = me`).
- A `setShared(id, shared)` helper updates the owned character in place (sets
  `is_shared`) by calling `charactersApi.setShared`.

## 4. Assets page — the share control

[app/assets/page.tsx](../../../app/assets/page.tsx) and
[components/assets/CharacterCard.tsx](../../../components/assets/CharacterCard.tsx):

- The page fetches `userApi.me()` once to read `is_admin` (same pattern as
  [Sidebar.tsx](../../../components/layout/Sidebar.tsx)) and threads `isAdmin` through
  `CharacterGrid` → `CharacterCard`. It also wires an `onToggleShare(c)` handler that
  calls the hook's `setShared`.
- **`CharacterCard`** (admin only): a share toggle button (`Share2` / globe icon) in
  the hover action row next to edit/delete. Active state when `is_shared`. Shared
  cards also show a small **"Shared"** badge in a corner (visible to the admin) so the
  state is obvious at a glance. Non-admins: no toggle, no badge, no behavior change.

## 5. Side panel — enable the blocked tab

[components/editor/CharactersPanel.tsx](../../../components/editor/CharactersPanel.tsx):

- The `'all'` PillTab is **un-disabled** and **relabeled "Shared"** (keep the `Users`
  icon; drop the `disabled`/`title` "coming soon" props).
- The panel uses `useCharacters({ includeShared: true })`. When `scope === 'mine'` it
  renders the owned list (today's behavior); when `scope === 'shared'` it renders
  `sharedCharacters` in the same grid. Cards remain click/drag-to-canvas — this works
  read-only because the `characters` storage bucket is public-read and the canvas node
  only needs the reference image URLs.
- Empty state for the Shared tab: a short "No shared characters yet" message.

## 6. @ mention picker — grouped autocomplete

[components/chat/CharacterMentionPicker.tsx](../../../components/chat/CharacterMentionPicker.tsx)
and [components/chat/ChatInput.tsx](../../../components/chat/ChatInput.tsx):

- `ChatInput` switches to `useCharacters({ includeShared: true })` and passes both
  `characters` (own) and `sharedCharacters` to the picker.
- New pure helper `buildMentionResults(own, shared, query)` returns an ordered,
  grouped result:
  ```ts
  { items: Character[]; ownCount: number; sharedCount: number }
  ```
  - `own` filtered by query first (top-N when query empty, same as today), then
    `shared` filtered by query. `items` is the flat concatenation used for keyboard
    nav so `activeIndex` maps cleanly to a character.
- The picker renders `items[0..ownCount)` with **no header**, then — only when
  `sharedCount > 0` — a thin divider + a small uppercase **"Shared characters"** label,
  then `items[ownCount..]`. The existing divider + "Create new character" row stays at
  the bottom.
- `ChatInput`'s arrow-key / Enter / Tab logic operates on `items` (length =
  `ownCount + sharedCount`).
- `extractMentionedCharacters` receives the **merged, deduped** list (own + shared) so
  that an @-tagged shared character resolves into the read-only roster and the ordered
  ids sent to the brain.

## Edge cases / non-issues

- **`last_used_at` bump:** the only character `last_used_at` write is in
  [app/api/chat/stream/route.ts](../../../app/api/chat/stream/route.ts) via the
  user-scoped client (`.in('id', ids)`). For a shared character the user doesn't own,
  owner-only UPDATE RLS makes it match zero rows — no error, no special handling
  required.
- **Using shared reference images:** the `characters` storage bucket is public-read,
  so a non-owner generating with a shared character can fetch the images normally.
- **Unsharing:** an admin toggling a character off (`is_shared = false`) immediately
  removes it from other users' Shared tab / @ picker on their next fetch; already-built
  workflows that captured the reference URLs keep working (URLs are public).

## Out of scope (YAGNI)

- Admins sharing *other users'* characters / an admin-wide character browser.
- Non-owners editing shared characters.
- Per-user or per-team visibility scoping (sharing is global to all users).
- Notifications when a character is shared/unshared.
