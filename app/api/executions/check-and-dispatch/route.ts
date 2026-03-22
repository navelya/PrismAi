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
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('[API/Check-and-Dispatch] 🎯 ENDPOINT HIT');
  console.log('  Request URL:', request.url);
  console.log('  Method:', request.method);
  console.log('  Headers:', {
    authorization: request.headers.get('authorization')?.substring(0, 20) + '...',
    'content-type': request.headers.get('content-type'),
  });
  console.log('═══════════════════════════════════════════════════════════════');
  
  try {
    // Verify authorization (service role key)
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error('[API/Check-and-Dispatch] ❌ Missing or invalid auth header');
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    // Parse request body
    const body = await request.json();
    const executionId = body.execution_id;
    
    if (!executionId) {
      console.error('[API/Check-and-Dispatch] ❌ Missing execution_id in body');
      return NextResponse.json(
        { error: 'Missing execution_id' },
        { status: 400 }
      );
    }
    
    console.log(`[API/Check-and-Dispatch] ✅ Starting check-and-dispatch for execution ${executionId}`);
    
    // CRITICAL: Call check-and-dispatch and AWAIT it
    // This endpoint runs in its own serverless invocation
    // We need to await to ensure it completes before the process terminates
    await checkAndDispatch(executionId);
    
    console.log(`[API/Check-and-Dispatch] ✅ Check-and-dispatch completed for execution ${executionId}`);
    
    // Return success
    return NextResponse.json({
      success: true,
      execution_id: executionId,
      message: 'Check-and-dispatch completed',
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