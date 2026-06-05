# Workflow Templates — Design

**Date:** 2026-06-05
**Status:** Approved (pending spec review)

## Overview

Today's `/library` page lists nothing (the old "my workflows" query is hardcoded to
`'anonymous'` and effectively dead). We are replacing it with a **Templates** experience:

1. **Admins** can convert any workflow they're editing into a reusable **template** with a
   photo, description, "how it works", category, tags, and use cases.
2. A redesigned **`/templates` gallery** lets every user browse published templates, preview
   them, and clone one into a brand-new workflow of their own.
3. The data model is built for a **future "community" (user-created/shared) tier** without a
   schema migration — only admin-created (`official`) templates are exposed now.

This feature is **partially pre-existing**: there is a `workflow_templates` table
(`supabase/migrations/20260430_workflow_templates.sql`) and an in-canvas `TemplatesModal`
(`components/editor/TemplatesModal.tsx`) wired to the ToolRail. Both are WIP. This design
**evolves the existing table in place** and **repurposes the existing modal** rather than
creating parallel systems.

## Goals

- Admin-authored templates with rich metadata, created from a live workflow.
- A professional, modern, minimal gallery that matches the app's existing theme
  (semantic Tailwind tokens + glassmorphism) — no new theme, nothing broken.
- One `workflow_templates` table that scales to thousands of future community rows while
  keeping the ~30–50 official ones instantly queryable (indexed `source`/`status`).
- Cloning a template never runs the graph → **no credits** are touched until the user runs it.

## Non-goals (future work)

- User-created / user-shared templates and any moderation/submission queue.
- A separate `template_submissions` table (only add if community moderation later needs a queue).
- "Update template from current canvas" (templates are frozen snapshots; re-convert to refresh).
- Server-side video-to-thumbnail rendering (see Thumbnails).

---

## Reconciliation with existing WIP

| Existing | Decision |
|---|---|
| `workflow_templates` table (simple schema, user-owned RLS) | **Evolve in place** — add columns, remap values, swap to admin-only RLS. |
| `TemplatesModal` (hardcoded built-ins + private "save mine" + load-replaces-canvas) | **Repurpose** — drop hardcoded built-ins and the private "save mine"; read published `official` templates from the new system. Keep the in-editor "load into current canvas (with confirm)" behavior as a quick-insert surface. |
| ToolRail "Templates" button | Keep — opens the repurposed modal. |

Two surfaces, one data source, distinct roles:
- **`/templates` gallery** → browse + preview + **clone into a NEW session**.
- **In-canvas `TemplatesModal`** → quick **load into the CURRENT canvas** (existing confirm dialog).

---

## Data model

### Table: `workflow_templates` (evolved)

Migration adds columns and rewrites RLS. Existing columns kept: `id`, `name`, `description`,
`workflow` (jsonb nodes+edges — the frozen snapshot), `thumbnail_url`, `created_at`, `updated_at`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | existing |
| `name` | text not null | existing — template title |
| `description` | text | existing — short tagline |
| `workflow` | jsonb not null | existing — **frozen** deep copy of `{nodes, edges}` |
| `thumbnail_url` | text | existing — hero image (see Thumbnails) |
| `how_it_works` | text | **new** — longer body, rendered as markdown |
| `category` | text | **new** — single category, drives gallery sections |
| `tags` | text[] default `'{}'` | **new** — searchable keywords |
| `use_cases` | text[] default `'{}'` | **new** — bullet list |
| `nodes_used` | text[] default `'{}'` | **new** — auto-derived node types |
| `source` | text default `'official'` | **new** — `'official' \| 'community'`; replaces `template_type` |
| `status` | text default `'draft'` | **new** — `'draft' \| 'published' \| 'archived'`; replaces `is_public` |
| `created_by` | uuid → auth.users | **renamed** from `user_id` — author |
| `created_by_name` | text | **new** — denormalized author display name |
| `source_session_id` | uuid → sessions(id) null | **new** — provenance of the conversion |
| `usage_count` | int default 0 | **new** — times cloned (enables "Popular" sort) |
| `published_at` | timestamptz null | **new** |

**Migration steps (in one migration file):**
1. `ALTER TABLE ... ADD COLUMN` for all new columns.
2. Rename `user_id` → `created_by`.
3. `ADD COLUMN source`; backfill `template_type='builtin'→'official'`, `'user'→'community'`; `DROP COLUMN template_type`.
4. `ADD COLUMN status`; backfill `is_public=true→'published'` (set `published_at=now()`), `false→'draft'`; `DROP COLUMN is_public`.
5. Add CHECK constraints for `source` and `status`.

**Indexes:** `(source, status)`, `category`, GIN on `tags`. (Keeps "official + published" instant.)

**RLS (replaces existing user-owned policies):**
- `SELECT`: `auth.uid() IS NOT NULL AND status = 'published'` **OR** `public.is_admin()`.
- `INSERT / UPDATE / DELETE`: `public.is_admin()`.
- Keep the existing `service_role` ALL policy.

> Per the project rule (memory: *admin-routes-need-rls-policies*), `/api/admin/*` uses the
> RLS-scoped session client, so admin write access is granted via `public.is_admin()` policies,
> not the service-role client. The clone endpoint's `usage_count` bump (a non-admin write) goes
> through a `SECURITY DEFINER` RPC — see Clone flow.

### Storage bucket: `template-thumbnails`

New public-read bucket; writes restricted to `public.is_admin()` (mirrors `provider-logos`).
Path: `templates/{templateId}/{uuid}.{ext}`.

---

## Convert-to-template (admin authoring)

### Trigger button
- Added to the `EditorToolbar` Actions Island (`components/editor/EditorToolbar.tsx`), beside
  Save Checkpoint, gated on `isAdmin && canEdit`.
- Client admin flag: new tiny `useIsAdmin()` hook reading `userApi.me().is_admin`
  (`/api/user/me` already returns `is_admin`). Pass `isAdmin` down through
  `SharedWorkflowEditor` → `EditorToolbar` like the existing `isOwner`/`isViewer` props.

### `ConvertToTemplateModal` (`components/editor/ConvertToTemplateModal.tsx`)
- **Thumbnail:** preview auto-filled from the workflow's last output (see Thumbnails) with an
  upload-override file input.
- **Inputs:** name (prefilled from workflow title), category (Select), tags (chip input),
  description (Textarea), how-it-works (Textarea/markdown), use-cases (repeatable list).
- **Read-only:** nodes used (auto-derived, shown as node-icon chips via the node registry meta)
  and created-by (current admin's name).
- **Publish now** toggle (default ON → `status='published'`; off → `'draft'`).
- Submits `FormData` (so an optional uploaded file rides along, like the providers form).

### `POST /api/admin/templates`
- `requireAdmin`.
- Reads the source session's `canvas_state`; **deep-snapshots** it into `workflow`
  (sanitized: positions/types/config kept; runtime/output fields dropped).
- Derives `nodes_used` = unique `node.type` values excluding `group_container`.
- Resolves thumbnail: if a file was uploaded → store it in `template-thumbnails`; else fetch the
  last successful **image** output and copy it into the bucket (reuse the fetch→upload pattern in
  `lib/utils/image-processing.ts`). If no image output exists, the modal requires an upload.
- Inserts the row with `source='official'`, `created_by`/`created_by_name`,
  `source_session_id`, `status`, and `published_at` when published.

**Snapshot semantics:** like the existing `character` node, a template is frozen — later edits to
the source workflow do **not** change the template.

---

## Thumbnails

- **Auto source:** the workflow's most recent successful **image** output (from
  `executions`/`node_results`). It is **copied into `template-thumbnails`** at convert time so it
  survives output GC.
- **Video-only workflows:** server-side video framing is out of scope. If the only outputs are
  video, the modal prompts the admin to upload a thumbnail (the video is shown as reference).
- **Override:** admin upload always wins.

---

## `/templates` gallery (full redesign)

### Routing / cleanup
- Rename route `app/library` → `app/templates`.
- Sidebar nav (`components/layout/Sidebar.tsx`): label **Library → Templates**, icon updated,
  path `/library → /templates` (all three sidebar variants).
- Update the middleware gate `/library → /templates`.
- **Delete** dead code: `components/library/*`, `hooks/useWorkflowLibrary.ts`, and the unused
  `getRecentWorkflows` library path in `lib/db/workflows.ts`.

### UI (`components/templates/`)
Built with the `ui-ux-pro-max` / `ui-styling` design skills during implementation, on the app's
existing semantic tokens + glassmorphism (modern, minimal; no new theme).
- **Page header**, search, and **category filter pills**; responsive card grid.
- **`TemplateCard`:** thumbnail, name, category badge, short description, tag chips,
  author/"Official" badge, usage count; hover-elevate.
- **`TemplatePreviewModal`:** large thumbnail, description, how-it-works (markdown), use-cases,
  node-icon chips, tags, author; primary CTA **"Use this template."**
- Empty state.

### Public API
- `GET /api/templates` — published only; optional `category`, `tag`, `q`, `source` filters
  (defaults to `source=official`). RLS already restricts to published.
- `GET /api/templates/[id]` — single published template for the preview modal.

---

## Use a template (clone)

`POST /api/templates/[id]/use`:
1. Auth required (any signed-in user).
2. Read the template (RLS ⇒ must be published).
3. Create a **new `sessions` row** owned by the user: `title = template.name`,
   `canvas_state =` sanitized deep copy of `template.workflow` (clear per-node `output`,
   `outputMetadata`, `status`, `errorMessage`, `isNew`). **Reuse/extract the existing
   "Duplicate to My Files" sanitizer** in the editor so behavior stays consistent.
4. Increment `usage_count` via a `SECURITY DEFINER` RPC `increment_template_usage(template_id)`
   (regular users can't UPDATE the template under RLS).
5. Return the new session id; client navigates to `/chat/[newId]`.

Cloning does not dispatch any node → **no credit debit**.

---

## Admin management — `/admin?section=templates`

- New "Templates" nav item in the single-page `/admin` (`app/admin/page.tsx`), matching the
  Models/Providers/Users patterns.
- **`TemplatesAdminContent`** (`components/admin/`): list all templates (any status/source);
  edit `name`/`description`/`how_it_works`/`category`/`tags`/`use_cases`/thumbnail; change
  **status** (publish / unpublish→draft / archive); delete (with `ConfirmationModal`, also
  removing the bucket image). Editing the recipe (`workflow`) is **not** supported here — that's
  what re-convert is for.
- A **"Promote to official"** action (`source='community' → 'official'`) is included for when the
  community tier exists; it's a no-op surface until then.
- APIs: `GET /api/admin/templates` (all), `PATCH /api/admin/templates/[id]`,
  `DELETE /api/admin/templates/[id]`. (`POST` is shared with the convert flow.)

---

## Files touched (summary)

**DB / storage**
- `supabase/migrations/20260605_evolve_workflow_templates.sql` — table evolution, RLS, RPC, bucket.

**Server / API**
- `app/api/admin/templates/route.ts` (GET, POST)
- `app/api/admin/templates/[id]/route.ts` (PATCH, DELETE)
- `app/api/templates/route.ts` (GET)
- `app/api/templates/[id]/route.ts` (GET)
- `app/api/templates/[id]/use/route.ts` (POST)
- `lib/api/admin.ts`, `lib/api/client.ts` — client wrappers.

**Client — authoring**
- `hooks/useIsAdmin.ts` (new)
- `components/editor/EditorToolbar.tsx` — Convert button (admin+canEdit)
- `components/editor/SharedWorkflowEditor.tsx` — thread `isAdmin`
- `components/editor/ConvertToTemplateModal.tsx` (new)

**Client — gallery (redesign)**
- `app/templates/page.tsx` (replaces `app/library/page.tsx`)
- `components/templates/*` (new: gallery, card, preview modal, filters)
- Remove `components/library/*`, `hooks/useWorkflowLibrary.ts`, dead `getRecentWorkflows` path.

**Client — in-canvas modal repurpose**
- `components/editor/TemplatesModal.tsx` — drop hardcoded built-ins + private "save mine"; read
  published official templates; keep load-into-current-canvas (confirm).

**Admin management**
- `app/admin/page.tsx` — add Templates section nav.
- `components/admin/TemplatesAdminContent.tsx` (new)

**Nav / middleware**
- `components/layout/Sidebar.tsx`, middleware route gate.

---

## Open questions / risks

- **Node-icon chips** in the convert modal, preview, and admin list need a client-safe lookup of
  node `label`/`icon`/`color` from the shared registry (no server registry import in client).
- **`created_by_name`** source: from the admin's `profiles` display name at convert time;
  official cards render an **"Official"** badge rather than the personal name.
- The migration renames `user_id → created_by` and drops `template_type`/`is_public`; the existing
  table is WIP with negligible real data, so backfill is low-risk, but the migration must run
  before the repurposed modal/code ships.
