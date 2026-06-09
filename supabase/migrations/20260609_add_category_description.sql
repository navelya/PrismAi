-- Migration: Add category descriptions
-- Date: 2026-06-09
-- Description: Adds a `description` column to categories and seeds short copy
-- for the foundational categories. Surfaced in the Add Node panel's category
-- rows (revealed on hover); falls back to an item count when empty.

ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS description TEXT;

UPDATE public.categories SET description = CASE id
  WHEN 'image' THEN 'Create & edit images'
  WHEN 'video' THEN 'Generate & animate video'
  WHEN 'audio' THEN 'Speech, music & sound'
  WHEN 'text'  THEN 'Generate & edit text'
  ELSE description
END
WHERE id IN ('image', 'video', 'audio', 'text');
