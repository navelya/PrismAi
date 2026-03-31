-- Migration: Add provider item type to context menu
-- Date: 2026-03-31
-- Description: Allows 'provider' as a valid item type for folders.

ALTER TABLE public.context_menu_items DROP CONSTRAINT IF EXISTS context_menu_items_item_type_check;

ALTER TABLE public.context_menu_items ADD CONSTRAINT context_menu_items_item_type_check 
CHECK (item_type IN ('header', 'submenu', 'node_type', 'ai_model', 'static_node', 'provider'));
