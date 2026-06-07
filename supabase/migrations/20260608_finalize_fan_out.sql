-- Migration: Atomic finalize for ai_generator fan-out (iterations > 1)
-- Date: 2026-06-08
-- Description:
--   Replaces the webhook's non-atomic "count-pending -> gather rows -> conditional
--   update" finalize with a single locked transaction, and gates finalization on
--   the EXPECTED iteration count rather than "no pending rows". The expected-count
--   gate is what makes fan-out correct under every create/insert/callback ordering:
--   a fast callback can upsert its own 'completed' row by index before its sibling
--   rows even exist, so "zero pending among existing rows" would finalize on a
--   partial set (losing images). Waiting until exactly N iterations have resolved
--   removes that whole class of races. Mirrors the locking style of
--   claim_node_for_dispatch (SELECT ... FOR UPDATE).
--
--   Scope: a single (execution_id, node_id) fan-out. Per-row locking means
--   different nodes finalize concurrently without blocking each other.

CREATE OR REPLACE FUNCTION public.finalize_fan_out(
  p_execution_id   UUID,
  p_node_id        TEXT,
  p_output_type    TEXT,
  p_expected_count INT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status     TEXT;
  v_resolved   INT;
  v_completed  INT;
  v_aggregated JSONB;
BEGIN
  -- Lock the node's result row so concurrent webhooks serialize here. Only the
  -- node currently in 'running' is a finalize candidate.
  SELECT status
    INTO v_status
  FROM public.node_results
  WHERE execution_id = p_execution_id
    AND node_id = p_node_id
  FOR UPDATE;

  -- No running row yet (an early callback that beat dispatch's 'running' write):
  -- not ready. Dispatch re-calls finalize once the row exists and rows are in.
  IF NOT FOUND OR v_status IS DISTINCT FROM 'running' THEN
    RETURN FALSE;
  END IF;

  -- Readiness gate: all N iterations must have resolved (completed or failed).
  -- failed-at-creation rows are written 'failed' by the dispatcher and count here,
  -- so a partially-failed batch still finalizes once every index is accounted for.
  SELECT
    COUNT(*) FILTER (WHERE status IN ('completed', 'failed')),
    COUNT(*) FILTER (WHERE status = 'completed')
    INTO v_resolved, v_completed
  FROM public.node_predictions
  WHERE execution_id = p_execution_id
    AND node_id = p_node_id;

  IF v_resolved < p_expected_count THEN
    RETURN FALSE;
  END IF;

  -- Flatten every completed prediction's result_data array into one array,
  -- ordered by prediction_index then by element position within each prediction.
  SELECT COALESCE(jsonb_agg(elem ORDER BY np.prediction_index, ord), '[]'::jsonb)
    INTO v_aggregated
  FROM public.node_predictions np
  CROSS JOIN LATERAL jsonb_array_elements(np.result_data) WITH ORDINALITY AS t(elem, ord)
  WHERE np.execution_id = p_execution_id
    AND np.node_id = p_node_id
    AND np.status = 'completed'
    -- Defensive: only flatten array payloads. A completed row always stores an
    -- array (toResultDataForType), but guard so a malformed object/scalar can't
    -- make jsonb_array_elements raise and fail the whole finalize.
    AND jsonb_typeof(np.result_data) = 'array';

  UPDATE public.node_results
  SET status      = CASE WHEN v_completed > 0 THEN 'completed' ELSE 'failed' END,
      result_type = p_output_type,
      result_data = v_aggregated,
      error       = CASE WHEN v_completed > 0 THEN NULL ELSE 'All iterations failed' END,
      updated_at  = NOW()
  WHERE execution_id = p_execution_id
    AND node_id = p_node_id;

  -- This caller won the claim (transitioned the row out of 'running'); its caller
  -- is responsible for dispatching children exactly once.
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_fan_out(UUID, TEXT, TEXT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_fan_out(UUID, TEXT, TEXT, INT) TO service_role;

COMMENT ON FUNCTION public.finalize_fan_out IS
  'Atomically finalizes an ai_generator fan-out node: under a row lock, once all p_expected_count iterations have resolved, aggregates completed predictions into node_results and claims the running->completed/failed transition exactly once. Returns true for the single caller that finalized.';
