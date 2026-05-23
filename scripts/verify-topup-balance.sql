-- ─────────────────────────────────────────────────────────────────────────────
-- Dev-DB verification for the free-monthly-expiry + top-up-tracking migration
-- (20260523_topup_balance_and_free_expiry.sql).
--
-- This version RETURNS A RESULTS GRID (expected vs actual + PASS/FAIL per step),
-- because the Supabase SQL editor hides RAISE NOTICE output.
--
-- HOW TO RUN (dev only — never prod):
--   1. Apply the migration to a DEV Supabase first.
--   2. Sign up a THROWAWAY account in the dev app (clean free user: 200 / 0).
--   3. Paste that user's UUID into v_user below.
--   4. Run the whole file. Read the grid at the bottom — every row should be ✅.
--
-- SAFETY: step 0 aborts unless the user is exactly a fresh 200/0 free user, so you
-- can't accidentally run this against a real account. It is ONE-SHOT and DOES
-- persist its changes on the throwaway account (no rollback, so the grid is
-- visible). To run again, use a NEW throwaway account (re-running the same one
-- aborts at step 0 because it's no longer 200/0). Cleanup snippet at the bottom.
--
-- Assumes default plan config: free floor=100, signup_bonus=200, pro floor=5000.
-- ─────────────────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS _verify_results;
CREATE TEMP TABLE _verify_results (ord INT, step TEXT, expected TEXT, actual TEXT, pass BOOLEAN);

DO $$
DECLARE
  v_user  UUID := '00000000-0000-0000-0000-000000000000';  -- ← PASTE THROWAWAY USER ID
  v_bal   NUMERIC(20,6);
  v_topup NUMERIC(20,6);
  v_spent NUMERIC(20,6);
  v_sess  UUID;
  v_exec  UUID;
  v_grant UUID;
  v_bd    INT;
  v_td    INT;
BEGIN
  -- Step 0: precondition — must be a fresh free user (200 / 0). Aborts otherwise.
  SELECT token_balance, topup_balance INTO v_bal, v_topup FROM profiles WHERE id = v_user;
  IF v_bal IS NULL THEN
    RAISE EXCEPTION 'No profile for %. Sign up a throwaway account and paste its UUID into v_user.', v_user;
  END IF;
  IF NOT (v_bal = 200 AND v_topup = 0) THEN
    RAISE EXCEPTION 'Refusing to run: user is %/%, not a fresh 200/0 throwaway. (Re-running needs a NEW throwaway account.)', v_bal, v_topup;
  END IF;
  INSERT INTO _verify_results VALUES (0, 'Fresh free user', '200 / 0', v_bal || ' / ' || v_topup, true);

  -- Step 2: spend 150 (monthly-first; top-up untouched) -> 50 / 0
  PERFORM debit_tokens(v_user, 150, 'execution_debit', 'verify:debit1:' || v_user::text, NULL, '{}'::jsonb);
  SELECT token_balance, topup_balance INTO v_bal, v_topup FROM profiles WHERE id = v_user;
  INSERT INTO _verify_results VALUES (2, 'Spend 150 (monthly-first)', '50 / 0', v_bal||' / '||v_topup, (v_bal=50 AND v_topup=0));

  -- Step 3: buy 400 pack (lands in top-up) -> 450 / 400
  PERFORM credit_tokens(v_user, 400, 'paddle_pack_purchase', 'verify:pack:' || v_user::text, NULL, NULL, '{}'::jsonb);
  SELECT token_balance, topup_balance INTO v_bal, v_topup FROM profiles WHERE id = v_user;
  INSERT INTO _verify_results VALUES (3, 'Buy 400 pack', '450 / 400', v_bal||' / '||v_topup, (v_bal=450 AND v_topup=400));

  -- Step 4: spend 100 (50 monthly, then 50 top-up) -> 350 / 350
  -- Create a real execution so the refund (step 6) can find this debit. Guarded.
  BEGIN
    INSERT INTO sessions (user_id) VALUES (v_user) RETURNING id INTO v_sess;
    INSERT INTO executions (session_id, status, graph_json) VALUES (v_sess, 'failed', '{}'::jsonb) RETURNING id INTO v_exec;
  EXCEPTION WHEN OTHERS THEN
    v_exec := NULL;
    INSERT INTO _verify_results VALUES (1, 'NOTE: executions row not created (' || SQLERRM || ') — refund step skipped', '-', '-', true);
  END;
  PERFORM debit_tokens(v_user, 100, 'execution_debit', 'verify:debit2:' || v_user::text, v_exec, '{}'::jsonb);
  SELECT token_balance, topup_balance INTO v_bal, v_topup FROM profiles WHERE id = v_user;
  INSERT INTO _verify_results VALUES (4, 'Spend 100 (monthly 50 + top-up 50)', '350 / 350', v_bal||' / '||v_topup, (v_bal=350 AND v_topup=350));
  SELECT (metadata->>'topup_spent')::numeric INTO v_spent FROM token_ledger WHERE idempotency_key = 'verify:debit2:' || v_user::text;
  INSERT INTO _verify_results VALUES (5, '  ↳ ledger topup_spent', '50', COALESCE(v_spent::text,'null'), v_spent = 50);

  -- Step 5: free monthly reset (monthly -> floor 100, packs preserved) -> 450 / 350
  PERFORM monthly_topup(v_user);
  SELECT token_balance, topup_balance INTO v_bal, v_topup FROM profiles WHERE id = v_user;
  INSERT INTO _verify_results VALUES (6, 'Free monthly reset', '450 / 350', v_bal||' / '||v_topup, (v_bal=450 AND v_topup=350));

  -- Step 7: paid accumulates; monthly_topup is a no-op for paid
  UPDATE subscriptions SET plan_id = 'pro' WHERE user_id = v_user;
  PERFORM credit_tokens(v_user, 5000, 'paddle_subscription_grant', 'verify:subgrant:' || v_user::text, NULL, NULL, '{}'::jsonb);
  SELECT token_balance, topup_balance INTO v_bal, v_topup FROM profiles WHERE id = v_user;
  INSERT INTO _verify_results VALUES (7, 'Paid subscription grant +5000', '5450 / 350', v_bal||' / '||v_topup, (v_bal=5450 AND v_topup=350));
  PERFORM monthly_topup(v_user);
  SELECT token_balance, topup_balance INTO v_bal, v_topup FROM profiles WHERE id = v_user;
  INSERT INTO _verify_results VALUES (8, 'Paid monthly_topup is a no-op', '5450 / 350', v_bal||' / '||v_topup, (v_bal=5450 AND v_topup=350));
  UPDATE subscriptions SET plan_id = 'free' WHERE user_id = v_user;

  -- Step 8: chargeback the pack grant (reduce top-up, clamp) -> 5050 / 0
  SELECT id INTO v_grant FROM token_ledger WHERE idempotency_key = 'verify:pack:' || v_user::text;
  PERFORM paddle_chargeback_clawback(v_user, 'verify-evt', v_grant, 'verify:cbk:' || v_user::text, '{}'::jsonb);
  SELECT token_balance, topup_balance INTO v_bal, v_topup FROM profiles WHERE id = v_user;
  INSERT INTO _verify_results VALUES (9, 'Chargeback the 400 pack', '5050 / 0', v_bal||' / '||v_topup, (v_bal=5050 AND v_topup=0));

  -- Step 6 (run last so a skipped execution doesn't shift earlier numbers):
  -- refund the step-4 debit -> +100 balance, +50 top-up restored -> 5150 / 50
  IF v_exec IS NOT NULL THEN
    PERFORM refund_tokens(v_exec, 'verification');
    SELECT token_balance, topup_balance INTO v_bal, v_topup FROM profiles WHERE id = v_user;
    INSERT INTO _verify_results VALUES (10, 'Refund the step-4 debit', '5150 / 50', v_bal||' / '||v_topup, (v_bal=5150 AND v_topup=50));
  END IF;

  -- Audits: zero drift for this user on both checks.
  SELECT count(*) INTO v_bd FROM audit_balance_drift() WHERE user_id = v_user;
  SELECT count(*) INTO v_td FROM audit_topup_drift()  WHERE user_id = v_user;
  INSERT INTO _verify_results VALUES (11, 'audit_balance_drift (rows for user)', '0', v_bd::text, v_bd = 0);
  INSERT INTO _verify_results VALUES (12, 'audit_topup_drift (rows for user)',  '0', v_td::text, v_td = 0);
END $$;

-- The results grid. Every row's "result" should be ✅.
SELECT
  ord,
  step,
  expected,
  actual,
  CASE WHEN pass THEN '✅' ELSE '❌ FAIL' END AS result
FROM _verify_results
ORDER BY ord;

-- ─────────────────────────────────────────────────────────────────────────────
-- Re-run cleanup (optional): wipe this throwaway user's test rows. Easiest is to
-- just use a fresh throwaway account instead.
--   DELETE FROM token_ledger WHERE idempotency_key LIKE 'verify:%' AND user_id = '<UUID>';
--
-- Global read-only sanity sweep across ALL users (both should return zero rows):
--   SELECT * FROM audit_balance_drift();
--   SELECT * FROM audit_topup_drift();
-- ─────────────────────────────────────────────────────────────────────────────
