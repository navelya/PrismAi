-- Migration: evolve workflow_templates into the rich Templates feature
-- Date: 2026-06-05
-- - Adds metadata columns, renames user_id -> created_by
-- - Replaces template_type -> source ('official'|'community')
-- - Replaces is_public -> status ('draft'|'published'|'archived')
-- - Admin-only write RLS via public.is_admin(); published-read for all authed users
-- - increment_template_usage() SECURITY DEFINER RPC for non-admin clone bumps
-- - template-thumbnails storage bucket + admin-write policies

-- 1. NEW COLUMNS
ALTER TABLE public.workflow_templates
  ADD COLUMN IF NOT EXISTS how_it_works      TEXT,
  ADD COLUMN IF NOT EXISTS category          TEXT,
  ADD COLUMN IF NOT EXISTS tags              TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS use_cases         TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS nodes_used        TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS created_by_name    TEXT,
  ADD COLUMN IF NOT EXISTS source_session_id  UUID REFERENCES public.sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS usage_count        INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS published_at       TIMESTAMPTZ;

-- 2. RENAME user_id -> created_by (guarded)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='workflow_templates' AND column_name='user_id')
  THEN
    ALTER TABLE public.workflow_templates RENAME COLUMN user_id TO created_by;
  END IF;
END $$;

-- 2b. DROP LEGACY POLICIES FIRST — the old read policy references template_type
--     and is_public, so it must be removed before those columns can be dropped.
DROP POLICY IF EXISTS "Users can read their own and public templates" ON public.workflow_templates;
DROP POLICY IF EXISTS "Users can create their own templates"          ON public.workflow_templates;
DROP POLICY IF EXISTS "Users can update their own templates"          ON public.workflow_templates;
DROP POLICY IF EXISTS "Users can delete their own templates"          ON public.workflow_templates;

-- 3. source column (replaces template_type)
ALTER TABLE public.workflow_templates
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'official';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='workflow_templates' AND column_name='template_type')
  THEN
    UPDATE public.workflow_templates
      SET source = CASE WHEN template_type = 'user' THEN 'community' ELSE 'official' END;
    ALTER TABLE public.workflow_templates DROP COLUMN template_type;
  END IF;
END $$;

-- 4. status column (replaces is_public)
ALTER TABLE public.workflow_templates
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='workflow_templates' AND column_name='is_public')
  THEN
    UPDATE public.workflow_templates
      SET status = CASE WHEN is_public = true THEN 'published' ELSE 'draft' END,
          published_at = CASE WHEN is_public = true THEN NOW() ELSE NULL END;
    ALTER TABLE public.workflow_templates DROP COLUMN is_public;
  END IF;
END $$;

-- 5. CHECK constraints
ALTER TABLE public.workflow_templates
  DROP CONSTRAINT IF EXISTS workflow_templates_source_check,
  DROP CONSTRAINT IF EXISTS workflow_templates_status_check;
ALTER TABLE public.workflow_templates
  ADD CONSTRAINT workflow_templates_source_check CHECK (source IN ('official','community')),
  ADD CONSTRAINT workflow_templates_status_check CHECK (status IN ('draft','published','archived'));

-- 6. INDEXES (drop stale ones, add new)
DROP INDEX IF EXISTS public.idx_workflow_templates_type;
DROP INDEX IF EXISTS public.idx_workflow_templates_public;
CREATE INDEX IF NOT EXISTS idx_workflow_templates_source_status
  ON public.workflow_templates(source, status);
CREATE INDEX IF NOT EXISTS idx_workflow_templates_category
  ON public.workflow_templates(category);
CREATE INDEX IF NOT EXISTS idx_workflow_templates_tags
  ON public.workflow_templates USING GIN (tags);

-- 7. RLS — drop old user-owned policies, install admin/published model
ALTER TABLE public.workflow_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read their own and public templates" ON public.workflow_templates;
DROP POLICY IF EXISTS "Users can create their own templates"          ON public.workflow_templates;
DROP POLICY IF EXISTS "Users can update their own templates"          ON public.workflow_templates;
DROP POLICY IF EXISTS "Users can delete their own templates"          ON public.workflow_templates;

DROP POLICY IF EXISTS "Published templates readable by authed users" ON public.workflow_templates;
CREATE POLICY "Published templates readable by authed users"
  ON public.workflow_templates FOR SELECT
  USING (
    (auth.uid() IS NOT NULL AND status = 'published')
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "Admins manage templates" ON public.workflow_templates;
CREATE POLICY "Admins manage templates"
  ON public.workflow_templates FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
-- (existing "Service role manages all templates" policy is left intact)

-- 8. RPC: bump usage_count on clone (callable by any authed user)
CREATE OR REPLACE FUNCTION public.increment_template_usage(p_template_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.workflow_templates
    SET usage_count = usage_count + 1
    WHERE id = p_template_id AND status = 'published';
END;
$$;
GRANT EXECUTE ON FUNCTION public.increment_template_usage(UUID) TO authenticated;

-- 9. STORAGE bucket + policies
INSERT INTO storage.buckets (id, name, public)
  VALUES ('template-thumbnails', 'template-thumbnails', true)
  ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "template-thumbnails public read"  ON storage.objects;
CREATE POLICY "template-thumbnails public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'template-thumbnails');

DROP POLICY IF EXISTS "template-thumbnails admin write"  ON storage.objects;
CREATE POLICY "template-thumbnails admin write"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'template-thumbnails' AND public.is_admin());

DROP POLICY IF EXISTS "template-thumbnails admin delete" ON storage.objects;
CREATE POLICY "template-thumbnails admin delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'template-thumbnails' AND public.is_admin());

DO $$ BEGIN RAISE NOTICE '✅ workflow_templates evolved for Templates feature.'; END $$;
