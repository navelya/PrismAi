-- Migration: Per-tile, owner-scoped asset soft-delete
-- Date: 2026-06-12
-- Purpose: Let a user hide individual assets from their own Assets gallery
--          without modifying or deleting the underlying node_results row.
--          A pure per-user flag keyed by the asset's URL (the gallery de-dupes
--          tiles by URL in lib/assets/unpack.ts). Scope is owner-only: the row
--          is untouched, so chat results, canvas nodes, admin surfaces and
--          other users are unaffected.

CREATE TABLE IF NOT EXISTS public.hidden_assets (
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_url      TEXT NOT NULL,
  node_result_id UUID REFERENCES public.node_results(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, asset_url)
);

CREATE INDEX IF NOT EXISTS idx_hidden_assets_user ON public.hidden_assets(user_id);

ALTER TABLE public.hidden_assets ENABLE ROW LEVEL SECURITY;

-- A user manages only their own hidden flags.
DROP POLICY IF EXISTS "hidden_assets_select_own" ON public.hidden_assets;
CREATE POLICY "hidden_assets_select_own" ON public.hidden_assets
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "hidden_assets_insert_own" ON public.hidden_assets;
CREATE POLICY "hidden_assets_insert_own" ON public.hidden_assets
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "hidden_assets_delete_own" ON public.hidden_assets;
CREATE POLICY "hidden_assets_delete_own" ON public.hidden_assets
  FOR DELETE USING (user_id = auth.uid());
