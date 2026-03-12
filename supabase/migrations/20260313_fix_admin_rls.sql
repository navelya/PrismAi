-- Migration: Fix Admin RLS Violations
-- Date: 2026-03-13
-- Description: Adds is_admin flag to profiles and enables admin-only write access to registry tables.

-- 1. Add is_admin column to profiles if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE table_name = 'profiles' AND column_name = 'is_admin') THEN
        ALTER TABLE public.profiles ADD COLUMN is_admin BOOLEAN DEFAULT false;
    END IF;
END $$;

-- 2. Create helper function for admin check
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND is_admin = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Update RLS policies for Registry Tables

-- Helper to grant admin rights to a table
-- ai_models
DROP POLICY IF EXISTS "Allow admin insert for ai_models" ON public.ai_models;
CREATE POLICY "Allow admin insert for ai_models" ON public.ai_models FOR INSERT WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Allow admin update for ai_models" ON public.ai_models;
CREATE POLICY "Allow admin update for ai_models" ON public.ai_models FOR UPDATE USING (public.is_admin());
DROP POLICY IF EXISTS "Allow admin delete for ai_models" ON public.ai_models;
CREATE POLICY "Allow admin delete for ai_models" ON public.ai_models FOR DELETE USING (public.is_admin());

-- categories
DROP POLICY IF EXISTS "Allow admin insert for categories" ON public.categories;
CREATE POLICY "Allow admin insert for categories" ON public.categories FOR INSERT WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Allow admin update for categories" ON public.categories;
CREATE POLICY "Allow admin update for categories" ON public.categories FOR UPDATE USING (public.is_admin());
DROP POLICY IF EXISTS "Allow admin delete for categories" ON public.categories;
CREATE POLICY "Allow admin delete for categories" ON public.categories FOR DELETE USING (public.is_admin());

-- node_types
DROP POLICY IF EXISTS "Allow admin insert for node_types" ON public.node_types;
CREATE POLICY "Allow admin insert for node_types" ON public.node_types FOR INSERT WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Allow admin update for node_types" ON public.node_types;
CREATE POLICY "Allow admin update for node_types" ON public.node_types FOR UPDATE USING (public.is_admin());
DROP POLICY IF EXISTS "Allow admin delete for node_types" ON public.node_types;
CREATE POLICY "Allow admin delete for node_types" ON public.node_types FOR DELETE USING (public.is_admin());

-- node_archetypes
DROP POLICY IF EXISTS "Allow admin insert for node_archetypes" ON public.node_archetypes;
CREATE POLICY "Allow admin insert for node_archetypes" ON public.node_archetypes FOR INSERT WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Allow admin update for node_archetypes" ON public.node_archetypes;
CREATE POLICY "Allow admin update for node_archetypes" ON public.node_archetypes FOR UPDATE USING (public.is_admin());
DROP POLICY IF EXISTS "Allow admin delete for node_archetypes" ON public.node_archetypes;
CREATE POLICY "Allow admin delete for node_archetypes" ON public.node_archetypes FOR DELETE USING (public.is_admin());

-- ui_collections
DROP POLICY IF EXISTS "Allow admin insert for ui_collections" ON public.ui_collections;
CREATE POLICY "Allow admin insert for ui_collections" ON public.ui_collections FOR INSERT WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Allow admin update for ui_collections" ON public.ui_collections;
CREATE POLICY "Allow admin update for ui_collections" ON public.ui_collections FOR UPDATE USING (public.is_admin());
DROP POLICY IF EXISTS "Allow admin delete for ui_collections" ON public.ui_collections;
CREATE POLICY "Allow admin delete for ui_collections" ON public.ui_collections FOR DELETE USING (public.is_admin());

-- ui_collection_items
DROP POLICY IF EXISTS "Allow admin insert for ui_collection_items" ON public.ui_collection_items;
CREATE POLICY "Allow admin insert for ui_collection_items" ON public.ui_collection_items FOR INSERT WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Allow admin update for ui_collection_items" ON public.ui_collection_items;
CREATE POLICY "Allow admin update for ui_collection_items" ON public.ui_collection_items FOR UPDATE USING (public.is_admin());
DROP POLICY IF EXISTS "Allow admin delete for ui_collection_items" ON public.ui_collection_items;
CREATE POLICY "Allow admin delete for ui_collection_items" ON public.ui_collection_items FOR DELETE USING (public.is_admin());
