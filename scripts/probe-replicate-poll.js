// scripts/probe-replicate-poll.js
// Creates a tiny real Replicate prediction, polls it to completion via the same
// SDK calls the adapter uses, and prints the normalized status transitions.
// Run: node scripts/probe-replicate-poll.js
const fs = require('fs');
// Lightweight .env.local loader (this repo does not depend on dotenv).
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const Replicate = require('replicate');

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

// A small, cheap, fast public model. Adjust if this version is unavailable.
const MODEL = 'black-forest-labs/flux-schnell';

(async () => {
  if (!process.env.REPLICATE_API_TOKEN) { console.error('❌ REPLICATE_API_TOKEN missing'); process.exit(1); }
  console.log('Creating prediction…');
  const created = await replicate.predictions.create({
    model: MODEL,
    input: { prompt: 'a single red apple on a white background', num_outputs: 1 },
  });
  console.log('✅ created id:', created.id, 'status:', created.status);

  let status = created.status;
  for (let i = 0; i < 60 && (status === 'starting' || status === 'processing'); i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const p = await replicate.predictions.get(created.id);
    status = p.status;
    console.log(`  poll ${i}: ${status}`);
    if (status === 'succeeded') {
      console.log('✅ output:', Array.isArray(p.output) ? p.output[0] : p.output);
      process.exit(0);
    }
    if (status === 'failed' || status === 'canceled') {
      console.error('❌ terminal failure:', p.error);
      process.exit(1);
    }
  }
  console.error('❌ did not reach terminal status in time');
  process.exit(1);
})();
