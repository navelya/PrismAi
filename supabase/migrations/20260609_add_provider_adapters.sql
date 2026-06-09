-- External provider adapters.
-- providers.adapter_key links a provider row to a server-side code adapter
-- (lib/ai/providers/registry.ts). NULL = Replicate/legacy (no code adapter).
ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS adapter_key TEXT;

COMMENT ON COLUMN public.providers.adapter_key IS
  'Server adapter key (e.g. ''elevenlabs''). NULL means Replicate/legacy dispatch.';

-- ai_models.provider_model_id holds the provider-native model identifier for
-- adapter providers (e.g. ElevenLabs ''eleven_v3''). replicate_model_id stays for
-- Replicate models and becomes optional for adapter providers.
ALTER TABLE public.ai_models
  ADD COLUMN IF NOT EXISTS provider_model_id TEXT;

COMMENT ON COLUMN public.ai_models.provider_model_id IS
  'Provider-native model id for adapter providers (e.g. ElevenLabs eleven_v3).';

-- replicate_model_id was NOT NULL; adapter models do not have one. Relax it.
ALTER TABLE public.ai_models
  ALTER COLUMN replicate_model_id DROP NOT NULL;
