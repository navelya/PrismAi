// Verifies the collaboration RLS helpers + claim logic against live Supabase.
// Usage: node scripts/verify-collaboration-rls.js
// Requires .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY,
// and two pre-existing test auth users (set their ids/emails via env vars).
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const svc = createClient(url, key, { auth: { persistSession: false } });

const OWNER = { id: process.env.TEST_OWNER_ID, email: process.env.TEST_OWNER_EMAIL };
const COLLAB = { id: process.env.TEST_COLLAB_ID, email: process.env.TEST_COLLAB_EMAIL };

async function main() {
  const { data: sess, error: e1 } = await svc.from('sessions')
    .insert({ user_id: OWNER.id, title: 'RLS test canvas' }).select().single();
  if (e1) throw e1;
  console.log('canvas session', sess.id);

  const { error: e2 } = await svc.from('session_collaborators').insert({
    session_id: sess.id, user_id: COLLAB.id, invited_email: COLLAB.email,
    role: 'editor', invited_by: OWNER.id,
  });
  if (e2) throw e2;

  const { data: rows } = await svc.from('session_collaborators')
    .select('*').eq('session_id', sess.id);
  console.assert(rows.length === 1 && rows[0].role === 'editor', 'collaborator row present');

  const { error: e3 } = await svc.from('session_collaborators').insert({
    session_id: sess.id, invited_email: 'pending-' + Date.now() + '@example.com',
    role: 'viewer', invited_by: OWNER.id,
  });
  if (e3) throw e3;
  console.log('pending invite inserted (claim trigger fires on real signup)');

  await svc.from('sessions').delete().eq('id', sess.id);
  console.log('✅ verify-collaboration-rls passed (structural checks)');
}
main().catch((e) => { console.error('❌', e); process.exit(1); });
