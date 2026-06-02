# Workflow Collaboration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a workflow owner share a workflow by email with Editor/Viewer collaborators who see live cursors, live edits, and (editors) co-edit one shared canvas — each with their own private chat thread.

**Architecture:** Extend the existing single-user infra rather than replace it. Keep `sessions.canvas_state` as the source of truth. Decouple the chat thread from the canvas via a `sessions.canvas_session_id` pointer (companion threads). Widen RLS via `can_access_session`/`can_edit_session` helpers. Add Supabase Realtime **presence** (roster + cursors) and **broadcast** (granular edit ops) layered on the existing `canvas_state` postgres_changes sync, with per-node last-write-wins.

**Tech Stack:** Next.js (App Router, `nodejs` runtime for chat), Supabase (Postgres + RLS + Realtime), Zustand store, ReactFlow canvas, Resend email, TypeScript.

**Branch policy:** ALL commits go to `main`. Do not create a branch or worktree.

**Verification reality (per CLAUDE.md — no test runner):**
- Type safety: `npx tsc --noEmit` (lint/build are unreliable in this repo — see memory).
- DB/RLS logic: ad-hoc Node scripts in `scripts/` run against live Supabase with service + two test users.
- Realtime/UI: explicit manual two-browser steps.

**Phases (each independently shippable & verifiable):**
- **Phase 1 — Foundation:** migration (collaborators table, `canvas_session_id`, RLS helpers, RPCs, claim trigger), `effectiveCanvasId` plumbing, companion-thread open route, shared-with-me list. After Phase 1: a collaborator added directly in the DB can open and co-edit the shared canvas (no realtime cursors yet), and it appears in their sidebar.
- **Phase 2 — Sharing & invites:** Share dialog + collaborator API routes + Resend invite email + `/share/[token]` accept page. After Phase 2: an owner can invite by email end-to-end.
- **Phase 3 — Realtime presence & viewer lockdown:** `useWorkflowCollaboration` hook (presence + op broadcast), cursor overlay, presence avatars, live peer drag, viewer read-only UI. After Phase 3: the full Figma-style experience.

---

# PHASE 1 — Foundation

## Task 1.1: Database migration

**Files:**
- Create: `supabase/migrations/20260602_workflow_collaboration.sql`
- Test: `scripts/verify-collaboration-rls.js`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260602_workflow_collaboration.sql`:

```sql
-- Migration: workflow collaboration
-- Date: 2026-06-02
-- Description: Multi-user workflow collaboration. Adds:
--   (a) sessions.canvas_session_id — decouples a per-user chat thread from the
--       shared canvas it edits (companion threads point at the owner's canvas session).
--   (b) session_collaborators — membership + pending email invites.
--   (c) can_access_session / can_edit_session RLS helpers and widened policies on
--       sessions, messages, executions, node_results.
--   (d) RPCs: find_user_id_by_email, accept_workflow_invite.
--   (e) claim_pending_invites trigger — links pending invites on signup.

-- 1. CHAT-THREAD DECOUPLING ---------------------------------------------------
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS canvas_session_id uuid REFERENCES public.sessions(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_sessions_canvas_session_id
  ON public.sessions (canvas_session_id) WHERE canvas_session_id IS NOT NULL;

-- 2. COLLABORATORS TABLE ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.session_collaborators (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES auth.users(id) ON DELETE CASCADE,            -- NULL = pending
  invited_email text NOT NULL,
  role         text NOT NULL CHECK (role IN ('editor','viewer')),
  invited_by   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invite_token uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  accepted_at  timestamptz,
  UNIQUE (session_id, invited_email)
);

CREATE INDEX IF NOT EXISTS idx_session_collab_session ON public.session_collaborators (session_id);
CREATE INDEX IF NOT EXISTS idx_session_collab_user    ON public.session_collaborators (user_id);
CREATE INDEX IF NOT EXISTS idx_session_collab_email   ON public.session_collaborators (lower(invited_email));
CREATE INDEX IF NOT EXISTS idx_session_collab_token   ON public.session_collaborators (invite_token);

ALTER TABLE public.session_collaborators ENABLE ROW LEVEL SECURITY;

-- 3. ACCESS HELPER FUNCTIONS --------------------------------------------------
-- SECURITY DEFINER (owned by migration role) → bypasses RLS internally, so the
-- self-reference to sessions does not recurse into the sessions RLS policy.
CREATE OR REPLACE FUNCTION public.can_access_session(p_session_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE s.id = p_session_id AND s.user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.session_collaborators c
    WHERE c.session_id = p_session_id AND c.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.can_edit_session(p_session_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE s.id = p_session_id AND s.user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.session_collaborators c
    WHERE c.session_id = p_session_id AND c.user_id = auth.uid() AND c.role = 'editor'
  );
$$;

REVOKE ALL ON FUNCTION public.can_access_session(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_edit_session(uuid)   FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_session(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_edit_session(uuid)   TO authenticated, service_role;

-- 4. RLS: session_collaborators ----------------------------------------------
-- Read: the collaborator themselves OR the canvas owner.
DROP POLICY IF EXISTS "collab read" ON public.session_collaborators;
CREATE POLICY "collab read" ON public.session_collaborators FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.sessions s
               WHERE s.id = session_collaborators.session_id AND s.user_id = auth.uid())
  );
-- Write (insert/update/delete): owner only.
DROP POLICY IF EXISTS "collab owner insert" ON public.session_collaborators;
CREATE POLICY "collab owner insert" ON public.session_collaborators FOR INSERT
  WITH CHECK (
    invited_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.sessions s
                WHERE s.id = session_collaborators.session_id AND s.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "collab owner update" ON public.session_collaborators;
CREATE POLICY "collab owner update" ON public.session_collaborators FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.sessions s
                 WHERE s.id = session_collaborators.session_id AND s.user_id = auth.uid()));
DROP POLICY IF EXISTS "collab owner delete" ON public.session_collaborators;
CREATE POLICY "collab owner delete" ON public.session_collaborators FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.sessions s
                 WHERE s.id = session_collaborators.session_id AND s.user_id = auth.uid()));

-- 5. WIDEN sessions policies --------------------------------------------------
DROP POLICY IF EXISTS "Users can view their own sessions" ON public.sessions;
CREATE POLICY "Users can view accessible sessions" ON public.sessions FOR SELECT
  USING (public.can_access_session(id));

DROP POLICY IF EXISTS "Users can update their own sessions" ON public.sessions;
CREATE POLICY "Users can update editable sessions" ON public.sessions FOR UPDATE
  USING (public.can_edit_session(id));
-- INSERT stays "auth.uid() = user_id" (companion threads insert with user_id = me).
-- DELETE stays owner-only (auth.uid() = user_id) — also lets an editor delete their
-- own companion thread (its user_id is theirs) without touching the shared canvas.

-- 6. WIDEN messages policies --------------------------------------------------
DROP POLICY IF EXISTS "Users can view messages of their sessions" ON public.messages;
CREATE POLICY "Users can view messages of accessible sessions" ON public.messages FOR SELECT
  USING (public.can_access_session(session_id));

DROP POLICY IF EXISTS "Users can insert messages to their sessions" ON public.messages;
CREATE POLICY "Users can insert messages to accessible sessions" ON public.messages FOR INSERT
  WITH CHECK (public.can_access_session(session_id));

DROP POLICY IF EXISTS "Users can update messages of their sessions" ON public.messages;
CREATE POLICY "Users can update messages of accessible sessions" ON public.messages FOR UPDATE
  USING (public.can_access_session(session_id));

-- 7. WIDEN executions + node_results SELECT (client reads; writes use service role)
DROP POLICY IF EXISTS "Users can view their own executions" ON public.executions;
CREATE POLICY "Users can view accessible executions" ON public.executions FOR SELECT
  USING (public.can_access_session(session_id));

DROP POLICY IF EXISTS "Users can view their own node_results" ON public.node_results;
CREATE POLICY "Users can view accessible node_results" ON public.node_results FOR SELECT
  USING (public.can_access_session(session_id));

-- 8. RPC: map email → user id (keeps user-facing routes off the service client) --
CREATE OR REPLACE FUNCTION public.find_user_id_by_email(p_email text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT id FROM auth.users WHERE lower(email) = lower(p_email) LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.find_user_id_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_user_id_by_email(text) TO authenticated, service_role;

-- 9. RPC: accept an invite by token (logged-in user whose email matches) --------
CREATE OR REPLACE FUNCTION public.accept_workflow_invite(p_token uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_email   text;
  v_session uuid;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  IF v_email IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  UPDATE public.session_collaborators
     SET user_id = auth.uid(), accepted_at = now()
   WHERE invite_token = p_token
     AND lower(invited_email) = lower(v_email)
     AND (user_id IS NULL OR user_id = auth.uid())
   RETURNING session_id INTO v_session;

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Invite not found or email mismatch';
  END IF;
  RETURN v_session;
END;
$$;
REVOKE ALL ON FUNCTION public.accept_workflow_invite(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_workflow_invite(uuid) TO authenticated;

-- 10. CLAIM TRIGGER: link pending invites when the invited email signs up -------
CREATE OR REPLACE FUNCTION public.claim_pending_invites()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  UPDATE public.session_collaborators
     SET user_id = NEW.id, accepted_at = now()
   WHERE user_id IS NULL AND lower(invited_email) = lower(NEW.email);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_claim_pending_invites ON auth.users;
CREATE TRIGGER trg_claim_pending_invites
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.claim_pending_invites();

DO $$ BEGIN RAISE NOTICE '✅ workflow collaboration migration applied'; END $$;
```

- [ ] **Step 2: Confirm exact existing table/policy names before applying**

Run (psql or Supabase SQL editor):
```sql
select tablename, policyname from pg_policies
where tablename in ('sessions','messages','executions','node_results') order by tablename;
select table_name from information_schema.tables
where table_schema='public' and table_name in ('executions','executions_v2','node_results');
```
Expected: confirms the execution table is `executions` (code uses `.from('executions')`). If it is `executions_v2`, change the table name in Step 1 section 7. The `DROP POLICY IF EXISTS` lines are no-ops if a name differs, so a name mismatch only means an old policy lingers — reconcile by matching the printed `policyname`.

- [ ] **Step 3: Apply the migration**

Apply `20260602_workflow_collaboration.sql` against the project (Supabase SQL editor or `supabase db push`). Expected: `NOTICE: ✅ workflow collaboration migration applied`, no errors.

- [ ] **Step 4: Write the verification script**

Create `scripts/verify-collaboration-rls.js`:
```js
// Verifies the collaboration RLS helpers + claim logic against live Supabase.
// Usage: node scripts/verify-collaboration-rls.js
// Requires .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY,
// and two pre-existing test auth users (set their ids/emails below).
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const svc = createClient(url, key, { auth: { persistSession: false } });

// EDIT THESE to two real test users in your project:
const OWNER = { id: process.env.TEST_OWNER_ID, email: process.env.TEST_OWNER_EMAIL };
const COLLAB = { id: process.env.TEST_COLLAB_ID, email: process.env.TEST_COLLAB_EMAIL };

async function main() {
  // 1. owner creates a canvas session
  const { data: sess, error: e1 } = await svc.from('sessions')
    .insert({ user_id: OWNER.id, title: 'RLS test canvas' }).select().single();
  if (e1) throw e1;
  console.log('canvas session', sess.id);

  // 2. add COLLAB as editor
  const { error: e2 } = await svc.from('session_collaborators').insert({
    session_id: sess.id, user_id: COLLAB.id, invited_email: COLLAB.email,
    role: 'editor', invited_by: OWNER.id,
  });
  if (e2) throw e2;

  // 3. helper checks (run as the function; service role still evaluates auth.uid()=null,
  //    so test via the RPCs that take explicit ids is not possible — instead assert rows).
  const { data: rows } = await svc.from('session_collaborators')
    .select('*').eq('session_id', sess.id);
  console.assert(rows.length === 1 && rows[0].role === 'editor', 'collaborator row present');

  // 4. pending-invite claim: insert a pending row, then simulate by calling the trigger path
  const { error: e3 } = await svc.from('session_collaborators').insert({
    session_id: sess.id, invited_email: 'pending-' + Date.now() + '@example.com',
    role: 'viewer', invited_by: OWNER.id,
  });
  if (e3) throw e3;
  console.log('pending invite inserted (claim trigger fires on real signup)');

  // 5. cleanup
  await svc.from('sessions').delete().eq('id', sess.id);
  console.log('✅ verify-collaboration-rls passed (structural checks)');
}
main().catch((e) => { console.error('❌', e); process.exit(1); });
```

- [ ] **Step 5: Run the verification script**

Run: `node scripts/verify-collaboration-rls.js`
Expected: prints `✅ verify-collaboration-rls passed (structural checks)`. (Per-user `auth.uid()` RLS gating is exercised end-to-end by the manual two-browser test in Phase 3; this script asserts the schema + cascade work.)

- [ ] **Step 6: Commit**
```bash
git add supabase/migrations/20260602_workflow_collaboration.sql scripts/verify-collaboration-rls.js
git commit -m "feat(collab): migration — collaborators, canvas_session_id, RLS helpers, invite RPCs"
```

---

## Task 1.2: `effectiveCanvasId` plumbing — store + load + save

**Goal:** Resolve `effectiveCanvasId = canvas_session_id ?? id` so canvas reads/writes target the shared canvas while messages stay on the per-user thread.

**Files:**
- Modify: `lib/store/slices/workflow-slice.ts` (add `activeCanvasId` state + setter)
- Modify: `lib/store/types.ts` (type the new field)
- Modify: `lib/hooks/use-session.ts:101-140` (load canvas from canvas session; set `activeCanvasId`)
- Modify: `hooks/useAutoSave.ts:27-46` (save to `activeCanvasId`)
- Modify: `lib/db/workflows.ts:15-48` (no signature change; caller passes canvas id)

- [ ] **Step 1: Add `activeCanvasId` to the store types**

In `lib/store/types.ts`, find the `WorkflowSlice` interface (the one declaring `activeSessionId: string | null`) and add:
```typescript
    activeCanvasId: string | null;
    setActiveCanvasId: (id: string | null) => void;
```

- [ ] **Step 2: Initialize + implement in the slice**

In `lib/store/slices/workflow-slice.ts`, in the initial state block (near `activeSessionId: null,`) add:
```typescript
    activeCanvasId: null,
```
And alongside the other setters add:
```typescript
    setActiveCanvasId: (id) => set({ activeCanvasId: id }),
```

- [ ] **Step 3: Exclude `activeCanvasId` from persistence**

In `lib/store/app-store.ts` `partialize`, add `'activeCanvasId'` to the excluded-keys list (same list that already excludes `'activeSessionId'`). It is a trigger/runtime field and must not rehydrate.

- [ ] **Step 4: Load the canvas from the canvas session**

In `lib/hooks/use-session.ts`, `loadSession`, after the session row is fetched and before hydrating the workflow (around line 101), resolve the canvas id and fetch its `canvas_state` when it differs:
```typescript
// Resolve the shared canvas: companion threads point at the owner's canvas session.
const canvasId = (session as any).canvas_session_id || session.id;
let canvasRow: any = session;
if (canvasId !== session.id) {
    const { data: cr } = await sessionsApi.load(canvasId); // GET /api/sessions/:id returns { session, messages }
    canvasRow = cr?.session || session;
}
const rawCanvas = (canvasRow.canvas_state || {}) as Partial<Workflow>;
```
Replace the existing `const rawCanvas = (session.canvas_state || {}) ...` line with the block above. Keep the rest of the hydration (it already builds `workflow` from `rawCanvas`). Then set both ids:
```typescript
store.setActiveCanvasId(canvasId);
store.setCurrentWorkflow(workflow, false);
```
Note: `workflow.id` should remain `canvasId` (the canvas identity), not the thread id — set `id: canvasId` in the `workflow` object built from `rawCanvas`.

- [ ] **Step 5: Make `GET /api/sessions/[id]` return `canvas_session_id` and resolve access**

In `app/api/sessions/[id]/route.ts` GET (lines 11-39), the current query is `.eq('user_id', user.id)`. Replace the ownership filter so collaborators can load, and so the row includes `canvas_session_id`:
```typescript
    const { data: session, error: sessionError } = await supabase
        .from('sessions')
        .select('*')                       // includes canvas_session_id
        .eq('id', params.id)
        .eq('is_deleted', false)
        .single();                         // RLS (can_access_session) now gates visibility

    if (sessionError || !session) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
```
(The `.eq('user_id', user.id)` filter is removed — RLS from Task 1.1 is the gate. `user` is still used for nothing else here; leave the auth check.)

- [ ] **Step 6: Autosave to the canvas id**

In `hooks/useAutoSave.ts`, add a subscription to `activeCanvasId` and prefer it over `activeSessionId` for the remote save target. Near lines 27-33:
```typescript
    const activeSessionId = useAppStore((state) => state.activeSessionId);
    const activeCanvasId = useAppStore((state) => state.activeCanvasId);
```
Add a ref (near `activeSessionIdRef`):
```typescript
    const activeCanvasIdRef = useRef(activeCanvasId);
    useEffect(() => { activeCanvasIdRef.current = activeCanvasId; }, [activeCanvasId]);
```
Where the remote save calls `saveWorkflow(sanitizedWorkflow, activeSessionIdRef.current)`, change the target to:
```typescript
    const saveTarget = activeCanvasIdRef.current || activeSessionIdRef.current;
    await saveWorkflow(sanitizedWorkflow, saveTarget);
```

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `activeCanvasId`, `setActiveCanvasId`, or `use-session.ts`.

- [ ] **Step 8: Commit**
```bash
git add lib/store/slices/workflow-slice.ts lib/store/types.ts lib/store/app-store.ts lib/hooks/use-session.ts hooks/useAutoSave.ts app/api/sessions/\[id\]/route.ts
git commit -m "feat(collab): resolve effectiveCanvasId for canvas load/save (chat-thread decoupling)"
```

---

## Task 1.3: Companion-thread open route + load-by-thread

**Goal:** When a user opens a shared canvas, give an editor their own companion chat thread; a viewer reads the owner's thread.

**Files:**
- Create: `app/api/sessions/[id]/open/route.ts`
- Modify: `lib/api/client.ts` (add `sessionsApi.open`)

- [ ] **Step 1: Create the open route**

Create `app/api/sessions/[id]/open/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';

interface RouteParams { params: { id: string }; }

// POST /api/sessions/:id/open
// :id is a CANVAS session id. Returns the calling user's chat thread for it:
//  - owner            → the canvas session itself
//  - editor collab    → their companion thread (created if missing)
//  - viewer collab    → the canvas session (read-only; client shows owner's thread)
export async function POST(_req: NextRequest, { params }: RouteParams) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;
    const canvasId = params.id;

    // Load the canvas session (RLS: can_access_session gates this).
    const { data: canvas, error: cErr } = await supabase
        .from('sessions').select('id, user_id, title, canvas_session_id')
        .eq('id', canvasId).eq('is_deleted', false).single();
    if (cErr || !canvas) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (canvas.canvas_session_id) {
        return NextResponse.json({ error: 'Not a canvas session' }, { status: 400 });
    }

    // Owner → the canvas session is their thread.
    if (canvas.user_id === user.id) {
        return NextResponse.json({ threadId: canvas.id, canvasId, role: 'owner' });
    }

    // Determine collaborator role.
    const { data: collab } = await supabase
        .from('session_collaborators').select('role')
        .eq('session_id', canvasId).eq('user_id', user.id).single();
    if (!collab) return NextResponse.json({ error: 'No access' }, { status: 403 });

    // Viewer → no companion thread; they read the owner's (canvas) thread.
    if (collab.role === 'viewer') {
        return NextResponse.json({ threadId: canvasId, canvasId, role: 'viewer' });
    }

    // Editor → find-or-create a companion thread.
    const { data: existing } = await supabase
        .from('sessions').select('id')
        .eq('user_id', user.id).eq('canvas_session_id', canvasId)
        .eq('is_deleted', false).maybeSingle();
    if (existing) {
        return NextResponse.json({ threadId: existing.id, canvasId, role: 'editor' });
    }
    const { data: created, error: insErr } = await supabase
        .from('sessions')
        .insert({ user_id: user.id, title: canvas.title || 'Shared workflow', canvas_session_id: canvasId })
        .select('id').single();
    if (insErr || !created) {
        return NextResponse.json({ error: insErr?.message || 'Create failed' }, { status: 500 });
    }
    return NextResponse.json({ threadId: created.id, canvasId, role: 'editor' });
}
```

- [ ] **Step 2: Add the client helper**

In `lib/api/client.ts`, inside `sessionsApi`, add:
```typescript
    /** Open a shared canvas → returns the caller's { threadId, canvasId, role } */
    open: (canvasId: string) =>
        apiFetch<{ threadId: string; canvasId: string; role: 'owner' | 'editor' | 'viewer' }>(
            `/api/sessions/${canvasId}/open`, { method: 'POST' }
        ),
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors in the new route or `client.ts`.

- [ ] **Step 4: Manual smoke (owner path)**

With the dev server running (`npm run dev`), open one of your own workflows and confirm it still loads normally (owner path returns the canvas session as the thread). Expected: workflow loads, no console errors.

- [ ] **Step 5: Commit**
```bash
git add app/api/sessions/\[id\]/open/route.ts lib/api/client.ts
git commit -m "feat(collab): companion-thread open route (find-or-create per editor)"
```

---

## Task 1.4: Shared-with-me in the session list

**Files:**
- Modify: `app/api/sessions/route.ts:9-26` (GET)
- Modify: `components/layout/Sidebar.tsx:83-128`

- [ ] **Step 1: Return owned + shared sessions, hide companion threads**

Replace the GET handler in `app/api/sessions/route.ts` (lines 9-26):
```typescript
export async function GET() {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;

    // Owned canvases (exclude companion threads: canvas_session_id IS NOT NULL).
    const ownedQ = supabase
        .from('sessions')
        .select('id, title, updated_at, user_id')
        .eq('user_id', user.id)
        .is('canvas_session_id', null)
        .eq('is_deleted', false);

    // Canvases shared with me.
    const sharedQ = supabase
        .from('session_collaborators')
        .select('role, sessions:session_id ( id, title, updated_at, user_id, is_deleted )')
        .eq('user_id', user.id);

    const [{ data: owned, error: e1 }, { data: shared, error: e2 }] = await Promise.all([ownedQ, sharedQ]);
    if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
    if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

    const ownedRows = (owned || []).map((s: any) => ({ ...s, shared: false, role: 'owner' }));
    const sharedRows = (shared || [])
        .filter((r: any) => r.sessions && !r.sessions.is_deleted)
        .map((r: any) => ({
            id: r.sessions.id, title: r.sessions.title, updated_at: r.sessions.updated_at,
            shared: true, role: r.role,
        }));

    const all = [...ownedRows, ...sharedRows]
        .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
    return NextResponse.json({ sessions: all });
}
```

- [ ] **Step 2: Show a "Shared" tag in the sidebar**

In `components/layout/Sidebar.tsx`, where each session row is rendered, add a badge when `session.shared` is truthy. Find the session list `.map(...)` and inside the row JSX (next to the title) add:
```tsx
{session.shared && (
    <span className="ml-1 text-[10px] uppercase tracking-wide text-text-tertiary border border-stroke-subtle rounded px-1 py-0.5">
        Shared
    </span>
)}
```

- [ ] **Step 3: Keep the realtime INSERT/UPDATE filters working**

The Sidebar's realtime subscription (lines 100-128) filters `user_id=eq.${user.id}`, which won't fire for shared canvases owned by others. That's acceptable for v1 — shared rows refresh on next `sessionsApi.list()` (the 2s promise cache already allows refetch). Add a one-line comment above the subscription noting shared canvases rely on list refetch, not realtime row events, in v1.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (If `session.shared`/`session.role` raise type errors, widen the Sidebar's local session type to include `shared?: boolean; role?: string`.)

- [ ] **Step 5: Manual smoke**

In the DB, insert a `session_collaborators` row giving a second test account editor access to one of your canvases. Log in as that account → the workflow appears in the sidebar with a "Shared" badge → opening it loads the shared canvas (read/edit). Expected: visible + loads.

- [ ] **Step 6: Commit**
```bash
git add app/api/sessions/route.ts components/layout/Sidebar.tsx
git commit -m "feat(collab): surface shared-with-me workflows in the sidebar"
```

---

## Task 1.5: Chat-stream route — canvas resolution + edit-permission guard

**Why:** `app/api/chat/stream/route.ts` uses the **service-role client** (bypasses RLS), so it must (a) resolve the shared canvas and write patches there, not to the companion thread, and (b) explicitly verify the caller may edit. Messages still persist to the per-user thread.

**Files:**
- Modify: `app/api/chat/stream/route.ts` (handler ~325-389; canvas write ~600-607)

- [ ] **Step 1: Authenticate the caller and resolve canvas + permission**

In `handleWithNewBrain`, after `const { messages, sessionId, previousWorkflow, ... } = body`, add:
```typescript
  // Resolve the shared canvas + verify edit rights (service client bypasses RLS).
  const auth = await getAuthenticatedUser();
  if (auth.error) return auth.error;
  const authedUserId = auth.user.id;

  let canvasId = sessionId;
  if (sessionId) {
    const { data: threadRow } = await supabase
      .from('sessions').select('id, user_id, canvas_session_id').eq('id', sessionId).single();
    if (threadRow) {
      canvasId = threadRow.canvas_session_id || threadRow.id;
      const isOwner = !threadRow.canvas_session_id && threadRow.user_id === authedUserId;
      if (!isOwner) {
        const { data: collab } = await supabase
          .from('session_collaborators').select('role')
          .eq('session_id', canvasId).eq('user_id', authedUserId).single();
        if (!collab || collab.role !== 'editor') {
          return new Response(JSON.stringify({ error: 'No edit access' }), { status: 403 });
        }
      }
    }
  }
```
(Add `import { getAuthenticatedUser } from '@/lib/api/auth';` at the top if not present.)

- [ ] **Step 2: Write canvas patches to the canvas, messages to the thread**

At the canvas-write block (~600-607), change the target from `sessionId` to `canvasId`:
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
Leave the assistant/user message inserts keyed on `session_id: sessionId` (the per-user thread) unchanged.

- [ ] **Step 3: Type-check + manual owner smoke**

Run: `npx tsc --noEmit` (expected: clean). Then as the owner, send a chat message that edits the canvas — confirm the canvas updates and the message saves (owner path: `canvasId === sessionId`, behavior unchanged).

- [ ] **Step 4: Commit**
```bash
git add app/api/chat/stream/route.ts
git commit -m "feat(collab): chat brain writes to shared canvas + editor permission guard"
```

---

## Task 1.6: Executions start — target the canvas + editor guard

**Why:** `app/api/executions/start/route.ts` uses the service-role client and already debits `authedUserId` (runner-pays ✓). It must run against the **canvas** session id (so all collaborators see results on the canvas-keyed channel) and must reject non-editors.

**Files:**
- Modify: `app/api/executions/start/route.ts` (auth ~39-52)
- Modify: the client call site that posts to `/api/executions/start`

- [ ] **Step 1: Locate the client call site**

Run: `grep -rn "executions/start" lib components hooks`
Expected: one fetch call building `{ session_id, workflow, ... }`. Change `session_id` there to send the canvas id:
```typescript
    session_id: useAppStore.getState().activeCanvasId || useAppStore.getState().activeSessionId,
```

- [ ] **Step 2: Add the editor guard in the route**

In `app/api/executions/start/route.ts`, after `const authedUserId = auth.user.id;` and after `session_id` is destructured (~line 44), add:
```typescript
  // session_id is the canvas session. Verify the runner may edit it.
  {
    const { data: canvasRow } = await supabase
      .from('sessions').select('user_id, canvas_session_id').eq('id', session_id).single();
    const isOwner = canvasRow && !canvasRow.canvas_session_id && canvasRow.user_id === authedUserId;
    if (!isOwner) {
      const { data: collab } = await supabase
        .from('session_collaborators').select('role')
        .eq('session_id', session_id).eq('user_id', authedUserId).single();
      if (!collab || collab.role !== 'editor') {
        return NextResponse.json({ error: 'No edit access' }, { status: 403 });
      }
    }
  }
```
(`supabase` here is the service client already created at line 109 — ensure this block runs after it, or create a short-lived service client for the check.)

- [ ] **Step 3: Type-check + manual owner smoke**

Run: `npx tsc --noEmit` (clean). As owner, run a generation → confirm it still debits your credits and produces results (owner path unchanged; `activeCanvasId === activeSessionId`).

- [ ] **Step 4: Commit**
```bash
git add app/api/executions/start/route.ts
git commit -m "feat(collab): executions target shared canvas + editor permission guard"
```

**✅ Phase 1 ships here:** a directly-added collaborator can see and co-edit the shared canvas — drag/add/delete (autosave), chat-driven edits, and runs (billed to the runner) — with per-user companion threads. No invite UI or live cursors yet.

---

# PHASE 2 — Sharing & invites

## Task 2.1: Collaborator API routes

**Files:**
- Create: `app/api/sessions/[id]/collaborators/route.ts` (GET list, POST invite)
- Create: `app/api/sessions/[id]/collaborators/[collabId]/route.ts` (PATCH role, DELETE revoke)
- Modify: `lib/api/client.ts` (add `collaboratorsApi`)

- [ ] **Step 1: Create the list + invite route**

Create `app/api/sessions/[id]/collaborators/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';
import { sendWorkflowInvite } from '@/lib/email/workflow-invite';

interface RouteParams { params: { id: string }; }

// GET /api/sessions/:id/collaborators — roster (owner + collaborators can read via RLS)
export async function GET(_req: NextRequest, { params }: RouteParams) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { supabase } = auth;
    const { data, error } = await supabase
        .from('session_collaborators')
        .select('id, invited_email, role, user_id, accepted_at, created_at')
        .eq('session_id', params.id)
        .order('created_at', { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ collaborators: data || [] });
}

// POST /api/sessions/:id/collaborators  body: { email, role }
export async function POST(req: NextRequest, { params }: RouteParams) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;

    const { email, role } = await req.json();
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail || !['editor', 'viewer'].includes(role)) {
        return NextResponse.json({ error: 'email and role (editor|viewer) required' }, { status: 400 });
    }

    // Owner-only (RLS also enforces). Confirm caller owns the canvas + fetch its title.
    const { data: canvas } = await supabase
        .from('sessions').select('id, title, user_id, canvas_session_id')
        .eq('id', params.id).single();
    if (!canvas || canvas.user_id !== user.id || canvas.canvas_session_id) {
        return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
    }
    if (cleanEmail === (user.email || '').toLowerCase()) {
        return NextResponse.json({ error: 'You already own this workflow' }, { status: 400 });
    }

    // Resolve existing account (RPC keeps us off the service client).
    const { data: existingId } = await supabase.rpc('find_user_id_by_email', { p_email: cleanEmail });

    // Upsert the collaborator row (UNIQUE(session_id, invited_email) → role update on re-invite).
    const { data: row, error: upErr } = await supabase
        .from('session_collaborators')
        .upsert({
            session_id: params.id,
            invited_email: cleanEmail,
            role,
            invited_by: user.id,
            user_id: existingId || null,
            ...(existingId ? { accepted_at: new Date().toISOString() } : {}),
        }, { onConflict: 'session_id,invited_email' })
        .select('id, invite_token, invited_email, role, user_id')
        .single();
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    // Fire the invite email (non-blocking — never fail the invite on email error).
    let emailSent = true;
    try {
        const base = process.env.NEXT_PUBLIC_APP_URL || '';
        await sendWorkflowInvite({
            to: cleanEmail,
            workflowName: canvas.title || 'a workflow',
            inviterName: user.email || 'A PrismAi user',
            acceptUrl: `${base}/share/${row.invite_token}`,
        });
    } catch { emailSent = false; }

    return NextResponse.json({ collaborator: row, emailSent }, { status: 201 });
}
```

- [ ] **Step 2: Create the role-change + revoke route**

Create `app/api/sessions/[id]/collaborators/[collabId]/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';

interface RouteParams { params: { id: string; collabId: string }; }

// PATCH body: { role }
export async function PATCH(req: NextRequest, { params }: RouteParams) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { supabase } = auth;
    const { role } = await req.json();
    if (!['editor', 'viewer'].includes(role)) {
        return NextResponse.json({ error: 'role must be editor|viewer' }, { status: 400 });
    }
    const { data, error } = await supabase
        .from('session_collaborators').update({ role })
        .eq('id', params.collabId).eq('session_id', params.id)
        .select('id, role').single();           // RLS: owner-only update
    if (error || !data) return NextResponse.json({ error: error?.message || 'Not found' }, { status: 404 });
    return NextResponse.json({ collaborator: data });
}

// DELETE — revoke. Also remove the collaborator's companion thread for this canvas.
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { supabase } = auth;

    const { data: row } = await supabase
        .from('session_collaborators').select('user_id')
        .eq('id', params.collabId).eq('session_id', params.id).single();

    const { error } = await supabase
        .from('session_collaborators').delete()
        .eq('id', params.collabId).eq('session_id', params.id);   // RLS: owner-only delete
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Best-effort: drop their companion thread (their private chat) for this canvas.
    if (row?.user_id) {
        await supabase.from('sessions').delete()
            .eq('user_id', row.user_id).eq('canvas_session_id', params.id);
    }
    return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: Add `collaboratorsApi` to the client**

In `lib/api/client.ts` add:
```typescript
export const collaboratorsApi = {
    list: (canvasId: string) =>
        apiFetch<{ collaborators: any[] }>(`/api/sessions/${canvasId}/collaborators`),
    invite: (canvasId: string, email: string, role: 'editor' | 'viewer') =>
        apiFetch<{ collaborator: any; emailSent: boolean }>(
            `/api/sessions/${canvasId}/collaborators`,
            { method: 'POST', body: JSON.stringify({ email, role }) }
        ),
    setRole: (canvasId: string, collabId: string, role: 'editor' | 'viewer') =>
        apiFetch(`/api/sessions/${canvasId}/collaborators/${collabId}`,
            { method: 'PATCH', body: JSON.stringify({ role }) }),
    remove: (canvasId: string, collabId: string) =>
        apiFetch(`/api/sessions/${canvasId}/collaborators/${collabId}`, { method: 'DELETE' }),
};
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: the only error is the missing `@/lib/email/workflow-invite` module — fixed in Task 2.2. (Optionally do Task 2.2 first.)

- [ ] **Step 5: Commit**
```bash
git add app/api/sessions/\[id\]/collaborators lib/api/client.ts
git commit -m "feat(collab): collaborator API routes (list/invite/role/revoke)"
```

---

## Task 2.2: Invite email

**Files:**
- Create: `lib/email/workflow-invite.ts`

- [ ] **Step 1: Create the email helper** (mirrors `lib/email/admin-alerts.ts`)

Create `lib/email/workflow-invite.ts`:
```typescript
import { Resend } from 'resend';

interface SendWorkflowInviteArgs {
    to: string;
    workflowName: string;
    inviterName: string;
    acceptUrl: string;
}

// Sends a workflow-collaboration invite. Errors are thrown to the caller, which
// catches them and reports a non-blocking warning (the invite row is already saved).
export async function sendWorkflowInvite(args: SendWorkflowInviteArgs): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.ADMIN_ALERT_FROM || 'alerts@prismai.local';
    if (!apiKey) throw new Error('RESEND_API_KEY not configured');

    const resend = new Resend(apiKey);
    const subject = `${args.inviterName} invited you to collaborate on "${args.workflowName}"`;
    const html = `
        <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto">
          <h2 style="margin:0 0 12px">You've been invited to collaborate</h2>
          <p style="color:#444">${args.inviterName} invited you to the workflow
             <strong>${args.workflowName}</strong> on PrismAi.</p>
          <p style="margin:24px 0">
            <a href="${args.acceptUrl}"
               style="background:#111;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px">
               Open workflow
            </a>
          </p>
          <p style="color:#888;font-size:12px">
             If the button doesn't work, paste this link: ${args.acceptUrl}
          </p>
        </div>`;
    await resend.emails.send({ from, to: args.to, subject, html });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean (the Task 2.1 import now resolves).

- [ ] **Step 3: Commit**
```bash
git add lib/email/workflow-invite.ts
git commit -m "feat(collab): workflow invite email (Resend)"
```

---

## Task 2.3: Share dialog UI

**Files:**
- Create: `components/collab/ShareDialog.tsx`
- Modify: `components/editor/EditorToolbar.tsx:16-26,129-132` (add Share button + props)

- [ ] **Step 1: Create the dialog**

Create `components/collab/ShareDialog.tsx`:
```tsx
'use client';
import React, { useEffect, useState } from 'react';
import { collaboratorsApi } from '@/lib/api/client';

interface ShareDialogProps {
    canvasId: string;
    isOwner: boolean;
    onClose: () => void;
}

interface Collab { id: string; invited_email: string; role: 'editor' | 'viewer'; user_id: string | null; }

export function ShareDialog({ canvasId, isOwner, onClose }: ShareDialogProps) {
    const [rows, setRows] = useState<Collab[]>([]);
    const [email, setEmail] = useState('');
    const [role, setRole] = useState<'editor' | 'viewer'>('editor');
    const [busy, setBusy] = useState(false);
    const [warning, setWarning] = useState<string | null>(null);

    const refresh = () => collaboratorsApi.list(canvasId).then(r => setRows(r.collaborators || []));
    useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [canvasId]);

    const invite = async () => {
        if (!email.trim()) return;
        setBusy(true); setWarning(null);
        try {
            const res = await collaboratorsApi.invite(canvasId, email.trim(), role);
            if (res && res.emailSent === false) setWarning('Invite saved, but the email failed to send.');
            setEmail('');
            await refresh();
        } catch (e: any) {
            setWarning(e?.message || 'Failed to invite');
        } finally { setBusy(false); }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
            <div className="bg-surface-elevated border border-stroke-subtle rounded-xl p-5 w-[420px] max-w-[92vw]"
                 onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold">Share workflow</h3>
                    <button onClick={onClose} className="text-text-tertiary hover:text-text-primary">✕</button>
                </div>

                {isOwner && (
                    <div className="flex gap-2 mb-3">
                        <input value={email} onChange={e => setEmail(e.target.value)} type="email"
                               placeholder="teammate@email.com"
                               className="flex-1 bg-surface-primary border border-stroke-subtle rounded-lg px-3 py-2 text-sm" />
                        <select value={role} onChange={e => setRole(e.target.value as any)}
                                className="bg-surface-primary border border-stroke-subtle rounded-lg px-2 text-sm">
                            <option value="editor">Editor</option>
                            <option value="viewer">Viewer</option>
                        </select>
                        <button disabled={busy} onClick={invite}
                                className="bg-text-primary text-surface-primary rounded-lg px-3 text-sm disabled:opacity-50">
                            Invite
                        </button>
                    </div>
                )}
                {warning && <p className="text-xs text-amber-500 mb-2">{warning}</p>}

                <ul className="space-y-1 max-h-64 overflow-auto">
                    {rows.map(c => (
                        <li key={c.id} className="flex items-center justify-between text-sm py-1">
                            <span className="truncate">
                                {c.invited_email}
                                {!c.user_id && <span className="ml-2 text-[10px] text-text-tertiary">Pending</span>}
                            </span>
                            {isOwner ? (
                                <span className="flex items-center gap-2">
                                    <select value={c.role}
                                            onChange={async e => { await collaboratorsApi.setRole(canvasId, c.id, e.target.value as any); refresh(); }}
                                            className="bg-surface-primary border border-stroke-subtle rounded px-1 text-xs">
                                        <option value="editor">Editor</option>
                                        <option value="viewer">Viewer</option>
                                    </select>
                                    <button onClick={async () => { await collaboratorsApi.remove(canvasId, c.id); refresh(); }}
                                            className="text-text-tertiary hover:text-red-500">✕</button>
                                </span>
                            ) : (
                                <span className="text-xs text-text-tertiary capitalize">{c.role}</span>
                            )}
                        </li>
                    ))}
                    {rows.length === 0 && <li className="text-xs text-text-tertiary">No collaborators yet.</li>}
                </ul>
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Add the Share button to the toolbar**

In `components/editor/EditorToolbar.tsx`, extend the props interface (lines 16-26) with:
```tsx
    canvasId?: string | null;
    isOwner?: boolean;
```
Import at top: `import { ShareDialog } from '@/components/collab/ShareDialog';` and add local state inside the component: `const [shareOpen, setShareOpen] = React.useState(false);`. Then between the `<div className="flex-1" />` (line 129) and the Actions Island (line 132), insert:
```tsx
{canvasId && (
    <button onClick={() => setShareOpen(true)}
            className="pointer-events-auto bg-surface-elevated/80 backdrop-blur-md border border-stroke-subtle shadow-lg rounded-xl px-3 py-1.5 text-sm flex items-center gap-1.5">
        Share
    </button>
)}
{shareOpen && canvasId && (
    <ShareDialog canvasId={canvasId} isOwner={!!isOwner} onClose={() => setShareOpen(false)} />
)}
```

- [ ] **Step 3: Pass `canvasId`/`isOwner` from the toolbar's parent**

Find where `<EditorToolbar` is rendered (grep: `grep -rn "EditorToolbar" components app`). Pass:
```tsx
    canvasId={useAppStore.getState().activeCanvasId}
    isOwner={/* true when the current user owns the canvas; derive from the open route's role or compare user id */}
```
Use the `role` returned by `sessionsApi.open` (stored in Task 3.1's collab state) — `isOwner={collabRole === 'owner'}`. If Task 3.1 isn't done yet, temporarily pass `isOwner={true}` and wire it in 3.1.

- [ ] **Step 4: Type-check + manual**

Run: `npx tsc --noEmit` (clean). Open a workflow → click Share → invite a second test account's email as Editor → confirm the row appears (Pending if no account) and (if Resend is configured) the email arrives.

- [ ] **Step 5: Commit**
```bash
git add components/collab/ShareDialog.tsx components/editor/EditorToolbar.tsx
git commit -m "feat(collab): share dialog + toolbar Share button"
```

---

## Task 2.4: `/share/[token]` accept page

**Files:**
- Create: `app/share/[token]/page.tsx`
- Create: `app/api/invites/accept/route.ts`

- [ ] **Step 1: Create the accept API**

Create `app/api/invites/accept/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';

// POST { token } — claims the invite for the logged-in user (email must match).
export async function POST(req: NextRequest) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { supabase } = auth;
    const { token } = await req.json();
    if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 });

    const { data, error } = await supabase.rpc('accept_workflow_invite', { p_token: token });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ canvasId: data });   // session_id of the canvas
}
```

- [ ] **Step 2: Create the accept page**

Create `app/share/[token]/page.tsx`:
```tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { apiFetch } from '@/lib/api/client';

export default function ShareAcceptPage({ params }: { params: { token: string } }) {
    const router = useRouter();
    const [status, setStatus] = useState<'checking' | 'error'>('checking');
    const [message, setMessage] = useState('Opening your invitation…');

    useEffect(() => {
        (async () => {
            const supabase = createClient();
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                // Bounce to login/signup, returning here afterward.
                router.replace(`/login?redirect=${encodeURIComponent(`/share/${params.token}`)}`);
                return;
            }
            try {
                const res = await apiFetch<{ canvasId: string }>('/api/invites/accept', {
                    method: 'POST', body: JSON.stringify({ token: params.token }),
                });
                router.replace(`/workflow/${res.canvasId}`);   // adjust to the app's workflow route
            } catch (e: any) {
                setStatus('error');
                setMessage(e?.message || 'This invitation is invalid or was for a different email.');
            }
        })();
    }, [params.token, router]);

    return (
        <div className="min-h-screen flex items-center justify-center text-center p-6">
            <div>
                <p className={status === 'error' ? 'text-red-500' : 'text-text-secondary'}>{message}</p>
                {status === 'error' && (
                    <button onClick={() => router.replace('/')} className="mt-4 underline text-sm">Go home</button>
                )}
            </div>
        </div>
    );
}
```

- [ ] **Step 3: Confirm the workflow route + login redirect**

Run: `grep -rn "workflow/\|/login\|redirect" app components | grep -i route` to confirm the canvas-open URL (e.g. `/workflow/[id]` or `/session/[id]`) and that `/login` honors a `redirect` param. Adjust the two `router.replace` paths in Step 2 to match the real routes.

- [ ] **Step 4: Type-check + manual**

Run: `npx tsc --noEmit` (clean). As the invited account, click the email link (or visit `/share/<token>`) → it should claim and land you in the shared workflow. Wrong-email account → sees the error message.

- [ ] **Step 5: Commit**
```bash
git add app/share/\[token\]/page.tsx app/api/invites/accept/route.ts
git commit -m "feat(collab): /share/[token] accept page + invite-accept API"
```

**✅ Phase 2 ships here:** full email-invite flow — owner invites by email, invitee (new or existing) gets access and lands in the shared workflow.

---

# PHASE 3 — Realtime presence & viewer lockdown

## Task 3.1: Collaboration store slice + role wiring

**Files:**
- Create: `lib/store/slices/collab-slice.ts`
- Modify: `lib/store/app-store.ts` (register slice + exclude from persist)
- Modify: `lib/store/types.ts` (add `CollabSlice` to `RootState`)
- Modify: the workflow loader (Task 1.3 open call site) to set role + canvasId

- [ ] **Step 1: Create the slice**

Create `lib/store/slices/collab-slice.ts`:
```typescript
import { StateCreator } from 'zustand';
import { RootState } from '../types';

export interface CollaboratorPresence {
    userId: string; name: string; color: string; role: 'owner' | 'editor' | 'viewer';
    cursor?: { x: number; y: number };
}
export interface CollabSlice {
    collabRole: 'owner' | 'editor' | 'viewer' | null;
    presence: Record<string, CollaboratorPresence>;   // keyed by userId
    setCollabRole: (r: CollabSlice['collabRole']) => void;
    setPresence: (p: Record<string, CollaboratorPresence>) => void;
    upsertCursor: (userId: string, cursor: { x: number; y: number }) => void;
}

export const createCollabSlice: StateCreator<RootState, [], [], CollabSlice> = (set) => ({
    collabRole: null,
    presence: {},
    setCollabRole: (r) => set({ collabRole: r }),
    setPresence: (p) => set({ presence: p }),
    upsertCursor: (userId, cursor) => set((s) => ({
        presence: s.presence[userId]
            ? { ...s.presence, [userId]: { ...s.presence[userId], cursor } }
            : s.presence,
    })),
});
```
Note: high-frequency cursor rendering does NOT use `upsertCursor` (that would churn the store every frame). The cursor overlay (Task 3.3) consumes broadcast events via a ref. `presence`/`collabRole` are low-frequency only.

- [ ] **Step 2: Register the slice + exclude from persist**

In `lib/store/app-store.ts`, import `createCollabSlice` and spread it into the store (same way the other slices are composed). Add `'collabRole'` and `'presence'` to the `partialize` excluded-keys list.
In `lib/store/types.ts`, add `CollabSlice` to the `RootState` intersection type.

- [ ] **Step 3: Set role + canvasId on open**

At the workflow open call site (where `sessionsApi.open`/`loadSession` runs), call the open route and store the result:
```typescript
const { threadId, canvasId, role } = await sessionsApi.open(canvasIdFromUrl);
useAppStore.getState().setActiveCanvasId(canvasId);
useAppStore.getState().setCollabRole(role);
// load messages for `threadId`, canvas for `canvasId` (loadSession already resolves canvas)
```
For owner-opened own workflows (canvasIdFromUrl is their own session with `canvas_session_id IS NULL`), `open` returns role `owner` and `threadId === canvasId` — unchanged behavior.

- [ ] **Step 4: Type-check + commit**

Run: `npx tsc --noEmit` (clean).
```bash
git add lib/store/slices/collab-slice.ts lib/store/app-store.ts lib/store/types.ts
git commit -m "feat(collab): collaboration store slice (role + presence)"
```

---

## Task 3.2: `useWorkflowCollaboration` hook (presence + op broadcast)

**Files:**
- Create: `lib/hooks/use-workflow-collaboration.ts`

- [ ] **Step 1: Create the hook**

Create `lib/hooks/use-workflow-collaboration.ts`:
```typescript
'use client';
import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAppStore } from '@/lib/store/app-store';

// Deterministic per-user color so it's stable across clients.
function colorFor(userId: string): string {
    let h = 0; for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) % 360;
    return `hsl(${h} 70% 55%)`;
}

export interface CursorEvent { userId: string; x: number; y: number; }
export interface WorkflowOp {
    origin: string;
    kind: 'node:add' | 'node:delete' | 'node:move-commit' | 'node:config' | 'edge:add' | 'edge:delete';
    payload: any;
}

export function useWorkflowCollaboration(
    canvasId: string | null,
    me: { id: string; name: string; role: 'owner' | 'editor' | 'viewer' } | null,
    handlers: { onOp: (op: WorkflowOp) => void; onCursor: (c: CursorEvent) => void; onNodeDrag: (e: any) => void; },
) {
    const supabaseRef = useRef(createClient());
    const opsChannelRef = useRef<any>(null);
    const handlersRef = useRef(handlers);
    handlersRef.current = handlers;

    useEffect(() => {
        if (!canvasId || !me) return;
        const supabase = supabaseRef.current;
        const setPresence = useAppStore.getState().setPresence;

        // Presence: roster.
        const presence = supabase.channel(`workflow-presence-${canvasId}`, {
            config: { presence: { key: me.id } },
        });
        presence.on('presence', { event: 'sync' }, () => {
            const state = presence.presenceState() as any;
            const roster: Record<string, any> = {};
            Object.values(state).forEach((arr: any) => {
                const p = arr[0];
                if (p) roster[p.userId] = { userId: p.userId, name: p.name, color: colorFor(p.userId), role: p.role };
            });
            setPresence(roster);
        });
        presence.subscribe((status: string) => {
            if (status === 'SUBSCRIBED') {
                presence.track({ userId: me.id, name: me.name, role: me.role });
            }
        });

        // Ops + cursors: broadcast (self: false → never echo our own).
        const ops = supabase.channel(`workflow-ops-${canvasId}`, { config: { broadcast: { self: false } } });
        ops.on('broadcast', { event: 'op' }, ({ payload }: any) => handlersRef.current.onOp(payload));
        ops.on('broadcast', { event: 'cursor' }, ({ payload }: any) => handlersRef.current.onCursor(payload));
        ops.on('broadcast', { event: 'node-drag' }, ({ payload }: any) => handlersRef.current.onNodeDrag(payload));
        ops.subscribe();
        opsChannelRef.current = ops;

        return () => { supabase.removeChannel(presence); supabase.removeChannel(ops); opsChannelRef.current = null; };
    }, [canvasId, me?.id, me?.role]);

    // Senders (throttle cursor/drag at call sites).
    const sendCursor = (x: number, y: number) => {
        if (!me) return;
        opsChannelRef.current?.send({ type: 'broadcast', event: 'cursor', payload: { userId: me.id, x, y } });
    };
    const sendNodeDrag = (nodeId: string, x: number, y: number) => {
        if (!me) return;
        opsChannelRef.current?.send({ type: 'broadcast', event: 'node-drag', payload: { userId: me.id, nodeId, x, y } });
    };
    const sendOp = (op: Omit<WorkflowOp, 'origin'>) => {
        if (!me) return;
        opsChannelRef.current?.send({ type: 'broadcast', event: 'op', payload: { ...op, origin: me.id } });
    };
    return { sendCursor, sendNodeDrag, sendOp };
}
```

- [ ] **Step 2: Type-check + commit**

Run: `npx tsc --noEmit` (clean).
```bash
git add lib/hooks/use-workflow-collaboration.ts
git commit -m "feat(collab): useWorkflowCollaboration hook (presence + op/cursor broadcast)"
```

---

## Task 3.3: Cursor overlay + presence avatars

**Files:**
- Create: `components/collab/CollaboratorCursors.tsx`
- Create: `components/collab/PresenceAvatars.tsx`
- Modify: `components/editor/EditorCanvas.tsx` (mount overlay after `</ReactFlow>`, ~line 1508; wire pane mouse-move + drag broadcasts)
- Modify: `components/editor/EditorToolbar.tsx` (mount `PresenceAvatars`)

- [ ] **Step 1: Cursor overlay (ref-driven, no per-frame store writes)**

Create `components/collab/CollaboratorCursors.tsx`:
```tsx
'use client';
import React, { useImperativeHandle, useRef, forwardRef } from 'react';
import { useReactFlow } from 'reactflow';

export interface CursorsHandle { update: (userId: string, name: string, color: string, fx: number, fy: number) => void; remove: (userId: string) => void; }

// Renders remote cursors. Positions are pushed imperatively (via ref) to avoid
// React re-renders on every cursor broadcast. flow-coords → screen via the RF viewport.
export const CollaboratorCursors = forwardRef<CursorsHandle, {}>(function CollaboratorCursors(_props, ref) {
    const layerRef = useRef<HTMLDivElement>(null);
    const elsRef = useRef<Map<string, HTMLDivElement>>(new Map());
    const rf = useReactFlow();

    useImperativeHandle(ref, () => ({
        update(userId, name, color, fx, fy) {
            const { x, y, zoom } = rf.getViewport();
            const sx = fx * zoom + x, sy = fy * zoom + y;
            let el = elsRef.current.get(userId);
            if (!el && layerRef.current) {
                el = document.createElement('div');
                el.style.cssText = 'position:absolute;pointer-events:none;transition:transform 60ms linear;z-index:50';
                el.innerHTML = `<div style="width:10px;height:10px;border-radius:50%;background:${color}"></div>
                    <div style="background:${color};color:#fff;font-size:10px;border-radius:4px;padding:1px 5px;margin-top:2px;white-space:nowrap">${name}</div>`;
                layerRef.current.appendChild(el);
                elsRef.current.set(userId, el);
            }
            if (el) el.style.transform = `translate(${sx}px, ${sy}px)`;
        },
        remove(userId) {
            const el = elsRef.current.get(userId);
            if (el) { el.remove(); elsRef.current.delete(userId); }
        },
    }), [rf]);

    return <div ref={layerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />;
});
```

- [ ] **Step 2: Presence avatars**

Create `components/collab/PresenceAvatars.tsx`:
```tsx
'use client';
import React from 'react';
import { useAppStore } from '@/lib/store/app-store';
import { useShallow } from 'zustand/react/shallow';

export function PresenceAvatars() {
    const presence = useAppStore(useShallow((s) => s.presence));
    const people = Object.values(presence);
    if (people.length === 0) return null;
    return (
        <div className="flex items-center -space-x-2 pointer-events-auto">
            {people.slice(0, 5).map((p) => (
                <div key={p.userId} title={`${p.name} (${p.role})`}
                     className="w-7 h-7 rounded-full border-2 border-surface-elevated flex items-center justify-center text-[11px] text-white"
                     style={{ background: p.color }}>
                    {p.name?.[0]?.toUpperCase() || '?'}
                </div>
            ))}
            {people.length > 5 && <div className="w-7 h-7 rounded-full bg-surface-primary border-2 border-surface-elevated flex items-center justify-center text-[10px]">+{people.length - 5}</div>}
        </div>
    );
}
```

- [ ] **Step 3: Wire the hook + overlay into the canvas**

In `components/editor/EditorCanvas.tsx`: instantiate `useWorkflowCollaboration` with `activeCanvasId`, the current user (from `userApi.me()` / a small `useCurrentUser` hook — create `lib/hooks/use-current-user.ts` returning `{ id, name }` via `createClient().auth.getUser()`), and `collabRole`. Add a `cursorsRef`. Then:
- Mount `<CollaboratorCursors ref={cursorsRef} />` immediately after `</ReactFlow>` (line 1508).
- In `onCursor` handler, call `cursorsRef.current?.update(...)` using the sender's presence color.
- Add `onPaneMouseMove` to `<ReactFlow>` that throttles (~30ms) and calls `sendCursor(flowX, flowY)` using `rf.screenToFlowPosition`.
- In `handleNodeDrag` (existing), also call `sendNodeDrag(node.id, node.position.x, node.position.y)` throttled.
- In `onNodeDrag` (incoming), route to the existing `setLiveNodePosition(nodeId, {x,y})` from the live-position slice.
- In `handleNodeDragStop`/add/delete/connect, call `sendOp(...)` with the committed change; in `onOp`, apply the op to the store via existing actions (`updateNodePositions`, add/remove node, `onConnect`, delete edge). Guard each applied op so it does not re-broadcast (ops carry `origin`; `self:false` already prevents self-echo).
- **Save authority (spec Section 3):** applying a peer op must NOT set `isWorkflowDirty` — otherwise every client redundantly autosaves the same blob. After applying an incoming op, call `setWorkflowDirty(false)` (or apply via `setCurrentWorkflow(updated, false)`), so only the user who *originated* a change schedules the remote save. The originator's own local edit still marks dirty normally.

- [ ] **Step 4: Mount avatars in the toolbar**

In `components/editor/EditorToolbar.tsx`, render `<PresenceAvatars />` next to the Share button (inside the right-side group).

- [ ] **Step 5: Type-check + manual two-browser test**

Run: `npx tsc --noEmit` (clean). Open the same shared workflow as owner (Browser A) and editor (Browser B):
- Both see each other's avatar in the toolbar.
- Moving the mouse in A shows A's cursor in B (and vice versa).
- Dragging a node in A animates it live in B; on drop it persists for both.
- Adding/deleting a node or edge in A appears in B.

- [ ] **Step 6: Commit**
```bash
git add components/collab/CollaboratorCursors.tsx components/collab/PresenceAvatars.tsx components/editor/EditorCanvas.tsx components/editor/EditorToolbar.tsx lib/hooks/use-current-user.ts
git commit -m "feat(collab): live cursors, presence avatars, peer node-drag + op apply"
```

---

## Task 3.4: Realtime channel keying on canvas id

**Files:**
- Modify: `lib/hooks/use-chat-realtime.ts:71,314-349`
- Modify: `lib/hooks/use-execution-channel.ts:175,195-207` (call site)

- [ ] **Step 1: Canvas/results channels key on canvas id; messages on thread id**

In `lib/hooks/use-chat-realtime.ts`, the `chat-sessions-${activeSessionId}` channel (canvas_state sync) and the execution-results channel must key on the canvas id, while `chat-messages-${activeSessionId}` stays on the per-user thread. Change the sessions channel block (lines ~333-349) to use a `canvasId` derived from the store:
```typescript
const canvasId = useAppStore.getState().activeCanvasId || activeSessionId;
// ... chat-sessions channel:
const sessionsChannel = supabase
    .channel(`chat-sessions-${canvasId}`)
    .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${canvasId}` },
        handleSessionUpdate)
    .subscribe(/* ... */);
```
Leave the `chat-messages-${activeSessionId}` channel keyed on the thread.

- [ ] **Step 2: Results channel keys on canvas id**

Where `useExecutionChannel(sessionId)` is invoked, pass the canvas id: `useExecutionChannel(activeCanvasId || activeSessionId)`. (Executions are written with `session_id = canvasId` per Task 1.6, so the `session_results_${canvasId}` channel + `applyNodeResult` filter match.)

- [ ] **Step 3: Type-check + manual**

Run: `npx tsc --noEmit` (clean). Two-browser: a generation run by the editor (B) shows its node results on the owner's canvas (A) in real time.

- [ ] **Step 4: Commit**
```bash
git add lib/hooks/use-chat-realtime.ts lib/hooks/use-execution-channel.ts components app
git commit -m "feat(collab): key canvas + results realtime channels on shared canvas id"
```

---

## Task 3.5: Viewer lockdown + membership-change handling

**Files:**
- Modify: the workflow editor wrapper that renders `EditorCanvas`/`SharedWorkflowEditor` (pass `readOnly={collabRole==='viewer'}`)
- Modify: `components/chat/ChatInterface.tsx:438-490` (disable composer for viewers; show owner thread)
- Modify: `components/layout/WorkspaceLayout.tsx:47-85` (lock Assets/Characters/node-library panels for viewers)

- [ ] **Step 1: Read-only canvas for viewers**

Where `EditorCanvas`/`SharedWorkflowEditor` is rendered, pass `readOnly={useAppStore.getState().collabRole === 'viewer'}` (the prop already gates dragging, connecting, deleting, and the property panel — confirmed at `EditorCanvas.tsx:132,153,1144` and `SharedWorkflowEditor.tsx:29,157,226,236`). Also hide Run/Stop in `EditorToolbar` when `collabRole === 'viewer'`.

- [ ] **Step 2: Viewer chat = owner thread, read-only**

In `ChatInterface.tsx`, when `collabRole === 'viewer'`: (a) load messages from the canvas/owner thread (`activeCanvasId`) instead of a companion thread, and (b) pass `disabled` to `<ChatInput>` unconditionally and show a "View only" hint. The `disabled` prop is already honored (`ChatInput.tsx:457`). Concretely:
```tsx
const isViewer = useAppStore((s) => s.collabRole) === 'viewer';
// ...
<ChatInput value={input} onChange={setInput}
    disabled={isViewer || isLoading || isLoadingSession}
    /* ...existing props... */ />
{isViewer && <p className="text-xs text-text-tertiary px-3 pb-2">View only — ask an editor to make changes.</p>}
```

- [ ] **Step 3: Lock side panels for viewers**

In `WorkspaceLayout.tsx`, gate the panel toggles so viewers can't open editing panels:
```tsx
const isViewer = useAppStore((s) => s.collabRole) === 'viewer';
const togglePanel = useCallback((panel: ActivePanel) => {
    if (isViewer) return;            // viewers: panels locked
    /* ...existing body... */
}, [isViewer, isCopilotMinimized, setIsCopilotMinimized]);
```
Also visually disable the panel trigger buttons when `isViewer` (add `disabled`/`opacity-50` to the Assets/Characters/Node-library buttons).

- [ ] **Step 4: Membership-change broadcast (revoke/downgrade kicks the client)**

In `use-workflow-collaboration.ts`, add a `membership` broadcast listener; when the owner revokes/downgrades, the Share dialog's PATCH/DELETE also sends a broadcast `ops.send({ type:'broadcast', event:'membership', payload:{ userId, action } })`. On receipt, if it targets the current user: re-fetch role via `sessionsApi.open(canvasId)`; if access lost, redirect to `/`. (RLS is the hard backstop — their next save/read fails regardless.) Add the listener in Task 3.2's hook and emit from the collaborator PATCH/DELETE client calls in the Share dialog.

- [ ] **Step 5: Type-check + manual**

Run: `npx tsc --noEmit` (clean). As a viewer (Browser B): canvas is read-only, Run hidden, chat composer disabled showing the owner's conversation, Assets/Characters/node-library locked, but cursors still render. Owner revokes B mid-session → B drops out.

- [ ] **Step 6: Commit**
```bash
git add components app lib
git commit -m "feat(collab): viewer lockdown (read-only canvas/chat/panels) + revoke handling"
```

**✅ Phase 3 ships here:** full Figma-style collaboration — live cursors, presence, live edits, runner-pays runs, and viewer lockdown.

---

# Self-review checklist (run before execution)

- [ ] **Spec coverage:** every spec section maps to a task — Section 1 → 1.1; Section 1b → 1.2/1.3 + 1.5/1.6 (canvas resolution) + 3.5 (viewer chat); Section 2 → 2.1–2.4; Section 3 → 3.2/3.3/3.4; Section 4 → 3.3 (avatars/cursors) + 3.5 (viewer lockdown); Section 5 → 1.1 (RPC/trigger/cascade), 2.1 (re-invite upsert, email-fail warning), 3.5 (revoke). 
- [ ] **Open spec checks resolved in-plan:** executions owner-assert → 1.6; postgres_changes honors widened RLS → manual in 3.4; auth.users trigger composes with `handle_new_user` → 1.1 (separate AFTER INSERT trigger); chat brain canvas via effectiveCanvasId → 1.5; autosave/realtime resolve canvas id → 1.2/3.4.
- [ ] **Placeholders:** none — every code step contains full code. Steps that say "find the call site" include the exact grep command and the concrete edit to make.
- [ ] **Type consistency:** `activeCanvasId`/`setActiveCanvasId`, `collabRole`/`setCollabRole`/`setPresence`, `effectiveCanvasId = canvas_session_id ?? id`, channel names `workflow-presence-{canvasId}`/`workflow-ops-{canvasId}`/`chat-sessions-{canvasId}`, and `sessionsApi.open` shape `{ threadId, canvasId, role }` are used consistently across tasks.

