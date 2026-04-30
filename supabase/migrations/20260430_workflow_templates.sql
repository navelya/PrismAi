-- Migration: workflow_templates table
-- Date: 2026-04-30
-- Description: Stores user-saved workflow templates. Built-in templates are
--              seeded at the application level. This table holds user-created
--              ones that can be shared or kept private.

-- 1. CREATE TABLE
CREATE TABLE IF NOT EXISTS public.workflow_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  -- The full workflow JSON (nodes + edges), same shape as canvas_state
  workflow    JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
  -- Optional: thumbnail / preview image URL stored in Supabase Storage
  thumbnail_url TEXT,
  -- 'builtin' templates are shipped with the app (user_id = NULL)
  -- 'user' templates are created by an authenticated user
  template_type TEXT NOT NULL DEFAULT 'user' CHECK (template_type IN ('builtin', 'user')),
  is_public   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 2. PERFORMANCE INDEXES
CREATE INDEX IF NOT EXISTS idx_workflow_templates_user_id
  ON public.workflow_templates(user_id);

CREATE INDEX IF NOT EXISTS idx_workflow_templates_type
  ON public.workflow_templates(template_type);

CREATE INDEX IF NOT EXISTS idx_workflow_templates_public
  ON public.workflow_templates(is_public)
  WHERE is_public = true;

-- 3. AUTO-UPDATE updated_at
CREATE OR REPLACE FUNCTION public.set_workflow_templates_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_workflow_templates_updated_at ON public.workflow_templates;
CREATE TRIGGER trg_workflow_templates_updated_at
  BEFORE UPDATE ON public.workflow_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_workflow_templates_updated_at();

-- 4. ROW LEVEL SECURITY
ALTER TABLE public.workflow_templates ENABLE ROW LEVEL SECURITY;

-- Read: own templates + all public templates + all builtins
DROP POLICY IF EXISTS "Users can read their own and public templates" ON public.workflow_templates;
CREATE POLICY "Users can read their own and public templates"
  ON public.workflow_templates FOR SELECT
  USING (
    user_id = auth.uid()
    OR is_public = true
    OR template_type = 'builtin'
  );

-- Insert: authenticated users only, for their own records
DROP POLICY IF EXISTS "Users can create their own templates" ON public.workflow_templates;
CREATE POLICY "Users can create their own templates"
  ON public.workflow_templates FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Update: own templates only
DROP POLICY IF EXISTS "Users can update their own templates" ON public.workflow_templates;
CREATE POLICY "Users can update their own templates"
  ON public.workflow_templates FOR UPDATE
  USING (user_id = auth.uid());

-- Delete: own templates only
DROP POLICY IF EXISTS "Users can delete their own templates" ON public.workflow_templates;
CREATE POLICY "Users can delete their own templates"
  ON public.workflow_templates FOR DELETE
  USING (user_id = auth.uid());

-- Service role: full access (for seeding builtins from the backend)
DROP POLICY IF EXISTS "Service role manages all templates" ON public.workflow_templates;
CREATE POLICY "Service role manages all templates"
  ON public.workflow_templates FOR ALL
  USING (auth.role() = 'service_role');

-- 5. SYSTEM NOTICE
DO $$
BEGIN
  RAISE NOTICE '✅ workflow_templates table created and secured.';
END $$;
