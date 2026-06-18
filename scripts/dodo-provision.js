// scripts/dodo-provision.js
// Provision Dodo Payments products for every plan and credit pack in the DB.
// Idempotent: if a row already has a dodo_product_id_* set, the existing Dodo
// product is updated in-place (price only). Re-running the script never creates
// duplicate products.
//
// Prerequisites:
//   1. Apply migration 20260618_dodo_payments.sql to the live DB first.
//   2. Ensure DODO_API_KEY, DODO_ENVIRONMENT, NEXT_PUBLIC_SUPABASE_URL,
//      SUPABASE_SERVICE_ROLE_KEY are set in .env.local.
//
// Run: node scripts/dodo-provision.js
//
// Safe-to-run flag: does NOT modify any billing state, only product catalogue.

'use strict';

const fs = require('fs');

// ─── .env.local loader (no dotenv dependency) ────────────────────────────────
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

// ─── Clients ─────────────────────────────────────────────────────────────────
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

const dodoApiKey = process.env.DODO_API_KEY;
if (!dodoApiKey) {
  console.error('ERROR: DODO_API_KEY is not set in .env.local');
  process.exit(1);
}

// Dodo environment mapping — mirrors lib/billing/dodo-server.ts getDodoEnvironment()
function getDodoEnvironment() {
  const e = (process.env.DODO_ENVIRONMENT || 'sandbox').toLowerCase();
  return e === 'live' || e === 'live_mode' || e === 'production' ? 'live_mode' : 'test_mode';
}

const dodopayments = require('dodopayments');
const DodoPayments = dodopayments.default || dodopayments;
const dodo = new DodoPayments({ bearerToken: dodoApiKey, environment: getDodoEnvironment() });

// ─── Price builders (mirrors lib/billing/dodo-products.ts exactly) ───────────
function buildRecurringPrice(cents, interval) {
  return {
    type: 'recurring_price',
    price: cents,
    currency: 'USD',
    discount: 0,
    purchasing_power_parity: false,
    payment_frequency_count: 1,
    payment_frequency_interval: interval,
    subscription_period_count: 1,
    subscription_period_interval: interval,
  };
}

function buildOneTimePrice(cents) {
  return {
    type: 'one_time_price',
    price: cents,
    currency: 'USD',
    discount: 0,
    purchasing_power_parity: false,
  };
}

// ─── Migration guard ──────────────────────────────────────────────────────────
// Detect if migration 20260618 has not been applied by probing the new columns.
async function checkMigrationApplied() {
  const { error: plansErr } = await supabase
    .from('plans')
    .select('dodo_product_id_monthly')
    .limit(1);
  if (plansErr && /does not exist|could not find|schema cache/i.test(plansErr.message)) {
    return false;
  }
  const { error: packsErr } = await supabase
    .from('credit_packs')
    .select('dodo_product_id')
    .limit(1);
  if (packsErr && /does not exist|could not find|schema cache/i.test(packsErr.message)) {
    return false;
  }
  return true;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`Dodo environment: ${getDodoEnvironment()}`);
  console.log('');

  // 1. Guard: migration must be applied first.
  const migrationOk = await checkMigrationApplied();
  if (!migrationOk) {
    console.error(
      'ERROR: Migration 20260618 not applied — run it first (Supabase SQL editor or ' +
      'scripts/apply-migration.js), then re-run this script.',
    );
    process.exit(1);
  }

  // 2. Fetch plans (excluding 'free' — no paid product needed).
  const { data: plans, error: plansError } = await supabase
    .from('plans')
    .select('id, display_name, tagline, price_cents, price_yearly_cents, dodo_product_id_monthly, dodo_product_id_yearly')
    .neq('id', 'free');

  if (plansError) {
    // Catch late column-not-found errors (race between guard probe and this query).
    if (/does not exist|could not find|schema cache/i.test(plansError.message)) {
      console.error(
        'ERROR: Migration 20260618 not applied — run it first (Supabase SQL editor or ' +
        'scripts/apply-migration.js), then re-run this script.',
      );
      process.exit(1);
    }
    console.error('ERROR: Failed to fetch plans:', plansError.message);
    process.exit(1);
  }

  // 3. Fetch credit packs.
  const { data: packs, error: packsError } = await supabase
    .from('credit_packs')
    .select('id, display_name, tagline, price_cents, dodo_product_id');

  if (packsError) {
    if (/does not exist|could not find|schema cache/i.test(packsError.message)) {
      console.error(
        'ERROR: Migration 20260618 not applied — run it first (Supabase SQL editor or ' +
        'scripts/apply-migration.js), then re-run this script.',
      );
      process.exit(1);
    }
    console.error('ERROR: Failed to fetch credit_packs:', packsError.message);
    process.exit(1);
  }

  console.log(`Found ${plans.length} paid plan(s) and ${packs.length} credit pack(s).\n`);

  // Collect any created/updated product ids that we've not yet written to DB,
  // in case a DB write fails (so the operator can recover them).
  const orphanProductIds = [];
  const summaryRows = [];
  let dbWriteFailedWithMissingColumn = false;

  // ─── Plans ────────────────────────────────────────────────────────────────
  for (const plan of plans) {
    const description = plan.tagline || undefined;
    let monthlyId = plan.dodo_product_id_monthly;
    let yearlyId = plan.dodo_product_id_yearly;
    let monthlyAction = 'skipped';
    let yearlyAction = 'skipped';

    // Monthly product
    try {
      if (monthlyId) {
        await dodo.products.update(monthlyId, {
          price: buildRecurringPrice(plan.price_cents, 'Month'),
        });
        monthlyAction = 'updated';
      } else {
        const created = await dodo.products.create({
          name: `${plan.display_name} (Monthly)`,
          description,
          tax_category: 'saas',
          price: buildRecurringPrice(plan.price_cents, 'Month'),
        });
        monthlyId = created.product_id;
        monthlyAction = 'created';
        orphanProductIds.push(`plan:${plan.id}:monthly → ${monthlyId}`);
      }
    } catch (err) {
      console.error(`  ERROR syncing monthly product for plan "${plan.id}": ${err.message}`);
      summaryRows.push({ kind: 'plan', id: plan.id, monthly: monthlyId || 'ERROR', yearly: yearlyId || '-', status: 'monthly-FAILED' });
      continue;
    }

    // Yearly product (only if price_yearly_cents is set)
    if (plan.price_yearly_cents != null) {
      try {
        if (yearlyId) {
          await dodo.products.update(yearlyId, {
            price: buildRecurringPrice(plan.price_yearly_cents, 'Year'),
          });
          yearlyAction = 'updated';
        } else {
          const created = await dodo.products.create({
            name: `${plan.display_name} (Yearly)`,
            description,
            tax_category: 'saas',
            price: buildRecurringPrice(plan.price_yearly_cents, 'Year'),
          });
          yearlyId = created.product_id;
          yearlyAction = 'created';
          orphanProductIds.push(`plan:${plan.id}:yearly → ${yearlyId}`);
        }
      } catch (err) {
        console.error(`  ERROR syncing yearly product for plan "${plan.id}": ${err.message}`);
        yearlyAction = 'ERROR';
      }
    }

    // Write product ids back to DB.
    const updatePayload = {};
    if (monthlyAction === 'created') updatePayload.dodo_product_id_monthly = monthlyId;
    if (yearlyAction === 'created') updatePayload.dodo_product_id_yearly = yearlyId;

    if (Object.keys(updatePayload).length > 0) {
      const { error: dbErr } = await supabase
        .from('plans')
        .update(updatePayload)
        .eq('id', plan.id);

      if (dbErr) {
        if (/does not exist|could not find|schema cache/i.test(dbErr.message)) {
          dbWriteFailedWithMissingColumn = true;
          console.error(`  DB write failed for plan "${plan.id}": column not found (migration not applied?)`);
        } else {
          console.error(`  ERROR writing product ids to DB for plan "${plan.id}": ${dbErr.message}`);
        }
      } else {
        // Successfully written — remove from orphan list.
        orphanProductIds.splice(0, orphanProductIds.length, ...orphanProductIds.filter(
          s => !s.startsWith(`plan:${plan.id}:`),
        ));
      }
    }

    summaryRows.push({
      kind: 'plan',
      id: plan.id,
      monthly: monthlyId || '-',
      yearly: yearlyId || '-',
      monthlyAction,
      yearlyAction,
    });
  }

  // ─── Credit packs ─────────────────────────────────────────────────────────
  for (const pack of packs) {
    const description = pack.tagline || undefined;
    let productId = pack.dodo_product_id;
    let action = 'skipped';

    try {
      if (productId) {
        await dodo.products.update(productId, {
          price: buildOneTimePrice(pack.price_cents),
        });
        action = 'updated';
      } else {
        const created = await dodo.products.create({
          name: pack.display_name,
          description,
          tax_category: 'digital_products',
          price: buildOneTimePrice(pack.price_cents),
        });
        productId = created.product_id;
        action = 'created';
        orphanProductIds.push(`pack:${pack.id} → ${productId}`);
      }
    } catch (err) {
      console.error(`  ERROR syncing product for pack "${pack.id}": ${err.message}`);
      summaryRows.push({ kind: 'pack', id: pack.id, productId: productId || 'ERROR', action: 'FAILED' });
      continue;
    }

    // Write product id back to DB.
    if (action === 'created') {
      const { error: dbErr } = await supabase
        .from('credit_packs')
        .update({ dodo_product_id: productId })
        .eq('id', pack.id);

      if (dbErr) {
        if (/does not exist|could not find|schema cache/i.test(dbErr.message)) {
          dbWriteFailedWithMissingColumn = true;
          console.error(`  DB write failed for pack "${pack.id}": column not found (migration not applied?)`);
        } else {
          console.error(`  ERROR writing product id to DB for pack "${pack.id}": ${dbErr.message}`);
        }
      } else {
        orphanProductIds.splice(0, orphanProductIds.length, ...orphanProductIds.filter(
          s => !s.startsWith(`pack:${pack.id}`),
        ));
      }
    }

    summaryRows.push({ kind: 'pack', id: pack.id, productId, action });
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log('\n=== Summary ===\n');
  console.log('Plans:');
  for (const r of summaryRows.filter(r => r.kind === 'plan')) {
    console.log(
      `  ${r.id.padEnd(16)}  monthly: ${r.monthly.padEnd(40)} [${r.monthlyAction}]` +
      (r.yearlyAction !== 'skipped' ? `\n${''.padEnd(20)}yearly:  ${r.yearly.padEnd(40)} [${r.yearlyAction}]` : ''),
    );
  }
  console.log('\nCredit packs:');
  for (const r of summaryRows.filter(r => r.kind === 'pack')) {
    console.log(`  ${r.id.padEnd(16)}  product: ${r.productId.padEnd(40)} [${r.action}]`);
  }

  const created = summaryRows.filter(r => r.monthlyAction === 'created' || r.yearlyAction === 'created' || r.action === 'created').length;
  const updated = summaryRows.filter(r => r.monthlyAction === 'updated' || r.yearlyAction === 'updated' || r.action === 'updated').length;
  const failed  = summaryRows.filter(r => r.status === 'monthly-FAILED' || r.action === 'FAILED').length;
  console.log(`\nCreated: ${created}  Updated: ${updated}  Failed: ${failed}`);

  if (orphanProductIds.length > 0) {
    console.log('\nWARNING: The following Dodo product ids were created but could NOT be written back to the DB.');
    console.log('         Record them manually so they are not lost:');
    for (const s of orphanProductIds) console.log(`  ${s}`);
  }

  if (dbWriteFailedWithMissingColumn) {
    console.error(
      '\nERROR: Migration 20260618 not applied — run it first (Supabase SQL editor or ' +
      'scripts/apply-migration.js), then re-run this script.',
    );
    process.exit(1);
  }

  const missingIds = [
    ...plans.filter(p => !p.dodo_product_id_monthly && summaryRows.find(r => r.id === p.id && r.monthly === '-')).map(p => `plan:${p.id}:monthly`),
    ...packs.filter(p => !p.dodo_product_id && summaryRows.find(r => r.id === p.id && r.productId === 'ERROR')).map(p => `pack:${p.id}`),
  ];
  if (missingIds.length > 0) {
    console.log(`\n${missingIds.length} row(s) still missing Dodo product ids (failed during this run):`);
    for (const s of missingIds) console.log(`  ${s}`);
    process.exit(1);
  }

  console.log('\nAll products provisioned successfully.');
  process.exit(0);
})();
