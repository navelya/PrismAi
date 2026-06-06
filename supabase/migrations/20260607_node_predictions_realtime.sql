-- Expose node_predictions to client realtime so per-iteration results stream to
-- the chat as each prediction completes (concurrent-streaming-iterations feature).
-- The table was previously server-only (RLS enabled, no policies). We add a
-- user-scoped SELECT policy (via execution → session ownership), grant SELECT to
-- authenticated, set REPLICA IDENTITY FULL (so UPDATE payloads carry the row),
-- and add it to the realtime publication. The service role still bypasses RLS for
-- all writes from the dispatcher/webhook.

-- 1. User-scoped read access (realtime authorizes the subscriber via RLS).
DROP POLICY IF EXISTS "Users can view predictions of their own executions" ON public.node_predictions;
CREATE POLICY "Users can view predictions of their own executions" ON public.node_predictions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.executions
      JOIN public.sessions ON sessions.id = executions.session_id
      WHERE executions.id = node_predictions.execution_id
        AND sessions.user_id = auth.uid()
    )
  );

-- 2. Service role keeps full write access (explicit, matches node_results).
DROP POLICY IF EXISTS "Service Role can manage predictions" ON public.node_predictions;
CREATE POLICY "Service Role can manage predictions" ON public.node_predictions
  FOR ALL USING (auth.role() = 'service_role');

-- 3. RLS-with-realtime requires the role to hold table SELECT too.
GRANT SELECT ON public.node_predictions TO authenticated;

-- 4. Full row image in change payloads (required for non-PK realtime).
ALTER TABLE public.node_predictions REPLICA IDENTITY FULL;

-- 5. Add to the realtime publication (guarded — ADD TABLE errors if present).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'node_predictions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.node_predictions;
  END IF;
END $$;
