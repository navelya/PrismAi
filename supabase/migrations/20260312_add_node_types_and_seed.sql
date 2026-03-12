-- Migration: Add Node Types and Seed Data
-- Date: 2026-03-12
-- Description: Creates node_types table, updates ai_models, and inserts foundational categories, archetypes, and node types.

-- 1. Create node_types table
CREATE TABLE IF NOT EXISTS public.node_types (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  icon_reference TEXT,
  parent_categories TEXT[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS and add policy
ALTER TABLE public.node_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow read access for node_types" ON public.node_types FOR SELECT USING (true);
CREATE POLICY "Allow write access for node_types" ON public.node_types FOR ALL USING (true); -- Relaxed for internal admin panel, adjust as needed

-- 2. Update ai_models table
-- Step 2a: Add the new column
ALTER TABLE public.ai_models ADD COLUMN IF NOT EXISTS node_type_id TEXT REFERENCES public.node_types(id) ON DELETE SET NULL;

-- Step 2b: Migrate any existing task_type data (Optional, handle carefully in prod)
-- UPDATE public.ai_models SET node_type_id = task_type WHERE task_type IS NOT NULL;

-- Step 2c: Drop the old column
ALTER TABLE public.ai_models DROP COLUMN IF EXISTS task_type;

-- 3. Seed Foundational Data

-- 3a. Categories
INSERT INTO public.categories (id, display_name, icon_reference)
VALUES
  ('image', 'Image Generation', 'ImageIcon'),
  ('video', 'Video & Animation', 'VideoIcon'),
  ('text', 'Text & LLMs', 'TypeIcon'),
  ('audio', 'Audio & Speech', 'MicIcon')
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  icon_reference = EXCLUDED.icon_reference;

-- 3b. Node Archetypes
INSERT INTO public.node_archetypes (id, component_name)
VALUES
  ('ai_generation', 'AIGeneratorSkeleton'),
  ('input', 'InputSkeleton'),
  ('utility', 'UtilitySkeleton')
ON CONFLICT (id) DO UPDATE SET
  component_name = EXCLUDED.component_name;

-- 3c. Node Types
INSERT INTO public.node_types (id, display_name, icon_reference, parent_categories)
VALUES
  ('image_generation', 'Image Generation', 'ImageIcon', ARRAY['image']),
  ('remove_background', 'Remove Background', 'ScissorsIcon', ARRAY['image']),
  ('image_to_text', 'Image to Text (Vision)', 'ScanIcon', ARRAY['image', 'text'])
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  icon_reference = EXCLUDED.icon_reference,
  parent_categories = EXCLUDED.parent_categories;
