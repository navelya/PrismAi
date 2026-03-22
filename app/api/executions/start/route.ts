/**
 * Workflow Engine v2 - Start Execution Endpoint
 * API route to initialize and start a workflow execution
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { GraphJson } from '@/lib/workflow/types-v2';
import { transformWorkflowV1ToV2 } from '@/lib/workflow/node-type-mapper';

// NOTE: Cannot use Edge Runtime because check-and-dispatch uses Sharp (Node.js only)
// For instant response, deploy the Supabase Edge Function (STEP 4)
// That provides event-driven dispatch without blocking this endpoint

export async function POST(request: NextRequest) {
  console.log('[Execution/Start] Received start execution request');
  
  try {
    const body = await request.json();
    const { session_id, workflow, user_id } = body;
    let { graph_json } = body;
    
    // Validate required fields
    if (!session_id || (!graph_json && !workflow)) {
      return NextResponse.json(
        { error: 'Missing required fields: session_id, and either graph_json or workflow' },
        { status: 400 }
      );
    }

    // If workflow is provided (V1 format), transform it to graph_json (V2 format)
    if (workflow && !graph_json) {
      console.log('[Execution/Start] Transforming V1 workflow to V2 graph_json on server');
      try {
        graph_json = await transformWorkflowV1ToV2(workflow);
      } catch (transformError) {
        console.error('[Execution/Start] Transformation failed:', transformError);
        return NextResponse.json(
          { error: `Workflow transformation failed: ${transformError instanceof Error ? transformError.message : 'Unknown error'}` },
          { status: 500 }
        );
      }
    }
    
    // Validate graph structure
    if (!graph_json || !graph_json.nodes || !Array.isArray(graph_json.nodes)) {
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
    
    // V2 ARCHITECTURE: Database trigger → Edge Function → Dispatch
    // The Postgres trigger will fire NOTIFY, Edge Function picks it up and dispatches
    // For now: await to ensure execution (TODO: Deploy Edge Function for instant response)
    console.log(`[Execution/Start] Starting check-and-dispatch (awaiting until Edge Function deployed)`);
    
    try {
      const { checkAndDispatch } = await import('@/lib/workflow/check-and-dispatch-v2');
      await checkAndDispatch(execution.id);
      console.log(`[Execution/Start] ✅ Check-and-dispatch completed`);
    } catch (error) {
      console.error(`[Execution/Start] ❌ Check-and-dispatch failed:`, error);
      // Don't fail the request - execution is created, can be retried
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
