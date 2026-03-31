-- Migration: Context Menu Builder Architecture
-- Date: 2026-03-30
-- Description: Creates the unified context_menu_items table for hierarchical menus and removes outdated ui_collections tables.

-- 1. Create context_menu_items table
CREATE TABLE IF NOT EXISTS public.context_menu_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id UUID REFERENCES public.context_menu_items(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    item_type TEXT NOT NULL CHECK (item_type IN ('header', 'submenu', 'node_type', 'ai_model', 'static_node')),
    action_value TEXT,
    icon TEXT,
    badge TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.context_menu_items ENABLE ROW LEVEL SECURITY;

-- Add policies
CREATE POLICY "Allow read access for context_menu_items" ON public.context_menu_items FOR SELECT USING (true);
CREATE POLICY "Allow write access for context_menu_items" ON public.context_menu_items FOR ALL USING (true);

-- 2. Drop old tables cleanly
DROP TABLE IF EXISTS public.ui_collection_items CASCADE;
DROP TABLE IF EXISTS public.ui_collections CASCADE;