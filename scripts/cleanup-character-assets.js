/**
 * One-time cleanup: remove character reference images that leaked into
 * `node_results` (and thus into the Assets / Last-runs views) before the
 * character node was flagged ephemeral.
 *
 * Character images are the only thing uploaded under the `/characters/` storage
 * path (app/api/characters/generate/route.ts), so matching that path segment in
 * an image row's result_data is precise.
 *
 *   node scripts/cleanup-character-assets.js            # dry run (counts only)
 *   node scripts/cleanup-character-assets.js --apply    # actually delete
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the env.
 */
const { createClient } = require('@supabase/supabase-js');

function urlIsCharacterAsset(url) {
  return typeof url === 'string' && url.includes('/characters/');
}

function rowHasCharacterAsset(row) {
  return (
    !!row &&
    row.result_type === 'image' &&
    Array.isArray(row.result_data) &&
    row.result_data.some(urlIsCharacterAsset)
  );
}

async function run({ apply }) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.');
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  const pageSize = 1000;
  let from = 0;
  const toDelete = [];

  for (;;) {
    const { data, error } = await supabase
      .from('node_results')
      .select('id, result_type, result_data')
      .eq('result_type', 'image')
      .range(from, from + pageSize - 1);
    if (error) {
      console.error('Query failed:', error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    for (const row of data) {
      if (rowHasCharacterAsset(row)) toDelete.push(row.id);
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }

  console.log(`Found ${toDelete.length} character-asset node_results row(s).`);
  if (!apply) {
    console.log('Dry run — re-run with --apply to delete them.');
    return;
  }

  const chunk = 500;
  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += chunk) {
    const ids = toDelete.slice(i, i + chunk);
    const { error } = await supabase.from('node_results').delete().in('id', ids);
    if (error) {
      console.error('Delete failed:', error.message);
      process.exit(1);
    }
    deleted += ids.length;
  }
  console.log(`Deleted ${deleted} row(s).`);
}

if (require.main === module) {
  run({ apply: process.argv.includes('--apply') }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { urlIsCharacterAsset, rowHasCharacterAsset, run };
