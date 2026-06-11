-- ─────────────────────────────────────────────────────────────────────────────
-- Schedule the poll-backstop (sweep-pending) WITHOUT Vercel Pro.
--
-- The backstop is a plain authenticated HTTP route; ANY scheduler can drive it.
-- We use Supabase pg_cron + pg_net so the schedule lives in YOUR database (no
-- Vercel lock-in — it travels with Supabase if you ever migrate hosts) and the
-- CRON_SECRET never leaves your infra.
--
-- Cadence: every 2 minutes. The sweep ignores jobs idle < 90s (STALE_MS) and is
-- idempotent + missed-tick-safe, so 1/min buys nothing; 2 min keeps worst-case
-- self-heal under ~3.5 min.
--
-- THIS IS A TEMPLATE — edit the two placeholders, then run it ONCE in the
-- Supabase SQL editor (it is NOT an auto-applied migration on purpose).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Enable the extensions (free tier supports both; no-op if already enabled).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. Store the cron secret in Vault so it is NOT written in plaintext into the
--    cron.job table. Run this ONCE (replace the value with your real CRON_SECRET,
--    identical to the env var the route checks). If a secret named 'cron_secret'
--    already exists, update it instead via vault.update_secret.
--    Docs: https://supabase.com/docs/guides/database/vault
select vault.create_secret(
  'REPLACE_WITH_YOUR_CRON_SECRET',  -- must match process.env.CRON_SECRET
  'cron_secret',
  'Bearer secret for /api/cron/sweep-pending'
);

-- 3. Schedule the trigger. Replace YOUR_APP_URL with your deployed origin
--    (the same value as NEXT_PUBLIC_APP_URL, e.g. https://app.example.com).
--    net.http_get is fire-and-forget: it queues the request and does not block.
select cron.schedule(
  'sweep-pending',
  '*/2 * * * *',
  $$
  select net.http_get(
    url     := 'https://YOUR_APP_URL/api/cron/sweep-pending',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    )
  );
  $$
);

-- ── Operational notes ────────────────────────────────────────────────────────
-- • Inspect schedule:   select * from cron.job where jobname = 'sweep-pending';
-- • Inspect run history: select * from cron.job_run_details
--                        where jobid = (select jobid from cron.job where jobname='sweep-pending')
--                        order by start_time desc limit 20;
-- • pg_net responses (status codes) land in net._http_response (GC'd over time):
--                        select * from net._http_response order by created desc limit 20;
-- • pg_net is fire-and-forget — non-200s are NOT surfaced to pg_cron. That's fine
--   for a backstop (a missed tick only costs latency, never correctness). Monitor
--   the route's own logs on the app host for real errors.
-- • To remove the schedule:  select cron.unschedule('sweep-pending');
--
-- Alternative (no Postgres extensions): point any external cron (e.g. cron-job.org)
-- at GET https://YOUR_APP_URL/api/cron/sweep-pending every 2 min with header
-- 'Authorization: Bearer <CRON_SECRET>'. Same route, also Vercel-independent.
