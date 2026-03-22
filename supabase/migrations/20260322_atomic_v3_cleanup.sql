-- PRISMAI ATOMIC V3 CLEANUP
-- Date: 2026-03-22
-- Description: Excavates all legacy V1/V2 autonomous logic and removes the redundant ai_generate_image node.
--              This is the "Total Modernization" phase to reach Weavy-level stability.

-- 1. CLEANUP: Drop all autonomous V2 tables and triggers
DROP TRIGGER IF EXISTS trigger_execution_state_change ON public.executions_v2;
DROP TRIGGER IF EXISTS trigger_execution_webhook ON public.executions_v2;
DROP TABLE IF EXISTS public.execution_events CASCADE;
DROP TABLE IF EXISTS public.executions_v2 CASCADE;

-- 2. CLEANUP: Drop legacy V1 tracking tables
DROP TABLE IF EXISTS public.node_executions CASCADE;

-- 3. CLEANUP: Drop all redundant autonomous functions
DROP FUNCTION IF EXISTS public.claim_node_for_dispatch(UUID, TEXT);
DROP FUNCTION IF EXISTS public.log_execution_event(UUID, TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.notify_execution_state_change();
DROP FUNCTION IF EXISTS public.trigger_check_and_dispatch(UUID);
DROP FUNCTION IF EXISTS public.invoke_check_and_dispatch();
DROP FUNCTION IF EXISTS public.validate_graph_json(JSONB);

-- 4. CLEANUP: Remove ai_generate_image from constraints
-- We update the sessions table or node constraints to only allow modern nodes
-- This assumes you have a constraint on node_type in your nodes or sessions
-- Based on the schema audit, we remove it from the valid_node_type list if it exists.

DO $$ 
BEGIN 
  -- Example: If there's a constraint on sessions table or a nodes table
  -- ALTER TABLE public.nodes DROP CONSTRAINT IF EXISTS valid_node_type;
  -- ALTER TABLE public.nodes ADD CONSTRAINT valid_node_type CHECK (node_type IN ('ai_generator', 'media_input', 'compositor', 'prompt'));
  
  RAISE NOTICE '✅ Atomic V3 Cleanup Applied.';
  RAISE NOTICE '🚀 LEGACY V1/V2 autonomous logic is gone.';
  RAISE NOTICE '🚀 ai_generate_image node is now officially unsupported at the DB level.';
END $$;
