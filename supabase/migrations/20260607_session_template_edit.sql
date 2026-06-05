-- Migration: admin template editing via a reusable Studio "edit session"
-- Date: 2026-06-07
-- An admin edits a template's graph on a real canvas. We back that with a hidden,
-- reusable session per (admin, template): seeded from the template's workflow,
-- edited like any session, then saved back onto the template. The column lets us
-- find/reuse that session and hide it from the normal session list / sidebar.

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS template_edit_id UUID
    REFERENCES public.workflow_templates(id) ON DELETE CASCADE;

-- Partial index: the only lookups are "this admin's edit session for template X".
CREATE INDEX IF NOT EXISTS idx_sessions_template_edit
  ON public.sessions (user_id, template_edit_id)
  WHERE template_edit_id IS NOT NULL;

-- No RLS change: existing owner policies on sessions already scope these rows to
-- the admin who owns them.

DO $$ BEGIN RAISE NOTICE '✅ sessions.template_edit_id added.'; END $$;
