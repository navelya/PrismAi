# Preserve Results Across Session Deletion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a session is hard-deleted, keep its gallery-visible generated results (and their storage files) alive as a session-less personal library, while still purging ephemeral outputs.

**Architecture:** Orphan-in-place. Add a denormalized `node_results.user_id`, switch the `session_id`/`execution_id` foreign keys from `ON DELETE CASCADE` to `ON DELETE SET NULL`, and widen the SELECT RLS policy so orphaned rows stay visible to their owner. The cleanup cron is rewritten to enumerate "keeper" rows once, stamp their `user_id`, preserve their storage files, delete only the ephemeral rows, and then delete the session (which nulls the keepers' FKs instead of deleting them).

**Tech Stack:** Next.js 14 App Router (route handlers), Supabase (Postgres + Storage, service-role client), TypeScript. No test runner in this repo — verification is `npx tsc --noEmit`, a pure-function check via `npx tsx`, and a scripted/manual end-to-end against live Supabase.

**Spec:** [docs/superpowers/specs/2026-05-31-preserve-results-across-session-deletion-design.md](../specs/2026-05-31-preserve-results-across-session-deletion-design.md)

**Keeper predicate (used verbatim throughout):**
```
status = 'completed'
AND result_type IN ('image','video','audio','3d')
AND (node_type IS NULL OR node_type <> 'character')
```

---

## File Structure

- **Create** `supabase/migrations/20260602_preserve_results_on_session_delete.sql` — schema: `user_id` column + backfill, FK `SET NULL` swap, RLS rewrite.
- **Create** `lib/storage/public-url.ts` — pure helper `storageKeyFromPublicUrl(url)` that converts a Supabase public URL into a bucket-relative storage key. Single responsibility, unit-testable without Supabase.
- **Create** `scripts/check-public-url.ts` — assertion script for the helper (run with `npx tsx`).
- **Modify** `app/api/webhooks/replicate-v2/route.ts` — populate `user_id` on the three `node_results` upserts (write-path hygiene; non-load-bearing).
- **Modify** `app/api/cron/cleanup-sessions/route.ts` — rewrite the per-session loop to the 5-step keeper-preserving flow.
- **Create** `scripts/verify-result-preservation.md` — manual end-to-end verification checklist + SQL queries.

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20260602_preserve_results_on_session_delete.sql`

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/20260602_preserve_results_on_session_delete.sql` with exactly:

```sql
-- Migration: Preserve generated results across session deletion
-- Date: 2026-06-02
-- Purpose: Keep "keeper" node_results (gallery-visible media) alive when a
--          session is hard-deleted. Adds a denormalized user_id for RLS,
--          switches session/execution FKs to SET NULL, and widens the SELECT
--          policy so orphaned keepers remain visible to their owner.

-- 1. Denormalized owner column. The library is the user's, so deleting the
--    USER still cascades everything away — only session/execution detach.
ALTER TABLE public.node_results
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_node_results_user_id ON public.node_results(user_id);

-- 2. Backfill user_id for existing rows: prefer the direct session link, then
--    fall back through executions for older rows with a null session_id.
UPDATE public.node_results nr
SET user_id = s.user_id
FROM public.sessions s
WHERE nr.session_id = s.id AND nr.user_id IS NULL;

UPDATE public.node_results nr
SET user_id = s.user_id
FROM public.executions e
JOIN public.sessions s ON s.id = e.session_id
WHERE nr.execution_id = e.id AND nr.user_id IS NULL;

-- 3. session_id FK: ON DELETE CASCADE -> ON DELETE SET NULL.
ALTER TABLE public.node_results DROP CONSTRAINT IF EXISTS node_results_session_id_fkey;
ALTER TABLE public.node_results
  ADD CONSTRAINT node_results_session_id_fkey
  FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE SET NULL;

-- 4. execution_id FK: ON DELETE CASCADE -> ON DELETE SET NULL.
ALTER TABLE public.node_results DROP CONSTRAINT IF EXISTS node_results_execution_id_fkey;
ALTER TABLE public.node_results
  ADD CONSTRAINT node_results_execution_id_fkey
  FOREIGN KEY (execution_id) REFERENCES public.executions(id) ON DELETE SET NULL;

-- 5. Widen SELECT RLS: visible by direct ownership (survives orphaning) OR the
--    existing session/execution joins (unchanged for live rows).
DROP POLICY IF EXISTS "Users can view session results" ON public.node_results;
CREATE POLICY "Users can view session results" ON public.node_results
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.sessions
      WHERE sessions.id = node_results.session_id
      AND sessions.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.executions
      JOIN public.sessions ON sessions.id = executions.session_id
      WHERE executions.id = node_results.execution_id
      AND sessions.user_id = auth.uid()
    )
  );

-- 6. Realtime relies on REPLICA IDENTITY FULL; reassert after the schema change.
ALTER TABLE public.node_results REPLICA IDENTITY FULL;
```

- [ ] **Step 2: Apply the migration**

This repo has no Supabase CLI config (`supabase/config.toml` is absent), so migrations are applied as raw SQL against the database, not via `supabase db push`. Apply the file's contents through the Supabase SQL editor (or whatever deploy path this project uses for the `supabase/migrations/` folder).

- [ ] **Step 3: Verify the schema changed correctly**

Run these queries in the Supabase SQL editor. Expected results noted inline.

```sql
-- (a) user_id column exists -> 1 row
SELECT column_name FROM information_schema.columns
WHERE table_name = 'node_results' AND column_name = 'user_id';

-- (b) BOTH foreign keys now SET NULL -> delete_rule = 'SET NULL' for
--     node_results_session_id_fkey AND node_results_execution_id_fkey
SELECT tc.constraint_name, rc.delete_rule
FROM information_schema.referential_constraints rc
JOIN information_schema.table_constraints tc ON tc.constraint_name = rc.constraint_name
WHERE tc.table_name = 'node_results';

-- (c) policy exists -> a row named "Users can view session results"
SELECT polname FROM pg_policy
WHERE polrelid = 'public.node_results'::regclass;

-- (d) backfill worked -> 0 rows where a session-linked result still lacks user_id
SELECT count(*) FROM public.node_results nr
JOIN public.sessions s ON s.id = nr.session_id
WHERE nr.user_id IS NULL;
```

If query (b) shows any `delete_rule = 'CASCADE'` for these two constraints, the constraint names differ from the Postgres defaults; list them with
`SELECT conname FROM pg_constraint WHERE conrelid = 'public.node_results'::regclass AND contype = 'f';`
then redo Steps 3–4 of the SQL using the actual names.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260602_preserve_results_on_session_delete.sql
git commit -m "feat(db): preserve node_results across session deletion (user_id + SET NULL FKs + RLS)"
```

---

## Task 2: Pure helper `storageKeyFromPublicUrl` (TDD)

**Files:**
- Create: `lib/storage/public-url.ts`
- Test: `scripts/check-public-url.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/check-public-url.ts`:

```ts
import assert from 'node:assert';
import { storageKeyFromPublicUrl } from '../lib/storage/public-url';

const BASE = 'https://abc.supabase.co/storage/v1/object/public/chat-assets/';

// Strips bucket prefix and cache-buster -> bucket-relative key
assert.strictEqual(
  storageKeyFromPublicUrl(`${BASE}user1/sess1/results/nodeA/result_123_0.png?t=999`),
  'user1/sess1/results/nodeA/result_123_0.png',
);

// No cache-buster
assert.strictEqual(
  storageKeyFromPublicUrl(`${BASE}user1/sess1/results/nodeA/result_123_0.png`),
  'user1/sess1/results/nodeA/result_123_0.png',
);

// Percent-encoded segment is decoded
assert.strictEqual(
  storageKeyFromPublicUrl(`${BASE}user1/sess1/results/node%20B/r.png`),
  'user1/sess1/results/node B/r.png',
);

// URL not in the chat-assets bucket (e.g. still replicate-hosted) -> null
assert.strictEqual(
  storageKeyFromPublicUrl('https://replicate.delivery/pbxt/abc/out.png'),
  null,
);

console.log('OK: storageKeyFromPublicUrl');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx scripts/check-public-url.ts`
Expected: FAILS — `Cannot find module '../lib/storage/public-url'` (the helper does not exist yet).

- [ ] **Step 3: Write the helper**

Create `lib/storage/public-url.ts`:

```ts
/** The single Supabase Storage bucket all chat/canvas media lives in. */
export const CHAT_ASSETS_BUCKET = 'chat-assets';

/**
 * Convert a Supabase Storage public URL into a bucket-relative storage key
 * (the form `supabase.storage.from(bucket).remove([...])` expects).
 *
 * Returns null when the URL is not under the chat-assets bucket (e.g. media
 * that is still hosted on replicate.delivery because mirroring failed) — there
 * is no local object to act on in that case.
 */
export function storageKeyFromPublicUrl(url: string): string | null {
  const marker = `/object/public/${CHAT_ASSETS_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;

  const afterMarker = url.slice(idx + marker.length);
  const noQuery = afterMarker.split('?')[0]; // drop the ?t= cache-buster
  try {
    return decodeURIComponent(noQuery);
  } catch {
    return noQuery;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx scripts/check-public-url.ts`
Expected: prints `OK: storageKeyFromPublicUrl` and exits 0.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/storage/public-url.ts scripts/check-public-url.ts
git commit -m "feat(storage): add storageKeyFromPublicUrl helper + check script"
```

---

## Task 3: Populate `user_id` on webhook writes (non-load-bearing hygiene)

**Files:**
- Modify: `app/api/webhooks/replicate-v2/route.ts`

Context: `userId` in this file falls back to the string `'unknown_user'` for storage paths and must NOT be written into the `uuid` `user_id` column. Derive a separate nullable `userUuid`.

- [ ] **Step 1: Add the `userUuid` constant**

In `app/api/webhooks/replicate-v2/route.ts`, find (≈ line 253-255):

```ts
    const sessionId = executionCtx?.session_id || null;
    const userId = (executionCtx?.sessions as any)?.user_id || 'unknown_user';
    const storageSessionId = sessionId || 'unknown_session';
```

Replace with:

```ts
    const sessionId = executionCtx?.session_id || null;
    const userId = (executionCtx?.sessions as any)?.user_id || 'unknown_user';
    // Real owner UUID (or null) for the node_results.user_id column. Distinct
    // from `userId` above, which may be the 'unknown_user' string used only for
    // storage paths and is not a valid uuid.
    const userUuid: string | null = (executionCtx?.sessions as any)?.user_id ?? null;
    const storageSessionId = sessionId || 'unknown_session';
```

- [ ] **Step 2: Add `user_id` to the upload-failure upsert**

Find (≈ line 297-310) the `node_results` upsert inside the `mirrorMediaToStorage` catch block:

```ts
        await supabase.from('node_results').upsert(
          {
            execution_id: executionId,
            node_id: nodeId,
            session_id: sessionId,
            status: 'failed',
```

Insert `user_id: userUuid,` after the `session_id` line:

```ts
        await supabase.from('node_results').upsert(
          {
            execution_id: executionId,
            node_id: nodeId,
            session_id: sessionId,
            user_id: userUuid,
            status: 'failed',
```

- [ ] **Step 3: Add `user_id` to the still-replicate-hosted failure upsert**

Find (≈ line 334-345):

```ts
        await supabase.from('node_results').upsert(
          {
            execution_id: executionId,
            node_id: nodeId,
            session_id: sessionId,
            status: 'failed',
            error: 'Media could not be permanently stored. Please re-run the node.',
```

Insert `user_id: userUuid,` after `session_id`:

```ts
        await supabase.from('node_results').upsert(
          {
            execution_id: executionId,
            node_id: nodeId,
            session_id: sessionId,
            user_id: userUuid,
            status: 'failed',
            error: 'Media could not be permanently stored. Please re-run the node.',
```

- [ ] **Step 4: Add `user_id` to the success upsert**

Find (≈ line 363-375):

```ts
      const { error: updateError } = await supabase.from('node_results').upsert(
        {
          execution_id: executionId,
          node_id: nodeId,
          session_id: sessionId,
          status: 'completed',
          result_type: outputType,
```

Insert `user_id: userUuid,` after `session_id`:

```ts
      const { error: updateError } = await supabase.from('node_results').upsert(
        {
          execution_id: executionId,
          node_id: nodeId,
          session_id: sessionId,
          user_id: userUuid,
          status: 'completed',
          result_type: outputType,
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/api/webhooks/replicate-v2/route.ts
git commit -m "feat(webhook): stamp node_results.user_id on result writes"
```

---

## Task 4: Rewrite the cleanup cron to preserve keepers

**Files:**
- Modify: `app/api/cron/cleanup-sessions/route.ts`

This replaces the per-session body. The new flow, per session: (1) enumerate keepers once, (2) stamp their `user_id`, (3) build the keeper storage-key set, (4) wipe storage except those keys, (5) delete non-keeper rows (NULL-safe via `id NOT IN keeperIds`), (6) delete the session (FKs SET NULL the keepers). If keeper enumeration errors, the session is skipped entirely — never delete data we could not classify.

- [ ] **Step 1: Add the import and keeper-media constant**

At the top of `app/api/cron/cleanup-sessions/route.ts`, the existing imports are:

```ts
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';
```

Replace with:

```ts
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { storageKeyFromPublicUrl } from '@/lib/storage/public-url';

export const dynamic = 'force-dynamic';

// A "keeper" result is exactly what the Assets gallery shows: a completed media
// output from a non-ephemeral node. Keepers survive session deletion.
const KEEPER_MEDIA_TYPES = ['image', 'video', 'audio', '3d'];
```

- [ ] **Step 2: Replace the per-session loop body**

Find the entire `for (const session of deletedSessions) { ... }` block (currently ≈ lines 37-90, from `for (const session` through its closing `}` just before the final `console.log('[Cron] Cleanup complete...`). Replace the whole loop with:

```ts
        // 3. Process each session
        for (const session of deletedSessions) {
            const basePath = `${session.user_id}/${session.id}`;

            // 3a. Enumerate keepers ONCE. Drives stamping, file preservation,
            // and the ephemeral delete — so the split is computed exactly once
            // and is immune to SQL three-valued-logic edge cases.
            const { data: keeperRows, error: keeperErr } = await supabaseAdmin
                .from('node_results')
                .select('id, result_data')
                .eq('session_id', session.id)
                .eq('status', 'completed')
                .in('result_type', KEEPER_MEDIA_TYPES)
                .or('node_type.is.null,node_type.neq.character');

            if (keeperErr) {
                // Could not classify -> do NOT delete anything for this session.
                console.error(`[Cron Wipe] Keeper query failed for session ${session.id}; skipping:`, keeperErr);
                continue;
            }

            const keeperIds = (keeperRows ?? []).map((r) => r.id);

            // 3b. Stamp user_id on keepers so they stay RLS-visible once orphaned.
            if (keeperIds.length > 0) {
                const { error: stampErr } = await supabaseAdmin
                    .from('node_results')
                    .update({ user_id: session.user_id })
                    .in('id', keeperIds)
                    .is('user_id', null);
                if (stampErr) {
                    console.error(`[Cron Wipe] user_id stamp failed for session ${session.id}; skipping:`, stampErr);
                    continue;
                }
            }

            // 3c. Build the set of storage keys referenced by keeper rows.
            const keeperKeys = new Set<string>();
            for (const row of keeperRows ?? []) {
                const items = Array.isArray(row.result_data) ? row.result_data : [];
                for (const item of items) {
                    if (typeof item === 'string') {
                        const key = storageKeyFromPublicUrl(item);
                        if (key) keeperKeys.add(key);
                    }
                }
            }

            // 3d. Crawl storage under {userId}/{sessionId}, then remove everything
            // EXCEPT keeper files.
            let filesToRemove: string[] = [];
            async function fetchAllFiles(path: string) {
                const { data, error } = await supabaseAdmin.storage.from('chat-assets').list(path);
                if (error) {
                    console.error(`[Cron Wipe] List error at ${path}:`, error);
                    return;
                }
                if (!data) return;
                for (const item of data) {
                    if (item.id === null) {
                        await fetchAllFiles(`${path}/${item.name}`);
                    } else {
                        filesToRemove.push(`${path}/${item.name}`);
                    }
                }
            }
            await fetchAllFiles(basePath);

            const removable = filesToRemove.filter((p) => !keeperKeys.has(p));
            if (removable.length > 0) {
                const chunkSize = 100;
                for (let i = 0; i < removable.length; i += chunkSize) {
                    const chunk = removable.slice(i, i + chunkSize);
                    const { error: removeError } = await supabaseAdmin.storage
                        .from('chat-assets')
                        .remove(chunk);
                    if (removeError) {
                        console.error(`[Cron Wipe] Chunk removal error for session ${session.id}:`, removeError);
                    } else {
                        totalFilesDeleted += chunk.length;
                    }
                }
            }

            // 3e. Delete the EPHEMERAL rows (everything for this session that is
            // not a keeper). Must run BEFORE the session delete, while session_id
            // still links them. NULL-safe: keyed on keeperIds, not a predicate.
            let ephemeralDelete = supabaseAdmin
                .from('node_results')
                .delete()
                .eq('session_id', session.id);
            if (keeperIds.length > 0) {
                ephemeralDelete = ephemeralDelete.not('id', 'in', `(${keeperIds.join(',')})`);
            }
            const { error: ephemeralErr } = await ephemeralDelete;
            if (ephemeralErr) {
                console.error(`[Cron Wipe] Ephemeral row delete failed for session ${session.id}; skipping session delete:`, ephemeralErr);
                continue;
            }

            // 3f. Hard delete the session. Keeper node_results rows get their
            // session_id and execution_id SET NULL and survive as a session-less
            // library entry (visible via user_id RLS). messages cascade.
            const { error: dbError } = await supabaseAdmin
                .from('sessions')
                .delete()
                .eq('id', session.id);

            if (dbError) {
                console.error(`[Cron Wipe] DB deletion error for session ${session.id}:`, dbError);
            } else {
                totalSessionsDeleted++;
            }
        }
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (In particular, `keeperRows`, `keeperKeys`, and `removable` are all well-typed; `session.user_id` and `session.id` come from the existing `.select('id, user_id')`.)

- [ ] **Step 4: Sanity-read the diff**

Run: `git diff app/api/cron/cleanup-sessions/route.ts`
Confirm: the old unconditional full-tree `remove()` is gone; storage removal now filters on `keeperKeys`; the session `.delete()` is preceded by the keeper stamp and the ephemeral-row delete; nothing deletes `node_results` keepers.

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/cleanup-sessions/route.ts
git commit -m "feat(cron): preserve keeper results + their files on session hard-delete"
```

---

## Task 5: End-to-end verification

**Files:**
- Create: `scripts/verify-result-preservation.md`

No automated harness can drive the full Replicate → webhook → storage → cron path offline, so verification is a documented manual run against a live environment.

- [ ] **Step 1: Write the verification checklist**

Create `scripts/verify-result-preservation.md`:

```markdown
# Verify: results survive session deletion

Prereq: migration `20260602_preserve_results_on_session_delete.sql` applied;
cron + webhook + helper changes deployed (or running `npm run dev`).

1. Create a session; run a workflow whose leaf node is an AI generator that
   produces an image. Wait for it to finish.
2. Open the Assets gallery — confirm the image appears.
3. In Supabase, capture the keeper row and its file:
   ```sql
   SELECT id, session_id, execution_id, user_id, result_type, result_data
   FROM node_results
   WHERE session_id = '<SESSION_ID>' AND status = 'completed';
   ```
   Note `result_data` (the `/results/<nodeId>/...` URL) and that `user_id` is set.
4. Soft-delete the session from the UI (sidebar delete).
5. Trigger the cleanup cron:
   `curl -H "Authorization: Bearer $CRON_SECRET" "$NEXT_PUBLIC_APP_URL/api/cron/cleanup-sessions"`
6. Confirm preservation:
   - [ ] The keeper row still exists, now with `session_id IS NULL` and
     `execution_id IS NULL` and `user_id` still set:
     ```sql
     SELECT id, session_id, execution_id, user_id FROM node_results WHERE id = '<KEEPER_ID>';
     ```
   - [ ] The keeper's `result_data` URL still loads in a browser (file kept).
   - [ ] The Assets gallery (all-sessions view) still shows the image.
   - [ ] Ephemeral artifacts are gone: the session's `thumbnails/...` storage is
     empty, and any `character`/intermediate node_results rows for that session
     are deleted.
   - [ ] The session row is gone and its messages cascaded away.
```

- [ ] **Step 2: Execute the checklist against a live/dev environment**

Walk through `scripts/verify-result-preservation.md`. Every checkbox in step 6 must pass. If any fails, STOP and diagnose with the systematic-debugging skill before proceeding — do not paper over it.

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-result-preservation.md
git commit -m "docs: add manual verification for result preservation on session delete"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** user_id column + backfill (Task 1) ✓; session_id/execution_id SET NULL (Task 1) ✓; RLS rewrite with user_id arm (Task 1) ✓; cron 5-step keeper flow incl. precise storage wipe + NULL-safe ephemeral delete + keeper stamp (Task 4) ✓; webhook user_id write-path (Task 3) ✓; "skip session on classification error" safety (Task 4) ✓; verification incl. orphaned-but-visible keeper + ephemeral cleanup (Task 5) ✓. UI requires no changes per spec — no task, intentionally.
- **Placeholder scan:** none — every code/SQL step is complete.
- **Type/name consistency:** `storageKeyFromPublicUrl` and `CHAT_ASSETS_BUCKET` defined in Task 2 and consumed in Task 4; `KEEPER_MEDIA_TYPES`, `keeperRows`, `keeperIds`, `keeperKeys`, `removable`, `userUuid` used consistently; keeper predicate identical in the migration, the cron query, and the spec.
```
