-- Add canvas_state to messages table to store workflow snapshots
ALTER TABLE public.messages 
ADD COLUMN IF NOT EXISTS canvas_state JSONB DEFAULT NULL;
