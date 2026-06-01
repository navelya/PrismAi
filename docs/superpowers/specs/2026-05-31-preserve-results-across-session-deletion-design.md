# Preserve generated results across session deletion

**Date:** 2026-05-31
**Status:** Approved (design)

## Problem

Generated AI results live only in the session-scoped `node_results` table (FKs
`execution_id` and `session_id`, both `ON DELETE CASCADE`) plus storage under
`{userId}/{sessionId}/…`. When a session is hard-deleted by the cleanup cron,
both the rows and the storage files are destroyed, so the results vanish from
the cross-session Assets gallery.

We want: **deleting a session must never delete its results; ephemeral outputs
(thumbnails, character reference images, intermediate/preview data, failed or
pending rows) may still be deleted.** Preserved results must remain browsable in
the Assets gallery as a permanent, session-less personal library.

### Why the gallery loses results today

`node_results`'s SELECT RLS policy
([`20260322_atomic_v3_setup.sql:65-73`](../../../supabase/migrations/20260322_atomic_v3_setup.sql))
grants visibility only by joining `node_results → executions → sessions → user`.
Once the session (and its executions) are gone, the row is invisible even if it
survives. Preserving rows therefore requires a `user_id` column and an RLS
rewrite, not just a cascade change.

### Blast radius

The hard-delete cron is the **only** code path that destroys keeper results:

- Session *reset* ([`app/api/sessions/[id]/reset/route.ts`](../../../app/api/sessions/[id]/reset/route.ts))
  clears only `messages` + `canvas_state`; it never touches `node_results`.
- `clearSessionExecutions` ([`lib/db/workflows.ts:305`](../../../lib/db/workflows.ts)) has no callers.
- `cleanupEphemeralResults` ([`lib/workflow/orchestrator.ts:461`](../../../lib/workflow/orchestrator.ts))
  only removes ephemeral (character) rows after each run; unchanged by this work.

## Keeper definition

A `node_results` row is a **keeper** iff:

```sql
status = 'completed'
AND result_type IN ('image','video','audio','3d')
AND (node_type IS NULL OR node_type <> 'character')
```

This is identical to the Assets gallery predicate
([`AssetsGallery.tsx:34-41`](../../../components/assets/AssetsGallery.tsx),
[`AssetsPanel.tsx:55-71`](../../../components/editor/AssetsPanel.tsx)). Anything
that does not match is ephemeral and is deleted on session delete.

Rationale for reusing the gallery predicate rather than a "leaf-node only"
definition: (1) it matches exactly what the user perceives as "my results" — the
gallery — so nothing they can see silently disappears; (2) it is a pure
row-level predicate, avoiding fragile workflow-graph analysis at delete time;
(3) it builds on the existing ephemeral machinery (`meta.ephemeral`,
`node_type = 'character'`) instead of inventing a parallel taxonomy.

## Approach: orphan-in-place

Chosen over a new durable `user_assets` table because `node_results` is already
the gallery's backing store across all sessions — it is the de-facto library.
Orphan-in-place reaches the goal with one migration + one cron rewrite and zero
duplicated storage; a separate table would mean dual storage writes at
generation time, doubled media cost, and a gallery rewrite.

Keepers are made to outlive their session: a denormalized `user_id` keeps them
RLS-visible, and the session/execution FKs switch to `SET NULL` so deletion
detaches rather than destroys them.

## Schema changes (single migration)

1. **Add column** `node_results.user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE`,
   plus `CREATE INDEX idx_node_results_user_id ON node_results(user_id)`.
   Deleting the *user* still cascades everything away — correct, the library is
   the user's.
2. **Backfill** `user_id` for existing rows: primarily via
   `session_id → sessions.user_id`; fall back to
   `execution_id → executions.session_id → sessions.user_id` where `session_id`
   is null.
3. **Alter FK** `node_results.session_id`: drop `ON DELETE CASCADE`, re-add as
   `ON DELETE SET NULL`.
4. **Alter FK** `node_results.execution_id`: drop `ON DELETE CASCADE`, re-add as
   `ON DELETE SET NULL`.

`executions.session_id` keeps `ON DELETE CASCADE`. We do not preserve
executions, only results. On session delete: executions are cascade-deleted,
which nulls keeper `execution_id`; the session deletion nulls keeper
`session_id`. The keeper survives with both FKs null.

Note on `UNIQUE(execution_id, node_id)`: Postgres treats NULLs as distinct, so
multiple detached `(NULL, node_id)` rows do not collide, and future upserts
(always non-null `execution_id`) are unaffected.

## RLS rewrite

Replace the `node_results` SELECT policy with:

```sql
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.executions
    JOIN public.sessions ON sessions.id = executions.session_id
    WHERE executions.id = node_results.execution_id
      AND sessions.user_id = auth.uid()
  )
)
```

The OR keeps live rows visible exactly as today (no hard dependency on the write
path populating `user_id`), while orphaned keepers stay visible via `user_id`.
The existing service-role `FOR ALL` policy is unchanged.

## Cron rewrite — `app/api/cron/cleanup-sessions/route.ts`

For each soft-deleted session, **before** deleting the session row:

1. **Stamp keepers:**
   `UPDATE node_results SET user_id = <session.user_id> WHERE session_id = sid AND user_id IS NULL`.
   Guarantees post-orphan visibility regardless of the write path.
2. **Compute keeper file set:** select `result_data` of keeper rows for the
   session; parse each public URL into a storage key by stripping the
   `…/storage/v1/object/public/chat-assets/` prefix and any `?…` cache-buster
   (URL-decode for safety). Collect into a `Set<string>`.
3. **Wipe storage precisely:** recurse `{userId}/{sessionId}/` as today, but
   exclude any path present in the keeper set from the `remove()` chunks.
   Keeper files survive; thumbnails, character refs, and ephemeral result files
   are removed. No folder-name coupling, no leaks.
4. **Delete ephemeral rows:**
   `DELETE FROM node_results WHERE session_id = sid AND NOT (<keeper predicate>)`.
5. **Delete the session row** → remaining keeper rows get `session_id` and
   `execution_id` set null by the FK behavior.

URLs that are not under the `chat-assets` bucket (e.g. mirroring failed and the
URL is still `replicate.delivery`) contribute nothing to the keeper set — there
is no local file to keep, and the DB row still survives as a keeper.

## Write-path change (minor, non-load-bearing)

Set `user_id` on the `node_results` upsert in the Replicate v2 webhook
([`app/api/webhooks/replicate-v2/route.ts`](../../../app/api/webhooks/replicate-v2/route.ts)),
which already resolves `userId`. Not required for correctness — the RLS OR-clause
and the cron's step-1 stamp cover visibility — but it keeps the column populated
from creation. Other insert sites (the initial `running` row created at dispatch)
may also set it opportunistically; visibility does not depend on them.

## UI — no changes required

- AssetsGallery "all" scope reads `node_results` via RLS; orphaned keepers appear
  automatically once RLS is `user_id`-based.
- AssetsPanel "current" scope (`.eq('session_id', sid)`) correctly excludes
  orphans (null `session_id`).
- The realtime subscription keyed on `session_id` is unaffected.

A "Library" visual grouping for session-less results is explicitly **out of
scope** (YAGNI); they simply appear in the gallery ordered by `created_at`.

## Accepted tradeoffs

- **Keeper files remain under `{userId}/{sessionId}/results/…`.** The session
  folder is partially retained after deletion. The path is an opaque key; public
  URLs still resolve. Physically relocating files to a user-level path is exactly
  the cost of the rejected `user_assets` approach and is not worth it.
- **Cascade semantics on `node_results` change globally.** Verified safe:
  sessions are only ever hard-deleted by the cron (soft-delete sets `is_deleted`);
  and if an execution is ever deleted while its session lives, only `execution_id`
  is nulled while `session_id` still anchors the row, so no premature orphaning.

## Out of scope

- Session reset (already preserves `node_results`).
- Recovering results lost to *prior* deletions (unrecoverable).
- A separate optional one-off migration to relocate results still sitting under
  `thumbnails/` from before the storage-path fix (tracked separately).

## Verification

- `npx tsc --noEmit` (the reliable check in this repo; lint/build are not).
- Manual end-to-end:
  1. Create a session, generate an image (leaf AI node).
  2. Soft-delete the session, then invoke the cleanup cron.
  3. Confirm the keeper row survives with `session_id` and `execution_id` null
     and `user_id` set.
  4. Confirm it still renders in the Assets gallery.
  5. Confirm `thumbnails/…` and ephemeral files are gone from storage, while the
     keeper's result file under `results/…` remains and its URL resolves.
  6. Confirm ephemeral rows (e.g. character) for the deleted session are gone.
