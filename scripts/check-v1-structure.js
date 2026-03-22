/**
 * Check what the actual V1 node structure looks like
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkV1Nodes() {
  // Get the session from the execution
  const { data: execution } = await supabase
    .from('executions_v2')
    .select('session_id')
    .eq('id', 'e47fb4b6-b98b-44b0-8b89-22ddf6cde45f')
    .single();
  
  if (!execution) {
    console.log('Execution not found');
    return;
  }
  
  console.log('Session ID:', execution.session_id);
  
  // Get the session canvas state
  const { data: session } = await supabase
    .from('sessions')
    .select('canvas_state')
    .eq('id', execution.session_id)
    .single();
  
  if (!session?.canvas_state) {
    console.log('No canvas state found');
    return;
  }
  
  console.log('\n📊 V1 Node Structure:\n');
  const nodes = session.canvas_state.nodes || [];
  
  nodes.slice(0, 2).forEach(node => {
    console.log(`Node ${node.id}:`);
    console.log(`  Type: ${node.type}`);
    console.log(`  Data:`, JSON.stringify(node.data, null, 2));
    console.log('');
  });
}

checkV1Nodes().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
