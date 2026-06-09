-- Voice catalog synced from ElevenLabs (premade + shared library + owned).
-- preview_url is the ElevenLabs CDN URL stored directly (not mirrored).
CREATE TABLE IF NOT EXISTS public.voices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id TEXT REFERENCES public.providers(id) ON DELETE CASCADE,
  external_voice_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  gender TEXT,
  age TEXT,
  accent TEXT,
  language TEXT,
  use_case TEXT,
  category TEXT,                 -- premade | professional | shared | cloned | famous | generated
  preview_url TEXT,
  labels JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (provider_id, external_voice_id)
);

CREATE INDEX IF NOT EXISTS voices_provider_active_idx
  ON public.voices (provider_id, is_active);

CREATE INDEX IF NOT EXISTS voices_external_id_idx
  ON public.voices (external_voice_id);

CREATE INDEX IF NOT EXISTS voices_search_idx
  ON public.voices USING gin (
    to_tsvector('simple',
      coalesce(name,'') || ' ' || coalesce(description,'') || ' ' ||
      coalesce(accent,'') || ' ' || coalesce(use_case,'') || ' ' ||
      coalesce(language,''))
  );

-- RLS: anyone signed in can read active voices; writes only via service role
-- (the sync script uses the service client, which bypasses RLS).
ALTER TABLE public.voices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "voices_select_active" ON public.voices;
CREATE POLICY "voices_select_active" ON public.voices
  FOR SELECT
  USING (is_active = true);
