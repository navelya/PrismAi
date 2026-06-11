-- Migration: Generalize result tables for multi-provider generation (Phase A)
-- Date: 2026-06-11
-- Description:
--   Adds provider-agnostic job identity + poll bookkeeping to node_results and
--   node_predictions. Replicate is backfilled as the provider for every existing
--   row that carries a replicate_id. The replicate_id columns are KEPT (aliased)
--   and dropped in a later phase — nothing in Phase A relies on their removal.
--
--   provider_id     : adapter key of the provider that owns the job ('replicate' for all today)
--   provider_job_id : the provider's job/prediction id (mirror of replicate_id for Replicate)
--   attempt         : failover attempt index (0 for every Phase A row; used by Phase C)
--   last_polled_at  : when the cron sweep last polled this job (NULL = never); drives backoff

ALTER TABLE public.node_results
  ADD COLUMN IF NOT EXISTS provider_id     TEXT,
  ADD COLUMN IF NOT EXISTS provider_job_id TEXT,
  ADD COLUMN IF NOT EXISTS attempt         INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_polled_at  TIMESTAMPTZ;

ALTER TABLE public.node_predictions
  ADD COLUMN IF NOT EXISTS provider_id     TEXT,
  ADD COLUMN IF NOT EXISTS provider_job_id TEXT,
  ADD COLUMN IF NOT EXISTS attempt         INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_polled_at  TIMESTAMPTZ;

-- Backfill existing rows: anything with a replicate_id is a Replicate job.
UPDATE public.node_results
  SET provider_id = 'replicate', provider_job_id = replicate_id
  WHERE replicate_id IS NOT NULL AND provider_id IS NULL;

UPDATE public.node_predictions
  SET provider_id = 'replicate', provider_job_id = replicate_id
  WHERE replicate_id IS NOT NULL AND provider_id IS NULL;

-- The sweep selects non-terminal rows that have a provider job to poll. A partial
-- index keeps that scan cheap as the tables grow.
CREATE INDEX IF NOT EXISTS idx_node_results_pending_jobs
  ON public.node_results (last_polled_at)
  WHERE status IN ('pending', 'running') AND provider_job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_node_predictions_pending_jobs
  ON public.node_predictions (last_polled_at)
  WHERE status = 'pending' AND provider_job_id IS NOT NULL;
