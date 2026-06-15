-- Migration: drop the field_descriptions library table
-- Date: 2026-06-15
-- Description:
--   Reverts 20260614. The reusable description-library design was replaced by
--   inline per-field descriptions stored directly in ai_models.inputs_schema /
--   outputs_schema JSONB (no schema change), plus an admin "auto-generate"
--   (Gemini) helper. The library table is no longer referenced by any code.

DROP TABLE IF EXISTS public.field_descriptions;
