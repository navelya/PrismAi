/**
 * Seed/refresh the `voices` table from ElevenLabs.
 *
 * Pulls:
 *   - GET /v1/voices         → premade + your account's own voices (reliable to generate with)
 *   - GET /v1/shared-voices  → a slice of the community shared library (breadth)
 *
 * NOTE: A shared-library voice generally must be ADDED to your ElevenLabs account
 * before TTS generation with its voice_id will succeed. Premade + owned voices
 * always work. Shared voices are stored for browsing; if generation fails for a
 * shared voice, add it to your account in ElevenLabs and re-run this script.
 *
 * Usage: node scripts/sync-elevenlabs-voices.js
 * Env (from .env.local): ELEVENLABS_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
const fs = require('fs');
// Lightweight .env.local loader (this repo does not depend on dotenv).
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { createClient } = require('@supabase/supabase-js');

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROVIDER_ID = 'elevenlabs';
const BASE = 'https://api.elevenlabs.io/v1';
// How many shared-library voices to pull (in pages of 100).
const SHARED_TARGET = 300;

if (!ELEVENLABS_API_KEY) { console.error('Missing ELEVENLABS_API_KEY'); process.exit(1); }
if (!SUPABASE_URL || !SERVICE_KEY) { console.error('Missing Supabase env'); process.exit(1); }

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

function mapVoice(v, category) {
  const labels = v.labels || {};
  return {
    provider_id: PROVIDER_ID,
    external_voice_id: v.voice_id,
    name: v.name || v.voice_id,
    description: v.description || null,
    gender: labels.gender || v.gender || null,
    age: labels.age || v.age || null,
    accent: labels.accent || v.accent || null,
    language: labels.language || v.language || null,
    use_case: labels.use_case || labels['use case'] || v.use_case || null,
    category: v.category || category,
    preview_url: v.preview_url || null,
    labels,
    is_active: true,
    updated_at: new Date().toISOString(),
  };
}

async function upsertBatch(rows) {
  if (rows.length === 0) return;
  const { error } = await supabase
    .from('voices')
    .upsert(rows, { onConflict: 'provider_id,external_voice_id' });
  if (error) throw new Error(`voices upsert failed: ${error.message}`);
}

async function fetchPremadeAndOwned() {
  const res = await fetch(`${BASE}/voices`, { headers: { 'xi-api-key': ELEVENLABS_API_KEY } });
  if (!res.ok) throw new Error(`GET /voices failed (${res.status}): ${await res.text()}`);
  const json = await res.json();
  const voices = json.voices || [];
  console.log(`[sync] /voices returned ${voices.length} voices`);
  await upsertBatch(voices.map((v) => mapVoice(v, v.category || 'premade')));
  return voices.length;
}

async function fetchSharedLibrary() {
  let collected = 0;
  let page = 0;
  const pageSize = 100;
  while (collected < SHARED_TARGET) {
    const url = `${BASE}/shared-voices?page_size=${pageSize}&page=${page}`;
    const res = await fetch(url, { headers: { 'xi-api-key': ELEVENLABS_API_KEY } });
    if (!res.ok) {
      console.warn(`[sync] /shared-voices page ${page} failed (${res.status}) — stopping shared sync.`);
      break;
    }
    const json = await res.json();
    const voices = json.voices || [];
    if (voices.length === 0) break;
    await upsertBatch(voices.map((v) => mapVoice(v, 'shared')));
    collected += voices.length;
    console.log(`[sync] shared page ${page}: +${voices.length} (total ${collected})`);
    if (json.has_more === false) break;
    page += 1;
  }
  return collected;
}

(async () => {
  try {
    const a = await fetchPremadeAndOwned();
    const b = await fetchSharedLibrary();
    const { count } = await supabase.from('voices').select('*', { count: 'exact', head: true });
    console.log(`[sync] Done. premade/owned=${a}, shared=${b}. Total rows now: ${count}`);
    process.exit(0);
  } catch (err) {
    console.error('[sync] ERROR:', err.message);
    process.exit(1);
  }
})();
