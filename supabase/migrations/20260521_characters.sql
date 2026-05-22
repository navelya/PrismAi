-- Migration: characters table + storage bucket
-- Date: 2026-05-21
-- Description: User-owned reusable characters (named reference-image bundles)
--              referenced from chat via @ mentions and dropped on the canvas as
--              `character` nodes. Soft-deletable so saved workflows survive.
--              LoRA columns are present-but-null for a future fine-tuning upgrade.

-- 1. CREATE TABLE
CREATE TABLE IF NOT EXISTS public.characters (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  description      TEXT,
  -- array of { url, path }; index 0 is the primary reference image
  reference_images JSONB NOT NULL DEFAULT '[]',
  thumbnail_url    TEXT,
  weight           INT NOT NULL DEFAULT 70 CHECK (weight >= 0 AND weight <= 100),
  -- v1.1 LoRA fields (nullable now, no migration needed later)
  lora_url         TEXT,
  lora_status      TEXT CHECK (lora_status IN ('training', 'ready', 'failed')),
  lora_training_id TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ,
  last_used_at     TIMESTAMPTZ
);

-- 2. PERFORMANCE INDEXES
CREATE INDEX IF NOT EXISTS idx_characters_user_recent
  ON public.characters (user_id, deleted_at, last_used_at DESC);
CREATE INDEX IF NOT EXISTS idx_characters_user_name
  ON public.characters (user_id, deleted_at, name);

-- 3. AUTO-UPDATE updated_at
CREATE OR REPLACE FUNCTION public.set_characters_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_characters_updated_at ON public.characters;
CREATE TRIGGER trg_characters_updated_at
  BEFORE UPDATE ON public.characters
  FOR EACH ROW EXECUTE FUNCTION public.set_characters_updated_at();

-- 4. ROW LEVEL SECURITY
ALTER TABLE public.characters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read their own characters" ON public.characters;
CREATE POLICY "Users read their own characters"
  ON public.characters FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users create their own characters" ON public.characters;
CREATE POLICY "Users create their own characters"
  ON public.characters FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users update their own characters" ON public.characters;
CREATE POLICY "Users update their own characters"
  ON public.characters FOR UPDATE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users delete their own characters" ON public.characters;
CREATE POLICY "Users delete their own characters"
  ON public.characters FOR DELETE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role manages all characters" ON public.characters;
CREATE POLICY "Service role manages all characters"
  ON public.characters FOR ALL
  USING (auth.role() = 'service_role');

-- 5. STORAGE BUCKET (public-read, user-scoped writes under {userId}/...)
INSERT INTO storage.buckets (id, name, public)
VALUES ('characters', 'characters', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read characters bucket" ON storage.objects;
CREATE POLICY "Public read characters bucket"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'characters');

DROP POLICY IF EXISTS "Users upload to own characters folder" ON storage.objects;
CREATE POLICY "Users upload to own characters folder"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'characters'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users delete own characters folder" ON storage.objects;
CREATE POLICY "Users delete own characters folder"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'characters'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 6. SYSTEM NOTICE
DO $$
BEGIN
  RAISE NOTICE '✅ characters table + storage bucket created and secured.';
END $$;
