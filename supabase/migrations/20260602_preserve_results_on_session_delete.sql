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
