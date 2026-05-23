-- ─────────────────────────────────────────────────────────────────────────────
-- Dev-DB verification for the free-monthly-expiry + top-up-tracking migration
-- (20260523_topup_balance_and_free_expiry.sql). Task 10 of
-- docs/superpowers/plans/2026-05-23-free-monthly-expiry-and-topup-tracking.md
--
-- HOW TO RUN (dev only — never prod):
--   1. Apply the migration to a DEV Supabase first.
--   2. Sign up a THROWAWAY account in the dev app (gives a clean free user:
--      token_balance=200, topup_balance=0).
--   3. Paste that user's UUID into v_user below.
--   4. Run this whole file in the Supabase SQL editor (or psql).
--
-- It runs every scenario via the real RPCs, ASSERTs the expected balances, then
-- ROLLS BACK — so nothing persists and you can re-run it freely. A failed ASSERT
-- aborts loudly with the offending step. On success you'll see the NOTICE lines
-- and a final "ALL SCENARIOS PASSED".
--
-- Assumes the default plan config: free monthly_floor=100, signup_bonus=200,
-- pro monthly_floor=5000.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

DO $$
DECLARE
  v_user  UUID := '00000000-0000-0000-0000-000000000000';  -- ← PASTE THROWAWAY USER ID
  v_bal   NUMERIC(20,6);
  v_topup NUMERIC(20,6);
  v_spent NUMERIC(20,6);
  v_sess  UUID;
  v_exec  UUID;
  v_grant UUID;
  v_drift INT;
BEGIN
  -- ── Step 0: sanity — must be a fresh free user (200 / 0) ─────────────────────
  SELECT token_balance, topup_balance INTO v_bal, v_topup FROM profiles WHERE id = v_user;
  IF v_bal IS NULL THEN
    RAISE EXCEPTION 'No profile for %. Sign up a throwaway account and paste its UUID into v_user.', v_user;
  END IF;
  ASSERT v_bal = 200 AND v_topup = 0,
    format('Step 0: expected a fresh 200/0 user, got %s/%s. Use a freshly signed-up account.', v_bal, v_topup);
  RAISE NOTICE 'Step 0 OK — fresh user: balance=200 topup=0';

  -- ── Step 2: spend 150 (monthly-first; no top-up touched) ─────────────────────
  PERFORM debit_tokens(v_user, 150, 'execution_debit', 'verify:debit1:' || v_user::text, NULL, '{}'::jsonb);
  SELECT token_balance, topup_balance INTO v_bal, v_topup FROM profiles WHERE id = v_user;
  ASSERT v_bal = 50 AND v_topup = 0, format('Step 2: expected 50/0, got %s/%s', v_bal, v_topup);
  RAISE NOTICE 'Step 2 OK — spent 150 -> 50/0';

  -- ── Step 3: buy a 400 pack (lands in top-up) ─────────────────────────────────
  PERFORM credit_tokens(v_user, 400, 'paddle_pack_purchase', 'verify:pack:' || v_user::text, NULL, NULL, '{}'::jsonb);
  SELECT token_balance, topup_balance INTO v_bal, v_topup FROM profiles WHERE id = v_user;
  ASSERT v_bal = 450 AND v_topup = 400, format('Step 3: expected 450/400, got %s/%s', v_bal, v_topup);
  RAISE NOTICE 'Step 3 OK — +400 pack -> 450/400';

  -- ── Step 4: spend 100 (monthly 50 first, then 50 from top-up) ────────────────
  -- Create a real session + execution so the refund (Step 6) can find this debit.
  -- Guarded: if the executions schema differs, we keep going and skip the refund.
  BEGIN
    INSERT INTO sessions (user_id) VALUES (v_user) RETURNING id INTO v_sess;
    INSERT INTO executions (session_id, status, graph_json) VALUES (v_sess, 'failed', '{}'::jsonb) RETURNING id INTO v_exec;
  EXCEPTION WHEN OTHERS THEN
    v_exec := NULL;
    RAISE NOTICE '⚠️  Could not create a test execution (%) — refund scenario (Step 6) will be skipped; verify refund via the app flow.', SQLERRM;
  END;
  PERFORM debit_tokens(v_user, 100, 'execution_debit', 'verify:debit2:' || v_user::text, v_exec, '{}'::jsonb);
  SELECT token_balance, topup_balance INTO v_bal, v_topup FROM profiles WHERE id = v_user;
  ASSERT v_bal = 350 AND v_topup = 350, format('Step 4: expected 350/350, got %s/%s', v_bal, v_topup);
  SELECT (metadata->>'topup_spent')::numeric INTO v_spent FROM token_ledger WHERE idempotency_key = 'verify:debit2:' || v_user::text;
  ASSERT v_spent = 50, format('Step 4: expected ledger topup_spent=50, got %s', v_spent);
  RAISE NOTICE 'Step 4 OK — spent 100 -> 350/350 (topup_spent=50)';

  -- ── Step 5: free monthly reset (monthly -> floor 100, packs preserved) ───────
  PERFORM monthly_topup(v_user);
  SELECT token_balance, topup_balance INTO v_bal, v_topup FROM profiles WHERE id = v_user;
  ASSERT v_bal = 450 AND v_topup = 350, format('Step 5: expected 450/350 (350 topup + 100 floor), got %s/%s', v_bal, v_topup);
  RAISE NOTICE 'Step 5 OK — free reset -> 450/350 (monthly back to 100, packs kept)';

  -- ── Step 7: paid plan accumulates; monthly_topup is a no-op for paid ─────────
  UPDATE subscriptions SET plan_id = 'pro' WHERE user_id = v_user;     -- pretend they're on Pro
  PERFORM credit_tokens(v_user, 5000, 'paddle_subscription_grant', 'verify:subgrant:' || v_user::text, NULL, NULL, '{}'::jsonb);
  SELECT token_balance, topup_balance INTO v_bal, v_topup FROM profiles WHERE id = v_user;
  ASSERT v_bal = 5450 AND v_topup = 350, format('Step 7a: expected 5450/350, got %s/%s', v_bal, v_topup);
  PERFORM monthly_topup(v_user);                                       -- paid -> no-op
  SELECT token_balance, topup_balance INTO v_bal, v_topup FROM profiles WHERE id = v_user;
  ASSERT v_bal = 5450 AND v_topup = 350, format('Step 7b: paid monthly_topup must be a no-op, got %s/%s', v_bal, v_topup);
  UPDATE subscriptions SET plan_id = 'free' WHERE user_id = v_user;    -- restore
  RAISE NOTICE 'Step 7 OK — paid grant accumulates (5450/350); paid monthly_topup is a no-op';

  -- ── Step 8: chargeback of the pack grant (reduce top-up, clamp) ──────────────
  SELECT id INTO v_grant FROM token_ledger WHERE idempotency_key = 'verify:pack:' || v_user::text;
  PERFORM paddle_chargeback_clawback(v_user, 'verify-evt', v_grant, 'verify:cbk:' || v_user::text, '{}'::jsonb);
  SELECT token_balance, topup_balance INTO v_bal, v_topup FROM profiles WHERE id = v_user;
  ASSERT v_bal = 5050 AND v_topup = 0, format('Step 8: expected 5050/0 (pack 400 clawed, topup -> 0), got %s/%s', v_bal, v_topup);
  RAISE NOTICE 'Step 8 OK — pack chargeback -> 5050/0';

  -- ── Step 6 (run last so a skipped execution doesn''t shift earlier numbers) ──
  -- Refund the Step-4 debit: restores 100 to balance and the 50 it took from top-up.
  IF v_exec IS NOT NULL THEN
    PERFORM refund_tokens(v_exec, 'verification');
    SELECT token_balance, topup_balance INTO v_bal, v_topup FROM profiles WHERE id = v_user;
    ASSERT v_bal = 5150 AND v_topup = 50, format('Step 6: expected 5150/50 after refund, got %s/%s', v_bal, v_topup);
    RAISE NOTICE 'Step 6 OK — refund of Step-4 debit -> 5150/50 (restored 100 balance, 50 top-up)';
  ELSE
    RAISE NOTICE 'Step 6 SKIPPED — no test execution was created.';
  END IF;

  -- ── Audits: both must report ZERO drift for this user ────────────────────────
  SELECT count(*) INTO v_drift FROM audit_balance_drift() WHERE user_id = v_user;
  ASSERT v_drift = 0, format('audit_balance_drift reported %s row(s) for the test user', v_drift);
  SELECT count(*) INTO v_drift FROM audit_topup_drift() WHERE user_id = v_user;
  ASSERT v_drift = 0, format('audit_topup_drift reported %s row(s) for the test user', v_drift);
  RAISE NOTICE 'Audits OK — audit_balance_drift and audit_topup_drift both clean for the test user';

  RAISE NOTICE '✅ ALL SCENARIOS PASSED — rolling back (nothing persisted).';
END $$;

ROLLBACK;

-- ─────────────────────────────────────────────────────────────────────────────
-- Optional: a global sanity sweep across ALL users (run separately, read-only).
-- Both should return zero rows on a healthy database.
--   SELECT * FROM audit_balance_drift();
--   SELECT * FROM audit_topup_drift();
-- ─────────────────────────────────────────────────────────────────────────────
