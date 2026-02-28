-- Node output cache: stores hashed inputs → Supabase Storage paths + public URLs.
-- When a node with the same inputs is re-run, return the cached URLs instantly.

CREATE TABLE IF NOT EXISTS public.node_output_cache (
  hash         TEXT PRIMARY KEY,          -- SHA-256 hex of (nodeType + config + inputUrls)
  node_type    TEXT NOT NULL,
  output_items JSONB NOT NULL,            -- [{storagePath, publicUrl, width, height, ...}]
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_node_output_cache_node_type ON public.node_output_cache(node_type);
CREATE INDEX IF NOT EXISTS idx_node_output_cache_last_used ON public.node_output_cache(last_used_at);

-- RLS: all authenticated users can read / write (cache is shared for dedup across users)
ALTER TABLE public.node_output_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read node cache"
  ON public.node_output_cache FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert node cache"
  ON public.node_output_cache FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update node cache"
  ON public.node_output_cache FOR UPDATE
  USING (auth.role() = 'authenticated');
