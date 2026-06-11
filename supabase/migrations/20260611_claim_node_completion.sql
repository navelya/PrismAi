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
--   The loser (status already terminal) gets FALSE and writes nothing, so its own
--   mirrored media is simply discarded (storage waste is acceptable; correctness
--   is not). Callers therefore mirror media BEFORE calling this, then pass the
--   durable result_data in.

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
BEGIN
  -- Lock the node's row. Only a row currently in a non-terminal state is a
  -- completion candidate. A missing row is created (an early poll/webhook that
  -- beat the dispatcher's 'running' write) so the result is never lost.
  SELECT status
    INTO v_status
  FROM public.node_results
  WHERE execution_id = p_execution_id
    AND node_id = p_node_id
  FOR UPDATE;

  IF FOUND AND v_status IN ('completed', 'failed') THEN
    -- Already finalized by another trigger — this caller loses the claim.
    RETURN FALSE;
  END IF;

  INSERT INTO public.node_results AS nr
    (execution_id, node_id, status, result_type, result_data, error,
     provider_id, provider_job_id, session_id, user_id, updated_at)
  VALUES
    (p_execution_id, p_node_id, p_status, p_result_type, p_result_data, p_error,
     p_provider_id, p_provider_job_id, p_session_id, p_user_id, NOW())
  ON CONFLICT (execution_id, node_id) DO UPDATE
    SET status          = EXCLUDED.status,
        result_type     = EXCLUDED.result_type,
        result_data     = EXCLUDED.result_data,
        error           = EXCLUDED.error,
        provider_id     = EXCLUDED.provider_id,
        provider_job_id = EXCLUDED.provider_job_id,
        session_id      = COALESCE(EXCLUDED.session_id, nr.session_id),
        user_id         = COALESCE(EXCLUDED.user_id, nr.user_id),
        updated_at      = NOW();

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_node_completion(UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_node_completion(UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, UUID, UUID)
  TO service_role;

COMMENT ON FUNCTION public.claim_node_completion IS
  'Atomically claims a single (non-fan-out) node''s running/pending->terminal transition and writes the result under a row lock. Returns true only for the caller that won; that caller dispatches children exactly once.';
