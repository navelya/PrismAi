-- Migration: Atomic single-node completion claim (Phase A)
-- Date: 2026-06-11
-- Description:
--   Claims the running/pending -> terminal transition for a SINGLE (non-fan-out)
--   node exactly once, writing the terminal result in the same locked statement.
--   Returns TRUE only for the caller that won the transition; that caller is the
--   one allowed to dispatch children. Mirrors finalize_fan_out's locking style so
--   concurrent triggers (a late webhook + the cron sweep) cannot double-complete
--   or double-dispatch.
--
--   The row is INSERTed (ON CONFLICT DO NOTHING) before the FOR UPDATE lock so a
--   missing row (an early webhook/poll that beat the dispatcher's 'running'
--   write) cannot let two concurrent callers both win — FOR UPDATE on a missing
--   row locks nothing. A stale-attempt guard rejects callers whose
--   p_provider_job_id differs from the row's bound provider_job_id (a failover
--   that advanced the attempt; relevant from Phase C on).
--
--   The loser (status already terminal, or stale job id) gets FALSE and writes
--   nothing, so its own mirrored media is simply discarded (storage waste is
--   acceptable; correctness is not). Callers therefore mirror media BEFORE
--   calling this, then pass the durable result_data in.

CREATE OR REPLACE FUNCTION public.claim_node_completion(
  p_execution_id UUID,
  p_node_id      TEXT,
  p_status       TEXT,          -- 'completed' | 'failed'
  p_result_type  TEXT,          -- NULL allowed for 'failed'
  p_result_data  JSONB,         -- NULL allowed for 'failed'
  p_error        TEXT,          -- NULL for 'completed'
  p_provider_id  TEXT,          -- serving provider (e.g. 'replicate')
  p_provider_job_id TEXT,
  p_session_id   UUID DEFAULT NULL,
  p_user_id      UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status TEXT;
  v_job_id TEXT;
BEGIN
  -- Ensure the row exists FIRST so FOR UPDATE serializes ALL callers, including
  -- an early webhook/poll that beat the dispatcher's 'running' write.
  INSERT INTO public.node_results (execution_id, node_id, status, session_id, user_id)
  VALUES (p_execution_id, p_node_id, 'running', p_session_id, p_user_id)
  ON CONFLICT (execution_id, node_id) DO NOTHING;

  SELECT status, provider_job_id
    INTO v_status, v_job_id
  FROM public.node_results
  WHERE execution_id = p_execution_id AND node_id = p_node_id
  FOR UPDATE;

  IF v_status IN ('completed', 'failed') THEN
    RETURN FALSE;  -- already finalized; this caller loses
  END IF;

  -- Attempt-stale guard: if the row is bound to a DIFFERENT provider job (a
  -- failover advanced the attempt), a late trigger for the old job loses.
  IF v_job_id IS NOT NULL AND p_provider_job_id IS NOT NULL
     AND v_job_id <> p_provider_job_id THEN
    RETURN FALSE;
  END IF;

  UPDATE public.node_results SET
    status          = p_status,
    -- COALESCE: result_type/result_data are NOT NULL (20260501) but callers pass
    -- NULL for 'failed' — keep the row's current value (default 'json'/'[]') then.
    result_type     = COALESCE(p_result_type, result_type),
    result_data     = COALESCE(p_result_data, result_data),
    error           = p_error,
    provider_id     = p_provider_id,
    provider_job_id = p_provider_job_id,
    session_id      = COALESCE(p_session_id, session_id),
    user_id         = COALESCE(p_user_id, user_id),
    updated_at      = NOW()
  WHERE execution_id = p_execution_id AND node_id = p_node_id;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_node_completion(UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_node_completion(UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, UUID, UUID)
  TO service_role;

COMMENT ON FUNCTION public.claim_node_completion IS
  'Atomically claims a single (non-fan-out) node''s running/pending->terminal transition and writes the result under a row lock (the row is inserted first so a missing row cannot defeat FOR UPDATE serialization). Rejects callers whose provider_job_id differs from the row''s bound job (stale failover attempt). Returns true only for the caller that won; that caller dispatches children exactly once.';
