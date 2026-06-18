// scripts/verify-dodo-pricing.js
// Read-only verification that 20260618_dodo_payments.sql was applied correctly.
// Prints plans (id, tagline, features, accent, dodo_product_id_monthly,
// dodo_product_id_yearly) and credit_packs (id, tagline, accent, dodo_product_id).
// Expected: 4 plan rows + 3 pack rows, all with non-null tagline/features/accent.
//
// Run: node scripts/verify-dodo-pricing.js

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

(async () => {
  let ok = true;

  // ── Plans ──────────────────────────────────────────────────────────────────
  const { data: plans, error: plansErr } = await supabase
    .from('plans')
    .select('id, tagline, features, accent, dodo_product_id_monthly, dodo_product_id_yearly')
    .order('sort_order');

  if (plansErr) {
    console.error('plans query FAILED:', plansErr.message);
    ok = false;
  } else {
    console.log(`\n=== plans (${plans.length} rows) ===`);
    for (const p of plans) {
      const missingTagline  = p.tagline  == null ? ' ⛔ NULL tagline'  : '';
      const missingFeatures = p.features == null ? ' ⛔ NULL features' : '';
      const missingAccent   = p.accent   == null ? ' ⛔ NULL accent'   : '';
      const warn = missingTagline + missingFeatures + missingAccent;
      if (warn) ok = false;
      console.log(
        `  ${p.id.padEnd(8)} | accent=${String(p.accent).padEnd(9)}` +
        ` | dodo_monthly=${p.dodo_product_id_monthly ?? '(unset)'}` +
        ` | dodo_yearly=${p.dodo_product_id_yearly ?? '(unset)'}` +
        `\n           tagline=${JSON.stringify(p.tagline)}` +
        `\n           features=${JSON.stringify(p.features)}` +
        (warn ? `\n         ${warn}` : '')
      );
    }
    if (plans.length !== 4) {
      console.warn(`  ⚠️  Expected 4 plan rows, got ${plans.length}`);
    }
  }

  // ── Credit packs ───────────────────────────────────────────────────────────
  const { data: packs, error: packsErr } = await supabase
    .from('credit_packs')
    .select('id, tagline, accent, dodo_product_id')
    .order('sort_order');

  if (packsErr) {
    console.error('credit_packs query FAILED:', packsErr.message);
    ok = false;
  } else {
    console.log(`\n=== credit_packs (${packs.length} rows) ===`);
    for (const p of packs) {
      const missingTagline = p.tagline == null ? ' ⛔ NULL tagline' : '';
      const missingAccent  = p.accent  == null ? ' ⛔ NULL accent'  : '';
      const warn = missingTagline + missingAccent;
      if (warn) ok = false;
      console.log(
        `  ${p.id.padEnd(6)} | accent=${String(p.accent).padEnd(9)}` +
        ` | dodo_product_id=${p.dodo_product_id ?? '(unset)'}` +
        `\n           tagline=${JSON.stringify(p.tagline)}` +
        (warn ? `\n         ${warn}` : '')
      );
    }
    if (packs.length !== 3) {
      console.warn(`  ⚠️  Expected 3 pack rows, got ${packs.length}`);
    }
  }

  console.log(`\n${ok ? '✅ All checks passed.' : '❌ Some checks FAILED — see above.'}`);
  process.exit(ok ? 0 : 1);
})();
