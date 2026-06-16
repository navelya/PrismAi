-- Migration: Add node type (sub category) descriptions
-- Date: 2026-06-16
-- Description: Adds a `description` column to node_types. Surfaced in the Add
-- Node panel's flyout rows (revealed on hover, under the title) instead of the
-- hardcoded "Dynamic node" text, and authored/AI-generated from the admin
-- Sub Categories tab. Empty falls back to "Dynamic node" in the UI.

ALTER TABLE public.node_types ADD COLUMN IF NOT EXISTS description TEXT;
