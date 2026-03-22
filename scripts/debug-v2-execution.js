/**
 * Debug Script: Test V2 Execution System
 * 
 * This script helps debug why executions get stuck:
 * 1. Checks database connectivity
 * 2. Verifies model lookup works
 * 3. Tests node transformation
 * 4. Simulates execution creation
 * 
 * Usage: node scripts/debug-v2-execution.js <execution_id>
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function debugExecution(executionId) {
  console.log('🔍 Debugging execution:', executionId);
  console.log('');
  
  // Step 1: Fetch execution
  console.log('📊 Step 1: Fetching execution from database...');
  const { data: execution, error: fetchError } = await supabase
    .from('executions_v2')
    .select('*')
    .eq('id', executionId)
    .single();
  
  if (fetchError) {
    console.error('❌ Failed to fetch execution:', fetchError.message);
    return;
  }
  
  if (!execution) {
    console.error('❌ Execution not found');
    return;
  }
  
  console.log('✅ Execution found');
  console.log('   Status:', execution.status);
  console.log('   Created:', execution.created_at);
  console.log('   Nodes:', execution.graph_json?.nodes?.length || 0);
  console.log('');
  
  // Step 2: Check graph_json
  console.log('📊 Step 2: Analyzing graph_json...');
  const graph = execution.graph_json;
  
  if (!graph || !graph.nodes) {
    console.error('❌ Invalid graph_json - missing nodes array');
    return;
  }
  
  console.log('✅ Graph structure valid');
  console.log('   Nodes:', graph.nodes.length);
  console.log('   Edges:', graph.edges?.length || 0);
  console.log('');
  
  // Step 3: Check each node
  console.log('📊 Step 3: Checking node configurations...');
  for (const node of graph.nodes) {
    console.log(`   Node ${node.id}:`);
    console.log(`     Type: ${node.type}`);
    console.log(`     Has model: ${!!node.data?.model}`);
    console.log(`     Model value: ${node.data?.model || 'MISSING!'}`);
    console.log(`     Has model_id: ${!!node.data?.model_id}`);
    console.log(`     Model_id value: ${node.data?.model_id || 'N/A'}`);
    console.log(`     Has prompt: ${!!node.data?.prompt}`);
    console.log('');
    
    // If model_id exists but no model, try to resolve it
    if (node.data?.model_id && !node.data?.model) {
      console.log(`     ⚠️  WARNING: model_id exists but model is missing!`);
      console.log(`     Attempting to resolve model_id ${node.data.model_id}...`);
      
      const { data: modelData } = await supabase
        .from('ai_models')
        .select('replicate_model_id')
        .eq('id', node.data.model_id)
        .single();
      
      if (modelData?.replicate_model_id) {
        console.log(`     ✅ Resolved to: ${modelData.replicate_model_id}`);
      } else {
        console.log(`     ❌ Failed to resolve model_id!`);
      }
      console.log('');
    }
  }
  
  // Step 4: Check node_states
  console.log('📊 Step 4: Checking node_states...');
  const nodeStates = execution.node_states || {};
  
  for (const [nodeId, state] of Object.entries(nodeStates)) {
    console.log(`   Node ${nodeId}:`);
    console.log(`     Status: ${state.status}`);
    console.log(`     Dispatched: ${state.dispatched_at || 'No'}`);
    console.log(`     Error: ${state.error || 'None'}`);
    console.log('');
  }
  
  // Step 5: Check execution_events
  console.log('📊 Step 5: Checking execution_events...');
  const { data: events } = await supabase
    .from('execution_events')
    .select('*')
    .eq('execution_id', executionId)
    .order('created_at', { ascending: true });
  
  if (!events || events.length === 0) {
    console.log('   ⚠️  No events found - check-and-dispatch likely never ran!');
  } else {
    console.log(`   ✅ Found ${events.length} events:`);
    events.forEach(event => {
      console.log(`     ${event.created_at} - ${event.event_type} - Node ${event.node_id}`);
    });
  }
  console.log('');
  
  // Step 6: Recommendations
  console.log('💡 Diagnosis:');
  
  const hasInvalidNodes = graph.nodes.some(n => 
    (n.type === 'ai_generate_image' && !n.data?.model)
  );
  
  const hasEvents = events && events.length > 0;
  const allPending = Object.values(nodeStates).every(s => s.status === 'pending');
  
  if (hasInvalidNodes) {
    console.log('   ❌ PROBLEM: Nodes missing model configuration');
    console.log('   → Node transformation failed to resolve model_id');
    console.log('   → Check that ai_models table has the model');
  }
  
  if (!hasEvents) {
    console.log('   ❌ PROBLEM: No execution events');
    console.log('   → check-and-dispatch was never called or failed silently');
    console.log('   → Check server logs for errors in /api/executions/start');
  }
  
  if (allPending) {
    console.log('   ❌ PROBLEM: All nodes still pending');
    console.log('   → Dispatch never happened');
    console.log('   → Check if check-and-dispatch is finding ready nodes');
  }
  
  console.log('');
  console.log('📝 Next Steps:');
  console.log('   1. Check server logs for errors during execution creation');
  console.log('   2. Verify NEXT_PUBLIC_APP_URL is set correctly');
  console.log('   3. Test model lookup manually in database');
}

// Get execution ID from command line
const executionId = process.argv[2];

if (!executionId) {
  console.error('Usage: node scripts/debug-v2-execution.js <execution_id>');
  process.exit(1);
}

debugExecution(executionId)
  .then(() => {
    console.log('✅ Debug complete');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Debug failed:', error);
    process.exit(1);
  });
