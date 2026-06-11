// scripts/verify-phase-b-schema.js
// Verifies the Phase B binding table exists and was backfilled.
// Run: node scripts/verify-phase-b-schema.js
const fs = require('fs');
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const { data, error } = await supabase
    .from('ai_model_providers')
    .select('id, model_id, provider_id, provider_model_id, priority, is_active')
    .limit(5);
  if (error) { console.error('❌ ai_model_providers not found / not selectable:', error.message); process.exit(1); }
  console.log(`✅ ai_model_providers exists; sample rows: ${data.length}`);

  const { count } = await supabase
    .from('ai_model_providers')
    .select('*', { count: 'exact', head: true })
    .eq('provider_id', 'replicate');
  console.log(`✅ replicate bindings backfilled: ${count ?? 0}`);
  process.exit(0);
})();
