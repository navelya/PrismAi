-- Character sheet + cover redesign.
-- sheet_url is the real reference/output (a photographic contact sheet);
-- cover_url is a display-only hero portrait derived from it.
ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS sheet_url  TEXT,
  ADD COLUMN IF NOT EXISTS sheet_path TEXT,
  ADD COLUMN IF NOT EXISTS cover_url  TEXT,
  ADD COLUMN IF NOT EXISTS cover_path TEXT;

-- Backfill existing characters so they keep working in the new model:
-- old primary (reference_images[0]) becomes the sheet; thumbnail becomes the cover.
UPDATE public.characters SET
  sheet_url  = reference_images->0->>'url',
  sheet_path = reference_images->0->>'path',
  cover_url  = COALESCE(thumbnail_url, reference_images->0->>'url'),
  cover_path = reference_images->0->>'path'
WHERE sheet_url IS NULL
  AND jsonb_typeof(reference_images) = 'array'
  AND jsonb_array_length(reference_images) > 0;
