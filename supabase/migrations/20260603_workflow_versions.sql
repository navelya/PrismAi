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
CREATE INDEX IF NOT EXISTS idx_workflow_versions_canvas_kind_created
  ON public.workflow_versions (canvas_id, kind, created_at DESC);

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
