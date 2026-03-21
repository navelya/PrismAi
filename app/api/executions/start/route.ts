/**
 * Workflow Engine v2 - Start Execution Endpoint
 * API route to initialize and start a workflow execution
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { GraphJson } from '@/lib/workflow/types-v2';

export async function POST(request: NextRequest) {
  console.log('[Execution/Start] Received start execution request');
  
  try {
    const body = await request.json();
    const { session_id, graph_json, user_id } = body;
    
    // Validate required fields
    if (!session_id || !graph_json) {
      return NextResponse.json(
        { error: 'Missing required fields: session_id, graph_json' },
        { status: 400 }
      );
    }
    
    // Validate graph structure
    if (!graph_json.nodes || !Array.isArray(graph_json.nodes)) {
      return NextResponse.json(
        { error: 'Invalid graph_json: must contain nodes array' },
        { status: 400 }
      );
    }
    
    console.log(`[Execution/Start] Starting execution for session ${session_id} with ${graph_json.nodes.length} nodes`);
    
    const supabase = createServiceClient();
    
    // Validate graph structure using DB function
    try {
      const { data: isValid, error: validationError } = await supabase
        .rpc('validate_graph_json', { graph: graph_json });
      
      if (validationError) {
        console.error('[Execution/Start] Graph validation failed:', validationError);
        return NextResponse.json(
          { error: `Graph validation failed: ${validationError.message}` },
          { status: 400 }
        );
      }
    } catch (validationError) {
      console.error('[Execution/Start] Graph validation error:', validationError);
      return NextResponse.json(
        { error: 'Graph validation failed' },
        { status: 400 }
      );
    }
    
    // Initialize node_states - all nodes start as pending
    const initialNodeStates: Record<string, any> = {};
    for (const node of graph_json.nodes) {
      initialNodeStates[node.id] = {
        status: 'pending',
      };
    }
    
    // Create execution record
    const { data: execution, error: createError } = await supabase
      .from('executions_v2')
      .insert({
        session_id,
        user_id: user_id || null,
        graph_json,
        node_states: initialNodeStates,
        status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    
    if (createError || !execution) {
      console.error('[Execution/Start] Failed to create execution:', createError);
      return NextResponse.json(
        { error: `Failed to create execution: ${createError?.message}` },
        { status: 500 }
      );
    }
    
    console.log(`[Execution/Start] Created execution ${execution.id}`);
    
    // STEP 4: Trigger initial dispatch
    // Since Edge Function listener is not deployed yet, call check-and-dispatch directly
    console.log(`[Execution/Start] Triggering initial check-and-dispatch`);
    
    try {
      // Import and call check-and-dispatch directly
      const { checkAndDispatch } = await import('@/lib/workflow/check-and-dispatch-v2');
      
      console.log(`[Execution/Start] Successfully imported check-and-dispatch, calling now...`);
      
      // Call check-and-dispatch (don't wait for full completion, but catch errors)
      checkAndDispatch(execution.id).catch(error => {
        console.error(`[Execution/Start] Check-and-dispatch error:`, error);
      });
      
      console.log(`[Execution/Start] Check-and-dispatch call initiated`);
    } catch (importError) {
      console.error(`[Execution/Start] Failed to import check-and-dispatch:`, importError);
    }
    
    // Return execution details
    return NextResponse.json({
      success: true,
      execution_id: execution.id,
      status: 'pending',
    });
    
  } catch (error) {
    console.error('[Execution/Start] Unexpected error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
