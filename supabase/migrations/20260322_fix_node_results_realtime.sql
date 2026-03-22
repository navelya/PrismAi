-- Fix node_results table for Supabase Realtime compatibility
-- Date: 2026-03-22
-- Issue: "mismatch between server and client bindings" error

-- 1. Set REPLICA IDENTITY to FULL (required for realtime with filters on non-primary key columns)
ALTER TABLE public.node_results REPLICA IDENTITY FULL;

-- 2. Grant SELECT to authenticated users (required for RLS to work with realtime)
GRANT SELECT ON public.node_results TO authenticated;
GRANT SELECT ON public.executions TO authenticated;
GRANT SELECT ON public.sessions TO authenticated;

-- 3. Ensure the table is in the realtime publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND schemaname = 'public' 
    AND tablename = 'node_results'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.node_results;
  END IF;
END $$;

-- 4. Success message
DO $$ 
BEGIN 
  RAISE NOTICE '✅ node_results table configured for Supabase Realtime';
  RAISE NOTICE '📡 REPLICA IDENTITY set to FULL';
  RAISE NOTICE '🔐 SELECT grants added for RLS compatibility';
END $$;
