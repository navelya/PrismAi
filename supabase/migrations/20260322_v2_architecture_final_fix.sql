-- PRISMAI V2 ARCHITECTURE FINAL FIX (REVISED)
-- Date: 2026-03-22
-- Description: Cleans up all redundant/failing event-driven logic from previous migrations.
--              Specifically targeting the LISTEN/NOTIFY and pgnet approaches.
--              Ensures the atomic claim function is correct for the new Dashboard Webhook logic.

-- 1. CLEANUP: Drop triggers and functions from 20260321_event_driven_triggers
DROP TRIGGER IF EXISTS trigger_execution_state_change ON public.executions_v2;
DROP FUNCTION IF EXISTS public.notify_execution_state_change();
DROP FUNCTION IF EXISTS public.trigger_check_and_dispatch(UUID);

-- 2. CLEANUP: Drop triggers and functions from 20260322_database_webhooks_v2 (the one that used pgnet)
DROP TRIGGER IF EXISTS trigger_execution_webhook ON public.executions_v2;
DROP FUNCTION IF EXISTS public.invoke_check_and_dispatch();

-- 3. ENSURE ATOMIC LOGIC IS ROBUST
-- This replaces any previous versions of the claim function
CREATE OR REPLACE FUNCTION public.claim_node_for_dispatch(
  p_execution_id UUID,
  p_node_id TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_updated_states JSONB;
BEGIN
  -- Lock the row and check status atomically
  SELECT node_states INTO v_updated_states
  FROM public.executions_v2
  WHERE id = p_execution_id
  FOR UPDATE;
  
  -- Check if node exists and its status is 'pending'
  IF v_updated_states ? p_node_id AND v_updated_states->p_node_id->>'status' = 'pending' THEN
    -- Mark as 'dispatching' (Internal state for the Next.js process)
    v_updated_states := jsonb_set(
      v_updated_states,
      ARRAY[p_node_id, 'status'],
      '"dispatching"'::jsonb
    );
    
    UPDATE public.executions_v2
    SET 
      node_states = v_updated_states,
      updated_at = NOW()
    WHERE id = p_execution_id;
    
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. ENSURE NODE STATES DEFAULTS
ALTER TABLE public.executions_v2 
ALTER COLUMN node_states SET DEFAULT '{}'::jsonb;

-- 5. FINAL NOTICE
DO $$ 
BEGIN 
  RAISE NOTICE '✅ Architecture cleanup complete.';
  RAISE NOTICE '🚀 ACTION REQUIRED: Ensure your Dashboard Webhook is set up to call /api/executions/check-and-dispatch';
END $$;

COMMENT ON FUNCTION public.claim_node_for_dispatch IS 'Final V2 Logic: Atomically claims a pending node for dispatching.';
