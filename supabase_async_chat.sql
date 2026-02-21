-- =============================================================================
-- ASYNC CHAT ARCHITECTURE: Add status column to messages table
-- =============================================================================
-- Run this in your Supabase SQL Editor

-- 1. Add status column to messages table
ALTER TABLE public.messages 
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'completed' 
CHECK (status IN ('processing', 'completed', 'failed'));

-- 2. Add workflow column to store generated workflow JSON on assistant messages
ALTER TABLE public.messages 
ADD COLUMN IF NOT EXISTS workflow JSONB DEFAULT NULL;

-- 3. Add metadata column for extra info (response type, error details, etc.)
ALTER TABLE public.messages 
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT NULL;

-- 4. Enable Realtime for the messages table (required for live subscriptions)
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;

-- 5. Add an index on session_id + status for faster Realtime filtering
CREATE INDEX IF NOT EXISTS idx_messages_session_status 
ON public.messages (session_id, status);
