-- Migration: Core Security Hardening
-- Date: 2026-03-17
-- Description: Hardens RLS policies for workflows and related tables to ensure data isolation.
-- Also converts workflows.user_id to UUID to match Supabase Auth.
-- Self-healing: Creates tables if they don't exist yet.

-- 0. Ensure tables exist (Self-healing from schema.sql)
CREATE TABLE IF NOT EXISTS public.workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  node_type TEXT NOT NULL,
  position_x FLOAT NOT NULL DEFAULT 0,
  position_y FLOAT NOT NULL DEFAULT 0,
  config JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  source_node_id UUID NOT NULL REFERENCES public.nodes(id) ON DELETE CASCADE,
  target_node_id UUID NOT NULL REFERENCES public.nodes(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  result_data JSONB DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  CONSTRAINT valid_status CHECK (status IN ('pending', 'running', 'completed', 'failed'))
);

-- 1. Correct user_id type in workflows
-- Converts existing 'anonymous' strings to a nil UUID to maintain compatibility during migration
DO $$
BEGIN
    IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'workflows' AND column_name = 'user_id') = 'text' THEN
        ALTER TABLE public.workflows 
          ALTER COLUMN user_id TYPE UUID 
          USING (CASE WHEN user_id = 'anonymous' THEN '00000000-0000-0000-0000-000000000000'::uuid ELSE user_id::uuid END);
    END IF;
END $$;

-- 2. Drop outdated constraints and permissive policies
ALTER TABLE public.nodes DROP CONSTRAINT IF EXISTS valid_node_type;
DROP POLICY IF EXISTS "Enable all operations for workflows" ON public.workflows;
DROP POLICY IF EXISTS "Enable all operations for nodes" ON public.nodes;
DROP POLICY IF EXISTS "Enable all operations for edges" ON public.edges;
DROP POLICY IF EXISTS "Enable all operations for executions" ON public.executions;
DROP POLICY IF EXISTS "Public profiles are viewable by everyone." ON public.profiles;

-- 3. Implement 🛡️ HARDENED RLS POLICIES

-- Enable RLS (just in case)
ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executions ENABLE ROW LEVEL SECURITY;

-- Workflows: Strict ownership check
CREATE POLICY "Users can manage their own workflows" 
ON public.workflows FOR ALL 
USING (auth.uid() = user_id) 
WITH CHECK (auth.uid() = user_id);

-- Nodes: Linked to workflow ownership
CREATE POLICY "Users can manage their own nodes" 
ON public.nodes FOR ALL 
USING (EXISTS (SELECT 1 FROM public.workflows WHERE public.workflows.id = nodes.workflow_id AND public.workflows.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.workflows WHERE public.workflows.id = nodes.workflow_id AND public.workflows.user_id = auth.uid()));

-- Edges: Linked to workflow ownership
CREATE POLICY "Users can manage their own edges" 
ON public.edges FOR ALL 
USING (EXISTS (SELECT 1 FROM public.workflows WHERE public.workflows.id = edges.workflow_id AND public.workflows.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.workflows WHERE public.workflows.id = edges.workflow_id AND public.workflows.user_id = auth.uid()));

-- Executions: Linked to workflow ownership
CREATE POLICY "Users can manage their own executions" 
ON public.executions FOR ALL 
USING (EXISTS (SELECT 1 FROM public.workflows WHERE public.workflows.id = executions.workflow_id AND public.workflows.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.workflows WHERE public.workflows.id = executions.workflow_id AND public.workflows.user_id = auth.uid()));

-- Profiles: Viewable only by owner
CREATE POLICY "Users can view own profile."
  ON public.profiles FOR SELECT
  USING ( auth.uid() = id );

