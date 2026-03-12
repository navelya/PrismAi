-- Migration: Add Dynamic Node Registry
-- Date: 2026-03-12
-- Description: Creates tables for categories, node_archetypes, ai_models, ui_collections, and ui_collection_items to support dynamic AI model rendering.

-- Table: categories
-- Stores media types (e.g., image, video, text) for filtering.
CREATE TABLE IF NOT EXISTS public.categories (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  icon_reference TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table: node_archetypes
-- Stores references to React Skeleton components.
CREATE TABLE IF NOT EXISTS public.node_archetypes (
  id TEXT PRIMARY KEY,
  component_name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table: ai_models
-- Core table holding the actual models, linking to categories and archetypes.
CREATE TABLE IF NOT EXISTS public.ai_models (
  id SERIAL PRIMARY KEY,
  replicate_model_id TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  archetype_id TEXT NOT NULL REFERENCES public.node_archetypes(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  task_type TEXT,
  credit_cost INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  inputs_schema JSONB DEFAULT '{}'::jsonb NOT NULL,
  outputs_schema JSONB DEFAULT '{}'::jsonb NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table: ui_collections
-- Manages menu lists in the frontend (e.g., 'Popular Models').
CREATE TABLE IF NOT EXISTS public.ui_collections (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table: ui_collection_items
-- Junction table mapping AI Models to UI Collections.
CREATE TABLE IF NOT EXISTS public.ui_collection_items (
  collection_id TEXT NOT NULL REFERENCES public.ui_collections(id) ON DELETE CASCADE,
  model_id INTEGER NOT NULL REFERENCES public.ai_models(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (collection_id, model_id)
);

-- Enable RLS (Assuming you want to secure these tables)
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.node_archetypes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ui_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ui_collection_items ENABLE ROW LEVEL SECURITY;

-- Default Policies (Allows all reads, optionally restrict writes to admins)
CREATE POLICY "Allow read access for categories" ON public.categories FOR SELECT USING (true);
CREATE POLICY "Allow read access for node_archetypes" ON public.node_archetypes FOR SELECT USING (true);
CREATE POLICY "Allow read access for ai_models" ON public.ai_models FOR SELECT USING (true);
CREATE POLICY "Allow read access for ui_collections" ON public.ui_collections FOR SELECT USING (true);
CREATE POLICY "Allow read access for ui_collection_items" ON public.ui_collection_items FOR SELECT USING (true);
