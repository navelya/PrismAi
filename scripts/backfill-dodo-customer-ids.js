// scripts/backfill-dodo-customer-ids.js
// One-shot: iterates Dodo payment history, and for every payment that has
// metadata.user_id + customer.customer_id, upserts dodo_customer_id onto the
// matching subscriptions row (only when the row currently has null — idempotent).
//
// Run: node scripts/backfill-dodo-customer-ids.js
// Safe to re-run — the .is('dodo_customer_id', null) guard is a no-op on rows
// already backfilled.
const fs = require('fs');
// Lightweight .env.local loader (this repo does not depend on dotenv).
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const DodoPayments = require('dodopayments');
const { createClient } = require('@supabase/supabase-js');

// Resolve Dodo environment the same way lib/billing/dodo-server.ts does.
function getDodoEnvironment() {
  const e = (process.env.DODO_ENVIRONMENT || 'sandbox').toLowerCase();
  return e === 'live' || e === 'live_mode' || e === 'production' ? 'live_mode' : 'test_mode';
}

async function main() {
  const bearerToken = process.env.DODO_API_KEY;
  if (!bearerToken) {
    console.error('DODO_API_KEY is not set in .env.local');
    process.exit(1);
  }

  const dodo = new DodoPayments({ bearerToken, environment: getDodoEnvironment() });
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const CAP = 500;
  let processed = 0;
  let backfilled = 0;
  let skipped = 0;

  console.log(`Iterating Dodo payments (cap ${CAP})…`);

  for await (const payment of dodo.payments.list({})) {
    if (processed >= CAP) break;
    processed++;

    const userId = payment?.metadata?.user_id;
    const dodoCustomerId = payment?.customer?.customer_id;

    if (!userId || !dodoCustomerId) {
      skipped++;
      continue;
    }

    const { error } = await supabase
      .from('subscriptions')
      .update({ dodo_customer_id: dodoCustomerId })
      .eq('user_id', userId)
      .is('dodo_customer_id', null);

    if (error) {
      console.error(`  Error updating user ${userId}:`, error.message);
      skipped++;
    } else {
      backfilled++;
      console.log(`  Backfilled user ${userId} → customer ${dodoCustomerId}`);
    }
  }

  console.log(`\nDone. Processed ${processed} payments: ${backfilled} rows updated, ${skipped} skipped.`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
