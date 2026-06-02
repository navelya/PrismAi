// scripts/verify-pricing.js
// Run: node scripts/verify-pricing.js
// Reads pricing tables and exercises the Paddle SANDBOX price-create/archive
// path end-to-end. Requires .env.local env vars to be exported into the shell,
// or loaded by the caller: SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL,
// PADDLE_API_KEY, PADDLE_ENVIRONMENT=sandbox.
// Note: dotenv is not a project dependency; export vars before running:
//   export $(grep -v '^#' .env.local | xargs) && node scripts/verify-pricing.js
const { createClient } = require('@supabase/supabase-js');
const { Paddle, Environment } = require('@paddle/paddle-node-sdk');

async function main() {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const { data: plans } = await supabase.from('plans').select('*').order('sort_order');
    const { data: packs } = await supabase.from('credit_packs').select('*').order('sort_order');
    console.log('PLANS:', plans.map(p => `${p.id} $${(p.price_cents ?? 0) / 100}/mo cr=${p.monthly_floor} active=${p.is_active}`));
    console.log('PACKS:', packs.map(p => `${p.id} $${p.price_cents / 100} cr=${p.credits} active=${p.is_active}`));

    const env = (process.env.PADDLE_ENVIRONMENT || 'sandbox').toLowerCase();
    if (env !== 'sandbox') {
        console.log('PADDLE_ENVIRONMENT is not sandbox — skipping Paddle write test.');
        return;
    }
    const paddle = new Paddle(process.env.PADDLE_API_KEY, { environment: Environment.sandbox });

    const starter = plans.find(p => p.id === 'starter');
    const oldId = starter.paddle_price_id_monthly;
    const price = await paddle.prices.get(oldId);
    console.log('Resolved product for starter monthly:', price.productId);

    const created = await paddle.prices.create({
        description: 'VERIFY TEMP Starter Monthly',
        productId: price.productId,
        unitPrice: { amount: '2000', currencyCode: 'USD' },
        billingCycle: { interval: 'month', frequency: 1 },
    });
    console.log('Created sandbox price:', created.id);
    await paddle.prices.update(created.id, { status: 'archived' });
    console.log('Archived the temp price. End-to-end Paddle path OK.');
}

main().catch((e) => { console.error(e); process.exit(1); });
