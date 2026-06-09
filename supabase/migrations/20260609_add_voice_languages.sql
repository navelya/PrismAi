-- Per-voice supported languages (from ElevenLabs verified_languages).
-- Stored as an array of ISO-639-1 codes (e.g. {en,es,fr}) so the picker can
-- render a flag per language and filter by language via a GIN containment index.
ALTER TABLE public.voices
  ADD COLUMN IF NOT EXISTS language_codes TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS voices_language_codes_idx
  ON public.voices USING gin (language_codes);
