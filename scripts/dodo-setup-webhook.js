// scripts/dodo-setup-webhook.js
// Creates a Dodo Payments webhook endpoint for this app and captures the signing
// secret. If .env.local does NOT already contain a DODO_WEBHOOK_KEY line, the
// secret is appended to the file automatically. If it does, the script prints
// the new secret and instructs the operator to update it manually (never
// overwrites an existing key — rotating secrets is a deliberate operator act).
//
// Prerequisites:
//   DODO_API_KEY, DODO_ENVIRONMENT, NEXT_PUBLIC_APP_URL must be set in .env.local.
//
// Run: node scripts/dodo-setup-webhook.js
//
// IMPORTANT: Dodo CANNOT deliver webhooks to a localhost URL. If NEXT_PUBLIC_APP_URL
// contains "localhost", this script creates the endpoint anyway (useful for
// capturing the secret early) but prints a prominent warning. Re-run with the
// production public URL after deploy — or set up a tunnel (e.g. ngrok) for local
// development testing.

'use strict';

const fs = require('fs');
const path = require('path');

// ─── .env.local loader (no dotenv dependency) ────────────────────────────────
const envLocalPath = path.resolve('.env.local');
let envLocalContent = '';
try {
  envLocalContent = fs.readFileSync(envLocalPath, 'utf8');
} catch (err) {
  console.error(`ERROR: Could not read .env.local: ${err.message}`);
  process.exit(1);
}

for (const line of envLocalContent.split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

// ─── Env validation ───────────────────────────────────────────────────────────
const dodoApiKey = process.env.DODO_API_KEY;
if (!dodoApiKey) {
  console.error('ERROR: DODO_API_KEY is not set in .env.local');
  process.exit(1);
}

// ─── Resolve the public base URL ──────────────────────────────────────────────
// Priority: CLI arg > DODO_WEBHOOK_URL env > NEXT_PUBLIC_APP_URL. Dodo registers
// a webhook at <baseUrl>/api/webhooks/dodo. The URL only needs to be reachable by
// DODO's servers (your deployed Vercel domain) — NOT by the machine running this
// script — so pass your production https URL even when running locally:
//   node scripts/dodo-setup-webhook.js https://app.prisfol.com
const cliArg = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : null;
const baseUrl = cliArg || process.env.DODO_WEBHOOK_URL || process.env.NEXT_PUBLIC_APP_URL;
if (!baseUrl) {
  console.error('ERROR: No base URL. Pass one explicitly: node scripts/dodo-setup-webhook.js https://app.prisfol.com');
  process.exit(1);
}

// ─── Dodo requires HTTPS — validate BEFORE any network call ───────────────────
// (Dodo returns 422 "Endpoint URL schemes must be https". Failing fast here also
// avoids leaving an open SDK socket, which crashes Node on Windows at exit.)
let parsedUrl;
try {
  parsedUrl = new URL(baseUrl);
} catch {
  console.error(`ERROR: "${baseUrl}" is not a valid URL.`);
  process.exit(1);
}
if (parsedUrl.protocol !== 'https:') {
  console.error('');
  console.error('┌─────────────────────────────────────────────────────────────────────────┐');
  console.error('│  Dodo requires an HTTPS webhook URL — http:// / localhost is rejected.   │');
  console.error('│                                                                         │');
  console.error('│  Register the endpoint against your DEPLOYED (Vercel) domain. You can    │');
  console.error('│  run this from your laptop — only Dodo needs to reach the URL, not you:  │');
  console.error('│                                                                         │');
  console.error('│    node scripts/dodo-setup-webhook.js https://app.prisfol.com           │');
  console.error('│                                                                         │');
  console.error('│  (Use your real production domain or the *.vercel.app URL.) For LOCAL    │');
  console.error('│  webhook testing, expose localhost via an https tunnel (ngrok /          │');
  console.error('│  cloudflared) and pass that https URL instead.                          │');
  console.error('└─────────────────────────────────────────────────────────────────────────┘');
  console.error('');
  process.exit(1);
}
const appUrl = baseUrl;
const isLocalhost = false;

// ─── Dodo environment mapping ─────────────────────────────────────────────────
function getDodoEnvironment() {
  const e = (process.env.DODO_ENVIRONMENT || 'sandbox').toLowerCase();
  return e === 'live' || e === 'live_mode' || e === 'production' ? 'live_mode' : 'test_mode';
}

const dodopayments = require('dodopayments');
const DodoPayments = dodopayments.default || dodopayments;
const dodo = new DodoPayments({ bearerToken: dodoApiKey, environment: getDodoEnvironment() });

// ─── Webhook URL ──────────────────────────────────────────────────────────────
const webhookUrl = `${appUrl.replace(/\/$/, '')}/api/webhooks/dodo`;
console.log(`Dodo environment : ${getDodoEnvironment()}`);
console.log(`Webhook URL      : ${webhookUrl}`);
console.log('');

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  let endpoint;
  try {
    // WebhookCreateParams: url (required), description, disabled, filter_types,
    // headers, idempotency_key, metadata, rate_limit.
    // The create response is WebhookDetails: { id, url, description, metadata,
    // created_at, updated_at, disabled?, filter_types?, rate_limit? }.
    // NOTE: The secret is NOT in the create response — it must be fetched
    // separately via webhooks.retrieveSecret(webhookID).
    endpoint = await dodo.webhooks.create({
      url: webhookUrl,
      description: 'PrismAi Dodo Payments webhook',
    });
  } catch (err) {
    // Provide clear error messages for common failure modes.
    const msg = err.message || String(err);
    if (/unauthorized|invalid.*key|401/i.test(msg)) {
      console.error('ERROR: Dodo API rejected the request — check that DODO_API_KEY is correct and matches DODO_ENVIRONMENT.');
    } else if (/network|ENOTFOUND|ECONNREFUSED|fetch/i.test(msg)) {
      console.error('ERROR: Network error contacting Dodo API — check connectivity.');
    } else {
      console.error(`ERROR: Failed to create Dodo webhook endpoint: ${msg}`);
    }
    process.exit(1);
  }

  console.log(`Webhook endpoint created: ${endpoint.id}`);

  // ─── Retrieve the signing secret (separate API call) ─────────────────────
  let secret;
  try {
    const result = await dodo.webhooks.retrieveSecret(endpoint.id);
    secret = result.secret;
  } catch (err) {
    console.error(`ERROR: Webhook endpoint created (id: ${endpoint.id}) but failed to retrieve secret: ${err.message}`);
    console.log('You can retrieve the secret manually from the Dodo dashboard.');
    process.exit(1);
  }

  console.log('');
  console.log(`Signing secret   : ${secret}`);
  console.log('');

  // ─── Write secret to .env.local if not already present ───────────────────
  const alreadyHasKey = /^\s*DODO_WEBHOOK_KEY\s*=/m.test(envLocalContent);

  if (alreadyHasKey) {
    console.log('DODO_WEBHOOK_KEY already exists in .env.local — NOT overwriting.');
    console.log('To rotate the key, update .env.local manually:');
    console.log(`  DODO_WEBHOOK_KEY=${secret}`);
  } else {
    const appendLine = `\nDODO_WEBHOOK_KEY=${secret}\n`;
    try {
      fs.appendFileSync(envLocalPath, appendLine, 'utf8');
      console.log('DODO_WEBHOOK_KEY appended to .env.local.');
    } catch (err) {
      console.error(`ERROR: Could not write to .env.local: ${err.message}`);
      console.log('Set it manually:');
      console.log(`  DODO_WEBHOOK_KEY=${secret}`);
      process.exit(1);
    }
  }

  console.log('');
  if (isLocalhost) {
    console.log('NOTE: This endpoint points to a localhost URL and will not receive events.');
    console.log('      After deploy, re-run with the production NEXT_PUBLIC_APP_URL.');
  } else {
    console.log('Done. Dodo webhook endpoint is live and ready to receive events.');
  }

  process.exit(0);
})();
