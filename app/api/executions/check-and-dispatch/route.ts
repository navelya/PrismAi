/**
 * Workflow Engine v2 - STEP 4: Check-and-Dispatch API Route
 * 
 * Internal endpoint for triggering check-and-dispatch.
 * Called by the event listener edge function when notifications arrive.
 * 
 * POST /api/executions/check-and-dispatch
 * Body: { execution_id: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkAndDispatch } from '@/lib/workflow/check-and-dispatch-v2';
import { createServiceClient } from '@/lib/supabase/service';

export async function POST(request: NextRequest) {
  console.log('[API/Check-and-Dispatch] Received request');
  
  try {
    // Verify authorization (service role key)
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    // Parse request body
    const body = await request.json();
    const executionId = body.execution_id;
    
    if (!executionId) {
      return NextResponse.json(
        { error: 'Missing execution_id' },
        { status: 400 }
      );
    }
    
    console.log(`[API/Check-and-Dispatch] Triggering check-and-dispatch for execution ${executionId}`);
    
    // Call check-and-dispatch (async, don't wait for completion)
    checkAndDispatch(executionId).catch(error => {
      console.error(`[API/Check-and-Dispatch] Error:`, error);
    });
    
    // Return immediately
    return NextResponse.json({
      success: true,
      execution_id: executionId,
      message: 'Check-and-dispatch triggered',
    });
    
  } catch (error) {
    console.error('[API/Check-and-Dispatch] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Allow GET for health checks
export async function GET(request: NextRequest) {
  return NextResponse.json({
    status: 'healthy',
    endpoint: '/api/executions/check-and-dispatch',
    method: 'POST',
  });
}