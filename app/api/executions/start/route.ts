/**
 * Workflow Engine v2 - Start Execution Endpoint
 * API route to initialize and start a workflow execution
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { GraphJson } from '@/lib/workflow/types-v2';
import { transformWorkflowV1ToV2 } from '@/lib/workflow/node-type-mapper';

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
    
    // CRITICAL FIX: Trigger dispatch in separate serverless invocation
    // Fire-and-forget was causing process termination before dispatch completed
    console.log(`[Execution/Start] Triggering check-and-dispatch via separate API call`);
    
    // Get app URL for internal API call
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 
                   (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
    
    // Make internal fetch to check-and-dispatch endpoint
    // This runs in a separate serverless invocation and won't be killed
    fetch(`${appUrl}/api/executions/check-and-dispatch`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ execution_id: execution.id }),
    }).catch(error => {
      console.error(`[Execution/Start] Failed to trigger check-and-dispatch:`, error);
    });
    
    console.log(`[Execution/Start] Check-and-dispatch API call initiated in separate process`);
    
    // Return execution details immediately
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
