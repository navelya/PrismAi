-- Migration: API providers are NOT brand rows — remove them from `providers`
-- Date: 2026-06-13
-- Description:
--   The `providers` table is the model BRAND catalog (drives the node-library
--   grouping via ai_models.provider_id and the mandatory brand picker in the
--   model form). The earlier 20260613_seed_async_providers.sql WRONGLY seeded the
--   API providers (FAL/WaveSpeed/KIE/Kinovi) here, so they appeared as brands in
--   the node library and management. API providers now come from code
--   (lib/ai/providers/catalog.ts); the binding table references them by adapter-
--   key TEXT (ai_model_providers.provider_id, NOT an FK), so removing these rows
--   does NOT affect existing bindings.
--
--   ElevenLabs is intentionally NOT removed — it is a real brand AND an adapter.
--   The guard skips any row still referenced as a model's brand (no FK breakage).

DELETE FROM public.providers
WHERE id IN ('fal', 'wavespeed', 'kie', 'kinovi')
  AND NOT EXISTS (
    SELECT 1 FROM public.ai_models m WHERE m.provider_id = providers.id
  );
