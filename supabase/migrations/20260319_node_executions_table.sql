-- Migration: Separate node execution state into dedicated table
-- Date: 2026-03-19
-- Purpose: Complete isolation of execution state from canvas state

-- ============================================================================
-- 1. Create node_executions table
-- ============================================================================

CREATE TABLE IF NOT EXISTS node_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'idle',
    output JSONB,
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    user_id UUID REFERENCES auth.users(id),
    
    -- One row per node per session (current state)
    UNIQUE(session_id, node_id)
);

COMMENT ON TABLE node_executions IS 'Stores execution state for workflow nodes, separate from canvas layout';
COMMENT ON COLUMN node_executions.session_id IS 'Links to the workflow session';
COMMENT ON COLUMN node_executions.node_id IS 'The node identifier from canvas_state';
COMMENT ON COLUMN node_executions.status IS 'Current execution status: idle, pending, running, success, error';
COMMENT ON COLUMN node_executions.output IS 'Execution result data';
COMMENT ON COLUMN node_executions.error IS 'Error message if status is error';
COMMENT ON COLUMN node_executions.user_id IS 'Owner for RLS, can be NULL for shared sessions';

-- ============================================================================
-- 2. Create indexes for performance
-- ============================================================================

CREATE INDEX idx_node_executions_session ON node_executions(session_id);
CREATE INDEX idx_node_executions_status ON node_executions(status);
CREATE INDEX idx_node_executions_user ON node_executions(user_id);
CREATE INDEX idx_node_executions_updated ON node_executions(updated_at);

-- ============================================================================
-- 3. Enable Row Level Security
-- ============================================================================

ALTER TABLE node_executions ENABLE ROW LEVEL SECURITY;

-- Users can read their own executions
CREATE POLICY node_executions_select ON node_executions
    FOR SELECT 
    USING (user_id = auth.uid() OR user_id IS NULL);

-- Users can insert their own executions
CREATE POLICY node_executions_insert ON node_executions
    FOR INSERT 
    WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

-- Users can update their own executions
CREATE POLICY node_executions_update ON node_executions
    FOR UPDATE 
    USING (user_id = auth.uid() OR user_id IS NULL);

-- Users can delete their own executions
CREATE POLICY node_executions_delete ON node_executions
    FOR DELETE 
    USING (user_id = auth.uid() OR user_id IS NULL);

-- ============================================================================
-- 4. Helper Functions
-- ============================================================================

-- Upsert node execution (insert or update)
CREATE OR REPLACE FUNCTION upsert_node_execution(
    p_session_id UUID,
    p_node_id TEXT,
    p_status TEXT,
    p_output JSONB DEFAULT NULL,
    p_error TEXT DEFAULT NULL,
    p_user_id UUID DEFAULT NULL
) RETURNS void AS $$
BEGIN
    INSERT INTO node_executions (
        session_id, 
        node_id, 
        status, 
        output, 
        error, 
        user_id, 
        updated_at
    )
    VALUES (
        p_session_id, 
        p_node_id, 
        p_status, 
        p_output, 
        p_error, 
        p_user_id, 
        NOW()
    )
    ON CONFLICT (session_id, node_id) 
    DO UPDATE SET
        status = EXCLUDED.status,
        output = COALESCE(EXCLUDED.output, node_executions.output),
        error = EXCLUDED.error,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION upsert_node_execution IS 'Upsert node execution state, preserving output if not provided';

-- Get all node executions for a session
CREATE OR REPLACE FUNCTION get_session_executions(p_session_id UUID)
RETURNS TABLE(
    node_id TEXT, 
    status TEXT, 
    output JSONB, 
    error TEXT,
    updated_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ne.node_id, 
        ne.status, 
        ne.output, 
        ne.error,
        ne.updated_at
    FROM node_executions ne
    WHERE ne.session_id = p_session_id
    ORDER BY ne.updated_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_session_executions IS 'Retrieve all node executions for a session';

-- Clear executions for a session (for reset workflow)
CREATE OR REPLACE FUNCTION clear_session_executions(p_session_id UUID)
RETURNS void AS $$
BEGIN
    DELETE FROM node_executions WHERE session_id = p_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION clear_session_executions IS 'Delete all executions for a session (workflow reset)';

-- Batch upsert for initial load
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
            execution->>'error',
            (execution->>'userId')::UUID
        );
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION batch_upsert_executions IS 'Batch upsert node executions from JSONB array';

-- ============================================================================
-- 5. Migrate existing data from canvas_state
-- ============================================================================

-- Migrate status and output from sessions.canvas_state to node_executions
INSERT INTO node_executions (session_id, node_id, status, output, user_id)
SELECT 
    s.id as session_id,
    node->>'id' as node_id,
    COALESCE(node->'data'->>'status', 'idle') as status,
    node->'data'->'output' as output,
    s.user_id
FROM sessions s,
LATERAL jsonb_array_elements(s.canvas_state->'nodes') as node
WHERE s.canvas_state IS NOT NULL
  AND s.canvas_state->'nodes' IS NOT NULL
  AND node->'data'->>'status' IS NOT NULL
  AND node->'data'->>'status' != 'idle' -- Only migrate non-idle statuses
ON CONFLICT (session_id, node_id) DO NOTHING;

-- ============================================================================
-- 6. Clean canvas_state of execution data (optional, for data hygiene)
-- ============================================================================

-- Remove status, output, outputMetadata from canvas_state
-- This ensures clean separation going forward
UPDATE sessions
SET canvas_state = jsonb_set(
    canvas_state,
    '{nodes}',
    (
        SELECT jsonb_agg(
            node - 'data' || jsonb_build_object(
                'data',
                (node->'data') - 'status' - 'output' - 'outputMetadata'
            )
        )
        FROM jsonb_array_elements(canvas_state->'nodes') as node
    )
)
WHERE canvas_state IS NOT NULL 
  AND canvas_state->'nodes' IS NOT NULL
  AND EXISTS (
      SELECT 1 
      FROM jsonb_array_elements(canvas_state->'nodes') as node
      WHERE node->'data' ? 'status' 
         OR node->'data' ? 'output'
         OR node->'data' ? 'outputMetadata'
  );

-- ============================================================================
-- 7. Grant permissions
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON node_executions TO authenticated;
GRANT EXECUTE ON FUNCTION upsert_node_execution TO authenticated;
GRANT EXECUTE ON FUNCTION get_session_executions TO authenticated;
GRANT EXECUTE ON FUNCTION clear_session_executions TO authenticated;
GRANT EXECUTE ON FUNCTION batch_upsert_executions TO authenticated;
