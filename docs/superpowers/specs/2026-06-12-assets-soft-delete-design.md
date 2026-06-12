# Assets soft-delete (per-tile, owner-scoped)

**Date:** 2026-06-12
**Status:** Approved design — ready for implementation plan

## Goal

Let a user delete assets from the Assets page. Selecting tiles (via any existing
mechanism — ctrl/shift/checkbox/marquee) reveals a **Delete** button next to the
existing bulk-action buttons. Deleting only **flags** the assets as hidden for that
user; the underlying `node_results` rows are never modified or removed. Flagged
tiles stop showing on that user's own Assets page and **disappear immediately**
without a page refresh.

## Decisions (from brainstorming)

- **Granularity:** per individual tile (per media URL), not per `node_results` row.
  One run that produced 4 images = 1 row = 4 tiles; deleting one tile hides only
  that tile, the other three stay visible.
- **Scope:** owner's gallery only. The flag suppresses the tile on this user's
  Assets page. The `node_results` row is untouched; chat results, canvas nodes,
  admin surfaces, and other users are unaffected.
- **Confirmation:** show a `ConfirmationModal` ("Delete N asset(s)?") before
  flagging.
- **Write path:** browser Supabase client + RLS (no new API route) — consistent
  with the existing client-side `node_results` fetch in the gallery.
- **Out of scope (YAGNI):** no undo/trash view in the UI, no hard delete, no
  cross-surface hiding. Recovery is DB-only for now.

## Data model — new table `hidden_assets`

A flag column on `node_results` cannot express per-tile + per-user state (a row
holds many tiles and the flag is user-specific). A small join table keyed by the
tile's stable identity (its URL — `lib/assets/unpack.ts` already de-dupes by URL):

```sql
create table public.hidden_assets (
  user_id        uuid not null references auth.users(id) on delete cascade,
  asset_url      text not null,
  node_result_id uuid references public.node_results(id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (user_id, asset_url)
);

create index idx_hidden_assets_user on public.hidden_assets(user_id);

alter table public.hidden_assets enable row level security;

-- A user manages only their own hidden flags.
create policy "hidden_assets_select_own" on public.hidden_assets
  for select using (user_id = auth.uid());
create policy "hidden_assets_insert_own" on public.hidden_assets
  for insert with check (user_id = auth.uid());
create policy "hidden_assets_delete_own" on public.hidden_assets
  for delete using (user_id = auth.uid());
```

Notes:
- `asset_url` is the identity (not the `${row.id}:${index}` tile id, which is
  index-positional and less stable). `node_result_id` is stored for
  reference/recovery only.
- `on delete cascade` on both FKs keeps the table self-cleaning if the user or the
  source row is ever hard-deleted.

Migration file: `supabase/migrations/20260612_hidden_assets.sql`.

## Read path (gallery)

In `components/assets/AssetsGallery.tsx`, alongside the existing `node_results`
fetch (lines ~80-96):

1. Fetch the user's hidden URLs: `supabase.from('hidden_assets').select('asset_url')`
   (RLS auto-scopes to `auth.uid()`).
2. Build a `Set<string>` of hidden URLs.
3. Filter the unpacked assets so any tile whose URL is in the set is excluded
   before it reaches `assets` state. Do both fetches together (e.g. `Promise.all`)
   so there is no flash of soon-to-be-hidden tiles.

Result: flagged tiles never render on this user's page; everywhere else is
unaffected.

## Delete path (immediate, confirmed)

1. **Button:** add a Delete (Trash icon) button to
   `components/assets/AssetSelectionToolbar.tsx`, next to Download zip / Add to
   character. Visible only when `selectedIds.size > 0` (the toolbar already
   renders under that condition).
2. **Confirm:** clicking opens a shared `ConfirmationModal`
   (`components/ui/Modal.tsx` family) — "Delete N asset(s)?" with a
   destructive-styled confirm. (Reuse-first per CLAUDE.md; do not hand-roll.)
3. **On confirm:**
   - Resolve the selected tile ids → their `{ asset_url, node_result_id }`
     (`node_result_id` = the `row.id` half of the `${row.id}:${index}` tile id).
   - **Optimistic UI:** `setAssets(prev => prev.filter(a => !selectedUrls.has(a.url)))`
     and `clearSelection()` → tiles vanish instantly, no refresh.
   - **Persist:** `supabase.from('hidden_assets').upsert(rows, { onConflict:
     'user_id,asset_url', ignoreDuplicates: true })` with `user_id` set to the
     current user. RLS enforces ownership.
   - **On error:** re-add the removed assets to state and surface a toast/error
     (match the existing error handling used by the download/add-to-character
     flows). Do not leave the UI in a falsely-deleted state.

## Files touched

- `supabase/migrations/20260612_hidden_assets.sql` — new table + RLS (new).
- `components/assets/AssetSelectionToolbar.tsx` — Delete button + `onDelete` prop.
- `components/assets/AssetsGallery.tsx` — fetch hidden URLs + filter; delete
  handler with confirm + optimistic removal + upsert + rollback; wire
  `ConfirmationModal`.

## Testing / verification

There is no test runner in this repo. Verify with `npx tsc --noEmit` and manual
E2E:
- Select tiles via ctrl/shift/checkbox/marquee → Delete button appears.
- Confirm → tiles vanish immediately; no refresh; selection cleared.
- Reload page → deleted tiles stay gone (flag persisted).
- A multi-image run: deleting one tile leaves its siblings visible.
- `node_results` row still present in DB (soft delete only).
- A second user / admin surface still sees the asset (owner-scoped).

## Operator step

Apply migration `20260612_hidden_assets.sql` to the live Supabase before deploy.
