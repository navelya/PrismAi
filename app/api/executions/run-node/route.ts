/**
 * Workflow Engine V3 - Run Node API
 * Handles Step 3: UI request to run a specific node.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { runAtomicNode } from '@/lib/workflow/atomic-executor';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { session_id, node_id, user_id } = body;

    if (!session_id || !node_id) {
      return NextResponse.json({ error: 'Missing session_id or node_id' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // 1. Create a top-level execution record (Step 1)
    const { data: execution, error: execError } = await supabase
      .from('executions')
      .insert({
        session_id,
        user_id: user_id || null,
        status: 'running'
      })
      .select()
      .single();

    if (execError) throw new Error(`Failed to create execution: ${execError.message}`);

    // 2. Start the atomic execution (Step 4)
    // We DON'T await this if we want to return immediately, 
    // but for Phase 1 stability, we await the INITIAL setup.
    // Replicate will handle the long-wait via Webhook.
    console.log(`[API/Run-Node] Triggering atomic run for node ${node_id}`);
    
    await runAtomicNode(session_id, node_id, execution.id);

    return NextResponse.json({
      success: true,
      execution_id: execution.id
    });

  } catch (error: any) {
    console.error('[API/Run-Node] ❌ Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
