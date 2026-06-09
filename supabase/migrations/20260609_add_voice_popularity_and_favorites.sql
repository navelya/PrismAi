-- Voice popularity/featured signals (for the picker's "Popular" tab + badges) and
-- per-user favorites (the picker's "Favorites" tab).
--
-- popularity: a sortable usage signal. For ElevenLabs shared-library voices this is
--   `cloned_by_count` (how many users added the voice) — a good proxy for popularity.
--   Premade/owned voices have no such count; they're surfaced via `featured` instead.
-- featured: curated/promoted voices (ElevenLabs `featured` flag, plus all premade
--   voices, which are the hand-picked default set). Drives the "Popular" tab order.
ALTER TABLE public.voices
  ADD COLUMN IF NOT EXISTS popularity INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS featured BOOLEAN DEFAULT false;

-- Popular tab orders by (featured desc, popularity desc, name) — index supports it.
CREATE INDEX IF NOT EXISTS voices_popular_idx
  ON public.voices (provider_id, is_active, featured DESC, popularity DESC);

-- Per-user favorite voices. Stores both the FK (voice_id) for embedded reads and
-- the external_voice_id so the client can match favorites without a join.
CREATE TABLE IF NOT EXISTS public.voice_favorites (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  voice_id UUID NOT NULL REFERENCES public.voices(id) ON DELETE CASCADE,
  external_voice_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, voice_id)
);

CREATE INDEX IF NOT EXISTS voice_favorites_user_idx
  ON public.voice_favorites (user_id, created_at DESC);

-- RLS: a user may only read/insert/delete their OWN favorites.
ALTER TABLE public.voice_favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "voice_favorites_select_own" ON public.voice_favorites;
CREATE POLICY "voice_favorites_select_own" ON public.voice_favorites
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "voice_favorites_insert_own" ON public.voice_favorites;
CREATE POLICY "voice_favorites_insert_own" ON public.voice_favorites
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "voice_favorites_delete_own" ON public.voice_favorites;
CREATE POLICY "voice_favorites_delete_own" ON public.voice_favorites
  FOR DELETE USING (auth.uid() = user_id);
