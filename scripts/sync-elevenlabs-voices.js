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
// How many shared-library voices to pull from the general (trending) feed.
const SHARED_TARGET = 600;
// Languages we explicitly sweep so the catalog has broad language variety — one
// page per language guarantees coverage the trending feed alone would miss.
const SWEEP_LANGUAGES = [
  'en', 'es', 'fr', 'de', 'it', 'pt', 'pl', 'nl', 'ja', 'ko', 'zh', 'hi', 'ar',
  'tr', 'ru', 'id', 'fil', 'sv', 'bg', 'ro', 'cs', 'el', 'fi', 'hr', 'ms', 'sk',
  'da', 'ta', 'uk', 'hu', 'no', 'vi',
];

if (!ELEVENLABS_API_KEY) { console.error('Missing ELEVENLABS_API_KEY'); process.exit(1); }
if (!SUPABASE_URL || !SERVICE_KEY) { console.error('Missing Supabase env'); process.exit(1); }

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

function mapVoice(v, category) {
  const labels = v.labels || {};
  // Collect the languages this voice supports. verified_languages is the rich
  // source (shared-library / v3 voices); fall back to the single language label.
  const codes = new Set();
  const toCode = (s) => String(s || '').toLowerCase().split(/[-_]/)[0];
  if (Array.isArray(v.verified_languages)) {
    for (const vl of v.verified_languages) {
      const c = toCode(vl && (vl.language || vl.locale));
      if (c) codes.add(c);
    }
  }
  const single = toCode(labels.language || v.language);
  // Only add the single-label language if it looks like a code (<=3 chars),
  // not a display name like "english".
  if (single && single.length <= 3) codes.add(single);
  const language_codes = Array.from(codes);

  // Popularity: ElevenLabs shared-library voices carry `cloned_by_count` (how many
  // users added the voice) — a solid popularity proxy. Premade/owned voices have no
  // count, so they rely on `featured` for the Popular tab. Premade voices ARE the
  // hand-picked default set, so treat them as featured.
  const popularity = Number(v.cloned_by_count || 0) || 0;
  const featured = !!v.featured || category === 'premade';

  return {
    provider_id: PROVIDER_ID,
    external_voice_id: v.voice_id,
    name: v.name || v.voice_id,
    description: v.description || null,
    gender: labels.gender || v.gender || null,
    age: labels.age || v.age || null,
    accent: labels.accent || v.accent || null,
    language: labels.language || v.language || null,
    language_codes,
    use_case: labels.use_case || labels['use case'] || v.use_case || null,
    category: v.category || category,
    preview_url: v.preview_url || null,
    popularity,
    featured,
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
  // external_voice_id is NOT NULL — skip any entry missing voice_id so one
  // malformed item can't reject the whole batch upsert.
  await upsertBatch(voices.filter((v) => v.voice_id).map((v) => mapVoice(v, v.category || 'premade')));
  return voices.length;
}

// Pull a slice of /shared-voices with arbitrary query params, upserting each page.
// Returns how many voices were collected. Stops on the first error or empty page.
async function fetchSharedSlice(label, extraParams, target) {
  let collected = 0;
  let page = 0;
  const pageSize = 100;
  while (collected < target) {
    const params = new URLSearchParams({ page_size: String(pageSize), page: String(page), ...extraParams });
    const res = await fetch(`${BASE}/shared-voices?${params.toString()}`, {
      headers: { 'xi-api-key': ELEVENLABS_API_KEY },
    });
    if (!res.ok) {
      console.warn(`[sync] shared(${label}) page ${page} failed (${res.status}) — stopping this slice.`);
      break;
    }
    const json = await res.json();
    const voices = json.voices || [];
    if (voices.length === 0) break;
    await upsertBatch(voices.filter((v) => v.voice_id).map((v) => mapVoice(v, 'shared')));
    collected += voices.length;
    if (json.has_more === false) break;
    page += 1;
  }
  return collected;
}

async function fetchSharedLibrary() {
  // 1) The general trending feed — the bulk of popular voices.
  let total = await fetchSharedSlice('trending', {}, SHARED_TARGET);
  console.log(`[sync] shared trending: ${total} voices`);

  // 2) Per-language sweep so every supported language is represented, even ones
  //    the trending feed under-samples. One page (≤100) per language is plenty.
  for (const lang of SWEEP_LANGUAGES) {
    const n = await fetchSharedSlice(`lang:${lang}`, { language: lang }, 60);
    if (n) console.log(`[sync] shared lang ${lang}: +${n}`);
    total += n;
  }
  return total;
}

(async () => {
  try {
    const a = await fetchPremadeAndOwned();
    const b = await fetchSharedLibrary();
    const { count } = await supabase.from('voices').select('*', { count: 'exact', head: true });
    console.log(`[sync] Done. premade/owned=${a}, shared(incl. lang sweep)=${b}. Total rows now: ${count}`);
    process.exit(0);
  } catch (err) {
    console.error('[sync] ERROR:', err.message);
    process.exit(1);
  }
})();
