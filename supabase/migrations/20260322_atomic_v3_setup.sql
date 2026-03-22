-- PRISMAI ATOMIC V3 SETUP (REVISED)
-- Date: 2026-03-22
-- Description: Establishes the clean, Job-based architecture for Phase 1 stability.
--              Includes the executions table and the independent node_results table.
--              LEAN ARCHITECTURE: user_id is referenced via sessions table to avoid redundancy.

-- 1. CREATE THE ATOMIC EXECUTION TABLE
CREATE TABLE IF NOT EXISTS public.executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE,
  -- user_id removed to avoid redundancy (available via session_id -> sessions.user_id)
  status TEXT NOT NULL DEFAULT 'pending', 
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. CREATE THE NODE RESULTS TABLE
CREATE TABLE IF NOT EXISTS public.node_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID REFERENCES public.executions(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL, 
  status TEXT NOT NULL DEFAULT 'pending',
  result_url TEXT,
  error TEXT,
  replicate_id TEXT, 
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(execution_id, node_id)
);

-- 3. ENABLE REALTIME
-- Check if it already exists in publication before adding
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

-- 4. PERFORMANCE INDEXES
CREATE INDEX IF NOT EXISTS idx_node_results_execution ON public.node_results(execution_id);
CREATE INDEX IF NOT EXISTS idx_node_results_replicate ON public.node_results(replicate_id);

-- 5. SECURITY (RLS)
ALTER TABLE public.executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.node_results ENABLE ROW LEVEL SECURITY;

-- Select policies: Join with sessions to verify owner
DROP POLICY IF EXISTS "Users can view their own executions" ON public.executions;
CREATE POLICY "Users can view their own executions" ON public.executions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.sessions 
      WHERE sessions.id = executions.session_id 
      AND sessions.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can view results of their own executions" ON public.node_results;
CREATE POLICY "Users can view results of their own executions" ON public.node_results
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.executions 
      JOIN public.sessions ON sessions.id = executions.session_id
      WHERE executions.id = node_results.execution_id 
      AND sessions.user_id = auth.uid()
    )
  );

-- Service Role policies
DROP POLICY IF EXISTS "Service Role can manage executions" ON public.executions;
CREATE POLICY "Service Role can manage executions" ON public.executions
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service Role can manage results" ON public.node_results;
CREATE POLICY "Service Role can manage results" ON public.node_results
  FOR ALL USING (auth.role() = 'service_role');

-- 6. SYSTEM NOTICE
DO $$ 
BEGIN 
  RAISE NOTICE '✅ Atomic V3 Architecture Setup Complete (Lean Edition).';
END $$;
