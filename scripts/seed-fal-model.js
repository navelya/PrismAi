// scripts/seed-fal-model.js
// Creates a minimal FAL-backed ai_models row + a primary 'fal' binding so a FAL
// model can run without the admin UI. Idempotent on display_name.
// Run: node scripts/seed-fal-model.js
const fs = require('fs');
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const DISPLAY = 'FAL FLUX schnell (Phase B test)';
const SLUG = 'fal-ai/flux/schnell';

(async () => {
  const { data: cat } = await supabase.from('categories').select('id').limit(1).single();
  const { data: arch } = await supabase.from('node_archetypes').select('id').limit(1).single();
  if (!cat || !arch) { console.error('❌ need at least one category + archetype'); process.exit(1); }

  const inputs_schema = {
    description: 'FAL FLUX schnell text-to-image (Phase B smoke test)',
    handles: [],
    controls: [
      { api_mapping_key: 'prompt', type: 'string', component: 'prompt_textarea', default_value: 'a red apple on white', is_visible: true, label: 'Prompt' },
    ],
  };
  const outputs_schema = { handles: [{ name: 'image', api_mapping_key: 'image', type: 'image', is_array: true, is_visible: true }] };

  let { data: existing } = await supabase.from('ai_models').select('id').eq('display_name', DISPLAY).maybeSingle();
  let modelId = existing?.id;
  if (!modelId) {
    const { data, error } = await supabase.from('ai_models').insert({
      display_name: DISPLAY, category_id: cat.id, archetype_id: arch.id,
      credit_cost: 1, is_active: true, inputs_schema, outputs_schema,
    }).select('id').single();
    if (error) { console.error('❌ insert model:', error.message); process.exit(1); }
    modelId = data.id;
  }
  console.log('✅ ai_models id:', modelId);

  const { error: bErr } = await supabase.from('ai_model_providers').upsert({
    model_id: modelId, provider_id: 'fal', provider_model_id: SLUG, priority: 0, is_active: true,
  }, { onConflict: 'model_id,provider_id' });
  if (bErr) { console.error('❌ insert binding:', bErr.message); process.exit(1); }
  console.log(`✅ fal binding -> ${SLUG}`);
  console.log('Now add a node with this model in the app and run it (needs FAL_KEY + a deploy, or local dev which polls inline).');
  process.exit(0);
})();
