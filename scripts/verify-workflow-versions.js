// Usage: node scripts/verify-workflow-versions.js <canvasId>
// Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env.
// Note: dotenv is not a project dependency; export vars before running:
//   export $(grep -v '^#' .env.local | xargs) && node scripts/verify-workflow-versions.js <canvasId>
//
// SAFE-CLEANUP NOTE: this script only deletes rows it created — the checkpoint
// labelled 'verify-script' and auto rows whose content_hash starts with
// 'verify-auto-'. It will NOT touch real auto-versions or real checkpoints.
// Still, prefer running it against a throwaway/test session you own.
const { createClient } = require('@supabase/supabase-js');

const canvasId = process.argv[2];
if (!canvasId) { console.error('Pass a canvasId'); process.exit(1); }

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function stableStringify(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

(async () => {
  const { data: session } = await supabase.from('sessions').select('canvas_state, user_id').eq('id', canvasId).single();
  if (!session) { console.error('canvas not found'); process.exit(1); }
  const state = session.canvas_state || { nodes: [], edges: [] };

  // 1. Insert a checkpoint.
  const { data: cp, error: cpErr } = await supabase.from('workflow_versions').insert({
    canvas_id: canvasId, kind: 'checkpoint', label: 'verify-script',
    canvas_state: state, content_hash: stableStringify(state), created_by: session.user_id,
  }).select('id').single();
  if (cpErr) { console.error('checkpoint insert failed', cpErr); process.exit(1); }
  console.log('✅ checkpoint created', cp.id);

  // 2. List.
  const { data: list } = await supabase.from('workflow_versions')
    .select('id, kind, label, created_at').eq('canvas_id', canvasId).order('created_at', { ascending: false });
  console.log(`✅ list returned ${list.length} versions`);

  // 3. Insert 22 test autos (tagged via content_hash 'verify-auto-N'), then
  //    verify prune-to-20 leaves 20 of OUR test autos.
  for (let i = 0; i < 22; i++) {
    await supabase.from('workflow_versions').insert({
      canvas_id: canvasId, kind: 'auto', label: null,
      canvas_state: { nodes: [{ id: 'n' + i }], edges: [] },
      content_hash: 'verify-auto-' + i, created_by: null,
    });
  }
  const { data: testAutos } = await supabase.from('workflow_versions')
    .select('id, created_at').eq('canvas_id', canvasId).like('content_hash', 'verify-auto-%')
    .order('created_at', { ascending: false });
  const stale = testAutos.slice(20).map(r => r.id);
  if (stale.length) await supabase.from('workflow_versions').delete().in('id', stale);
  const { count } = await supabase.from('workflow_versions')
    .select('id', { count: 'exact', head: true }).eq('canvas_id', canvasId).like('content_hash', 'verify-auto-%');
  console.log(`✅ test autos after prune: ${count} (expected 20)`);

  // 4. Cleanup ONLY the rows this script created.
  await supabase.from('workflow_versions').delete().eq('canvas_id', canvasId).like('content_hash', 'verify-auto-%');
  await supabase.from('workflow_versions').delete().eq('canvas_id', canvasId).eq('kind', 'checkpoint').eq('label', 'verify-script');
  console.log('✅ cleanup done (only verify-script rows removed)');
})();
