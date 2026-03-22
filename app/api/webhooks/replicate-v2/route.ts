/**
 * Workflow Engine v2 - Replicate Webhook Handler
 * Receives callbacks from Replicate when predictions complete
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { REPLICATE_WEBHOOK_SIGNING_SECRET, normalizeReplicateOutput } from '@/lib/ai/replicate-client';
import { Webhook } from 'standardwebhooks';

export async function POST(request: NextRequest) {
  // TIER 2 FIX: Detailed webhook logging
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('[Webhook/Replicate-v2] 📨 RECEIVED WEBHOOK FROM REPLICATE:');
  console.log('  Request URL:', request.url);
  console.log('  Method:', request.method);
  console.log('  Headers:', {
    'webhook-id': request.headers.get('webhook-id'),
    'webhook-timestamp': request.headers.get('webhook-timestamp'),
    'content-type': request.headers.get('content-type'),
  });
  console.log('═══════════════════════════════════════════════════════════════');
  
  try {
    const { searchParams } = new URL(request.url);
    const executionId = searchParams.get('executionId');
    const nodeId = searchParams.get('nodeId');
    
    // Validate context parameters
    if (!executionId || !nodeId) {
      console.error('[Webhook/Replicate-v2] ❌ Missing context:', {
        executionId,
        nodeId,
        url: request.url,
      });
      return NextResponse.json(
        { error: 'Missing executionId or nodeId' },
        { status: 400 }
      );
    }
    
    console.log(`[Webhook/Replicate-v2] ✅ Received callback for node ${nodeId} in execution ${executionId}`);
    
    // Verify webhook signature if secret is configured
    const bodyText = await request.text();
    
    if (REPLICATE_WEBHOOK_SIGNING_SECRET) {
      const wh = new Webhook(REPLICATE_WEBHOOK_SIGNING_SECRET);
      const headers = {
        'webhook-id': request.headers.get('webhook-id') || '',
        'webhook-timestamp': request.headers.get('webhook-timestamp') || '',
        'webhook-signature': request.headers.get('webhook-signature') || '',
      };
      
      try {
        wh.verify(bodyText, headers);
        console.log(`[Webhook/Replicate-v2] Signature verified for node ${nodeId}`);
      } catch (err) {
        console.error('[Webhook/Replicate-v2] Signature verification failed:', err);
        return NextResponse.json(
          { error: 'Invalid signature' },
          { status: 401 }
        );
      }
    } else {
      console.warn('[Webhook/Replicate-v2] WARNING: No signing secret configured');
    }
    
    const body = JSON.parse(bodyText);
    const { status, output, error: predictionError, id: predictionId } = body;
    
    console.log(`[Webhook/Replicate-v2] Prediction ${predictionId} status: ${status}`);
    
    const supabase = createServiceClient();
    
    // Fetch current execution
    const { data: execution, error: fetchError } = await supabase
      .from('executions_v2')
      .select('node_states, graph_json')
      .eq('id', executionId)
      .single();
    
    if (fetchError || !execution) {
      console.error('[Webhook/Replicate-v2] Execution not found:', fetchError);
      return NextResponse.json(
        { error: 'Execution not found' },
        { status: 404 }
      );
    }
    
    // Handle different prediction statuses
    if (status === 'succeeded') {
      console.log(`[Webhook/Replicate-v2] Node ${nodeId} completed successfully`);
      
      // Normalize output to standard format
      const normalizedOutput = normalizeReplicateOutput(output);
      const resultUrl = normalizedOutput?.url || (Array.isArray(normalizedOutput) ? normalizedOutput[0]?.url : null);
      
      // Update node state to completed
      const updatedNodeStates = {
        ...execution.node_states,
        [nodeId]: {
          ...execution.node_states[nodeId],
          status: 'completed',
          result_url: resultUrl,
          output: normalizedOutput,
          completed_at: new Date().toISOString(),
        },
      };
      
      // Update execution
      const { error: updateError } = await supabase
        .from('executions_v2')
        .update({
          node_states: updatedNodeStates,
          updated_at: new Date().toISOString(),
        })
        .eq('id', executionId);
      
      if (updateError) {
        console.error('[Webhook/Replicate-v2] Failed to update execution:', updateError);
        return NextResponse.json(
          { error: 'Failed to update execution' },
          { status: 500 }
        );
      }
      
      // Log completion event
      await supabase.rpc('log_execution_event', {
        p_execution_id: executionId,
        p_node_id: nodeId,
        p_event_type: 'completed',
        p_payload: { result_url: resultUrl },
      });
      
      console.log(`[Webhook/Replicate-v2] Successfully processed completion for node ${nodeId}`);
      
      // STEP 4: Trigger downstream dispatch
      // Since Edge Function listener is not deployed yet, call check-and-dispatch directly
      console.log(`[Webhook/Replicate-v2] Triggering check-and-dispatch for downstream nodes`);
      
      const { checkAndDispatch } = await import('@/lib/workflow/check-and-dispatch-v2');
      checkAndDispatch(executionId).catch(error => {
        console.error(`[Webhook/Replicate-v2] Check-and-dispatch error:`, error);
      });
      
    } else if (status === 'failed' || status === 'canceled') {
      console.error(`[Webhook/Replicate-v2] Node ${nodeId} failed:`, predictionError);
      
      // Update node state to failed
      const updatedNodeStates = {
        ...execution.node_states,
        [nodeId]: {
          ...execution.node_states[nodeId],
          status: 'failed',
          error: predictionError || `Prediction ${status}`,
          completed_at: new Date().toISOString(),
        },
      };
      
      // Update execution to failed
      await supabase
        .from('executions_v2')
        .update({
          node_states: updatedNodeStates,
          status: 'failed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', executionId);
      
      // Log failure event
      await supabase.rpc('log_execution_event', {
        p_execution_id: executionId,
        p_node_id: nodeId,
        p_event_type: 'failed',
        p_payload: { error: predictionError || `Prediction ${status}` },
      });
      
    } else {
      console.log(`[Webhook/Replicate-v2] Ignoring intermediate status: ${status}`);
    }
    
    return NextResponse.json({ success: true });
    
  } catch (error) {
    console.error('[Webhook/Replicate-v2] Unexpected error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
