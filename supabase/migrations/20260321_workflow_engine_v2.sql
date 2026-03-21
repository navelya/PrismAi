-- Migration: Workflow Engine v2 - Foundation
-- Date: 2026-03-21
-- Description: Creates new execution engine tables alongside existing architecture
--              Part of the synthesized Gravity + Antigravity + Claude plan

-- ============================================================================
-- 1. Main Execution Tracking Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.executions_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- The complete node graph snapshot at execution time
  graph_json JSONB NOT NULL,
  
  -- Dynamic state of all nodes: {node_id: {status, result_url, dispatched_at, replicate_prediction_id, ...}}
  node_states JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  -- Overall execution status
  status TEXT NOT NULL DEFAULT 'pending',
  CONSTRAINT valid_execution_status CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- ============================================================================
-- 2. Execution Events Table (Append-Only Log)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.execution_events (
  id BIGSERIAL PRIMARY KEY,
  execution_id UUID REFERENCES public.executions_v2(id) ON DELETE CASCADE,
  node_id TEXT,
  
  -- Event types: 'dispatched', 'running', 'completed', 'failed', 'cancelled', 'retried'
  event_type TEXT NOT NULL,
  
  -- Correlation ID for tracing across webhooks and API calls
  correlation_id UUID DEFAULT gen_random_uuid(),
  
  -- Flexible payload for event-specific data
  payload JSONB DEFAULT '{}'::jsonb,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 3. Performance Indexes
-- ============================================================================

-- Query executions by session
CREATE INDEX IF NOT EXISTS idx_executions_v2_session 
ON public.executions_v2(session_id, created_at DESC);

-- Query running/pending executions for monitoring
CREATE INDEX IF NOT EXISTS idx_executions_v2_status 
ON public.executions_v2(status) 
WHERE status IN ('pending', 'running');

-- Query executions by user
CREATE INDEX IF NOT EXISTS idx_executions_v2_user 
ON public.executions_v2(user_id, created_at DESC);

-- Query events by execution (timeline reconstruction)
CREATE INDEX IF NOT EXISTS idx_execution_events_exec_id 
ON public.execution_events(execution_id, created_at DESC);

-- Query events by type (metrics/analytics)
CREATE INDEX IF NOT EXISTS idx_execution_events_type 
ON public.execution_events(event_type, created_at DESC);

-- ============================================================================
-- 4. Graph Validation Function
-- ============================================================================

CREATE OR REPLACE FUNCTION public.validate_graph_json(graph JSONB)
RETURNS BOOLEAN AS $$
DECLARE
  node JSONB;
  edge JSONB;
  node_ids TEXT[];
  source_id TEXT;
  target_id TEXT;
BEGIN
  -- Validate graph structure
  IF graph IS NULL OR NOT (graph ? 'nodes') THEN
    RAISE EXCEPTION 'Graph must contain a nodes array';
  END IF;
  
  -- Extract all node IDs
  SELECT ARRAY_AGG(n->>'id') INTO node_ids
  FROM jsonb_array_elements(graph->'nodes') n;
  
  -- If there are edges, validate them
  IF graph ? 'edges' THEN
    FOR edge IN SELECT * FROM jsonb_array_elements(graph->'edges')
    LOOP
      source_id := edge->>'source';
      target_id := edge->>'target';
      
      IF NOT (source_id = ANY(node_ids)) THEN
        RAISE EXCEPTION 'Invalid edge: source node % does not exist', source_id;
      END IF;
      
      IF NOT (target_id = ANY(node_ids)) THEN
        RAISE EXCEPTION 'Invalid edge: target node % does not exist', target_id;
      END IF;
    END LOOP;
  END IF;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 5. Auto-Update Timestamp Trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_executions_v2_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER executions_v2_updated_at
BEFORE UPDATE ON public.executions_v2
FOR EACH ROW
EXECUTE FUNCTION public.update_executions_v2_updated_at();

-- ============================================================================
-- 6. Event-Driven Notification Trigger (Core of Event-Driven Architecture)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_execution_update()
RETURNS TRIGGER AS $$
DECLARE
  notification JSON;
BEGIN
  -- Only notify if node_states actually changed
  IF OLD.node_states IS DISTINCT FROM NEW.node_states OR OLD.status IS DISTINCT FROM NEW.status THEN
    notification := json_build_object(
      'execution_id', NEW.id,
      'session_id', NEW.session_id,
      'status', NEW.status,
      'updated_at', NEW.updated_at
    );
    
    PERFORM pg_notify('execution_update', notification::text);
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER execution_update_trigger
AFTER UPDATE ON public.executions_v2
FOR EACH ROW
EXECUTE FUNCTION public.notify_execution_update();

-- ============================================================================
-- 7. Row Level Security (RLS)
-- ============================================================================

ALTER TABLE public.executions_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.execution_events ENABLE ROW LEVEL SECURITY;

-- Users can only see their own executions
CREATE POLICY "Users can view their own executions" 
ON public.executions_v2 FOR SELECT
USING (user_id = auth.uid());

-- Users can only create executions for their own sessions
CREATE POLICY "Users can create executions for their sessions" 
ON public.executions_v2 FOR INSERT
WITH CHECK (
  user_id = auth.uid() 
  AND EXISTS (
    SELECT 1 FROM public.sessions 
    WHERE sessions.id = executions_v2.session_id 
    AND sessions.user_id = auth.uid()
  )
);

-- Users can only update their own executions
CREATE POLICY "Users can update their own executions" 
ON public.executions_v2 FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Users can view events for their executions
CREATE POLICY "Users can view their execution events" 
ON public.execution_events FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.executions_v2 
  WHERE executions_v2.id = execution_events.execution_id 
  AND executions_v2.user_id = auth.uid()
));

-- System can insert events (SECURITY DEFINER functions will handle this)
CREATE POLICY "System can insert execution events" 
ON public.execution_events FOR INSERT
WITH CHECK (true);

-- ============================================================================
-- 8. Storage Buckets for Workflow Assets
-- ============================================================================

-- Create permanent workflow outputs bucket (if not exists)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'workflow-outputs',
  'workflow-outputs',
  true,
  52428800, -- 50MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Create ephemeral temporary storage bucket (if not exists)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'workflow-ephemeral-tmp',
  'workflow-ephemeral-tmp',
  true,
  52428800, -- 50MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for workflow-outputs
CREATE POLICY "Users can upload to workflow-outputs"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'workflow-outputs' 
  AND auth.uid() IS NOT NULL
);

CREATE POLICY "Anyone can view workflow-outputs"
ON storage.objects FOR SELECT
USING (bucket_id = 'workflow-outputs');

CREATE POLICY "Users can delete their workflow-outputs"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'workflow-outputs' 
  AND auth.uid() IS NOT NULL
);

-- Storage policies for workflow-ephemeral-tmp
CREATE POLICY "Users can upload to workflow-ephemeral-tmp"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'workflow-ephemeral-tmp' 
  AND auth.uid() IS NOT NULL
);

CREATE POLICY "Anyone can view workflow-ephemeral-tmp"
ON storage.objects FOR SELECT
USING (bucket_id = 'workflow-ephemeral-tmp');

CREATE POLICY "System can delete workflow-ephemeral-tmp"
ON storage.objects FOR DELETE
USING (bucket_id = 'workflow-ephemeral-tmp');

-- ============================================================================
-- 9. Helper Functions
-- ============================================================================

-- Log an execution event (used by backend)
CREATE OR REPLACE FUNCTION public.log_execution_event(
  p_execution_id UUID,
  p_node_id TEXT,
  p_event_type TEXT,
  p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID AS $$
DECLARE
  v_correlation_id UUID;
BEGIN
  v_correlation_id := gen_random_uuid();
  
  INSERT INTO public.execution_events (
    execution_id,
    node_id,
    event_type,
    correlation_id,
    payload,
    created_at
  ) VALUES (
    p_execution_id,
    p_node_id,
    p_event_type,
    v_correlation_id,
    p_payload,
    NOW()
  );
  
  RETURN v_correlation_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get execution timeline (all events for debugging)
CREATE OR REPLACE FUNCTION public.get_execution_timeline(p_execution_id UUID)
RETURNS TABLE (
  event_id BIGINT,
  node_id TEXT,
  event_type TEXT,
  correlation_id UUID,
  payload JSONB,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ee.id,
    ee.node_id,
    ee.event_type,
    ee.correlation_id,
    ee.payload,
    ee.created_at
  FROM public.execution_events ee
  WHERE ee.execution_id = p_execution_id
  ORDER BY ee.created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Comments for Documentation
-- ============================================================================

COMMENT ON TABLE public.executions_v2 IS 'Workflow Engine v2: Main execution tracking with graph snapshot and dynamic node states';
COMMENT ON TABLE public.execution_events IS 'Workflow Engine v2: Append-only event log for observability and debugging';
COMMENT ON COLUMN public.executions_v2.graph_json IS 'Complete node graph snapshot at execution start time (immutable)';
COMMENT ON COLUMN public.executions_v2.node_states IS 'Dynamic state map: {node_id: {status, result_url, replicate_prediction_id, error, ...}}';
COMMENT ON FUNCTION public.validate_graph_json IS 'Validates graph structure: nodes exist, edges reference valid nodes';
COMMENT ON FUNCTION public.notify_execution_update IS 'Fires pg_notify when node_states change (event-driven dispatch trigger)';
COMMENT ON FUNCTION public.log_execution_event IS 'Helper to log execution events with correlation IDs';
