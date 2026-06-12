// scripts/audit-migrations.js
// One-shot: this repo applies migrations BY HAND (no tracking table), so "applied"
// just means "the objects exist". This checks the live DB for the signature object
// of each recent migration and prints APPLIED / PENDING, so you know what's left to
// run. Read-only except a claim_node_completion existence probe that cleans up after
// itself. Extend RECENT below as you add migrations.
//
// Run: node scripts/audit-migrations.js
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

// Each check returns 'APPLIED' | 'PENDING' | 'MANUAL'.
async function columnExists(table, column) {
  const { error } = await supabase.from(table).select(column).limit(1);
  if (!error) return 'APPLIED';
  // A missing column/table surfaces as a 42703 / 42P01 / "does not exist" message.
  if (/does not exist|could not find|schema cache/i.test(error.message)) return 'PENDING';
  // Any other error (RLS, etc.) means the object exists but we hit something else.
  return 'APPLIED';
}
async function tableExists(table) {
  const { error } = await supabase.from(table).select('*').limit(1);
  if (!error) return 'APPLIED';
  if (/does not exist|could not find|schema cache/i.test(error.message)) return 'PENDING';
  return 'APPLIED';
}
async function functionExists(fn, args, { cleanup } = {}) {
  const { error } = await supabase.rpc(fn, args);
  if (error && /could not find the function|does not exist/i.test(error.message)) return 'PENDING';
  if (cleanup) await cleanup();
  return 'APPLIED'; // success OR a non-"missing function" error both mean it exists
}

const FAKE_EXEC = '00000000-0000-0000-0000-00000000aaaa';

const RECENT = [
  // migration file (without .sql)              -> check
  ['20260607_node_predictions_realtime',        async () => 'MANUAL'], // publication/policies — see note below
  ['20260608_finalize_fan_out',                 () => functionExists('finalize_fan_out', { p_execution_id: FAKE_EXEC, p_node_id: '__audit__', p_output_type: 'image', p_expected_count: 1 })],
  ['20260609_add_provider_adapters',            () => columnExists('providers', 'adapter_key')],
  ['20260609_add_category_description',          () => columnExists('categories', 'description')],
  ['20260609_add_voices_table',                 () => tableExists('voices')],
  ['20260609_add_voice_languages',              () => columnExists('voices', 'language_codes')],
  ['20260609_add_voice_popularity_and_favorites', () => columnExists('voices', 'popularity')],
  ['20260611_character_sheet_cover',            () => columnExists('characters', 'sheet_url')],
  ['20260611_add_provider_job_columns (Phase A)', () => columnExists('node_results', 'provider_id')],
  ['20260611_claim_node_completion (Phase A)',  () => functionExists('claim_node_completion', {
      p_execution_id: FAKE_EXEC, p_node_id: '__audit__', p_status: 'failed',
      p_result_type: null, p_result_data: null, p_error: 'audit', p_provider_id: 'replicate', p_provider_job_id: 'audit',
    }, { cleanup: () => supabase.from('node_results').delete().eq('execution_id', FAKE_EXEC).eq('node_id', '__audit__') })],
  // refund_tokens exists either way; a functionExists probe can't tell the old body
  // from the netting one. Verify in SQL editor:
  //   SELECT prosrc LIKE '%execution_partial_refund%' FROM pg_proc WHERE proname = 'refund_tokens';
  ['20260612_refund_tokens_net_partial',        async () => 'MANUAL'],
];

(async () => {
  console.log('Auditing recent migrations against the live DB…\n');
  let pending = 0;
  for (const [name, check] of RECENT) {
    let status;
    try { status = await check(); } catch (e) { status = `ERROR (${e.message})`; }
    const icon = status === 'APPLIED' ? '✅' : status === 'PENDING' ? '⛔' : status === 'MANUAL' ? '🔍' : '❓';
    if (status === 'PENDING') pending++;
    console.log(`${icon} ${status.padEnd(8)}  ${name}`);
  }
  console.log(`\n${pending} migration(s) report PENDING — apply those .sql files in supabase/migrations/.`);
  console.log("🔍 MANUAL = can't be checked via the JS client. For 20260607 (realtime), run this in the SQL editor:");
  console.log("   select * from pg_publication_tables where pubname='supabase_realtime' and tablename='node_predictions';");
  console.log('   (a row = applied; no row = apply 20260607_node_predictions_realtime.sql)');
  process.exit(0);
})();
