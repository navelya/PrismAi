-- Migration: Purge Legacy Nodes
-- Date: 2026-03-12
-- Description: Updates the node_type constraint to remove legacy nodes and add modern ones.

-- 1. Drop the old constraint
ALTER TABLE nodes DROP CONSTRAINT IF EXISTS valid_node_type;

-- 2. Add the new constraint with supported nodes
ALTER TABLE nodes ADD CONSTRAINT valid_node_type CHECK (node_type IN ('ai_generate_image', 'media_input', 'compositor', 'prompt'));
