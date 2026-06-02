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
  user_id      uuid REFERENCES auth.users(id) ON DELETE CASCADE,
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
DROP POLICY IF EXISTS "collab read" ON public.session_collaborators;
CREATE POLICY "collab read" ON public.session_collaborators FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.sessions s
               WHERE s.id = session_collaborators.session_id AND s.user_id = auth.uid())
  );
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
-- Executions table: "executions" (verified — app code uses .from('executions'))
DROP POLICY IF EXISTS "Users can view their own executions" ON public.executions;
CREATE POLICY "Users can view accessible executions" ON public.executions FOR SELECT
  USING (public.can_access_session(session_id));

-- node_results has a session_id column (added by 20260323_add_session_id_to_node_results.sql).
-- Current live policy name is "Users can view session results"
-- (set by 20260602_preserve_results_on_session_delete.sql — drops and recreates from prior name).
DROP POLICY IF EXISTS "Users can view session results" ON public.node_results;
CREATE POLICY "Users can view accessible node_results" ON public.node_results FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.can_access_session(session_id)
    OR EXISTS (
      SELECT 1 FROM public.executions e
      WHERE e.id = node_results.execution_id
      AND public.can_access_session(e.session_id)
    )
  );

-- 8. RPC: map email → user id --------------------------------------------------
CREATE OR REPLACE FUNCTION public.find_user_id_by_email(p_email text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT id FROM auth.users WHERE lower(email) = lower(p_email) LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.find_user_id_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_user_id_by_email(text) TO authenticated, service_role;

-- 9. RPC: accept an invite by token --------------------------------------------
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

-- 10. CLAIM TRIGGER ------------------------------------------------------------
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
