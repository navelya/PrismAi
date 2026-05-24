# Character Drafts — Design

**Date:** 2026-05-24
**Status:** Approved (design); implementation pending

## Problem

When a user creates a character and leaves the editor **without clicking Cancel**
(closing via the X button, clicking the backdrop, or pressing Escape), their
in-progress work is lost. We want that work preserved as a **draft** instead.

Drafts:
- **Do NOT** appear in the chat `@` mention picker.
- **Do NOT** appear in the side characters panel.
- **DO** appear on the assets page, visibly marked as a draft.
- Can be saved even **without a name** (draft save relaxes the name requirement),
  but still require **at least one reference image**.

A draft becomes a normal ("active") character when the user opens it from the
assets page and saves it properly (which already requires a name + an image).

## Scope decisions (confirmed with user)

1. **Exit behavior:** the explicit **Cancel** button discards. **All other exits**
   (X button, backdrop click, Escape) save a draft.
2. **Draft threshold:** a draft is created only if there is **≥ 1 reference image**.
   Touching nothing (or only a name) and leaving discards with no draft.
3. **Applies to new characters only**, in **both** the character editor
   (`CharacterModal`) **and** the variant window (`CharacterVariantModal`).
   Editing an existing character (active or draft) and exiting without Save just
   discards the in-progress edits — the stored row is untouched.

## Approach

Chosen: **a single `is_draft` boolean column on `characters`**, with the existing
list query hiding drafts by default and an opt-in flag for the assets page.

Rejected alternatives:
- **Separate `character_drafts` table** — duplicates types/CRUD/storage handling
  and forces the assets page to union two sources. Overkill.
- **`status` text enum (`'draft' | 'active'`)** — functionally identical; deferred
  because we have no third state in sight. Can be migrated to later if needed.

## Data model

Migration: add to `public.characters`

```sql
alter table public.characters
  add column is_draft boolean not null default false;
```

- Existing rows default to `false` (active) — no behavior change for them.
- `name` stays `NOT NULL`. Drafts store `''` (empty string is permitted by the
  constraint). The UI renders `name || 'Untitled draft'`.

TypeScript `Character` interface (`lib/api/client.ts`) gains:

```ts
is_draft: boolean;
```

All three `SELECT` column lists (GET list, POST insert-returning, PATCH
update-returning) must add `is_draft`.

## Visibility — one rule, three consumers

The single rule lives in `GET /api/characters`:

- **Default:** `.eq('is_draft', false)` — returns active characters only.
- **`?includeDrafts=true`:** drop that filter — returns active **and** draft.

Consumers:
- **@ mention picker** and **side characters panel** both read `useCharacters()`
  with no options → active-only by default → drafts excluded automatically. **No
  changes required in those components.**
- **Assets page** calls `useCharacters({ includeDrafts: true })` → drafts appear
  there and nowhere else.

> Verify during implementation that the chat mention list is sourced from
> `useCharacters()` (per research it is). If it has its own fetch, it must keep
> the default active-only behavior.

## API changes

### `GET /api/characters` (`app/api/characters/route.ts`)
- Read `request.nextUrl.searchParams.get('includeDrafts')`.
- Apply `.eq('is_draft', false)` unless `includeDrafts === 'true'`.
- Add `is_draft` to the `select(...)` list.

### `POST /api/characters` (create)
- Read `body.draft === true`.
- **Draft mode (`draft === true`):**
  - Name optional — use trimmed name or `''` (skip the "Name is required" 400).
  - Reference images **still required** (≥ 1) — unchanged 400 if empty.
  - Insert `is_draft: true`.
- **Normal mode (default):** existing validation (name + ≥1 image); insert
  `is_draft: false`.
- Add `is_draft` to the returning `select(...)`.

### `PATCH /api/characters/[id]` (edit / promote)
- On a successful update, set `update.is_draft = false`. The modal's Save button
  is the only caller and already enforces name + image client-side, and the route
  validates name-non-empty-if-provided and ≥1 image-if-provided — so promotion is
  always to a valid active character.
- Add `is_draft` to the returning `select(...)`.

> `last_used_at` bumps happen through a different path (not this PATCH's allowed
> fields), so forcing `is_draft = false` here cannot accidentally promote a draft.

## Client API (`lib/api/client.ts`)

- `charactersApi.list(opts?: { includeDrafts?: boolean })` → appends
  `?includeDrafts=true` when set.
- `charactersApi.create(input, opts?: { draft?: boolean })` → includes
  `draft: true` in the POST body when set.
- `charactersApi.update` — unchanged signature (promotion is implicit server-side).

## Hook (`lib/hooks/use-characters.ts`)

- `useCharacters(opts?: { includeDrafts?: boolean })`:
  - Passes `includeDrafts` to `charactersApi.list`.
  - Adds `createDraft(input)` that calls `charactersApi.create(input, { draft: true })`
    and **prepends to local state only when `includeDrafts` is true** for this
    instance. This keeps a panel-created draft from flashing into the panel list,
    while still showing it on the assets page.
- `createCharacter` (active create) and `updateCharacter` (edit/promote) unchanged
  in behavior; `updateCharacter` naturally reflects the promoted (`is_draft: false`)
  row returned by PATCH.

## Editor components

### `CharacterModal` (`components/assets/CharacterModal.tsx`)
- Add prop `onSaveDraft?: (input: CharacterInput) => Promise<void>`.
- Introduce an internal `handleDismiss()`:
  - If **new** (`!initial`) **and** `images.length > 0` and `onSaveDraft` is set →
    `await onSaveDraft(buildInput())` then `onClose()`.
  - Otherwise → `onClose()`.
  - On draft-save error, still close (best-effort; surface nothing blocking).
- Wire exits:
  - **Cancel button** → `onClose()` (discard, unchanged).
  - **X button** and **backdrop** → `handleDismiss()`.
  - Add an **Escape** key listener (while `open`) → `handleDismiss()`.
- `buildInput()` mirrors `handleSave`'s payload but tolerates an empty name:
  `{ name: name.trim(), description: description.trim() || null, referenceImages: images, thumbnailUrl: images[0].url, weight }`.

### `CharacterVariantModal` (`components/assets/CharacterVariantModal.tsx`)
- Same `onSaveDraft` prop + `handleDismiss()` pattern.
- Eligibility: `images.length > 0` (variant images exist only after generation).
  The name is pre-filled `"{source} (variant)"`, so drafts here normally have a
  name; the description carries the `style`.
- Cancel → discard; X / backdrop / Escape → `handleDismiss()`.

## Parent wiring

- **Assets page** (`app/assets/page.tsx`): `useCharacters({ includeDrafts: true })`;
  pass `onSaveDraft={(input) => createDraft(input)}` to both modals.
- **Side panel** (`components/editor/CharactersPanel.tsx`): pass
  `onSaveDraft={(input) => createDraft(input)}` to both modals (no prepend there).

## Assets-page display

- `useCharacters({ includeDrafts: true })` (above).
- `CharacterCard` (`components/assets/CharacterCard.tsx`):
  - Show a small **"Draft"** pill (e.g. amber, top-left of the thumbnail) when
    `character.is_draft`.
  - Render the name as `character.name || 'Untitled draft'`.
  - Edit / Delete / Variant buttons unchanged. Editing opens `CharacterModal` with
    the draft as `initial`; saving promotes it.
- Search filter (`c.name.toLowerCase().includes(...)`) is unaffected; nameless
  drafts simply won't match text queries.

## Untouched on purpose

Character snapshots (`lib/utils/character-refs.ts`), the chat brain's mention
block (`lib/chat/prompt/system.ts`), and the character node
(`lib/nodes/plugins/character/definition.ts`) need no changes — drafts can never
reach them because the mention picker only ever sees active characters.

## Out of scope / known limitations

- Dismissing **mid-generation/upload** (before any image lands in `images`) saves
  no draft — acceptable; the threshold is concrete images.
- Orphaned storage objects from images uploaded then removed before dismiss are an
  existing behavior, unchanged here.
- No automatic cleanup/expiry of stale drafts; users delete them from the assets
  page like any character.

## Verification

No automated test runner exists. Verify with `npx tsc --noEmit` (lint/build are
unreliable in this repo) plus manual checks:
1. New character + image → close via X → appears as "Draft" on assets page, absent
   from panel and `@` picker.
2. Open the draft, add a name, Save → badge disappears; now appears in panel and
   `@` picker.
3. New character + image → **Cancel** → nothing saved.
4. Open/empty modal → close via backdrop → nothing saved (no image).
5. Variant: generate → close via X → draft on assets page only.
