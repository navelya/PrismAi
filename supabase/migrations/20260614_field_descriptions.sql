-- Migration: Field descriptions library
-- Date: 2026-06-14
-- Description:
--   A global, reusable library of named descriptions (title + body) that an admin
--   attaches to a model's properties (controls), input handles, or output handles.
--   Fields reference a description by id (stored inside the existing
--   ai_models.inputs_schema / outputs_schema JSONB as `description_id`), so editing
--   a description updates every field that references it (live link). Deleting a
--   description simply leaves dangling references — the runtime lookup returns
--   undefined and the field shows no tooltip (no cascade needed).

CREATE TABLE IF NOT EXISTS public.field_descriptions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS field_descriptions_title_idx
  ON public.field_descriptions (title);

ALTER TABLE public.field_descriptions ENABLE ROW LEVEL SECURITY;

-- Open READ, matching the sibling registry tables (ai_models, categories,
-- node_types all use `USING (true)`): runtime tooltips render on the end-user
-- canvas (ai_generator node), not just in the admin editor, and the description
-- body is non-sensitive catalog metadata.
CREATE POLICY "field_descriptions read"
  ON public.field_descriptions FOR SELECT
  USING (true);

-- Only admins may write.
CREATE POLICY "field_descriptions admin write"
  ON public.field_descriptions FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
