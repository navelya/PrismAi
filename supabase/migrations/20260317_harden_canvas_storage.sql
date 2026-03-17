-- Migration: Harden canvas/session storage and cache policies
-- Date: 2026-03-17

-- 1) Tighten node_output_cache RLS (clients read-only; writes via service role which bypasses RLS)
DROP POLICY IF EXISTS "Authenticated users can insert node cache" ON public.node_output_cache;
DROP POLICY IF EXISTS "Authenticated users can update node cache" ON public.node_output_cache;
DROP POLICY IF EXISTS "Authenticated users can read node cache" ON public.node_output_cache;

ALTER TABLE public.node_output_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read node cache"
    ON public.node_output_cache FOR SELECT
    USING (auth.role() = 'authenticated');

-- 2) Ensure user_id is present and indexed for sessions hot paths
ALTER TABLE public.sessions
    ALTER COLUMN user_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_user_active
    ON public.sessions(user_id, is_deleted, updated_at DESC);

-- 3) Improve message fetch performance for chat replay
CREATE INDEX IF NOT EXISTS idx_messages_session_status_created_at
    ON public.messages(session_id, status, created_at DESC);

-- 4) Re-assert RLS on primary tables (idempotent)
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.node_output_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.node_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.node_archetypes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ui_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ui_collection_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.providers ENABLE ROW LEVEL SECURITY;
