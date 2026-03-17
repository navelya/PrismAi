-- Add dynamic pricing and billing fields to ai_models table
ALTER TABLE ai_models ADD COLUMN is_per_second BOOLEAN DEFAULT false;
-- Note: cost_modifiers and cost_per_unit are stored within the inputs_schema JSONB column, 
-- which already exists in the table. No shared column needed for those specific fields.
