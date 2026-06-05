# Workflow Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins convert a live workflow into a rich, browsable **template** that any user can preview and clone into a brand-new workflow, replacing the dead `/library` page with a redesigned `/templates` gallery.

**Architecture:** Evolve the existing `workflow_templates` table in place (add metadata columns, admin-only RLS, a usage-count RPC, a `template-thumbnails` storage bucket). Add admin authoring (toolbar button → modal → `POST /api/admin/templates`), a public gallery + preview + clone flow, an `/admin` management section, and repurpose the existing in-canvas `TemplatesModal` to read published official templates.

**Tech Stack:** Next.js App Router (route handlers, `nodejs`/edge defaults), Supabase (Postgres + RLS + Storage), TypeScript, React client components, Tailwind semantic tokens + glassmorphism, framer-motion, lucide-react.

---

## Project testing reality (read first)

This repo has **no unit-test runner** (per `CLAUDE.md`). Verification per task is:
- **Type check:** `npx tsc --noEmit` (authoritative — `npm run lint`/`build` are unreliable here per project memory).
- **DB checks:** ad-hoc Node scripts in `scripts/` run with `node scripts/<file>.js` against the live Supabase + `.env.local`.
- **Manual E2E:** `npm run dev` and exercise the UI (final task has a checklist).

So the usual "write failing test first" TDD loop is replaced by: implement → `npx tsc --noEmit` clean → (DB tasks) run a `scripts/` probe → commit. This follows the project's own conventions, which override the skill's default test loop.

---

## File structure

**New**
- `supabase/migrations/20260605_evolve_workflow_templates.sql` — table evolution, RLS, RPC, bucket, storage policies.
- `scripts/check-templates-schema.js` — DB verification probe.
- `lib/templates/snapshot.ts` — pure helpers: `sanitizeTemplateWorkflow`, `deriveNodesUsed`, shared TS types.
- `lib/templates/node-chips.ts` — client-safe node `{label,color,icon}` lookup from the shared registry.
- `lib/templates/thumbnail.server.ts` — resolve + copy last image output into `template-thumbnails`.
- `app/api/admin/templates/route.ts` — GET (all) + POST (create from a session).
- `app/api/admin/templates/[id]/route.ts` — PATCH + DELETE.
- `app/api/templates/route.ts` — GET (published list, filters).
- `app/api/templates/[id]/route.ts` — GET (published detail).
- `app/api/templates/[id]/use/route.ts` — POST (clone into a new session).
- `hooks/useIsAdmin.ts` — client admin flag.
- `components/editor/ConvertToTemplateModal.tsx` — authoring modal.
- `app/templates/page.tsx` — gallery page (replaces `app/library/page.tsx`).
- `components/templates/TemplatesGallery.tsx`, `TemplateCard.tsx`, `TemplatePreviewModal.tsx`, `TemplateFilters.tsx`.
- `components/admin/TemplatesAdminContent.tsx` — admin management.

**Modified**
- `lib/api/client.ts` — `templatesApi` (public/clone) wrappers.
- `lib/api/admin.ts` — `adminTemplatesApi` wrappers.
- `components/editor/EditorToolbar.tsx` — Convert-to-template button (admin + owner).
- `components/editor/SharedWorkflowEditor.tsx` — fetch + thread `isAdmin`.
- `components/editor/TemplatesModal.tsx` — repurpose to published official templates.
- `components/layout/Sidebar.tsx` — nav label/path/icon Library → Templates.
- `middleware.ts` — protected route `/library` → `/templates`.
- `app/admin/page.tsx` — add Templates section nav + content.

**Deleted**
- `app/library/page.tsx`, `components/library/*`, `hooks/useWorkflowLibrary.ts`.

---

## Task 1: Database migration — evolve `workflow_templates`

**Files:**
- Create: `supabase/migrations/20260605_evolve_workflow_templates.sql`
- Create: `scripts/check-templates-schema.js`

- [ ] **Step 1: Write the migration**

```sql
-- Migration: evolve workflow_templates into the rich Templates feature
-- Date: 2026-06-05
-- - Adds metadata columns, renames user_id -> created_by
-- - Replaces template_type -> source ('official'|'community')
-- - Replaces is_public -> status ('draft'|'published'|'archived')
-- - Admin-only write RLS via public.is_admin(); published-read for all authed users
-- - increment_template_usage() SECURITY DEFINER RPC for non-admin clone bumps
-- - template-thumbnails storage bucket + admin-write policies

-- 1. NEW COLUMNS
ALTER TABLE public.workflow_templates
  ADD COLUMN IF NOT EXISTS how_it_works      TEXT,
  ADD COLUMN IF NOT EXISTS category          TEXT,
  ADD COLUMN IF NOT EXISTS tags              TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS use_cases         TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS nodes_used        TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS created_by_name    TEXT,
  ADD COLUMN IF NOT EXISTS source_session_id  UUID REFERENCES public.sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS usage_count        INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS published_at       TIMESTAMPTZ;

-- 2. RENAME user_id -> created_by (guarded)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='workflow_templates' AND column_name='user_id')
  THEN
    ALTER TABLE public.workflow_templates RENAME COLUMN user_id TO created_by;
  END IF;
END $$;

-- 3. source column (replaces template_type)
ALTER TABLE public.workflow_templates
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'official';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='workflow_templates' AND column_name='template_type')
  THEN
    UPDATE public.workflow_templates
      SET source = CASE WHEN template_type = 'user' THEN 'community' ELSE 'official' END;
    ALTER TABLE public.workflow_templates DROP COLUMN template_type;
  END IF;
END $$;

-- 4. status column (replaces is_public)
ALTER TABLE public.workflow_templates
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='workflow_templates' AND column_name='is_public')
  THEN
    UPDATE public.workflow_templates
      SET status = CASE WHEN is_public = true THEN 'published' ELSE 'draft' END,
          published_at = CASE WHEN is_public = true THEN NOW() ELSE NULL END;
    ALTER TABLE public.workflow_templates DROP COLUMN is_public;
  END IF;
END $$;

-- 5. CHECK constraints
ALTER TABLE public.workflow_templates
  DROP CONSTRAINT IF EXISTS workflow_templates_source_check,
  DROP CONSTRAINT IF EXISTS workflow_templates_status_check;
ALTER TABLE public.workflow_templates
  ADD CONSTRAINT workflow_templates_source_check CHECK (source IN ('official','community')),
  ADD CONSTRAINT workflow_templates_status_check CHECK (status IN ('draft','published','archived'));

-- 6. INDEXES (drop stale ones, add new)
DROP INDEX IF EXISTS public.idx_workflow_templates_type;
DROP INDEX IF EXISTS public.idx_workflow_templates_public;
CREATE INDEX IF NOT EXISTS idx_workflow_templates_source_status
  ON public.workflow_templates(source, status);
CREATE INDEX IF NOT EXISTS idx_workflow_templates_category
  ON public.workflow_templates(category);
CREATE INDEX IF NOT EXISTS idx_workflow_templates_tags
  ON public.workflow_templates USING GIN (tags);

-- 7. RLS — drop old user-owned policies, install admin/published model
ALTER TABLE public.workflow_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read their own and public templates" ON public.workflow_templates;
DROP POLICY IF EXISTS "Users can create their own templates"          ON public.workflow_templates;
DROP POLICY IF EXISTS "Users can update their own templates"          ON public.workflow_templates;
DROP POLICY IF EXISTS "Users can delete their own templates"          ON public.workflow_templates;

DROP POLICY IF EXISTS "Published templates readable by authed users" ON public.workflow_templates;
CREATE POLICY "Published templates readable by authed users"
  ON public.workflow_templates FOR SELECT
  USING (
    (auth.uid() IS NOT NULL AND status = 'published')
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "Admins manage templates" ON public.workflow_templates;
CREATE POLICY "Admins manage templates"
  ON public.workflow_templates FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
-- (existing "Service role manages all templates" policy is left intact)

-- 8. RPC: bump usage_count on clone (callable by any authed user)
CREATE OR REPLACE FUNCTION public.increment_template_usage(p_template_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.workflow_templates
    SET usage_count = usage_count + 1
    WHERE id = p_template_id AND status = 'published';
END;
$$;
GRANT EXECUTE ON FUNCTION public.increment_template_usage(UUID) TO authenticated;

-- 9. STORAGE bucket + policies
INSERT INTO storage.buckets (id, name, public)
  VALUES ('template-thumbnails', 'template-thumbnails', true)
  ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "template-thumbnails public read"  ON storage.objects;
CREATE POLICY "template-thumbnails public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'template-thumbnails');

DROP POLICY IF EXISTS "template-thumbnails admin write"  ON storage.objects;
CREATE POLICY "template-thumbnails admin write"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'template-thumbnails' AND public.is_admin());

DROP POLICY IF EXISTS "template-thumbnails admin delete" ON storage.objects;
CREATE POLICY "template-thumbnails admin delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'template-thumbnails' AND public.is_admin());

DO $$ BEGIN RAISE NOTICE '✅ workflow_templates evolved for Templates feature.'; END $$;
```

- [ ] **Step 2: Write a DB verification probe**

```js
// scripts/check-templates-schema.js
// Verifies the evolved workflow_templates columns + RPC exist. Run AFTER applying the migration.
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const REQUIRED = [
  'id','name','description','workflow','thumbnail_url','how_it_works','category',
  'tags','use_cases','nodes_used','source','status','created_by','created_by_name',
  'source_session_id','usage_count','published_at','created_at','updated_at',
];

(async () => {
  // Selecting every required column will error if any is missing.
  const { error } = await supabase
    .from('workflow_templates')
    .select(REQUIRED.join(','))
    .limit(1);
  if (error) { console.error('❌ column check failed:', error.message); process.exit(1); }
  console.log('✅ all required columns present');

  // RPC smoke test with a random UUID (no row updated, but the function must resolve).
  const { error: rpcErr } = await supabase.rpc('increment_template_usage', {
    p_template_id: '00000000-0000-0000-0000-000000000000',
  });
  if (rpcErr) { console.error('❌ RPC missing:', rpcErr.message); process.exit(1); }
  console.log('✅ increment_template_usage RPC present');
  process.exit(0);
})();
```

- [ ] **Step 3: Apply the migration to the live DB**

Apply `20260605_evolve_workflow_templates.sql` via the project's normal migration path (Supabase SQL editor or `supabase db push`, matching how prior migrations in `supabase/migrations/` were applied).

- [ ] **Step 4: Run the probe**

Run: `node scripts/check-templates-schema.js`
Expected: `✅ all required columns present` and `✅ increment_template_usage RPC present`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260605_evolve_workflow_templates.sql scripts/check-templates-schema.js
git commit -m "feat(templates): evolve workflow_templates schema, RLS, usage RPC, thumbnail bucket"
```

---

## Task 2: Shared snapshot + nodes-used helpers

**Files:**
- Create: `lib/templates/snapshot.ts`

- [ ] **Step 1: Implement the helpers (pure, client+server safe)**

```ts
// lib/templates/snapshot.ts
// Pure helpers shared by the convert API and the clone API. No Node/sharp/browser deps.

export interface TemplateWorkflow {
  nodes: any[];
  edges: any[];
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string | null;
  workflow: TemplateWorkflow;
  thumbnail_url: string | null;
  how_it_works: string | null;
  category: string | null;
  tags: string[];
  use_cases: string[];
  nodes_used: string[];
  source: 'official' | 'community';
  status: 'draft' | 'published' | 'archived';
  created_by: string | null;
  created_by_name: string | null;
  source_session_id: string | null;
  usage_count: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Strip per-node runtime/output state so a stored template (or a clone of one)
 * starts clean. Keeps type/position/config/parentNode/measured/width/height.
 */
export function sanitizeTemplateWorkflow(wf: TemplateWorkflow | null | undefined): TemplateWorkflow {
  const nodes = (wf?.nodes ?? []).map((n) => {
    const data = { ...(n.data ?? {}) };
    delete data.output;
    delete data.outputMetadata;
    delete data.status;
    delete data.errorMessage;
    delete data.isNew;
    return { ...n, data, selected: false };
  });
  const edges = (wf?.edges ?? []).map((e) => ({ ...e, selected: false }));
  return { nodes, edges };
}

/** Unique node `type` values present in a workflow, excluding non-executable group containers. */
export function deriveNodesUsed(wf: TemplateWorkflow | null | undefined): string[] {
  const types = (wf?.nodes ?? [])
    .map((n) => n.type)
    .filter((t): t is string => !!t && t !== 'group_container');
  return Array.from(new Set(types));
}
```

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/templates/snapshot.ts
git commit -m "feat(templates): shared snapshot sanitize + nodes-used helpers"
```

---

## Task 3: Client-safe node-chip lookup

**Files:**
- Create: `lib/templates/node-chips.ts`

- [ ] **Step 1: Implement the lookup off the shared registry**

```ts
// lib/templates/node-chips.ts
// Client-safe: imports ONLY the shared registry (no server registry → no sharp in the bundle).
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';

export interface NodeChip {
  type: string;
  label: string;
  color: string; // CSS color string from registry meta
  icon: string;  // Lucide PascalCase name (best-effort; callers may fall back)
}

export function nodeChipsFor(types: string[]): NodeChip[] {
  return (types ?? []).map((type) => {
    const def: any = sharedRegistry[type];
    const meta = def?.meta ?? {};
    return {
      type,
      label: meta.label ?? type,
      color: meta.color ?? 'rgb(var(--stroke-subtle))',
      icon: meta.icon ?? 'Box',
    };
  });
}
```

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/templates/node-chips.ts
git commit -m "feat(templates): client-safe node-chip metadata lookup"
```

---

## Task 4: Server thumbnail resolver

**Files:**
- Create: `lib/templates/thumbnail.server.ts`

- [ ] **Step 1: Implement last-image-output → bucket copy**

```ts
// lib/templates/thumbnail.server.ts
// Resolve a template hero image from a session's most recent successful IMAGE output,
// copying it into the template-thumbnails bucket so it survives output GC.
// Returns the public URL, or null if no image output exists (caller then requires an upload).
import { v4 as uuidv4 } from 'uuid';

export async function resolveThumbnailFromSession(
  supabase: any,
  templateId: string,
  sessionId: string,
): Promise<string | null> {
  // Latest successful image result for this session.
  const { data: rows } = await supabase
    .from('node_results')
    .select('result_type, result_data, created_at')
    .eq('session_id', sessionId)
    .eq('status', 'success')
    .eq('result_type', 'image')
    .order('created_at', { ascending: false })
    .limit(5);

  const url = firstImageUrl(rows ?? []);
  if (!url) return null;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || 'image/png';
    const ext = contentType.includes('jpeg') ? 'jpg' : contentType.includes('webp') ? 'webp' : 'png';
    const buf = Buffer.from(await res.arrayBuffer());
    const path = `templates/${templateId}/${uuidv4()}.${ext}`;
    const { error } = await supabase.storage
      .from('template-thumbnails')
      .upload(path, buf, { contentType, upsert: true });
    if (error) return null;
    const { data } = supabase.storage.from('template-thumbnails').getPublicUrl(path);
    return data.publicUrl;
  } catch {
    return null;
  }
}

/** result_data is a JSONB array of items; pull the first usable image URL. */
function firstImageUrl(rows: any[]): string | null {
  for (const r of rows) {
    const items = Array.isArray(r.result_data) ? r.result_data : [];
    for (const item of items) {
      const u = typeof item === 'string' ? item : item?.url ?? item?.publicUrl ?? item?.src;
      if (typeof u === 'string' && /^https?:\/\//.test(u)) return u;
    }
  }
  return null;
}

/** Upload an admin-provided File to the template-thumbnails bucket; returns its public URL. */
export async function uploadTemplateThumbnail(
  supabase: any,
  templateId: string,
  file: File,
): Promise<string> {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase();
  const path = `templates/${templateId}/${uuidv4()}.${ext}`;
  const { error } = await supabase.storage
    .from('template-thumbnails')
    .upload(path, file, { upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from('template-thumbnails').getPublicUrl(path);
  return data.publicUrl;
}
```

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/templates/thumbnail.server.ts
git commit -m "feat(templates): server thumbnail resolver (last image output + admin upload)"
```

---

## Task 5: Admin templates API — list + create

**Files:**
- Create: `app/api/admin/templates/route.ts`

**Pattern reference:** `app/api/admin/providers/route.ts` (FormData + bucket upload + `requireAdmin`).

- [ ] **Step 1: Implement GET (all) + POST (create from a session)**

```ts
// app/api/admin/templates/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { sanitizeTemplateWorkflow, deriveNodesUsed } from '@/lib/templates/snapshot';
import { resolveThumbnailFromSession, uploadTemplateThumbnail } from '@/lib/templates/thumbnail.server';
import { v4 as uuidv4 } from 'uuid';

export const dynamic = 'force-dynamic';

/** GET /api/admin/templates — list ALL templates (any status/source). */
export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { data, error } = await auth.supabase
    .from('workflow_templates')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ templates: data });
}

/**
 * POST /api/admin/templates — create a template from a workflow session.
 * FormData fields: session_id, name, description, how_it_works, category,
 *   tags (JSON string[]), use_cases (JSON string[]), publish ('true'|'false'),
 *   thumbnail (optional File).
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { user, supabase } = auth;

  const form = await req.formData();
  const sessionId = form.get('session_id') as string | null;
  const name = (form.get('name') as string | null)?.trim();
  if (!sessionId || !name) {
    return NextResponse.json({ error: 'session_id and name are required' }, { status: 400 });
  }

  // Load the source session's canvas.
  const { data: session, error: sErr } = await supabase
    .from('sessions')
    .select('canvas_state')
    .eq('id', sessionId)
    .single();
  if (sErr || !session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  const workflow = sanitizeTemplateWorkflow(session.canvas_state || { nodes: [], edges: [] });
  const nodesUsed = deriveNodesUsed(workflow);

  // Author display name from profiles.
  const { data: profile } = await supabase
    .from('profiles').select('display_name, full_name').eq('id', user.id).single();
  const createdByName = profile?.display_name || profile?.full_name || 'Admin';

  const parseArr = (k: string): string[] => {
    try { const v = JSON.parse((form.get(k) as string) || '[]'); return Array.isArray(v) ? v : []; }
    catch { return []; }
  };

  const publish = (form.get('publish') as string) !== 'false';
  const id = uuidv4();

  // Thumbnail: uploaded file wins; else copy last image output; else null (UI requires upload).
  const file = form.get('thumbnail') as File | null;
  let thumbnailUrl: string | null = null;
  if (file && file.size > 0) thumbnailUrl = await uploadTemplateThumbnail(supabase, id, file);
  else thumbnailUrl = await resolveThumbnailFromSession(supabase, id, sessionId);

  const { data, error } = await supabase
    .from('workflow_templates')
    .insert({
      id,
      name,
      description: (form.get('description') as string) || null,
      how_it_works: (form.get('how_it_works') as string) || null,
      category: (form.get('category') as string) || null,
      tags: parseArr('tags'),
      use_cases: parseArr('use_cases'),
      workflow,
      nodes_used: nodesUsed,
      thumbnail_url: thumbnailUrl,
      source: 'official',
      status: publish ? 'published' : 'draft',
      created_by: user.id,
      created_by_name: createdByName,
      source_session_id: sessionId,
      published_at: publish ? new Date().toISOString() : null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ template: data }, { status: 201 });
}
```

- [ ] **Step 2: Verify `profiles` has a display name column**

Run: `node -e "require('dotenv').config({path:'.env.local'});const{createClient}=require('@supabase/supabase-js');const s=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);s.from('profiles').select('display_name,full_name').limit(1).then(r=>{console.log(r.error?('ERR '+r.error.message):'OK');process.exit(0)})"`
Expected: `OK`. If it errors on a missing column, edit the `select`/fallback in Step 1 to whatever name column `profiles` actually has (e.g. drop `display_name`).

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/templates/route.ts
git commit -m "feat(templates): admin list + create-from-session API"
```

---

## Task 6: Admin templates API — update + delete

**Files:**
- Create: `app/api/admin/templates/[id]/route.ts`

- [ ] **Step 1: Implement PATCH + DELETE**

```ts
// app/api/admin/templates/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { uploadTemplateThumbnail } from '@/lib/templates/thumbnail.server';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/admin/templates/[id] — update metadata/status/source/thumbnail.
 * Accepts FormData (so a new thumbnail File can ride along). Recipe (workflow) is NOT editable here.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { supabase } = auth;
  const form = await req.formData();

  const patch: Record<string, any> = {};
  const setStr = (k: string) => { const v = form.get(k); if (v !== null) patch[k] = (v as string) || null; };
  const setArr = (k: string) => {
    const v = form.get(k);
    if (v !== null) { try { const a = JSON.parse(v as string); if (Array.isArray(a)) patch[k] = a; } catch {} }
  };
  setStr('name'); setStr('description'); setStr('how_it_works'); setStr('category');
  setArr('tags'); setArr('use_cases');

  const status = form.get('status') as string | null;
  if (status && ['draft','published','archived'].includes(status)) {
    patch.status = status;
    patch.published_at = status === 'published' ? new Date().toISOString() : null;
  }
  const source = form.get('source') as string | null;
  if (source && ['official','community'].includes(source)) patch.source = source;

  const file = form.get('thumbnail') as File | null;
  if (file && file.size > 0) patch.thumbnail_url = await uploadTemplateThumbnail(supabase, params.id, file);

  const { data, error } = await supabase
    .from('workflow_templates').update(patch).eq('id', params.id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ template: data });
}

/** DELETE /api/admin/templates/[id] — delete the row and its thumbnail folder. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { supabase } = auth;

  // Best-effort thumbnail cleanup (folder = templates/<id>/).
  const { data: files } = await supabase.storage.from('template-thumbnails').list(`templates/${params.id}`);
  if (files?.length) {
    await supabase.storage.from('template-thumbnails')
      .remove(files.map((f: any) => `templates/${params.id}/${f.name}`));
  }

  const { error } = await supabase.from('workflow_templates').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/templates/[id]/route.ts
git commit -m "feat(templates): admin update + delete API"
```

---

## Task 7: Public templates API — list + detail

**Files:**
- Create: `app/api/templates/route.ts`
- Create: `app/api/templates/[id]/route.ts`

- [ ] **Step 1: Implement GET list with filters**

```ts
// app/api/templates/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';

export const dynamic = 'force-dynamic';

/** GET /api/templates — published templates. Query: category, tag, q, source (default official). */
export async function GET(req: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (auth.error) return auth.error;
  const { supabase } = auth;
  const sp = req.nextUrl.searchParams;

  let q = supabase
    .from('workflow_templates')
    .select('id,name,description,thumbnail_url,category,tags,use_cases,nodes_used,source,created_by_name,usage_count,created_at')
    .eq('status', 'published')
    .eq('source', sp.get('source') || 'official')
    .order('usage_count', { ascending: false })
    .order('created_at', { ascending: false });

  const category = sp.get('category');
  if (category) q = q.eq('category', category);
  const tag = sp.get('tag');
  if (tag) q = q.contains('tags', [tag]);
  const search = sp.get('q');
  if (search) q = q.ilike('name', `%${search}%`);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ templates: data });
}
```

- [ ] **Step 2: Implement GET detail**

```ts
// app/api/templates/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';

export const dynamic = 'force-dynamic';

/** GET /api/templates/[id] — a single published template (full detail incl. how_it_works). */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getAuthenticatedUser();
  if (auth.error) return auth.error;
  const { supabase } = auth;

  const { data, error } = await supabase
    .from('workflow_templates')
    .select('id,name,description,how_it_works,thumbnail_url,category,tags,use_cases,nodes_used,source,created_by_name,usage_count,created_at')
    .eq('id', params.id)
    .eq('status', 'published')
    .single();

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ template: data });
}
```

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/templates/route.ts app/api/templates/[id]/route.ts
git commit -m "feat(templates): public list + detail API"
```

---

## Task 8: Clone-to-new-session API

**Files:**
- Create: `app/api/templates/[id]/use/route.ts`

**Pattern reference:** `app/api/sessions/route.ts` POST (session insert shape).

- [ ] **Step 1: Implement POST /use**

```ts
// app/api/templates/[id]/use/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';
import { sanitizeTemplateWorkflow } from '@/lib/templates/snapshot';

export const dynamic = 'force-dynamic';

/** POST /api/templates/[id]/use — clone a published template into a NEW session owned by the caller. */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getAuthenticatedUser();
  if (auth.error) return auth.error;
  const { user, supabase } = auth;

  // RLS guarantees we only read published templates.
  const { data: tpl, error: tErr } = await supabase
    .from('workflow_templates')
    .select('name, workflow, status')
    .eq('id', params.id)
    .single();
  if (tErr || !tpl) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

  const canvas = sanitizeTemplateWorkflow(tpl.workflow || { nodes: [], edges: [] });

  const { data: session, error: sErr } = await supabase
    .from('sessions')
    .insert({ user_id: user.id, title: tpl.name, canvas_state: canvas })
    .select('id')
    .single();
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });

  // Best-effort usage bump (RPC is SECURITY DEFINER; failure must not block the clone).
  await supabase.rpc('increment_template_usage', { p_template_id: params.id });

  return NextResponse.json({ session_id: session.id }, { status: 201 });
}
```

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/templates/[id]/use/route.ts
git commit -m "feat(templates): clone template into a new session"
```

---

## Task 9: Client API wrappers + useIsAdmin hook

**Files:**
- Modify: `lib/api/client.ts` (append a `templatesApi` block near the other API objects)
- Modify: `lib/api/admin.ts` (append `adminTemplatesApi`)
- Create: `hooks/useIsAdmin.ts`

- [ ] **Step 1: Add `templatesApi` to `lib/api/client.ts`**

Append after the `userApi` block (around `lib/api/client.ts:245`):

```ts
// ─── Templates APIs ────────────────────────────────────────────────────
export const templatesApi = {
  list: (qs?: { category?: string; tag?: string; q?: string }) => {
    const p = new URLSearchParams();
    if (qs?.category) p.set('category', qs.category);
    if (qs?.tag) p.set('tag', qs.tag);
    if (qs?.q) p.set('q', qs.q);
    const s = p.toString();
    return apiFetch<{ templates: any[] }>(`/api/templates${s ? `?${s}` : ''}`);
  },
  get: (id: string) => apiFetch<{ template: any }>(`/api/templates/${id}`),
  use: (id: string) =>
    apiFetch<{ session_id: string }>(`/api/templates/${id}/use`, { method: 'POST' }),
};
```

- [ ] **Step 2: Add `adminTemplatesApi` to `lib/api/admin.ts`**

Append (mirroring the provider FormData wrappers already in that file):

```ts
export const adminTemplatesApi = {
  list: async () => {
    const res = await fetch('/api/admin/templates');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load templates');
    return data.templates as any[];
  },
  create: async (formData: FormData) => {
    const res = await fetch('/api/admin/templates', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create template');
    return data.template;
  },
  update: async (id: string, formData: FormData) => {
    const res = await fetch(`/api/admin/templates/${id}`, { method: 'PATCH', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update template');
    return data.template;
  },
  remove: async (id: string) => {
    const res = await fetch(`/api/admin/templates/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete template');
    return data;
  },
};
```

- [ ] **Step 3: Create `hooks/useIsAdmin.ts`**

```ts
// hooks/useIsAdmin.ts
'use client';
import { useEffect, useState } from 'react';
import { userApi } from '@/lib/api/client';

/** Returns whether the current user is an admin (false until resolved). */
export function useIsAdmin(): boolean {
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    let alive = true;
    userApi.me()
      .then(({ user }) => { if (alive) setIsAdmin(user?.is_admin === true); })
      .catch(() => { if (alive) setIsAdmin(false); });
    return () => { alive = false; };
  }, []);
  return isAdmin;
}
```

- [ ] **Step 4: Type check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add lib/api/client.ts lib/api/admin.ts hooks/useIsAdmin.ts
git commit -m "feat(templates): client API wrappers + useIsAdmin hook"
```

---

## Task 10: ConvertToTemplateModal

**Files:**
- Create: `components/editor/ConvertToTemplateModal.tsx`

**Pattern reference:** existing modal chrome in `components/editor/TemplatesModal.tsx` (backdrop/motion/tokens), node chips via `lib/templates/node-chips.ts`.

- [ ] **Step 1: Implement the modal**

```tsx
// components/editor/ConvertToTemplateModal.tsx
'use client';
import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, ImagePlus, LayoutTemplate } from 'lucide-react';
import { adminTemplatesApi } from '@/lib/api/admin';
import { useAppStore } from '@/lib/store/app-store';
import { deriveNodesUsed } from '@/lib/templates/snapshot';
import { nodeChipsFor } from '@/lib/templates/node-chips';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string | null;
  defaultName: string;
}

const CATEGORIES = ['Product Photography', 'Branding', 'Video', 'Image Editing', 'Characters', 'Other'];

export function ConvertToTemplateModal({ isOpen, onClose, sessionId, defaultName }: Props) {
  const currentWorkflow = useAppStore((s) => s.currentWorkflow);
  const [name, setName] = useState(defaultName);
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [howItWorks, setHowItWorks] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [useCasesText, setUseCasesText] = useState('');
  const [publish, setPublish] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const chips = useMemo(
    () => nodeChipsFor(deriveNodesUsed(currentWorkflow as any)),
    [currentWorkflow],
  );
  const filePreview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  const submit = async () => {
    if (!sessionId || !name.trim()) { setError('A name is required.'); return; }
    setSaving(true); setError(null);
    try {
      const fd = new FormData();
      fd.set('session_id', sessionId);
      fd.set('name', name.trim());
      fd.set('description', description);
      fd.set('how_it_works', howItWorks);
      fd.set('category', category);
      fd.set('tags', JSON.stringify(tagsText.split(',').map((t) => t.trim()).filter(Boolean)));
      fd.set('use_cases', JSON.stringify(useCasesText.split('\n').map((t) => t.trim()).filter(Boolean)));
      fd.set('publish', String(publish));
      if (file) fd.set('thumbnail', file);
      await adminTemplatesApi.create(fd);
      setDone(true);
      setTimeout(() => { setDone(false); onClose(); }, 900);
    } catch (e: any) {
      setError(e.message || 'Failed to create template');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div className="fixed inset-0 z-[81] flex items-center justify-center p-6 pointer-events-none"
            initial={{ opacity: 0, scale: 0.96, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }} transition={{ type: 'spring', damping: 28, stiffness: 320 }}>
            <div className="relative w-full max-w-lg max-h-[86vh] overflow-y-auto bg-surface-elevated border border-stroke-subtle rounded-2xl shadow-2xl pointer-events-auto"
              onClick={(e) => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-center justify-between p-5 border-b border-stroke-subtle">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-accent-primary/10 border border-accent-primary/20 flex items-center justify-center">
                    <LayoutTemplate className="w-4 h-4 text-accent-primary" />
                  </div>
                  <div>
                    <h2 className="font-bold text-content-primary text-base">Convert to template</h2>
                    <p className="text-xs text-content-tertiary">Publish this workflow as a reusable template</p>
                  </div>
                </div>
                <button onClick={onClose} className="p-2 hover:bg-surface-tertiary rounded-lg transition-colors">
                  <X className="w-4 h-4 text-content-tertiary" />
                </button>
              </div>

              {/* Body */}
              <div className="p-5 space-y-4">
                {/* Thumbnail */}
                <div>
                  <label className="block text-xs font-semibold text-content-secondary mb-1.5">Thumbnail</label>
                  <label className="flex items-center gap-3 p-3 rounded-xl border border-dashed border-stroke-subtle hover:border-accent-primary/50 cursor-pointer transition-colors">
                    {filePreview
                      ? <img src={filePreview} alt="" className="w-16 h-16 object-cover rounded-lg" />
                      : <div className="w-16 h-16 rounded-lg bg-surface-secondary flex items-center justify-center"><ImagePlus className="w-5 h-5 text-content-tertiary" /></div>}
                    <span className="text-xs text-content-tertiary">
                      {file ? file.name : 'Optional — defaults to the last generated image. Click to upload an override.'}
                    </span>
                    <input type="file" accept="image/*" className="hidden"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                  </label>
                </div>

                <Field label="Name">
                  <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
                </Field>
                <Field label="Category">
                  <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Description">
                  <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputCls} />
                </Field>
                <Field label="How it works (markdown)">
                  <textarea value={howItWorks} onChange={(e) => setHowItWorks(e.target.value)} rows={3} className={inputCls} />
                </Field>
                <Field label="Tags (comma-separated)">
                  <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="ecommerce, lighting" className={inputCls} />
                </Field>
                <Field label="Use cases (one per line)">
                  <textarea value={useCasesText} onChange={(e) => setUseCasesText(e.target.value)} rows={3} className={inputCls} />
                </Field>

                {/* Nodes used (read-only) */}
                <div>
                  <label className="block text-xs font-semibold text-content-secondary mb-1.5">Nodes used</label>
                  <div className="flex flex-wrap gap-1.5">
                    {chips.length === 0
                      ? <span className="text-xs text-content-tertiary">No nodes detected</span>
                      : chips.map((c) => (
                        <span key={c.type} className="flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-full bg-surface-secondary text-content-secondary">
                          <span className="w-2 h-2 rounded-full" style={{ background: c.color }} />{c.label}
                        </span>
                      ))}
                  </div>
                </div>

                <label className="flex items-center gap-2 text-xs text-content-secondary">
                  <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
                  Publish immediately
                </label>

                {error && <p className="text-xs text-accent-error">{error}</p>}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 p-5 border-t border-stroke-subtle">
                <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-content-secondary hover:bg-surface-tertiary transition-colors">Cancel</button>
                <button onClick={submit} disabled={saving || done}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary text-white text-sm font-semibold hover:bg-accent-primary/90 transition-colors disabled:opacity-50">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {done ? 'Saved' : 'Create template'}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

const inputCls = 'w-full bg-surface-primary border border-stroke-subtle rounded-lg px-3 py-2 text-sm text-content-primary placeholder:text-content-tertiary focus:outline-none focus:border-accent-primary/50 transition-colors';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-content-secondary mb-1.5">{label}</label>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add components/editor/ConvertToTemplateModal.tsx
git commit -m "feat(templates): convert-to-template authoring modal"
```

---

## Task 11: Wire the Convert button into the toolbar

**Files:**
- Modify: `components/editor/EditorToolbar.tsx`
- Modify: `components/editor/SharedWorkflowEditor.tsx`

- [ ] **Step 1: Add `isAdmin` prop + button to EditorToolbar**

In `components/editor/EditorToolbar.tsx`:

1. Extend the import on line 4 to include the icon:
```tsx
import { Play, Save, Trash2, FilePlus, MoreVertical, MousePointer, Square, Coins, Loader2, AlertCircle, Eye, LayoutTemplate } from 'lucide-react';
```
2. Add to `EditorToolbarProps` (after line 34 `isViewer?: boolean;`):
```tsx
    isAdmin?: boolean;
    onConvertToTemplate?: () => void;
```
3. Add to the destructured params (after line 48 `isViewer = false,`):
```tsx
    isAdmin = false,
    onConvertToTemplate,
```
4. Render the button next to the owner-only Save Checkpoint button (find the `{isOwner && (` Tooltip block that wraps the `Save` checkpoint icon, ~line 323, and add immediately after its closing `)}`):
```tsx
{isAdmin && isOwner && onConvertToTemplate && (
    <Tooltip content="Convert to template" position="bottom">
        <button
            onClick={onConvertToTemplate}
            className="p-1.5 text-content-tertiary hover:text-content-primary hover:bg-white/10 rounded-md transition-colors"
        >
            <LayoutTemplate className="w-3.5 h-3.5" />
        </button>
    </Tooltip>
)}
```

- [ ] **Step 2: Provide the prop from SharedWorkflowEditor**

In `components/editor/SharedWorkflowEditor.tsx`:

1. Add imports near the other editor imports (top of file):
```tsx
import { useIsAdmin } from '@/hooks/useIsAdmin';
import { ConvertToTemplateModal } from './ConvertToTemplateModal';
```
2. Inside the component body (near `const isViewer = collabRole === 'viewer';`, ~line 159) add:
```tsx
const isAdmin = useIsAdmin();
const [convertOpen, setConvertOpen] = useState(false);
```
3. Pass props to `<EditorToolbar>` (the JSX at ~line 744 — add after `isViewer={isViewer}`):
```tsx
                        isAdmin={isAdmin}
                        onConvertToTemplate={() => setConvertOpen(true)}
```
4. Render the modal once (just before the component's closing root `</div>` at the end of the returned JSX, ~line 790+):
```tsx
            <ConvertToTemplateModal
                isOpen={convertOpen}
                onClose={() => setConvertOpen(false)}
                sessionId={activeCanvasId}
                defaultName={workflowName}
            />
```

> `activeCanvasId` and `workflowName` are already in scope (used by the toolbar at lines 745/753). If `activeCanvasId` is not the correct in-scope name, use the same variable passed to `canvasId={...}` on the existing `<EditorToolbar>`.

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual check**

Run `npm run dev`, open a workflow as an admin owner → the template icon appears in the toolbar; clicking opens the modal. As a non-admin, the icon is absent.

- [ ] **Step 5: Commit**

```bash
git add components/editor/EditorToolbar.tsx components/editor/SharedWorkflowEditor.tsx
git commit -m "feat(templates): admin convert-to-template button in editor toolbar"
```

---

## Task 12: Gallery route rename, nav, middleware, dead-code removal

**Files:**
- Delete: `app/library/page.tsx`, `components/library/WorkflowList.tsx`, `components/library/WorkflowCard.tsx`, `hooks/useWorkflowLibrary.ts`
- Modify: `components/layout/Sidebar.tsx`
- Modify: `middleware.ts`
- Create (stub, fleshed out next task): `app/templates/page.tsx`

- [ ] **Step 1: Update the Sidebar nav item**

In `components/layout/Sidebar.tsx` line 21, replace:
```tsx
    { name: 'Library', path: '/library', icon: BookOpen, desktopOnly: false },
```
with:
```tsx
    { name: 'Templates', path: '/templates', icon: LayoutTemplate, desktopOnly: false },
```
Then ensure `LayoutTemplate` is imported from `lucide-react` at the top of the file (add it to the existing lucide import; `BookOpen` may stay if used elsewhere — otherwise remove it).

- [ ] **Step 2: Update middleware protected routes**

In `middleware.ts`:
- Line 40: change `'/library'` → `'/templates'` in `protectedPageRoutes`.
- Line 77: change `'/library/:path*'` → `'/templates/:path*'` in the matcher.

- [ ] **Step 3: Create a minimal `app/templates/page.tsx` stub**

```tsx
// app/templates/page.tsx
import { TemplatesGallery } from '@/components/templates/TemplatesGallery';

export default function TemplatesPage() {
  return <TemplatesGallery />;
}
```

- [ ] **Step 4: Delete the dead library code**

```bash
git rm app/library/page.tsx components/library/WorkflowList.tsx components/library/WorkflowCard.tsx hooks/useWorkflowLibrary.ts
```
(If `components/library/` has other files, remove the whole dir only if empty afterward.)

- [ ] **Step 5: Remove the dead `getRecentWorkflows` path**

In `lib/db/workflows.ts`, delete the `getRecentWorkflows` function (it was only used by the removed hook). Run a grep to confirm no other importers:
Run: `git grep -n "getRecentWorkflows"`
Expected: no matches after deletion.

- [ ] **Step 6: Type check (will fail until Task 13 adds TemplatesGallery — acceptable interim, but verify only the non-gallery errors)**

Run: `npx tsc --noEmit`
Expected: the only error references the missing `@/components/templates/TemplatesGallery` import — resolved in Task 13. No other errors (e.g. no dangling `useWorkflowLibrary`/`getRecentWorkflows` references).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(templates): rename /library route to /templates, drop dead library code"
```

---

## Task 13: Templates gallery UI

**Files:**
- Create: `components/templates/TemplatesGallery.tsx`
- Create: `components/templates/TemplateCard.tsx`
- Create: `components/templates/TemplatePreviewModal.tsx`

> During this task, use the `ui-styling` / `ui-ux-pro-max` design skills to refine spacing, type scale, and grid rhythm. Keep all colors on the existing semantic tokens (`surface-*`, `content-*`, `stroke-*`, `accent-*`) and the `.glassmorphism` utility — do not introduce new theme values.

- [ ] **Step 1: TemplateCard**

```tsx
// components/templates/TemplateCard.tsx
'use client';
import React from 'react';
import { Sparkles, Users } from 'lucide-react';

export interface TemplateListItem {
  id: string; name: string; description: string | null; thumbnail_url: string | null;
  category: string | null; tags: string[]; source: 'official' | 'community';
  created_by_name: string | null; usage_count: number;
}

export function TemplateCard({ tpl, onOpen }: { tpl: TemplateListItem; onOpen: () => void }) {
  return (
    <button onClick={onOpen}
      className="group text-left bg-surface-secondary border border-stroke-subtle rounded-2xl overflow-hidden hover:border-accent-primary/40 hover:shadow-lg transition-all">
      <div className="aspect-[4/3] bg-surface-tertiary overflow-hidden">
        {tpl.thumbnail_url
          ? <img src={tpl.thumbnail_url} alt={tpl.name} className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300" />
          : <div className="w-full h-full flex items-center justify-center text-content-tertiary"><Sparkles className="w-6 h-6" /></div>}
      </div>
      <div className="p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-sm text-content-primary truncate">{tpl.name}</h3>
          {tpl.category && <span className="shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full bg-surface-tertiary text-content-tertiary">{tpl.category}</span>}
        </div>
        {tpl.description && <p className="text-xs text-content-secondary line-clamp-2">{tpl.description}</p>}
        <div className="flex items-center justify-between pt-1">
          <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-accent-primary">
            <Sparkles className="w-3 h-3" /> {tpl.source === 'official' ? 'Official' : tpl.created_by_name}
          </span>
          <span className="flex items-center gap-1 text-[10px] text-content-tertiary"><Users className="w-3 h-3" />{tpl.usage_count}</span>
        </div>
      </div>
    </button>
  );
}
```

- [ ] **Step 2: TemplatePreviewModal**

```tsx
// components/templates/TemplatePreviewModal.tsx
'use client';
import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { X, Loader2, Sparkles } from 'lucide-react';
import { templatesApi } from '@/lib/api/client';
import { nodeChipsFor } from '@/lib/templates/node-chips';

export function TemplatePreviewModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const router = useRouter();
  const [tpl, setTpl] = useState<any | null>(null);
  const [using, setUsing] = useState(false);

  useEffect(() => {
    if (!id) { setTpl(null); return; }
    let alive = true;
    templatesApi.get(id).then(({ template }) => { if (alive) setTpl(template); }).catch(() => {});
    return () => { alive = false; };
  }, [id]);

  const useTemplate = async () => {
    if (!id) return;
    setUsing(true);
    try { const { session_id } = await templatesApi.use(id); router.push(`/chat/${session_id}`); }
    catch { setUsing(false); }
  };

  const chips = tpl ? nodeChipsFor(tpl.nodes_used || []) : [];

  return (
    <AnimatePresence>
      {id && (
        <>
          <motion.div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div className="fixed inset-0 z-[81] flex items-center justify-center p-6 pointer-events-none"
            initial={{ opacity: 0, scale: 0.96, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }} transition={{ type: 'spring', damping: 28, stiffness: 320 }}>
            <div className="relative w-full max-w-2xl max-h-[88vh] overflow-y-auto bg-surface-elevated border border-stroke-subtle rounded-2xl shadow-2xl pointer-events-auto"
              onClick={(e) => e.stopPropagation()}>
              <button onClick={onClose} className="absolute top-4 right-4 z-10 p-2 bg-black/30 hover:bg-black/50 rounded-lg transition-colors">
                <X className="w-4 h-4 text-white" />
              </button>
              {!tpl ? (
                <div className="h-64 flex items-center justify-center text-content-tertiary"><Loader2 className="w-5 h-5 animate-spin" /></div>
              ) : (
                <>
                  <div className="aspect-[16/9] bg-surface-tertiary overflow-hidden">
                    {tpl.thumbnail_url
                      ? <img src={tpl.thumbnail_url} alt={tpl.name} className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-content-tertiary"><Sparkles className="w-8 h-8" /></div>}
                  </div>
                  <div className="p-6 space-y-5">
                    <div>
                      <h2 className="text-xl font-bold text-content-primary">{tpl.name}</h2>
                      <p className="text-xs text-accent-primary font-semibold uppercase tracking-wide mt-1">
                        {tpl.source === 'official' ? 'Official template' : `by ${tpl.created_by_name}`}
                        {tpl.category ? ` · ${tpl.category}` : ''}
                      </p>
                    </div>
                    {tpl.description && <p className="text-sm text-content-secondary">{tpl.description}</p>}
                    {tpl.how_it_works && (
                      <Section title="How it works">
                        <p className="text-sm text-content-secondary whitespace-pre-wrap">{tpl.how_it_works}</p>
                      </Section>
                    )}
                    {tpl.use_cases?.length > 0 && (
                      <Section title="Use cases">
                        <ul className="list-disc list-inside text-sm text-content-secondary space-y-1">
                          {tpl.use_cases.map((u: string, i: number) => <li key={i}>{u}</li>)}
                        </ul>
                      </Section>
                    )}
                    {chips.length > 0 && (
                      <Section title="Nodes used">
                        <div className="flex flex-wrap gap-1.5">
                          {chips.map((c) => (
                            <span key={c.type} className="flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-full bg-surface-secondary text-content-secondary">
                              <span className="w-2 h-2 rounded-full" style={{ background: c.color }} />{c.label}
                            </span>
                          ))}
                        </div>
                      </Section>
                    )}
                    {tpl.tags?.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {tpl.tags.map((t: string) => (
                          <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-surface-tertiary text-content-tertiary">#{t}</span>
                        ))}
                      </div>
                    )}
                    <button onClick={useTemplate} disabled={using}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-accent-primary text-white text-sm font-semibold hover:bg-accent-primary/90 transition-colors disabled:opacity-50">
                      {using ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                      Use this template
                    </button>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-wide text-content-tertiary mb-2">{title}</h3>
      {children}
    </div>
  );
}
```

- [ ] **Step 3: TemplatesGallery (page body)**

```tsx
// components/templates/TemplatesGallery.tsx
'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { Search, Loader2, Sparkles } from 'lucide-react';
import { templatesApi } from '@/lib/api/client';
import { TemplateCard, TemplateListItem } from './TemplateCard';
import { TemplatePreviewModal } from './TemplatePreviewModal';

export function TemplatesGallery() {
  const [items, setItems] = useState<TemplateListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    templatesApi.list()
      .then(({ templates }) => { if (alive) setItems(templates as TemplateListItem[]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const categories = useMemo(
    () => Array.from(new Set(items.map((t) => t.category).filter(Boolean))) as string[],
    [items],
  );
  const filtered = useMemo(() => items.filter((t) =>
    (!category || t.category === category) &&
    (!search || t.name.toLowerCase().includes(search.toLowerCase()))
  ), [items, category, search]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-content-primary">Templates</h1>
          <p className="text-sm text-content-secondary mt-1">Start from a proven workflow — preview it, then make it yours.</p>
        </div>

        {/* Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-content-tertiary" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search templates…"
              className="w-full bg-surface-secondary border border-stroke-subtle rounded-lg pl-9 pr-3 py-2 text-sm text-content-primary placeholder:text-content-tertiary focus:outline-none focus:border-accent-primary/50" />
          </div>
          <div className="flex items-center gap-2 overflow-x-auto">
            <Pill active={!category} onClick={() => setCategory(null)}>All</Pill>
            {categories.map((c) => <Pill key={c} active={category === c} onClick={() => setCategory(c)}>{c}</Pill>)}
          </div>
        </div>

        {/* Grid */}
        {loading ? (
          <div className="h-64 flex items-center justify-center text-content-tertiary"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center gap-3 text-content-tertiary">
            <Sparkles className="w-7 h-7 opacity-40" />
            <p className="text-sm">No templates yet</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map((t) => <TemplateCard key={t.id} tpl={t} onOpen={() => setPreviewId(t.id)} />)}
          </div>
        )}
      </div>
      <TemplatePreviewModal id={previewId} onClose={() => setPreviewId(null)} />
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${active ? 'bg-accent-primary text-white' : 'bg-surface-secondary text-content-secondary hover:text-content-primary'}`}>
      {children}
    </button>
  );
}
```

- [ ] **Step 4: Type check**

Run: `npx tsc --noEmit`
Expected: no errors (the Task 12 stub import now resolves).

- [ ] **Step 5: Manual check**

`npm run dev` → visit `/templates`. With at least one published template (create one via the convert modal first), the card grid, category pills, search, preview modal, and "Use this template" (→ navigates to a new `/chat/<id>`) all work.

- [ ] **Step 6: Commit**

```bash
git add components/templates app/templates/page.tsx
git commit -m "feat(templates): redesigned /templates gallery with preview + clone"
```

---

## Task 14: Repurpose the in-canvas TemplatesModal

**Files:**
- Modify: `components/editor/TemplatesModal.tsx`

Goal: drop the hardcoded `BUILTIN_TEMPLATES`, the "Mine" tab, and the private "Save current" path. Fetch **published official** templates from `templatesApi.list()` and keep the existing "load into current canvas" (with the confirm row) behavior via `onLoad`.

- [ ] **Step 1: Replace data source + remove private save**

Rewrite the component so that:
1. Remove the `BUILTIN_TEMPLATES` array and the `TemplateDefinition` interface (lines 13–158).
2. Remove `tab`/`'mine'` state, `fetchMyTemplates`, `handleSaveCurrent`, the "Save current" header button, and the tab switcher (the `builtin`/`mine` UI).
3. Load templates on open from the API and map them to cards; `onLoad` receives `tpl.workflow`:

```tsx
// inside the component, replacing the built-in/mine logic:
const [templates, setTemplates] = useState<any[]>([]);
const [loading, setLoading] = useState(false);

useEffect(() => {
  if (!isOpen) return;
  setLoading(true);
  templatesApi.list()
    .then(({ templates }) => setTemplates(templates))
    .finally(() => setLoading(false));
}, [isOpen]);

const filtered = templates.filter((t) =>
  !search || t.name.toLowerCase().includes(search.toLowerCase())
);
```
Add the import: `import { templatesApi } from '@/lib/api/client';` and remove the now-unused `createClient`/`useAppStore` (keep `useAppStore` only if still referenced).

> Note: the list endpoint returns metadata but **not** `workflow`. The in-canvas "load" needs the graph, so fetch it on confirm:
```tsx
const handleConfirmLoad = async (templateId: string) => {
  const { template } = await templatesApi.get(templateId); // detail (still no workflow — see below)
  // ...
};
```
**Decision:** to keep `onLoad` working without exposing full `workflow` on the public detail endpoint, the in-canvas modal clones via the same path as the gallery is overkill (it creates a new session). Instead, the modal should load the graph into the *current* canvas. Add a `workflow` field to the **detail** response for this purpose:

- In `app/api/templates/[id]/route.ts` add `workflow` to the `.select(...)` list (it's already RLS-gated to published). Re-commit that file as part of this task.

Then:
```tsx
const handleConfirmLoad = async (templateId: string) => {
  const { template } = await templatesApi.get(templateId);
  onLoad({ nodes: template.workflow?.nodes ?? [], edges: template.workflow?.edges ?? [] });
  onClose();
};
```
Wire each `TemplateCard`'s `onConfirm` to `handleConfirmLoad(tpl.id)`.

4. Update the empty state to a simple "No templates available yet" (remove `MyTemplatesEmpty`).

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: no new errors. Run `git grep -n "BUILTIN_TEMPLATES\|template_type"` and confirm no remaining references in app code.

- [ ] **Step 3: Manual check**

`npm run dev` → in a canvas, open the Templates panel from the ToolRail → published official templates list; selecting one and confirming loads it into the current canvas (existing "replace" confirm).

- [ ] **Step 4: Commit**

```bash
git add components/editor/TemplatesModal.tsx app/api/templates/[id]/route.ts
git commit -m "refactor(templates): repurpose in-canvas TemplatesModal to published official templates"
```

---

## Task 15: Admin management section

**Files:**
- Create: `components/admin/TemplatesAdminContent.tsx`
- Modify: `app/admin/page.tsx`

**Pattern reference:** existing `*AdminContent.tsx` components and the providers card/grid in `app/admin/page.tsx`.

- [ ] **Step 1: Build TemplatesAdminContent**

```tsx
// components/admin/TemplatesAdminContent.tsx
'use client';
import React, { useEffect, useState } from 'react';
import { Loader2, Trash2, Eye, EyeOff, Archive, ArrowLeft } from 'lucide-react';
import { adminTemplatesApi } from '@/lib/api/admin';
import { ConfirmationModal } from '@/components/ui/ConfirmationModal';

export function TemplatesAdminContent({ onMobileBack }: { onMobileBack?: () => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    adminTemplatesApi.list().then(setRows).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const setStatus = async (id: string, status: string) => {
    setBusyId(id);
    const fd = new FormData(); fd.set('status', status);
    try { await adminTemplatesApi.update(id, fd); load(); } finally { setBusyId(null); }
  };
  const remove = async (id: string) => {
    setBusyId(id);
    try { await adminTemplatesApi.remove(id); setConfirmId(null); load(); } finally { setBusyId(null); }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {onMobileBack && (
        <button onClick={onMobileBack} className="md:hidden flex items-center gap-1 text-sm text-content-secondary mb-4">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
      )}
      <h2 className="text-lg font-bold text-content-primary mb-1">Templates</h2>
      <p className="text-sm text-content-secondary mb-6">Manage official templates. Create new ones from a workflow via the editor's “Convert to template” button.</p>

      {loading ? (
        <div className="h-40 flex items-center justify-center text-content-tertiary"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-content-tertiary">No templates yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((t) => (
            <div key={t.id} className="flex items-center gap-3 p-3 rounded-xl border border-stroke-subtle bg-surface-secondary">
              <div className="w-14 h-14 rounded-lg bg-surface-tertiary overflow-hidden shrink-0">
                {t.thumbnail_url && <img src={t.thumbnail_url} alt="" className="w-full h-full object-cover" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm text-content-primary truncate">{t.name}</div>
                <div className="text-xs text-content-tertiary">
                  {t.source} · {t.status} · {t.category || 'Uncategorized'} · {t.usage_count} uses
                </div>
              </div>
              <div className="flex items-center gap-1">
                {t.status !== 'published' && (
                  <IconBtn title="Publish" busy={busyId === t.id} onClick={() => setStatus(t.id, 'published')}><Eye className="w-4 h-4" /></IconBtn>
                )}
                {t.status === 'published' && (
                  <IconBtn title="Unpublish" busy={busyId === t.id} onClick={() => setStatus(t.id, 'draft')}><EyeOff className="w-4 h-4" /></IconBtn>
                )}
                <IconBtn title="Archive" busy={busyId === t.id} onClick={() => setStatus(t.id, 'archived')}><Archive className="w-4 h-4" /></IconBtn>
                <IconBtn title="Delete" busy={busyId === t.id} onClick={() => setConfirmId(t.id)}><Trash2 className="w-4 h-4 text-accent-error" /></IconBtn>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmationModal
        isOpen={!!confirmId}
        title="Delete template?"
        message="This permanently removes the template and its thumbnail. Existing clones are unaffected."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => confirmId && remove(confirmId)}
        onCancel={() => setConfirmId(null)}
      />
    </div>
  );
}

function IconBtn({ title, onClick, busy, children }: { title: string; onClick: () => void; busy?: boolean; children: React.ReactNode }) {
  return (
    <button title={title} onClick={onClick} disabled={busy}
      className="p-2 rounded-lg hover:bg-surface-tertiary text-content-secondary hover:text-content-primary transition-colors disabled:opacity-50">
      {children}
    </button>
  );
}
```

> Verify the `ConfirmationModal` prop names against `components/ui/ConfirmationModal.tsx` before finishing this step; adjust `title`/`message`/`confirmLabel`/`variant`/`onConfirm`/`onCancel` to the actual API if they differ.

- [ ] **Step 2: Register the admin section**

In `app/admin/page.tsx`:
1. Import the icon + component:
```tsx
import { LayoutTemplate } from 'lucide-react';
import { TemplatesAdminContent } from '@/components/admin/TemplatesAdminContent';
```
2. Add to `sectionNavItems` (after the `failures` entry, ~line 76):
```tsx
    { id: 'templates', label: 'Templates', icon: <LayoutTemplate className="w-4 h-4" /> },
```
3. Add the `SectionId` union member `'templates'` if the type is a literal union (search for `type SectionId`); add it.
4. Render it (after the `failures` render line, ~line 205):
```tsx
                {activeSection === 'templates' && <TemplatesAdminContent onMobileBack={() => setMobileShowContent(false)} />}
```

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual check**

`npm run dev` → `/admin?section=templates` lists templates; publish/unpublish/archive/delete work and reflect on the `/templates` gallery.

- [ ] **Step 5: Commit**

```bash
git add components/admin/TemplatesAdminContent.tsx app/admin/page.tsx
git commit -m "feat(templates): admin templates management section"
```

---

## Task 16: Final verification + memory

**Files:** none (verification + memory note)

- [ ] **Step 1: Full type check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 2: Grep for leftovers**

Run: `git grep -n "useWorkflowLibrary\|getRecentWorkflows\|BUILTIN_TEMPLATES\|/library\|template_type\|is_public"`
Expected: no references in `app/`, `components/`, `hooks/`, `lib/` (matches only inside `supabase/migrations/` history and `docs/` are acceptable).

- [ ] **Step 3: Manual E2E checklist** (`npm run dev`)

  - Admin, in a workflow with at least one generated image → toolbar shows the template icon → Convert modal → fill fields → Create → success.
  - `/admin?section=templates` shows the new template as `published`.
  - `/templates` gallery shows the card (thumbnail = last image output); search + category pill filter work.
  - Preview modal shows description / how-it-works / use-cases / node chips / tags; "Use this template" opens a fresh `/chat/<id>` whose canvas matches the template with no stale outputs.
  - Non-admin user: no convert button; can browse + clone.
  - In-canvas Templates panel (ToolRail) lists the published official template and loads it into the current canvas.
  - Admin unpublish → the card disappears from `/templates`; admin delete → row + thumbnail gone.

- [ ] **Step 4: Update project memory**

Update `C:\Users\user\.claude\projects\c--Projects-Prisfol-PrismAi\memory\MEMORY.md` + a new memory file noting: workflow-templates feature shipped on main; one `workflow_templates` table (source/status), admin-only RLS, `increment_template_usage` RPC, `template-thumbnails` bucket; `/library`→`/templates`; migration `20260605` must be applied; remaining = in-app E2E if not yet run.

- [ ] **Step 5: Commit any remaining changes**

```bash
git add -A
git commit -m "chore(templates): final verification pass"
```

---

## Self-review notes (already reconciled)

- **Spec coverage:** schema evolution (T1), admin convert button+modal+API (T5, T10, T11), thumbnail auto+override (T4), public gallery redesign + route rename + dead-code removal (T12, T13), clone-to-new-session (T8), in-canvas modal repurpose (T14), admin management (T15), future community tier (columns `source`/`created_by_name` + admin "Promote to official" via PATCH `source`) — all covered.
- **Type consistency:** column/JSON field names are snake_case throughout (`how_it_works`, `use_cases`, `nodes_used`, `created_by_name`, `usage_count`); helper names `sanitizeTemplateWorkflow`/`deriveNodesUsed`/`nodeChipsFor`/`resolveThumbnailFromSession`/`uploadTemplateThumbnail` are used identically across tasks.
- **Known verify-before-finish spots (called out inline):** `profiles` display-name column (T5 S2), `ConfirmationModal` prop names (T15 S1), `SectionId` union type (T15 S2), and `activeCanvasId` variable name in `SharedWorkflowEditor` (T11 S2).
