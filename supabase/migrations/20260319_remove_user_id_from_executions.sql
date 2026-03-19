-- Migration: Remove redundant user_id from node_executions
-- Date: 2026-03-19
-- Reason: user_id already exists in sessions table, accessible via foreign key

-- ============================================================================
-- 1. Drop existing RLS policies that reference user_id
-- ============================================================================

DROP POLICY IF EXISTS node_executions_select ON node_executions;
DROP POLICY IF EXISTS node_executions_insert ON node_executions;
DROP POLICY IF EXISTS node_executions_update ON node_executions;
DROP POLICY IF EXISTS node_executions_delete ON node_executions;

-- ============================================================================
-- 2. Remove user_id column and its index
-- ============================================================================

DROP INDEX IF EXISTS idx_node_executions_user;
ALTER TABLE node_executions DROP COLUMN IF EXISTS user_id;

-- ============================================================================
-- 3. Create new RLS policies using JOIN to sessions table
-- ============================================================================

-- Users can read executions for their own sessions
CREATE POLICY node_executions_select ON node_executions
    FOR SELECT 
    USING (
        session_id IN (
            SELECT id FROM sessions WHERE user_id = auth.uid()
        )
    );

-- Users can insert executions for their own sessions
CREATE POLICY node_executions_insert ON node_executions
    FOR INSERT 
    WITH CHECK (
        session_id IN (
            SELECT id FROM sessions WHERE user_id = auth.uid()
        )
    );

-- Users can update executions for their own sessions
CREATE POLICY node_executions_update ON node_executions
    FOR UPDATE 
    USING (
        session_id IN (
            SELECT id FROM sessions WHERE user_id = auth.uid()
        )
    );

-- Users can delete executions for their own sessions
CREATE POLICY node_executions_delete ON node_executions
    FOR DELETE 
    USING (
        session_id IN (
            SELECT id FROM sessions WHERE user_id = auth.uid()
        )
    );

-- ============================================================================
-- 4. Update helper functions to remove user_id parameter
-- ============================================================================

-- Drop the old 6-parameter version first to avoid ambiguity
DROP FUNCTION IF EXISTS upsert_node_execution(UUID, TEXT, TEXT, JSONB, TEXT, UUID);

-- Updated upsert function (removed p_user_id parameter)
CREATE OR REPLACE FUNCTION upsert_node_execution(
    p_session_id UUID,
    p_node_id TEXT,
    p_status TEXT,
    p_output JSONB DEFAULT NULL,
    p_error TEXT DEFAULT NULL
) RETURNS void AS $$
BEGIN
    INSERT INTO node_executions (
        session_id, 
        node_id, 
        status, 
        output, 
        error, 
        updated_at
    )
    VALUES (
        p_session_id, 
        p_node_id, 
        p_status, 
        p_output, 
        p_error, 
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

COMMENT ON FUNCTION upsert_node_execution(UUID, TEXT, TEXT, JSONB, TEXT) IS 'Upsert node execution state (user_id accessible via sessions FK)';
