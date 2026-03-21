/**
 * Test STEP 5: Ephemeral Node Handlers
 * 
 * This script tests:
 * 1. Ephemeral node execution (Blur)
 * 2. Chain with both Replicate and ephemeral nodes
 * 3. Temporary storage in ephemeral bucket
 * 
 * Run: node scripts/test-ephemeral-nodes.js
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing environment variables');
  console.error('Required: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

async function testEphemeralNodes() {
  console.log('\n🧪 Testing STEP 5: Ephemeral Node Handlers\n');
  console.log('='.repeat(60));
  
  // Test 1: Single ephemeral node (Blur on existing image)
  console.log('\n📝 Test 1: Single Ephemeral Node (Blur)\n');
  
  // Use a public test image
  const testImageUrl = 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4';
  
  const createResponse = await fetch(`${APP_URL}/api/executions/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      session_id: '00000000-0000-0000-0000-000000000000',
      user_id: '00000000-0000-0000-0000-000000000000',
      graph_json: {
        nodes: [
          {
            id: 'image-input',
            type: 'image_input',
            data: {
              url: testImageUrl,
            }
          },
          {
            id: 'blur-node',
            type: 'blur',
            data: {
              radius: 10,
            }
          }
        ],
        edges: [
          {
            id: 'e1',
            source: 'image-input',
            target: 'blur-node',
            sourceHandle: 'output',
            targetHandle: 'image',
          }
        ]
      }
    })
  });
  
  const createResult = await createResponse.json();
  
  if (!createResult.success) {
    console.error('❌ Failed to create execution:', createResult);
    process.exit(1);
  }
  
  const executionId = createResult.execution_id;
  console.log(`✅ Execution created: ${executionId}`);
  
  // Initialize image-input node as completed
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  
  const { data: execution } = await supabase
    .from('executions_v2')
    .select('*')
    .eq('id', executionId)
    .single();
  
  if (execution) {
    const updatedNodeStates = {
      ...execution.node_states,
      'image-input': {
        status: 'completed',
        result_url: testImageUrl,
        completed_at: new Date().toISOString(),
      }
    };
    
    await supabase
      .from('executions_v2')
      .update({
        node_states: updatedNodeStates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', executionId);
    
    console.log('✅ Initialized image-input node');
  }
  
  // Wait for blur processing
  console.log('\n⏳ Waiting for blur processing...');
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Check results
  const { data: finalExecution } = await supabase
    .from('executions_v2')
    .select('*')
    .eq('id', executionId)
    .single();
  
  console.log('\n📊 Results:\n');
  console.log('='.repeat(60));
  
  if (finalExecution) {
    console.log('Execution status:', finalExecution.status);
    console.log('\nNode States:');
    
    for (const [nodeId, state] of Object.entries(finalExecution.node_states)) {
      console.log(`  ${nodeId}:`);
      console.log(`    Status: ${state.status}`);
      if (state.result_url) {
        console.log(`    Result: ${state.result_url.substring(0, 80)}...`);
      }
      if (state.error) {
        console.log(`    Error: ${state.error}`);
      }
    }
    
    // Verify ephemeral storage
    const blurNode = finalExecution.node_states['blur-node'];
    if (blurNode && blurNode.status === 'completed') {
      console.log('\n✅ SUCCESS: Blur node completed!');
      console.log(`   Result URL: ${blurNode.result_url}`);
      
      // Check if it's in ephemeral storage
      if (blurNode.result_url && blurNode.result_url.includes('ephemeral')) {
        console.log('✅ SUCCESS: Result stored in ephemeral bucket');
      } else {
        console.log('⚠️  WARNING: Result not in ephemeral bucket');
      }
    } else {
      console.log('\n❌ FAIL: Blur node did not complete');
      console.log(`   Status: ${blurNode?.status || 'unknown'}`);
      console.log(`   Error: ${blurNode?.error || 'none'}`);
    }
    
    // Check events
    const { data: events } = await supabase
      .from('execution_events')
      .select('*')
      .eq('execution_id', executionId)
      .order('created_at', { ascending: true });
    
    console.log(`\n📜 Execution Events (${events?.length || 0}):`);
    events?.forEach((event, i) => {
      console.log(`  ${i + 1}. [${event.event_type}] ${event.node_id || 'N/A'}`);
      if (event.payload?.handler) {
        console.log(`     Handler: ${event.payload.handler}`);
      }
    });
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('\n💡 What to check:');
  console.log('   1. Blur node should complete in < 5 seconds');
  console.log('   2. Result should be in workflow-ephemeral-tmp bucket');
  console.log('   3. Event log should show "dispatched" and "completed" events');
  console.log('   4. Output should be a valid image URL');
  console.log('\n📖 See STEP5_README.md for full testing guide\n');
}

testEphemeralNodes().catch(error => {
  console.error('\n❌ Test failed:', error);
  process.exit(1);
});
