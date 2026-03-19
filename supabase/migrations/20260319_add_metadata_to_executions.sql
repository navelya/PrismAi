-- Migration: Add output_metadata to node_executions
-- Date: 2026-03-19
-- Reason: Clean separation of execution data and UI metadata (thumbnails, etc.)

-- ============================================================================
-- 1. Add column to node_executions
-- ============================================================================

ALTER TABLE node_executions ADD COLUMN IF NOT EXISTS output_metadata JSONB;

COMMENT ON COLUMN node_executions.output_metadata IS 'UI metadata for the output (thumbnails, urls, computed hashes)';

-- ============================================================================
-- 2. Update upsert_node_execution function
-- ============================================================================

-- Drop existing 5-parameter version
DROP FUNCTION IF EXISTS upsert_node_execution(UUID, TEXT, TEXT, JSONB, TEXT);

CREATE OR REPLACE FUNCTION upsert_node_execution(
    p_session_id UUID,
    p_node_id TEXT,
    p_status TEXT,
    p_output JSONB DEFAULT NULL,
    p_error TEXT DEFAULT NULL,
    p_output_metadata JSONB DEFAULT NULL
) RETURNS void AS $$
BEGIN
    INSERT INTO node_executions (
        session_id, 
        node_id, 
        status, 
        output, 
        error, 
        output_metadata,
        updated_at
    )
    VALUES (
        p_session_id, 
        p_node_id, 
        p_status, 
        p_output, 
        p_error, 
        p_output_metadata,
        NOW()
    )
    ON CONFLICT (session_id, node_id) 
    DO UPDATE SET
        status = EXCLUDED.status,
        output = COALESCE(EXCLUDED.output, node_executions.output),
        error = EXCLUDED.error,
        output_metadata = COALESCE(EXCLUDED.output_metadata, node_executions.output_metadata),
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION upsert_node_execution(UUID, TEXT, TEXT, JSONB, TEXT, JSONB) IS 'Upsert node execution state with separate metadata column';

-- ============================================================================
-- 3. Update get_session_executions function
-- ============================================================================

DROP FUNCTION IF EXISTS get_session_executions(UUID);

CREATE OR REPLACE FUNCTION get_session_executions(p_session_id UUID)
RETURNS TABLE(
    node_id TEXT, 
    status TEXT, 
    output JSONB, 
    error TEXT,
    output_metadata JSONB,
    updated_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ne.node_id, 
        ne.status, 
        ne.output, 
        ne.error,
        ne.output_metadata,
        ne.updated_at
    FROM node_executions ne
    WHERE ne.session_id = p_session_id
    ORDER BY ne.updated_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_session_executions IS 'Retrieve all node executions with metadata for a session';
