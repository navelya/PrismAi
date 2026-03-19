-- Migration: Fix batch_upsert_executions to match new upsert_node_execution signature
-- Date: 2026-03-19
-- Reason: upsert_node_execution signature changed to 5 parameters (removed user_id)

-- ============================================================================
-- 1. Update batch_upsert_executions helper function
-- ============================================================================

CREATE OR REPLACE FUNCTION batch_upsert_executions(
    p_session_id UUID,
    p_executions JSONB
) RETURNS void AS $$
DECLARE
    execution JSONB;
BEGIN
    FOR execution IN SELECT * FROM jsonb_array_elements(p_executions)
    LOOP
        PERFORM upsert_node_execution(
            p_session_id,
            execution->>'nodeId',
            execution->>'status',
            execution->'output',
            execution->>'error'
        );
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION batch_upsert_executions IS 'Batch upsert node executions from JSONB array (removed user_id dependency)';
