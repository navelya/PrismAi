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
    
    // 1. Find the corresponding row in node_results (Step 6)
    const { data: resultRow, error: findError } = await supabase
      .from('node_results')
      .select('id, execution_id, node_id')
      .eq('replicate_id', predictionId)
      .single();
    
    if (findError || !resultRow) {
      console.error('[Webhook/Replicate-v2] ❌ Result row not found for prediction:', predictionId);
      return NextResponse.json({ error: 'Result row not found' }, { status: 404 });
    }

    // 2. Handle Completion (Step 5 & 6)
    if (status === 'succeeded') {
      const normalizedOutput = normalizeReplicateOutput(output);
      const resultUrl = normalizedOutput?.url || (Array.isArray(normalizedOutput) ? normalizedOutput[0]?.url : null);
      
      console.log(`[Webhook/Replicate-v2] ✅ Node ${resultRow.node_id} succeeded. URL: ${resultUrl}`);

      // Update node_results (Your Step 5: Store url in different table)
      await supabase
        .from('node_results')
        .update({
          status: 'completed',
          result_url: resultUrl,
          updated_at: new Date().toISOString(),
        })
        .eq('id', resultRow.id);

      // Update the parent execution status
      await supabase
        .from('executions')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', resultRow.execution_id);
      
    } else if (status === 'failed' || status === 'canceled') {
      console.error(`[Webhook/Replicate-v2] ❌ Node ${resultRow.node_id} failed:`, predictionError);
      
      await supabase
        .from('node_results')
        .update({
          status: 'failed',
          error: predictionError || `Prediction ${status}`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', resultRow.id);

      await supabase
        .from('executions')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', resultRow.execution_id);
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
