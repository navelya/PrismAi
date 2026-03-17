-- Migration: Database Consolidation & Versioning
-- Date: 2026-03-17
-- Description: Drops redundant structural tables and establishes session-based versioning and execution tracking.

-- 1. Cleanup old policies that depend on the tables we are about to drop
DROP POLICY IF EXISTS "Users can manage their own executions" ON public.executions;

-- 2. Repurpose public.executions
-- Link directly to sessions instead of workflows
ALTER TABLE public.executions ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE;

-- Optional: Since existing executions are empty, we drop the old column.
ALTER TABLE public.executions DROP COLUMN IF EXISTS workflow_id;

-- 3. DROP redundant structural tables
DROP TABLE IF EXISTS public.edges;
DROP TABLE IF EXISTS public.nodes;
DROP TABLE IF EXISTS public.workflows;

-- 4. Create session_versions (for History/Snapshot pattern)
CREATE TABLE IF NOT EXISTS public.session_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    canvas_state JSONB NOT NULL,
    version_name TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Hardened RLS for refined architecture
ALTER TABLE public.session_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executions ENABLE ROW LEVEL SECURITY;

-- Executions Policy: Linked to session ownership
CREATE POLICY "Users can manage their own executions" 
ON public.executions FOR ALL 
USING (EXISTS (SELECT 1 FROM public.sessions WHERE public.sessions.id = executions.session_id AND public.sessions.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.sessions WHERE public.sessions.id = executions.session_id AND public.sessions.user_id = auth.uid()));

-- Session Versions Policy: Linked to session ownership
CREATE POLICY "Users can manage their own session versions" 
ON public.session_versions FOR ALL 
USING (EXISTS (SELECT 1 FROM public.sessions WHERE public.sessions.id = session_versions.session_id AND public.sessions.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.sessions WHERE public.sessions.id = session_versions.session_id AND public.sessions.user_id = auth.uid()));
