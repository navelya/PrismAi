-- Migration: Add session_id to node_results for session-level realtime tracking
-- Date: 2026-03-23
-- Purpose: Enable a single WebSocket subscription per session that catches all execution updates

-- 1. Add the column
ALTER TABLE public.node_results ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE;

-- 2. Backfill existing data by joining with executions table
UPDATE public.node_results nr
SET session_id = e.session_id
FROM public.executions e
WHERE nr.execution_id = e.id AND nr.session_id IS NULL;

-- 3. Create index for performance
CREATE INDEX IF NOT EXISTS idx_node_results_session_id ON public.node_results(session_id);

-- 4. Update RLS policies to allow session-based selection
DROP POLICY IF EXISTS "Users can view results of their own executions" ON public.node_results;
CREATE POLICY "Users can view session results" ON public.node_results
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.sessions 
      WHERE sessions.id = node_results.session_id 
      AND sessions.user_id = auth.uid()
    )
    OR 
    EXISTS (
      SELECT 1 FROM public.executions 
      JOIN public.sessions ON sessions.id = executions.session_id
      WHERE executions.id = node_results.execution_id 
      AND sessions.user_id = auth.uid()
    )
  );

-- 5. Set REPLICA IDENTITY to FULL again for safety (already done but good to ensure)
ALTER TABLE public.node_results REPLICA IDENTITY FULL;
