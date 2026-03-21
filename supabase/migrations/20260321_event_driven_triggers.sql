-- Workflow Engine v2 - STEP 4: Event-Driven Triggers
-- Adds Postgres NOTIFY/LISTEN for instant node dispatch

-- =====================================================
-- 1. Create notification trigger function
-- =====================================================

CREATE OR REPLACE FUNCTION notify_execution_state_change()
RETURNS TRIGGER AS $$
DECLARE
  notification_payload JSON;
BEGIN
  -- Only notify on updates where node_states changed
  IF TG_OP = 'UPDATE' AND (OLD.node_states IS DISTINCT FROM NEW.node_states) THEN
    
    -- Build notification payload
    notification_payload := json_build_object(
      'execution_id', NEW.id,
      'status', NEW.status,
      'timestamp', NOW()
    );
    
    -- Send notification on channel 'execution_state_change'
    PERFORM pg_notify('execution_state_change', notification_payload::text);
    
    -- Also log to execution_events for observability
    INSERT INTO execution_events (
      execution_id,
      event_type,
      payload,
      created_at
    ) VALUES (
      NEW.id,
      'state_changed',
      json_build_object(
        'trigger', 'notify',
        'old_status', OLD.status,
        'new_status', NEW.status
      ),
      NOW()
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 2. Create trigger on executions_v2 table
-- =====================================================

DROP TRIGGER IF EXISTS trigger_execution_state_change ON executions_v2;

CREATE TRIGGER trigger_execution_state_change
  AFTER UPDATE ON executions_v2
  FOR EACH ROW
  EXECUTE FUNCTION notify_execution_state_change();

-- =====================================================
-- 3. Add index for faster execution lookups
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_executions_v2_status_updated 
  ON executions_v2(status, updated_at DESC)
  WHERE status IN ('pending', 'running');

-- =====================================================
-- 4. Create helper function for manual trigger testing
-- =====================================================

CREATE OR REPLACE FUNCTION trigger_check_and_dispatch(p_execution_id UUID)
RETURNS VOID AS $$
DECLARE
  notification_payload JSON;
BEGIN
  notification_payload := json_build_object(
    'execution_id', p_execution_id,
    'source', 'manual_trigger',
    'timestamp', NOW()
  );
  
  PERFORM pg_notify('execution_state_change', notification_payload::text);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trigger_check_and_dispatch IS 
  'Manually trigger check-and-dispatch for an execution. Useful for testing and recovery.';

-- =====================================================
-- 5. Grant permissions
-- =====================================================

GRANT EXECUTE ON FUNCTION notify_execution_state_change() TO authenticated;
GRANT EXECUTE ON FUNCTION trigger_check_and_dispatch(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION notify_execution_state_change() TO service_role;
GRANT EXECUTE ON FUNCTION trigger_check_and_dispatch(UUID) TO service_role;

-- =====================================================
-- 6. Success message
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '✅ Event-driven triggers installed successfully';
  RAISE NOTICE '📡 Listening on channel: execution_state_change';
  RAISE NOTICE '🔧 Test with: SELECT trigger_check_and_dispatch(''YOUR_EXECUTION_ID'');';
END $$;
