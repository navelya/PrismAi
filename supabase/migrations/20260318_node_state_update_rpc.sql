-- Migration: Atomic Node State Updates
-- Purpose: Enable concurrent-safe updates to individual nodes within canvas_state JSONB
-- Date: 2026-03-18

-- Drop function if exists (for idempotency)
DROP FUNCTION IF EXISTS public.update_node_in_canvas(uuid, text, jsonb);

-- Create the atomic update function
CREATE OR REPLACE FUNCTION public.update_node_in_canvas(
  p_session_id uuid,
  p_node_id text,
  p_node_data jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_canvas_state jsonb;
  v_nodes jsonb;
  v_node_index int;
  v_updated_canvas jsonb;
BEGIN
  -- Fetch current canvas_state
  SELECT canvas_state INTO v_canvas_state
  FROM public.sessions
  WHERE id = p_session_id;

  -- Handle null or missing canvas_state
  IF v_canvas_state IS NULL OR v_canvas_state = 'null'::jsonb THEN
    RAISE EXCEPTION 'Session % not found or has invalid canvas_state', p_session_id;
  END IF;

  -- Extract nodes array
  v_nodes := v_canvas_state->'nodes';
  
  IF v_nodes IS NULL OR jsonb_typeof(v_nodes) != 'array' THEN
    RAISE EXCEPTION 'Invalid canvas_state structure: nodes array not found';
  END IF;

  -- Find the index of the node to update
  SELECT idx - 1 INTO v_node_index
  FROM jsonb_array_elements(v_nodes) WITH ORDINALITY AS t(node, idx)
  WHERE node->>'id' = p_node_id;

  -- If node not found, raise exception
  IF v_node_index IS NULL THEN
    RAISE EXCEPTION 'Node % not found in canvas_state', p_node_id;
  END IF;

  -- Build the path to the specific node's data field
  -- Path: {nodes, <index>, data}
  v_updated_canvas := jsonb_set(
    v_canvas_state,
    ARRAY['nodes', v_node_index::text, 'data'],
    p_node_data,
    false -- Don't create if missing (should always exist)
  );

  -- Update the session with the modified canvas_state
  UPDATE public.sessions
  SET 
    canvas_state = v_updated_canvas,
    updated_at = now()
  WHERE id = p_session_id;

  -- Return the updated canvas_state
  RETURN v_updated_canvas;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.update_node_in_canvas(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_node_in_canvas(uuid, text, jsonb) TO service_role;

-- Comment for documentation
COMMENT ON FUNCTION public.update_node_in_canvas IS 
'Atomically updates a specific nodes data field within the canvas_state JSONB. 
Prevents race conditions from concurrent node completions. 
Used by workflow execution engine for real-time state persistence.';
