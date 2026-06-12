-- Migration: refund_tokens nets out prior partial iteration refunds
-- Date: 2026-06-12
-- Description:
--   `refund_tokens` refunds the full ABS(execution_debit) for an execution, but
--   fan-out runs ALSO refund per failed iteration via `refundFailedIteration`
--   (lib/workflow/refund.ts), which credits `execution_partial_refund` ledger
--   rows through credit_tokens. When the execution then fails as a whole (now
--   deterministically reachable via the sweep's deadline path), the full refund
--   stacked on top of the partial ones → up to ~2x refunded for an
--   all-iterations-failed fan-out.
--
--   Fix: subtract the sum of prior `execution_partial_refund` credits for this
--   execution from the refund amount, floored at 0. Idempotency behavior is
--   unchanged (one `refund:{executionId}` ledger row); if the partial refunds
--   already cover the full debit, no ledger row is written (a zero-amount row
--   would violate token_ledger_amount_nonzero) and the current balance is
--   returned.
--
--   Apply together with the 20260611 migrations (provider job columns +
--   claim_node_completion) — the sweep relies on all three.
--
--   Signature is identical to the 20260523 version; CREATE OR REPLACE keeps
--   existing grants.

CREATE OR REPLACE FUNCTION public.refund_tokens(
  p_execution_id UUID, p_reason TEXT DEFAULT 'execution_failed'
) RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_user_id UUID; v_debit_amount NUMERIC(20,6); v_topup_spent NUMERIC(20,6);
  v_idem TEXT := 'refund:' || p_execution_id::text;
  v_bal NUMERIC(20,6); v_topup NUMERIC(20,6);
  v_partial NUMERIC(20,6); v_refund NUMERIC(20,6);
  v_new_balance NUMERIC(20,6); v_new_topup NUMERIC(20,6); v_topup_delta NUMERIC(20,6);
BEGIN
  IF EXISTS (SELECT 1 FROM token_ledger WHERE idempotency_key = v_idem) THEN RETURN NULL; END IF;
  SELECT user_id, ABS(amount), COALESCE((metadata->>'topup_spent')::numeric, 0)
    INTO v_user_id, v_debit_amount, v_topup_spent
  FROM token_ledger WHERE execution_id = p_execution_id AND reason = 'execution_debit' LIMIT 1;
  IF v_user_id IS NULL THEN RETURN NULL; END IF;
  SELECT token_balance, topup_balance INTO v_bal, v_topup FROM profiles WHERE id = v_user_id FOR UPDATE;

  -- Net out what refundFailedIteration already credited for this execution
  -- (one execution_partial_refund row per failed fan-out iteration).
  SELECT COALESCE(SUM(amount), 0) INTO v_partial
  FROM token_ledger
  WHERE execution_id = p_execution_id AND reason = 'execution_partial_refund';
  v_refund := GREATEST(0, v_debit_amount - v_partial);

  IF v_refund = 0 THEN
    -- Partial refunds already covered the full debit. No zero-amount ledger row
    -- (token_ledger_amount_nonzero); replays stay no-ops because v_partial can
    -- only grow.
    RETURN v_bal;
  END IF;

  v_new_balance := v_bal + v_refund;
  v_new_topup   := LEAST(GREATEST(0, v_new_balance), v_topup + v_topup_spent);
  v_topup_delta := v_new_topup - v_topup;  -- effective change after clamp
  INSERT INTO token_ledger (user_id, amount, reason, idempotency_key, execution_id, metadata)
  VALUES (v_user_id, v_refund, 'execution_refund', v_idem, p_execution_id,
          jsonb_build_object('refund_reason', p_reason, 'topup_delta', v_topup_delta,
                             'full_debit', v_debit_amount, 'partial_refunds_netted', v_partial));
  UPDATE profiles SET token_balance = v_new_balance, topup_balance = v_new_topup WHERE id = v_user_id;
  RETURN v_new_balance;
END; $$;

-- ── Allow the partial-refund reason in the ledger ──────────────────────────────
-- refundFailedIteration writes reason 'execution_partial_refund', but the CHECK
-- constraint (last set in 20260523) never included it — every per-iteration
-- refund insert has been silently rejected (refund.ts logs and continues).
-- Add it so partial refunds actually land; the netting above then keeps the
-- combined partial+full refund capped at the original debit.
ALTER TABLE public.token_ledger DROP CONSTRAINT IF EXISTS token_ledger_reason_valid;
ALTER TABLE public.token_ledger ADD CONSTRAINT token_ledger_reason_valid CHECK (reason IN (
  'signup_bonus','monthly_topup','monthly_reset','execution_debit','execution_refund',
  'execution_partial_refund',
  'purchase','subscription_grant','admin_adjustment','stripe_refund','stripe_chargeback',
  'paddle_pack_purchase','paddle_subscription_grant','paddle_refund','paddle_chargeback'
));
