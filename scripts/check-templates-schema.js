// scripts/check-templates-schema.js
// Verifies the evolved workflow_templates columns + RPC exist. Run AFTER applying the migration.
const fs = require('fs');
// Lightweight .env.local loader (this repo does not depend on dotenv).
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const REQUIRED = [
  'id','name','description','workflow','thumbnail_url','how_it_works','category',
  'tags','use_cases','nodes_used','source','status','created_by','created_by_name',
  'source_session_id','usage_count','published_at','created_at','updated_at',
];

(async () => {
  // Selecting every required column will error if any is missing.
  const { error } = await supabase
    .from('workflow_templates')
    .select(REQUIRED.join(','))
    .limit(1);
  if (error) { console.error('❌ column check failed:', error.message); process.exit(1); }
  console.log('✅ all required columns present');

  // RPC smoke test with a random UUID (no row updated, but the function must resolve).
  const { error: rpcErr } = await supabase.rpc('increment_template_usage', {
    p_template_id: '00000000-0000-0000-0000-000000000000',
  });
  if (rpcErr) { console.error('❌ RPC missing:', rpcErr.message); process.exit(1); }
  console.log('✅ increment_template_usage RPC present');
  process.exit(0);
})();
