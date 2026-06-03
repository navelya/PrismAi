# Workflow Versions & Checkpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable, cross-device workflow versioning — AI-triggered auto-versions plus owner-created named checkpoints — with overwrite-on-restore (safety-snapshot first) and a History side panel.

**Architecture:** A dedicated `workflow_versions` table keyed by `canvas_id` holds full `canvas_state` JSONB snapshots. Auto-versions are written server-side in the chat route (service-role) right before the chat brain applies a graph patch. Checkpoints, listing, restore, and delete go through new user-facing API routes (session-scoped, owner-gated). A History side panel mirrors the existing Assets/Characters panel pattern.

**Tech Stack:** Next.js (app router, nodejs runtime), Supabase (Postgres + RLS), Zustand store, React Flow, framer-motion, Tailwind, lucide-react.

**Spec:** [docs/superpowers/specs/2026-06-03-workflow-versions-design.md](../specs/2026-06-03-workflow-versions-design.md)

**Verification note:** This repo has **no test runner** (see CLAUDE.md). Per [memory: verification-commands], type-check with `npx tsc --noEmit`. DB behavior is verified with an ad-hoc script against live Supabase (repo convention in [scripts/](../../../scripts/)). The migration is applied manually by an operator (Supabase SQL editor or `supabase db push`) — there is no automated migration runner.

---

## File structure

- **Create** `supabase/migrations/20260603_workflow_versions.sql` — table, indexes, RLS.
- **Create** `lib/db/versions.ts` — pure data-access layer (hash, list, get, create checkpoint, create auto, prune, restore). Accepts a Supabase client so it works from both service-role (chat route) and session-scoped (API routes) contexts.
- **Create** `app/api/versions/route.ts` — `GET` list.
- **Create** `app/api/versions/checkpoint/route.ts` — `POST` create checkpoint.
- **Create** `app/api/versions/[id]/route.ts` — `GET` one, `DELETE` checkpoint.
- **Create** `app/api/versions/[id]/restore/route.ts` — `POST` restore.
- **Create** `lib/hooks/use-versions.ts` — client hook (list + mutations).
- **Create** `components/editor/HistoryPanel.tsx` — the History side panel.
- **Create** `scripts/verify-workflow-versions.js` — ad-hoc DB verification.
- **Modify** `lib/api/client.ts` — add `versionsApi`.
- **Modify** `app/api/chat/stream/route.ts` — capture auto-version at the two canvas_state persist sites.
- **Modify** `lib/store/slices/workflow-slice.ts` + `lib/store/types.ts` — add `clearHistory()` action.
- **Modify** `components/layout/WorkspaceLayout.tsx` — add `'history'` panel + tool-rail button.

---

## Task 1: Database migration — `workflow_versions` table + RLS

**Files:**
- Create: `supabase/migrations/20260603_workflow_versions.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Migration: workflow versions & checkpoints
-- Date: 2026-06-03
-- Description: Durable snapshots of a canvas's graph (sessions.canvas_state),
-- keyed by canvas_id (the owner session that holds the canvas). Two kinds:
--   'auto'       — written server-side (service role) before the chat brain
--                  applies a graph patch; pruned to the newest 20 per canvas.
--   'checkpoint' — user-named, owner-created, never auto-pruned.
-- RLS: members can read; only the canvas owner may insert/delete via the
-- session client. Auto-version writes use the service-role client (bypass RLS).

CREATE TABLE IF NOT EXISTS public.workflow_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canvas_id     uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('auto','checkpoint')),
  label         text,
  canvas_state  jsonb NOT NULL,
  content_hash  text NOT NULL,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_versions_canvas_created
  ON public.workflow_versions (canvas_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_versions_canvas_hash
  ON public.workflow_versions (canvas_id, content_hash);

ALTER TABLE public.workflow_versions ENABLE ROW LEVEL SECURITY;

-- Members (owner + collaborators) can read. Reuses the helper installed by
-- 20260602_workflow_collaboration.sql.
DROP POLICY IF EXISTS "versions read" ON public.workflow_versions;
CREATE POLICY "versions read" ON public.workflow_versions FOR SELECT
  USING (public.can_access_session(canvas_id));

-- Only the canvas OWNER may insert (checkpoints via session client).
-- Auto-versions are inserted with the service-role client, which bypasses RLS.
DROP POLICY IF EXISTS "versions owner insert" ON public.workflow_versions;
CREATE POLICY "versions owner insert" ON public.workflow_versions FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.sessions s
            WHERE s.id = workflow_versions.canvas_id AND s.user_id = auth.uid())
  );

-- Only the canvas OWNER may delete (checkpoints, and prune via service role).
DROP POLICY IF EXISTS "versions owner delete" ON public.workflow_versions;
CREATE POLICY "versions owner delete" ON public.workflow_versions FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM public.sessions s
            WHERE s.id = workflow_versions.canvas_id AND s.user_id = auth.uid())
  );

-- No UPDATE policy: versions are immutable.

DO $$ BEGIN RAISE NOTICE '✅ workflow_versions migration applied'; END $$;
```

- [ ] **Step 2: Apply the migration**

Apply against the project's Supabase (operator step — there is no automated runner):
- Supabase Dashboard → SQL Editor → paste the migration → Run, **or**
- `supabase db push` if the CLI is configured for this project.

- [ ] **Step 3: Verify the table exists**

In the Supabase SQL editor, run:

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'workflow_versions'
ORDER BY ordinal_position;
```

Expected: rows for `id, canvas_id, kind, label, canvas_state, content_hash, created_by, created_at`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260603_workflow_versions.sql
git commit -m "feat(versions): add workflow_versions table + RLS"
```

---

## Task 2: DB access layer — `lib/db/versions.ts`

**Files:**
- Create: `lib/db/versions.ts`

- [ ] **Step 1: Write the data-access module**

The functions accept a Supabase client (`SupabaseClient`) so the chat route can pass its service-role client and API routes can pass their session-scoped client. Hashing reuses `stableStringify` for consistency with autosave.

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import { stableStringify } from '@/lib/utils/stable-stringify';
import { Workflow } from '@/lib/nodes/types';

const AUTO_VERSION_KEEP = 20;

export interface VersionRow {
  id: string;
  canvas_id: string;
  kind: 'auto' | 'checkpoint';
  label: string | null;
  content_hash: string;
  created_by: string | null;
  created_at: string;
}

/**
 * Hash the graph the same way autosave does: only nodes/edges matter, and
 * volatile per-node execution state (status/output) is stripped so identical
 * graphs across runs dedup correctly.
 */
export function hashCanvasState(canvasState: any): string {
  const nodes = Array.isArray(canvasState?.nodes) ? canvasState.nodes : [];
  const edges = Array.isArray(canvasState?.edges) ? canvasState.edges : [];
  const sanitized = {
    nodes: nodes.map((n: any) => ({
      ...n,
      data: { ...(n.data || {}), status: undefined, output: undefined },
    })),
    edges,
  };
  return stableStringify(sanitized);
}

/** List versions (metadata only — no canvas_state payload), newest first. */
export async function listVersions(
  client: SupabaseClient,
  canvasId: string
): Promise<VersionRow[]> {
  const { data, error } = await client
    .from('workflow_versions')
    .select('id, canvas_id, kind, label, content_hash, created_by, created_at')
    .eq('canvas_id', canvasId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []) as VersionRow[];
}

/** Fetch one version's full canvas_state. */
export async function getVersion(
  client: SupabaseClient,
  id: string
): Promise<{ canvas_id: string; canvas_state: Workflow } | null> {
  const { data, error } = await client
    .from('workflow_versions')
    .select('canvas_id, canvas_state')
    .eq('id', id)
    .single();
  if (error || !data) return null;
  return data as { canvas_id: string; canvas_state: Workflow };
}

/** Create a manual checkpoint from the canvas's CURRENT canvas_state (no dedup). */
export async function createCheckpoint(
  client: SupabaseClient,
  canvasId: string,
  label: string,
  userId: string
): Promise<VersionRow> {
  const { data: session, error: sErr } = await client
    .from('sessions')
    .select('canvas_state')
    .eq('id', canvasId)
    .single();
  if (sErr || !session) throw new Error('Canvas not found');

  const canvasState = session.canvas_state || { nodes: [], edges: [] };
  const { data, error } = await client
    .from('workflow_versions')
    .insert({
      canvas_id: canvasId,
      kind: 'checkpoint',
      label: label || 'Checkpoint',
      canvas_state: canvasState,
      content_hash: hashCanvasState(canvasState),
      created_by: userId,
    })
    .select('id, canvas_id, kind, label, content_hash, created_by, created_at')
    .single();
  if (error) throw new Error(error.message);
  return data as VersionRow;
}

/**
 * Create an auto-version from a provided pre-edit canvas_state, but only if it
 * differs (by hash) from the newest existing version for this canvas. Returns
 * the new row, or null if skipped (empty graph or duplicate). Prunes afterward.
 */
export async function createAutoVersion(
  client: SupabaseClient,
  canvasId: string,
  preEditState: any,
  userId: string | null
): Promise<VersionRow | null> {
  const nodes = Array.isArray(preEditState?.nodes) ? preEditState.nodes : [];
  if (nodes.length === 0) return null; // nothing meaningful to snapshot

  const hash = hashCanvasState(preEditState);

  const { data: latest } = await client
    .from('workflow_versions')
    .select('content_hash')
    .eq('canvas_id', canvasId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest && latest.content_hash === hash) return null; // dedup

  const { data, error } = await client
    .from('workflow_versions')
    .insert({
      canvas_id: canvasId,
      kind: 'auto',
      label: null,
      canvas_state: { nodes, edges: Array.isArray(preEditState?.edges) ? preEditState.edges : [] },
      content_hash: hash,
      created_by: userId,
    })
    .select('id, canvas_id, kind, label, content_hash, created_by, created_at')
    .single();
  if (error) throw new Error(error.message);

  await pruneAutoVersions(client, canvasId);
  return data as VersionRow;
}

/** Delete 'auto' rows beyond the newest AUTO_VERSION_KEEP for this canvas. */
export async function pruneAutoVersions(
  client: SupabaseClient,
  canvasId: string
): Promise<void> {
  const { data: autos, error } = await client
    .from('workflow_versions')
    .select('id')
    .eq('canvas_id', canvasId)
    .eq('kind', 'auto')
    .order('created_at', { ascending: false });
  if (error || !autos) return;
  const stale = autos.slice(AUTO_VERSION_KEEP).map((r: any) => r.id);
  if (stale.length === 0) return;
  await client.from('workflow_versions').delete().in('id', stale);
}

/** Delete a checkpoint (or any single version row). */
export async function deleteVersion(
  client: SupabaseClient,
  id: string
): Promise<void> {
  const { error } = await client.from('workflow_versions').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/**
 * Restore a version: safety-snapshot the current canvas as an auto-version,
 * then overwrite sessions.canvas_state with the target version. Returns the
 * restored canvas_state. Caller must have already verified ownership.
 */
export async function restoreVersion(
  client: SupabaseClient,
  id: string,
  userId: string
): Promise<{ canvasId: string; canvasState: Workflow }> {
  const target = await getVersion(client, id);
  if (!target) throw new Error('Version not found');
  const canvasId = target.canvas_id;

  // Safety snapshot of the current state (dedup'd; may be skipped).
  const { data: session } = await client
    .from('sessions')
    .select('canvas_state')
    .eq('id', canvasId)
    .single();
  if (session?.canvas_state) {
    await createAutoVersion(client, canvasId, session.canvas_state, userId);
  }

  // Overwrite.
  const { error: upErr } = await client
    .from('sessions')
    .update({ canvas_state: target.canvas_state, updated_at: new Date().toISOString() })
    .eq('id', canvasId);
  if (upErr) throw new Error(upErr.message);

  return { canvasId, canvasState: target.canvas_state };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors referencing `lib/db/versions.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/db/versions.ts
git commit -m "feat(versions): data-access layer for workflow versions"
```

---

## Task 3: API routes

**Files:**
- Create: `app/api/versions/route.ts`
- Create: `app/api/versions/checkpoint/route.ts`
- Create: `app/api/versions/[id]/route.ts`
- Create: `app/api/versions/[id]/restore/route.ts`

All use `getAuthenticatedUser()` (session-scoped client). Ownership for write ops is enforced both by RLS and an explicit check so we can return a clean 403.

- [ ] **Step 1: Write the list route** (`app/api/versions/route.ts`)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';
import { listVersions } from '@/lib/db/versions';

export const runtime = 'nodejs';

/** GET /api/versions?canvasId=… — list versions (metadata only), newest first. */
export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (auth.error) return auth.error;
  const { supabase } = auth;

  const canvasId = request.nextUrl.searchParams.get('canvasId');
  if (!canvasId) {
    return NextResponse.json({ error: 'Missing canvasId' }, { status: 400 });
  }

  try {
    const versions = await listVersions(supabase, canvasId);
    return NextResponse.json({ versions });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Write the checkpoint route** (`app/api/versions/checkpoint/route.ts`)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';
import { createCheckpoint } from '@/lib/db/versions';

export const runtime = 'nodejs';

/** POST /api/versions/checkpoint { canvasId, label } — owner only. */
export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (auth.error) return auth.error;
  const { user, supabase } = auth;

  const body = await request.json().catch(() => ({}));
  const canvasId = typeof body.canvasId === 'string' ? body.canvasId : '';
  const label = typeof body.label === 'string' ? body.label.slice(0, 120) : '';
  if (!canvasId) {
    return NextResponse.json({ error: 'Missing canvasId' }, { status: 400 });
  }

  // Explicit ownership check (RLS also enforces this).
  const { data: session } = await supabase
    .from('sessions')
    .select('id')
    .eq('id', canvasId)
    .eq('user_id', user.id)
    .single();
  if (!session) {
    return NextResponse.json({ error: 'Only the owner can create checkpoints' }, { status: 403 });
  }

  try {
    const version = await createCheckpoint(supabase, canvasId, label || 'Checkpoint', user.id);
    return NextResponse.json({ version });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
```

- [ ] **Step 3: Write the single-version route** (`app/api/versions/[id]/route.ts`)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';
import { getVersion, deleteVersion } from '@/lib/db/versions';

export const runtime = 'nodejs';

interface RouteParams { params: { id: string }; }

/** GET /api/versions/:id — full canvas_state (members, via RLS). */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const auth = await getAuthenticatedUser();
  if (auth.error) return auth.error;
  const { supabase } = auth;

  const version = await getVersion(supabase, params.id);
  if (!version) {
    return NextResponse.json({ error: 'Version not found' }, { status: 404 });
  }
  return NextResponse.json({ version });
}

/** DELETE /api/versions/:id — owner only. */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const auth = await getAuthenticatedUser();
  if (auth.error) return auth.error;
  const { user, supabase } = auth;

  const version = await getVersion(supabase, params.id);
  if (!version) {
    return NextResponse.json({ error: 'Version not found' }, { status: 404 });
  }
  const { data: session } = await supabase
    .from('sessions')
    .select('id')
    .eq('id', version.canvas_id)
    .eq('user_id', user.id)
    .single();
  if (!session) {
    return NextResponse.json({ error: 'Only the owner can delete versions' }, { status: 403 });
  }

  try {
    await deleteVersion(supabase, params.id);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
```

- [ ] **Step 4: Write the restore route** (`app/api/versions/[id]/restore/route.ts`)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';
import { getVersion, restoreVersion } from '@/lib/db/versions';

export const runtime = 'nodejs';

interface RouteParams { params: { id: string }; }

/** POST /api/versions/:id/restore — safety-snapshot + overwrite. Owner only. */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const auth = await getAuthenticatedUser();
  if (auth.error) return auth.error;
  const { user, supabase } = auth;

  const version = await getVersion(supabase, params.id);
  if (!version) {
    return NextResponse.json({ error: 'Version not found' }, { status: 404 });
  }
  const { data: session } = await supabase
    .from('sessions')
    .select('id')
    .eq('id', version.canvas_id)
    .eq('user_id', user.id)
    .single();
  if (!session) {
    return NextResponse.json({ error: 'Only the owner can restore' }, { status: 403 });
  }

  try {
    const { canvasId, canvasState } = await restoreVersion(supabase, params.id, user.id);
    return NextResponse.json({ canvasId, canvasState });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors in `app/api/versions/**`.

- [ ] **Step 6: Commit**

```bash
git add app/api/versions
git commit -m "feat(versions): list/checkpoint/restore/delete API routes"
```

---

## Task 4: Capture auto-versions in the chat route

The chat route loads the pre-edit graph and persists a modified `canvas_state` only when a patch was produced. Capture the **pre-edit** state at both persist sites, using the service-role client already in scope. Capture must never break the turn (try/catch).

**Files:**
- Modify: `app/api/chat/stream/route.ts`

- [ ] **Step 1: Add the import**

At the top of [app/api/chat/stream/route.ts](../../../app/api/chat/stream/route.ts), after the existing imports (e.g. after line 11 `import { getAuthenticatedUser } ...`):

```typescript
import { createAutoVersion } from '@/lib/db/versions';
```

- [ ] **Step 2: Capture in the main runBrain persist site**

In the main path, the canvas is persisted when `result.accumulatedPatch` is truthy (around line 626). The pre-edit graph is `previousWorkflow` (passed to `runBrain`). Replace the existing block:

```typescript
          if (result.accumulatedPatch) {
            dbOps.push(
              Promise.resolve(supabase.from('sessions').update({
                canvas_state: { nodes: result.finalWorkflow.nodes, edges: result.finalWorkflow.edges },
                updated_at: new Date().toISOString()
              }).eq('id', canvasId) as any)
            );
          }
```

with:

```typescript
          if (result.accumulatedPatch) {
            // Capture the PRE-edit graph as an auto-version before overwriting.
            // Service-role client → bypasses owner-only RLS (an editor may be
            // driving this turn). Never let a version failure break the turn.
            try {
              await createAutoVersion(
                supabase as any,
                canvasId,
                previousWorkflow,
                auth.user?.id ?? null
              );
            } catch (verr) {
              console.error('[chat] auto-version capture failed:', verr);
            }
            dbOps.push(
              Promise.resolve(supabase.from('sessions').update({
                canvas_state: { nodes: result.finalWorkflow.nodes, edges: result.finalWorkflow.edges },
                updated_at: new Date().toISOString()
              }).eq('id', canvasId) as any)
            );
          }
```

> Note: `auth` is the result of `getAuthenticatedUser()` resolved earlier in the POST handler (line 380). If `previousWorkflow` is not the variable name in scope here, use whatever holds the loaded pre-edit canvas passed into `runBrain` (the `workflow:` argument at the `runBrain({...})` call ~line 558). Confirm by reading the surrounding lines before editing.

- [ ] **Step 3: Capture in the `handlePlanApprove` persist site**

In `handlePlanApprove`, the pre-edit graph is `baseWorkflow` (loaded ~line 118) and the persist is gated by `result.patch` (~line 179). `handlePlanApprove` does not currently receive the user id; add capture using `created_by: null` (system) — the safety snapshot is still keyed to the canvas. Replace:

```typescript
            if (result.patch) {
              dbOps.push(
                Promise.resolve(supabase.from('sessions').update({
                  canvas_state: { nodes: state.workflow.nodes, edges: state.workflow.edges },
                  updated_at: new Date().toISOString(),
                }).eq('id', canvasId) as any)
              );
            }
```

with:

```typescript
            if (result.patch) {
              try {
                await createAutoVersion(supabase as any, canvasId, baseWorkflow, null);
              } catch (verr) {
                console.error('[chat] auto-version capture (approve) failed:', verr);
              }
              dbOps.push(
                Promise.resolve(supabase.from('sessions').update({
                  canvas_state: { nodes: state.workflow.nodes, edges: state.workflow.edges },
                  updated_at: new Date().toISOString(),
                }).eq('id', canvasId) as any)
              );
            }
```

> If a second persist site exists in the tasks branch (search the file for `canvas_state:` updates), apply the same pattern there using that branch's pre-edit `baseWorkflow`.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors in `app/api/chat/stream/route.ts`.

- [ ] **Step 5: Commit**

```bash
git add app/api/chat/stream/route.ts
git commit -m "feat(versions): capture auto-version before chat-brain graph edits"
```

---

## Task 5: Client API methods

**Files:**
- Modify: `lib/api/client.ts`

- [ ] **Step 1: Add `versionsApi`**

Append after the existing `collaboratorsApi` export (near line 105) in [lib/api/client.ts](../../../lib/api/client.ts):

```typescript
export interface WorkflowVersion {
    id: string;
    canvas_id: string;
    kind: 'auto' | 'checkpoint';
    label: string | null;
    content_hash: string;
    created_by: string | null;
    created_at: string;
}

export const versionsApi = {
    list: (canvasId: string) =>
        apiFetch<{ versions: WorkflowVersion[] }>(
            `/api/versions?canvasId=${encodeURIComponent(canvasId)}`,
            { cache: 'no-store' }
        ),
    createCheckpoint: (canvasId: string, label: string) =>
        apiFetch<{ version: WorkflowVersion }>('/api/versions/checkpoint', {
            method: 'POST',
            body: JSON.stringify({ canvasId, label }),
        }),
    restore: (id: string) =>
        apiFetch<{ canvasId: string; canvasState: any }>(`/api/versions/${id}/restore`, {
            method: 'POST',
        }),
    remove: (id: string) =>
        apiFetch<{ success: boolean }>(`/api/versions/${id}`, { method: 'DELETE' }),
};
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors in `lib/api/client.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/api/client.ts
git commit -m "feat(versions): client API for versions"
```

---

## Task 6: `clearHistory` store action

Restore is a fresh baseline; clear the in-session undo stack so a stray Ctrl-Z doesn't reintroduce pre-restore state into a now-divergent timeline.

**Files:**
- Modify: `lib/store/types.ts`
- Modify: `lib/store/slices/workflow-slice.ts`

- [ ] **Step 1: Add to the slice interface**

In [lib/store/types.ts](../../../lib/store/types.ts), find the `WorkflowSlice` interface and add alongside `undo`/`redo`:

```typescript
    clearHistory: () => void;
```

- [ ] **Step 2: Implement in the slice**

In [lib/store/slices/workflow-slice.ts](../../../lib/store/slices/workflow-slice.ts), add after the `redo` implementation (after line 175):

```typescript
    clearHistory: () => set({ past: [], future: [] }),
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors (interface and implementation now match).

- [ ] **Step 4: Commit**

```bash
git add lib/store/types.ts lib/store/slices/workflow-slice.ts
git commit -m "feat(versions): clearHistory store action"
```

---

## Task 7: `use-versions` client hook

**Files:**
- Create: `lib/hooks/use-versions.ts`

- [ ] **Step 1: Write the hook**

Fetches the version list for the active canvas, exposes mutations, and applies a restore into the store. Restore loads the returned canvas_state via `setCurrentWorkflow(workflow, false)` (not dirty — it is the new server baseline) and clears the undo stack. Peers in a shared canvas update through the same realtime path that already propagates chat-brain canvas edits (the restore route writes `sessions.canvas_state` identically).

```typescript
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '@/lib/store/app-store';
import { versionsApi, type WorkflowVersion } from '@/lib/api/client';

export function useVersions() {
    const canvasId = useAppStore((s) => s.activeCanvasId);
    const setCurrentWorkflow = useAppStore((s) => s.setCurrentWorkflow);
    const clearHistory = useAppStore((s) => s.clearHistory);

    const [versions, setVersions] = useState<WorkflowVersion[]>([]);
    const [loading, setLoading] = useState(false);

    const refresh = useCallback(async () => {
        if (!canvasId) return;
        setLoading(true);
        try {
            const { versions } = await versionsApi.list(canvasId);
            setVersions(versions);
        } catch (err) {
            console.error('[useVersions] list failed:', err);
        } finally {
            setLoading(false);
        }
    }, [canvasId]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const createCheckpoint = useCallback(async (label: string) => {
        if (!canvasId) return;
        await versionsApi.createCheckpoint(canvasId, label);
        await refresh();
    }, [canvasId, refresh]);

    const restore = useCallback(async (id: string) => {
        const { canvasState } = await versionsApi.restore(id);
        // Adopt as the new baseline (isDirty=false so autosave doesn't re-save).
        setCurrentWorkflow(canvasState, false);
        clearHistory();
        await refresh();
    }, [setCurrentWorkflow, clearHistory, refresh]);

    const remove = useCallback(async (id: string) => {
        await versionsApi.remove(id);
        await refresh();
    }, [refresh]);

    return { versions, loading, refresh, createCheckpoint, restore, remove };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors in `lib/hooks/use-versions.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/hooks/use-versions.ts
git commit -m "feat(versions): use-versions client hook"
```

---

## Task 8: History panel component

**Files:**
- Create: `components/editor/HistoryPanel.tsx`

- [ ] **Step 1: Write the panel**

Follows `CharactersPanel`'s container styling and `onClose` prop. Owner-only write actions are gated on `collabRole` (anything other than `'editor'`/`'viewer'` is treated as owner; the API enforces this regardless). Checkpoints are pinned to a top section; auto-versions list below.

```typescript
'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { History, Star, Clock, RotateCcw, Trash2, Plus, X } from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';
import { useAppStore } from '@/lib/store/app-store';
import { useVersions } from '@/lib/hooks/use-versions';
import type { WorkflowVersion } from '@/lib/api/client';

interface HistoryPanelProps {
    onClose: () => void;
}

function relativeTime(iso: string): string {
    const then = new Date(iso).getTime();
    const diff = Math.max(0, Date.now() - then);
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hr ago`;
    const days = Math.floor(hrs / 24);
    return `${days} day${days > 1 ? 's' : ''} ago`;
}

export function HistoryPanel({ onClose }: HistoryPanelProps) {
    const { versions, loading, createCheckpoint, restore, remove } = useVersions();
    const collabRole = useAppStore((s) => s.collabRole);
    const isOwner = collabRole !== 'editor' && collabRole !== 'viewer';
    const [busyId, setBusyId] = useState<string | null>(null);

    const checkpoints = versions.filter((v) => v.kind === 'checkpoint');
    const autos = versions.filter((v) => v.kind === 'auto');

    const handleCheckpoint = async () => {
        const label = window.prompt('Name this checkpoint:', 'Checkpoint');
        if (label == null) return;
        await createCheckpoint(label.trim() || 'Checkpoint');
    };

    const handleRestore = async (v: WorkflowVersion) => {
        if (!window.confirm('Restore this version? Your current canvas will be saved as a version first, then replaced.')) return;
        setBusyId(v.id);
        try { await restore(v.id); } finally { setBusyId(null); }
    };

    const handleDelete = async (v: WorkflowVersion) => {
        if (!window.confirm('Delete this checkpoint?')) return;
        setBusyId(v.id);
        try { await remove(v.id); } finally { setBusyId(null); }
    };

    return (
        <div className="relative w-full h-full bg-surface-elevated/80 backdrop-blur-md border border-stroke-subtle rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-stroke-subtle/60">
                <div className="flex items-center gap-2 text-content-secondary">
                    <History className="w-4 h-4" />
                    <span className="text-sm font-semibold">Version history</span>
                </div>
                <div className="flex items-center gap-0.5">
                    {isOwner && (
                        <button
                            onClick={handleCheckpoint}
                            className="p-1 hover:bg-white/10 rounded-md transition-colors group"
                            title="Save checkpoint"
                        >
                            <Plus className="w-3.5 h-3.5 text-content-tertiary group-hover:text-content-primary transition-colors" />
                        </button>
                    )}
                    <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-md transition-colors group" title="Close">
                        <X className="w-3.5 h-3.5 text-content-tertiary group-hover:text-content-primary" />
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-3">
                {loading ? (
                    <div className="space-y-2">
                        {Array.from({ length: 5 }).map((_, i) => (
                            <Skeleton key={i} className="h-12 rounded-xl border border-stroke-subtle" />
                        ))}
                    </div>
                ) : versions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center">
                        <History className="w-7 h-7 text-content-tertiary/50" />
                        <p className="text-xs text-content-tertiary leading-relaxed max-w-[200px]">
                            No versions yet. Versions are captured automatically before the AI edits your workflow, or save a checkpoint anytime.
                        </p>
                    </div>
                ) : (
                    <>
                        {checkpoints.length > 0 && (
                            <div className="space-y-1.5">
                                <p className="px-1 text-[10px] font-bold uppercase tracking-wider text-content-tertiary">Checkpoints</p>
                                <AnimatePresence initial={false}>
                                    {checkpoints.map((v) => (
                                        <VersionRowItem key={v.id} v={v} isOwner={isOwner} busy={busyId === v.id} onRestore={handleRestore} onDelete={handleDelete} />
                                    ))}
                                </AnimatePresence>
                            </div>
                        )}
                        {autos.length > 0 && (
                            <div className="space-y-1.5">
                                <p className="px-1 text-[10px] font-bold uppercase tracking-wider text-content-tertiary">Auto-saved</p>
                                <AnimatePresence initial={false}>
                                    {autos.map((v) => (
                                        <VersionRowItem key={v.id} v={v} isOwner={isOwner} busy={busyId === v.id} onRestore={handleRestore} onDelete={handleDelete} />
                                    ))}
                                </AnimatePresence>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

function VersionRowItem({
    v, isOwner, busy, onRestore, onDelete,
}: {
    v: WorkflowVersion;
    isOwner: boolean;
    busy: boolean;
    onRestore: (v: WorkflowVersion) => void;
    onDelete: (v: WorkflowVersion) => void;
}) {
    const isCheckpoint = v.kind === 'checkpoint';
    return (
        <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="group flex items-center gap-2 px-2 py-2 rounded-xl border border-stroke-subtle bg-surface-primary hover:border-accent-primary/40 transition-colors"
        >
            {isCheckpoint
                ? <Star className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                : <Clock className="w-3.5 h-3.5 text-content-tertiary shrink-0" />}
            <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-content-secondary truncate">
                    {isCheckpoint ? (v.label || 'Checkpoint') : 'Auto-saved'}
                </p>
                <p className="text-[10px] text-content-tertiary">{relativeTime(v.created_at)}</p>
            </div>
            {isOwner && (
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                        onClick={() => onRestore(v)}
                        disabled={busy}
                        className="p-1 rounded-md hover:bg-white/10 text-content-tertiary hover:text-content-primary disabled:opacity-40"
                        title="Restore this version"
                    >
                        <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                    {isCheckpoint && (
                        <button
                            onClick={() => onDelete(v)}
                            disabled={busy}
                            className="p-1 rounded-md hover:bg-white/10 text-content-tertiary hover:text-red-400 disabled:opacity-40"
                            title="Delete checkpoint"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>
            )}
        </motion.div>
    );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors in `components/editor/HistoryPanel.tsx`.

- [ ] **Step 3: Commit**

```bash
git add components/editor/HistoryPanel.tsx
git commit -m "feat(versions): History side panel component"
```

---

## Task 9: Wire the History panel into the workspace

**Files:**
- Modify: `components/layout/WorkspaceLayout.tsx`

- [ ] **Step 1: Add the import and icon**

Add `History` to the lucide import (line 5-8) and import the panel:

```typescript
import {
    MessageSquare, Minimize2, Plus,
    Image as ImageIcon, BookOpen, Users, History
} from 'lucide-react';
```

```typescript
import { HistoryPanel } from '@/components/editor/HistoryPanel';
```

- [ ] **Step 2: Extend the `ActivePanel` type** (line 34)

```typescript
type ActivePanel = 'node-library' | 'assets' | 'characters' | 'templates' | 'history' | null;
```

- [ ] **Step 3: Mark `history` as a mounted (persistent) panel** (line 77)

Replace:

```typescript
        if (panel === 'assets' || panel === 'characters') {
```

with:

```typescript
        if (panel === 'assets' || panel === 'characters' || panel === 'history') {
```

- [ ] **Step 4: Add the derived open flag** (after line 86)

```typescript
    const isHistoryOpen = activePanel === 'history';
```

And include it in `hasLeftPanel` (line 88):

```typescript
    const hasLeftPanel = isNodeLibraryOpen || isAssetsOpen || isCharactersOpen || isHistoryOpen;
```

- [ ] **Step 5: Render the panel** (after the Characters Panel block, ~line 254)

```typescript
            {/* ── LAYER 3b'' · History Panel ─────────────────────────────────── */}
            {isCanvasMode && mountedPanels.has('history') && (
                <motion.div
                    key="history-panel"
                    className="marquee-passthrough absolute left-4 bottom-4 z-[55]"
                    style={{ width: `${PANEL_W}px`, top: `${TOP_BAR_OFFSET}px` }}
                    initial={{ opacity: 0, x: -24 }}
                    animate={isHistoryOpen
                        ? { opacity: 1, x: 0, pointerEvents: 'auto' as any }
                        : { opacity: 0, x: -24, pointerEvents: 'none' as any }}
                    transition={{ duration: 0.18, ease: 'easeOut' }}
                >
                    <HistoryPanel onClose={() => setActivePanel(null)} />
                </motion.div>
            )}
```

- [ ] **Step 6: Add the tool-rail button** (in `ToolRail`'s `buttons` array, ~line 346)

Add after the `templates` entry:

```typescript
        { id: 'history', label: 'History', icon: History, onClick: () => onPanelToggle('history') },
```

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors in `components/layout/WorkspaceLayout.tsx`.

- [ ] **Step 8: Commit**

```bash
git add components/layout/WorkspaceLayout.tsx
git commit -m "feat(versions): wire History panel into workspace + tool rail"
```

---

## Task 10: Ad-hoc DB verification script

**Files:**
- Create: `scripts/verify-workflow-versions.js`

- [ ] **Step 1: Write the script**

Mirrors the repo's `scripts/*.js` convention (runs against live Supabase using service-role env). It exercises checkpoint → list → restore (safety snapshot) → prune.

```javascript
// Usage: node scripts/verify-workflow-versions.js <canvasId>
// Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env (.env.local).
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const canvasId = process.argv[2];
if (!canvasId) { console.error('Pass a canvasId'); process.exit(1); }

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function stableStringify(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

(async () => {
  const { data: session } = await supabase.from('sessions').select('canvas_state, user_id').eq('id', canvasId).single();
  if (!session) { console.error('canvas not found'); process.exit(1); }
  const state = session.canvas_state || { nodes: [], edges: [] };

  // 1. Insert a checkpoint.
  const { data: cp, error: cpErr } = await supabase.from('workflow_versions').insert({
    canvas_id: canvasId, kind: 'checkpoint', label: 'verify-script',
    canvas_state: state, content_hash: stableStringify(state), created_by: session.user_id,
  }).select('id').single();
  if (cpErr) { console.error('checkpoint insert failed', cpErr); process.exit(1); }
  console.log('✅ checkpoint created', cp.id);

  // 2. List.
  const { data: list } = await supabase.from('workflow_versions')
    .select('id, kind, label, created_at').eq('canvas_id', canvasId).order('created_at', { ascending: false });
  console.log(`✅ list returned ${list.length} versions`);

  // 3. Insert 22 autos, then verify prune-to-20 leaves 20 autos.
  for (let i = 0; i < 22; i++) {
    await supabase.from('workflow_versions').insert({
      canvas_id: canvasId, kind: 'auto', label: null,
      canvas_state: { nodes: [{ id: 'n' + i }], edges: [] },
      content_hash: 'auto-' + i, created_by: null,
    });
  }
  const { data: autos } = await supabase.from('workflow_versions')
    .select('id, created_at').eq('canvas_id', canvasId).eq('kind', 'auto').order('created_at', { ascending: false });
  const stale = autos.slice(20).map(r => r.id);
  if (stale.length) await supabase.from('workflow_versions').delete().in('id', stale);
  const { count } = await supabase.from('workflow_versions')
    .select('id', { count: 'exact', head: true }).eq('canvas_id', canvasId).eq('kind', 'auto');
  console.log(`✅ autos after prune: ${count} (expected 20)`);

  // 4. Cleanup test rows.
  await supabase.from('workflow_versions').delete().eq('canvas_id', canvasId).or('label.eq.verify-script,kind.eq.auto');
  console.log('✅ cleanup done');
})();
```

- [ ] **Step 2: Run it against a real canvas**

Run: `node scripts/verify-workflow-versions.js <a-real-session-id-you-own>`
Expected output (order): `✅ checkpoint created …`, `✅ list returned N versions`, `✅ autos after prune: 20 (expected 20)`, `✅ cleanup done`.

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-workflow-versions.js
git commit -m "chore(versions): ad-hoc DB verification script"
```

---

## Task 11: End-to-end manual verification

- [ ] **Step 1: Full type-check + dev server**

Run: `npx tsc --noEmit` (expect clean), then `npm run dev`.

- [ ] **Step 2: Auto-version on AI edit**

In a session, ask the chat brain to add/modify a node. After it applies, open the **History** panel (tool rail). Expected: an "Auto-saved" row appears under "Auto-saved" with a recent timestamp.

- [ ] **Step 3: Checkpoint**

Click **+** in the History panel header, name it. Expected: a starred row appears under "Checkpoints".

- [ ] **Step 4: Restore**

Make a visible change (e.g. move/add a node, let autosave settle). Restore the checkpoint. Expected: canvas reverts to the checkpoint's graph; a new "Auto-saved" (safety) row now exists capturing the pre-restore state; undo stack is cleared (Ctrl-Z does not jump back into the divergent pre-restore timeline).

- [ ] **Step 5: Delete checkpoint**

Hover a checkpoint → trash. Expected: it disappears; auto-versions are unaffected.

- [ ] **Step 6: Non-owner (optional, if a shared canvas is available)**

As an editor/viewer, open History. Expected: list is visible; no **+**, **Restore**, or **Delete** controls.

- [ ] **Step 7: Commit any fixups**

```bash
git add -A && git commit -m "fix(versions): manual-verification fixups"
```

---

## Self-review notes

- **Spec coverage:** data model (T1), keying on canvas_id (T1/T2), RLS member-read + owner-write (T1), AI-only auto capture with dedup + failure isolation (T4), checkpoint creation (T3/T8), overwrite-with-safety-snapshot restore (T2/T3/T7), keep-last-20 prune (T2), API surface (T3), client API (T5), History panel matching the mounted side-panel pattern (T8/T9), owner-only UI gating (T8), collab propagation via the existing canvas_state write path (T7). All spec sections map to a task.
- **Out of scope (per spec):** no chat/`node_results` snapshotting; no manual-edit auto-versioning; no time-windowed retention; no diff/branch. Not implemented — correct.
- **Type consistency:** `VersionRow` (db layer) and `WorkflowVersion` (client) share field names; `createAutoVersion`/`pruneAutoVersions`/`restoreVersion`/`createCheckpoint`/`deleteVersion`/`getVersion`/`listVersions` are referenced with the exact signatures defined in T2; `clearHistory` added to both the `WorkflowSlice` interface (T6) and implementation (T6); `activeCanvasId`/`collabRole`/`setCurrentWorkflow` are existing store fields.
- **Known integration caveat (flagged in T4):** confirm the in-scope variable names (`previousWorkflow`, `baseWorkflow`, `auth`) by reading the surrounding lines before editing — the file evolves and line numbers are approximate.
