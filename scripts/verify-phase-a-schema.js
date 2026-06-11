// scripts/verify-phase-a-schema.js
// Verifies Phase A schema changes are live: new columns + the claim RPC exist.
// Run: node scripts/verify-phase-a-schema.js
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  // 1. Columns exist: selecting them must not error.
  for (const table of ['node_results', 'node_predictions']) {
    const { error } = await supabase
      .from(table)
      .select('provider_id, provider_job_id, attempt, last_polled_at')
      .limit(1);
    if (error) {
      console.error(`❌ ${table} missing new columns:`, error.message);
      process.exit(1);
    }
    console.log(`✅ ${table} has provider columns`);
  }

  // 2. RPC exists: calling with a non-existent execution returns TRUE/FALSE, not a
  //    "function does not exist" error. Use a random uuid + a status of 'failed'
  //    so even if it inserts, it's a harmless orphan row we immediately delete.
  const fakeExec = '00000000-0000-0000-0000-00000000aaaa';
  const { data, error } = await supabase.rpc('claim_node_completion', {
    p_execution_id: fakeExec,
    p_node_id: '__phase_a_probe__',
    p_status: 'failed',
    p_result_type: null,
    p_result_data: null,
    p_error: 'probe',
    p_provider_id: 'replicate',
    p_provider_job_id: 'probe',
  });
  if (error) {
    console.error('❌ claim_node_completion RPC error:', error.message);
    process.exit(1);
  }
  console.log('✅ claim_node_completion callable, returned:', data);

  // Clean up the probe row.
  await supabase.from('node_results').delete()
    .eq('execution_id', fakeExec).eq('node_id', '__phase_a_probe__');
  console.log('✅ probe row cleaned up');
  process.exit(0);
})();
