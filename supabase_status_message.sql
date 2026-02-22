-- Add status_message column to sessions table for real-time progress tracking
-- This column is updated by the background worker during workflow execution
-- and read by the frontend via Supabase Realtime to show step-by-step progress.

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS status_message TEXT DEFAULT NULL;

-- NOTE: sessions table is already in supabase_realtime publication
