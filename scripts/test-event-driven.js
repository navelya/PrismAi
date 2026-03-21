/**
 * Test STEP 4: Event-Driven Triggers
 * 
 * This script tests that:
 * 1. Postgres triggers fire on state changes
 * 2. Edge Function receives notifications
 * 3. check-and-dispatch is triggered automatically
 * 
 * Run: node scripts/test-event-driven.js
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing environment variables');
  console.error('Required: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

async function testEventDrivenTriggers() {
  console.log('\n🧪 Testing STEP 4: Event-Driven Triggers\n');
  console.log('='.repeat(60));
  
  // Step 1: Create a minimal test execution
  console.log('\n📝 Step 1: Creating test execution...');
  
  const createResponse = await fetch(`${APP_URL}/api/executions/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      session_id: '00000000-0000-0000-0000-000000000000', // Test ID
      user_id: '00000000-0000-0000-0000-000000000000',
      graph_json: {
        nodes: [
          {
            id: 'test-node-1',
            type: 'flux_schnell',
            data: {
              model: 'black-forest-labs/flux-schnell',
              version: 'f2ab8a5569279a9b14b75e3d075e99a236f5bc82f654dc41d2a22fa608c8d5fb',
              prompt: 'Test prompt for event-driven trigger',
              input: { prompt: 'Test prompt' }
            }
          }
        ],
        edges: []
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
  
  // Step 2: Wait a moment for the event system to process
  console.log('\n⏳ Step 2: Waiting for event-driven dispatch...');
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Step 3: Check if node was dispatched via event system
  console.log('\n🔍 Step 3: Checking if node was dispatched...');
  
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  
  const { data: execution, error } = await supabase
    .from('executions_v2')
    .select('*')
    .eq('id', executionId)
    .single();
  
  if (error || !execution) {
    console.error('❌ Failed to fetch execution:', error);
    process.exit(1);
  }
  
  console.log('📊 Execution status:', execution.status);
  console.log('📊 Node states:', JSON.stringify(execution.node_states, null, 2));
  
  // Step 4: Check execution events
  console.log('\n📜 Step 4: Checking execution events...');
  
  const { data: events, error: eventsError } = await supabase
    .from('execution_events')
    .select('*')
    .eq('execution_id', executionId)
    .order('created_at', { ascending: true });
  
  if (eventsError) {
    console.error('❌ Failed to fetch events:', eventsError);
  } else {
    console.log(`📊 Found ${events.length} events:`);
    events.forEach((event, i) => {
      console.log(`  ${i + 1}. [${event.event_type}] ${event.node_id || 'N/A'} - ${event.created_at}`);
    });
  }
  
  // Step 5: Verify event-driven dispatch occurred
  console.log('\n✅ Step 5: Verification Results\n');
  console.log('='.repeat(60));
  
  const nodeState = execution.node_states['test-node-1'];
  
  if (!nodeState) {
    console.log('❌ FAIL: Node state not found');
    console.log('   Expected: Node should be initialized');
    process.exit(1);
  }
  
  if (nodeState.status === 'pending') {
    console.log('⚠️  WARNING: Node still pending');
    console.log('   This might mean:');
    console.log('   1. Edge Function is not deployed');
    console.log('   2. Event listener is not running');
    console.log('   3. Database trigger is not installed');
    console.log('\n   Check Edge Function logs and run migration again');
  } else if (nodeState.status === 'running' || nodeState.status === 'dispatching') {
    console.log('✅ SUCCESS: Event-driven dispatch worked!');
    console.log(`   Node status: ${nodeState.status}`);
    console.log('   The node was automatically dispatched via the event system');
  } else {
    console.log(`ℹ️  Node status: ${nodeState.status}`);
  }
  
  // Check for state_changed events
  const stateChangedEvents = events.filter(e => e.event_type === 'state_changed');
  if (stateChangedEvents.length > 0) {
    console.log(`\n✅ Database trigger fired ${stateChangedEvents.length} time(s)`);
  } else {
    console.log('\n⚠️  No state_changed events found - trigger may not be installed');
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('\n💡 To verify Edge Function is working:');
  console.log('   1. Check Supabase Dashboard → Edge Functions → execution-listener → Logs');
  console.log('   2. Look for: "[Execution Listener] 🔔 Notification received"');
  console.log('   3. Also check: "[Execution Listener] ✅ Dispatched check-and-dispatch"');
  console.log('\n📖 See STEP4_README.md for full testing guide\n');
}

testEventDrivenTriggers().catch(error => {
  console.error('\n❌ Test failed:', error);
  process.exit(1);
});
