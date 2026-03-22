/**
 * Workflow Engine V3 - Atomic Executor
 * Handles Step 4: Reading latest auto-save and executing a specific node.
 */

import { createServiceClient } from '@/lib/supabase/service';
import { replicate } from '@/lib/ai/replicate-client';
import { EPHEMERAL_HANDLERS, isEphemeralNode } from './handlers';

/**
 * Executes a single node by reading the latest canvas state from the session.
 * This follows the Step 4 & 6 logic for maximum stability.
 */
export async function runAtomicNode(
  sessionId: string,
  nodeId: string,
  executionId: string
) {
  console.log(`[AtomicExecutor] Starting execution for node ${nodeId} in session ${sessionId}`);
  
  const supabase = createServiceClient();

  // 1. Get the latest auto-saved workflow from the session (Step 4)
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('canvas_state')
    .eq('id', sessionId)
    .single();

  if (sessionError || !session) {
    throw new Error(`Failed to fetch session: ${sessionError?.message}`);
  }

  const workflow = session.canvas_state; // This is the latest UI save
  const node = workflow.nodes.find((n: any) => n.id === nodeId);

  if (!node) {
    throw new Error(`Node ${nodeId} not found in the latest workflow save.`);
  }

  // 2. Resolve inputs for this node (Step 4)
  // It looks at the edges and fetches results from the node_results table
  const inputs = await resolveNodeInputs(sessionId, nodeId, workflow, supabase);

  // 3. Create the placeholder in node_results (Step 5)
  const { data: resultRow, error: resultError } = await supabase
    .from('node_results')
    .insert({
      execution_id: executionId,
      node_id: nodeId,
      status: 'running'
    })
    .select()
    .single();

  if (resultError) {
    throw new Error(`Failed to initialize result row: ${resultError.message}`);
  }

  try {
    // 4. Determine if AI or Ephemeral
    if (isEphemeralNode(node.type)) {
      console.log(`[AtomicExecutor] Executing ephemeral node: ${node.type}`);
      const handler = EPHEMERAL_HANDLERS[node.type];
      if (!handler) throw new Error(`No handler for node type ${node.type}`);

      // Run local logic
      const output = await handler(node.data?.config || {}, inputs);
      
      // Handle output (Step 5: Store result url)
      let resultUrl = typeof output === 'string' ? output : null;
      
      // If it's a buffer (image), upload to storage
      if (Buffer.isBuffer(output)) {
        const filename = `${executionId}/${nodeId}/${Date.now()}.png`;
        const { data: uploadData } = await supabase.storage
          .from('workflow-ephemeral-tmp')
          .upload(filename, output, { contentType: 'image/png' });
        
        const { data: urlData } = supabase.storage
          .from('workflow-ephemeral-tmp')
          .getPublicUrl(filename);
        resultUrl = urlData.publicUrl;
      }

      // Update node_results to completed (Step 6)
      await supabase
        .from('node_results')
        .update({
          status: 'completed',
          result_url: resultUrl,
          updated_at: new Date().toISOString()
        })
        .eq('id', resultRow.id);

    } else {
      // AI GENERATION (Step 6: Replicate)
      console.log(`[AtomicExecutor] Dispatching to Replicate: ${node.type}`);
      
      const modelVersion = node.data?.config?.model || node.data?.config?.version;
      if (!modelVersion) throw new Error('No model version specified for AI node');

      // Construct Replicate Inputs
      const replicateInput = {
        ...(node.data?.config?.control_values || {}),
        ...inputs,
        prompt: node.data?.config?.prompt || inputs.prompt
      };

      // Set up Webhook
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const webhookUrl = `${appUrl}/api/webhooks/replicate-v2?executionId=${executionId}&nodeId=${nodeId}&resultId=${resultRow.id}`;

      const prediction = await replicate.predictions.create({
        version: modelVersion,
        input: replicateInput,
        webhook: webhookUrl,
        webhook_events_filter: ['completed'],
      });

      // Update result row with Replicate ID
      await supabase
        .from('node_results')
        .update({
          replicate_id: prediction.id,
          updated_at: new Date().toISOString()
        })
        .eq('id', resultRow.id);
    }

    return { success: true, executionId };

  } catch (error: any) {
    console.error(`[AtomicExecutor] Execution failed for node ${nodeId}:`, error);
    
    await supabase
      .from('node_results')
      .update({
        status: 'failed',
        error: error.message,
        updated_at: new Date().toISOString()
      })
      .eq('id', resultRow.id);
      
    throw error;
  }
}

/**
 * Resolve inputs for a node by looking at previous execution results
 */
async function resolveNodeInputs(
  sessionId: string,
  nodeId: string,
  workflow: any,
  supabase: any
): Promise<Record<string, any>> {
  const inputs: Record<string, any> = {};
  const incomingEdges = (workflow.edges || []).filter((e: any) => e.target === nodeId);

  for (const edge of incomingEdges) {
    // Look for the latest successful result for the source node in this session
    const { data: latestResult } = await supabase
      .from('node_results')
      .select('result_url, status')
      .eq('node_id', edge.source)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (latestResult?.result_url) {
      const inputKey = edge.targetHandle || 'image';
      inputs[inputKey] = latestResult.result_url;
    }
  }

  return inputs;
}
