-- Migration: Fix permissive RLS policies on workflow tables
-- Replaces the wide-open USING (true) policies with user-scoped policies

-- ==========================================
-- 1. Drop existing permissive policies
-- ==========================================

DROP POLICY IF EXISTS "Enable all operations for workflows" ON workflows;
DROP POLICY IF EXISTS "Enable all operations for nodes" ON nodes;
DROP POLICY IF EXISTS "Enable all operations for edges" ON edges;
DROP POLICY IF EXISTS "Enable all operations for executions" ON executions;

-- ==========================================
-- 2. Create user-scoped policies
-- ==========================================

-- Workflows: user_id is TEXT, so cast auth.uid() to text
CREATE POLICY "Users can view own workflows"
    ON workflows FOR SELECT
    USING (user_id = auth.uid()::text);

CREATE POLICY "Users can insert own workflows"
    ON workflows FOR INSERT
    WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY "Users can update own workflows"
    ON workflows FOR UPDATE
    USING (user_id = auth.uid()::text)
    WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY "Users can delete own workflows"
    ON workflows FOR DELETE
    USING (user_id = auth.uid()::text);

-- Nodes: scoped via workflow ownership (JOIN check)
CREATE POLICY "Users can view own nodes"
    ON nodes FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM workflows
        WHERE workflows.id = nodes.workflow_id
        AND workflows.user_id = auth.uid()::text
    ));

CREATE POLICY "Users can insert own nodes"
    ON nodes FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM workflows
        WHERE workflows.id = nodes.workflow_id
        AND workflows.user_id = auth.uid()::text
    ));

CREATE POLICY "Users can update own nodes"
    ON nodes FOR UPDATE
    USING (EXISTS (
        SELECT 1 FROM workflows
        WHERE workflows.id = nodes.workflow_id
        AND workflows.user_id = auth.uid()::text
    ));

CREATE POLICY "Users can delete own nodes"
    ON nodes FOR DELETE
    USING (EXISTS (
        SELECT 1 FROM workflows
        WHERE workflows.id = nodes.workflow_id
        AND workflows.user_id = auth.uid()::text
    ));

-- Edges: scoped via workflow ownership (JOIN check)
CREATE POLICY "Users can view own edges"
    ON edges FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM workflows
        WHERE workflows.id = edges.workflow_id
        AND workflows.user_id = auth.uid()::text
    ));

CREATE POLICY "Users can insert own edges"
    ON edges FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM workflows
        WHERE workflows.id = edges.workflow_id
        AND workflows.user_id = auth.uid()::text
    ));

CREATE POLICY "Users can update own edges"
    ON edges FOR UPDATE
    USING (EXISTS (
        SELECT 1 FROM workflows
        WHERE workflows.id = edges.workflow_id
        AND workflows.user_id = auth.uid()::text
    ));

CREATE POLICY "Users can delete own edges"
    ON edges FOR DELETE
    USING (EXISTS (
        SELECT 1 FROM workflows
        WHERE workflows.id = edges.workflow_id
        AND workflows.user_id = auth.uid()::text
    ));

-- Executions: scoped via workflow ownership (JOIN check)
CREATE POLICY "Users can view own executions"
    ON executions FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM workflows
        WHERE workflows.id = executions.workflow_id
        AND workflows.user_id = auth.uid()::text
    ));

CREATE POLICY "Users can insert own executions"
    ON executions FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM workflows
        WHERE workflows.id = executions.workflow_id
        AND workflows.user_id = auth.uid()::text
    ));

CREATE POLICY "Users can update own executions"
    ON executions FOR UPDATE
    USING (EXISTS (
        SELECT 1 FROM workflows
        WHERE workflows.id = executions.workflow_id
        AND workflows.user_id = auth.uid()::text
    ));

CREATE POLICY "Users can delete own executions"
    ON executions FOR DELETE
    USING (EXISTS (
        SELECT 1 FROM workflows
        WHERE workflows.id = executions.workflow_id
        AND workflows.user_id = auth.uid()::text
    ));
