-- Migration: Multi-provider bindings for ai_models (Phase B)
-- Date: 2026-06-12
-- Description:
--   One ai_models row (one shared inputs_schema) can be served by N providers in
--   priority order. priority 0 = primary; ascending = fallback order (failover is
--   Phase C; Phase B uses only the primary). provider_model_id is the per-provider
--   model slug (Replicate "owner/name:ver", FAL "fal-ai/flux/dev", etc).
--   input_overrides optionally remaps/defaults api_mapping_keys for a provider
--   whose input contract differs (unused for curated v1 models; the column exists
--   so a mismatch never forces a schema fork).

CREATE TABLE IF NOT EXISTS public.ai_model_providers (
  id                SERIAL PRIMARY KEY,
  model_id          INTEGER NOT NULL REFERENCES public.ai_models(id) ON DELETE CASCADE,
  provider_id       TEXT NOT NULL,
  provider_model_id TEXT NOT NULL,
  priority          INTEGER NOT NULL DEFAULT 0,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  input_overrides   JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (model_id, provider_id)
);

CREATE INDEX IF NOT EXISTS ai_model_providers_model_priority_idx
  ON public.ai_model_providers (model_id, priority);

INSERT INTO public.ai_model_providers (model_id, provider_id, provider_model_id, priority, is_active)
SELECT m.id, 'replicate', m.replicate_model_id, 0, true
  FROM public.ai_models m
  WHERE m.replicate_model_id IS NOT NULL AND m.replicate_model_id <> ''
ON CONFLICT (model_id, provider_id) DO NOTHING;

INSERT INTO public.ai_model_providers (model_id, provider_id, provider_model_id, priority, is_active)
SELECT m.id, p.adapter_key, COALESCE(m.provider_model_id, ''), 0, true
  FROM public.ai_models m
  JOIN public.providers p ON p.id = m.provider_id
  WHERE p.adapter_key IS NOT NULL AND p.adapter_key <> ''
ON CONFLICT (model_id, provider_id) DO NOTHING;

ALTER TABLE public.ai_model_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_model_providers admin all"
  ON public.ai_model_providers FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
