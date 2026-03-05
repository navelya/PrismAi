-- Add soft delete columns to sessions table
ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Create an index for faster querying of active vs deleted sessions
CREATE INDEX IF NOT EXISTS idx_sessions_is_deleted ON public.sessions(is_deleted);
