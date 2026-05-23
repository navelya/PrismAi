-- Tracks each individual Replicate prediction of a fan-out run (iterations > 1).
-- One row per (execution_id, node_id, prediction_index). The webhook updates the
-- row matching the completed prediction's replicate_id, then aggregates all rows
-- for the node into node_results once none remain 'pending'. iterations <= 1 runs
-- do NOT use this table (legacy single-prediction path is unchanged).
CREATE TABLE IF NOT EXISTS public.node_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID NOT NULL REFERENCES public.executions(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  prediction_index INT NOT NULL,
  replicate_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | completed | failed
  result_data JSONB NOT NULL DEFAULT '[]'::jsonb,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (execution_id, node_id, prediction_index)
);

CREATE INDEX IF NOT EXISTS idx_node_predictions_exec_node
  ON public.node_predictions (execution_id, node_id);
CREATE INDEX IF NOT EXISTS idx_node_predictions_replicate
  ON public.node_predictions (replicate_id);

-- Server-only table (service-role webhook/dispatch). Enable RLS with no policies
-- so anon/authenticated clients are denied; the service role bypasses RLS.
ALTER TABLE public.node_predictions ENABLE ROW LEVEL SECURITY;
