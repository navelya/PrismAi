-- Migration: Workflow Engine v2 - Atomic Node Claiming
-- Date: 2026-03-21
-- Description: Adds atomic function to claim nodes for dispatch (prevents race conditions)

-- ============================================================================
-- Atomic Node Claiming Function
-- ============================================================================

CREATE OR REPLACE FUNCTION public.claim_node_for_dispatch(
  p_execution_id UUID,
  p_node_id TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_current_status TEXT;
  v_updated_states JSONB;
BEGIN
  -- Lock the execution row for update
  SELECT node_states 
  INTO v_updated_states
  FROM public.executions_v2
  WHERE id = p_execution_id
  FOR UPDATE;
  
  -- Check if node exists and is pending
  v_current_status := v_updated_states->p_node_id->>'status';
  
  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'Node % does not exist in execution %', p_node_id, p_execution_id;
  END IF;
  
  IF v_current_status != 'pending' THEN
    -- Node already claimed or completed
    RETURN FALSE;
  END IF;
  
  -- Atomically update node status to 'dispatching'
  v_updated_states := jsonb_set(
    v_updated_states,
    ARRAY[p_node_id, 'status'],
    '"dispatching"'::jsonb
  );
  
  -- Write back to database
  UPDATE public.executions_v2
  SET 
    node_states = v_updated_states,
    updated_at = NOW()
  WHERE id = p_execution_id;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.claim_node_for_dispatch IS 'Atomically claims a pending node for dispatch, preventing race conditions in parallel execution';
