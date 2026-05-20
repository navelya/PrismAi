-- Migration: Paddle refund + chargeback handling
-- Date: 2026-05-20
-- Description:
--   Adds two clawback RPCs (paddle_refund_clawback, paddle_chargeback_clawback)
--   that the webhook calls when Paddle reports a refund or chargeback adjustment.
--
--   Schema changes:
--     - profiles.payment_disputed_at: timestamp set when a chargeback fires.
--       buy-pack and change-plan routes refuse purchases while this is non-null.
--     - profiles_token_balance_nonneg CHECK: dropped. The application-level
--       guard in debit_tokens already prevents normal spend below zero. The
--       CHECK was belt-and-suspenders and now blocks legitimate chargeback
--       clawbacks (chargebacks must be force-clawback even when the user has
--       already spent the credits — going negative is the intended outcome).
--       The tamper-proof trigger profiles_prevent_token_balance_tampering
--       still enforces service-role-only writes.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. profiles.payment_disputed_at + drop nonneg CHECK
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS payment_disputed_at TIMESTAMPTZ;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_token_balance_nonneg;

CREATE INDEX IF NOT EXISTS idx_profiles_payment_disputed
  ON public.profiles(id)
  WHERE payment_disputed_at IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. paddle_refund_clawback — admin-driven refund, cap clawback at current balance
-- ─────────────────────────────────────────────────────────────────────────────
--   Looks up the original ledger row (a positive paddle_pack_purchase or
--   paddle_subscription_grant) by id. Asserts user_id matches. Computes
--   clawback = min(grant_amount, current_balance) so the balance never goes
--   below zero on refunds. Returns shortfall so caller can alert admin.
--
--   Idempotent on p_idempotency_key via the existing UNIQUE constraint on
--   token_ledger.idempotency_key.

CREATE OR REPLACE FUNCTION public.paddle_refund_clawback(
  p_user_id           UUID,
  p_event_id          TEXT,
  p_original_grant_id UUID,
  p_idempotency_key   TEXT,
  p_metadata          JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_grant_amount   NUMERIC(20, 6);
  v_grant_user     UUID;
  v_balance        NUMERIC(20, 6);
  v_clawback       NUMERIC(20, 6);
  v_shortfall      NUMERIC(20, 6);
  v_new_balance    NUMERIC(20, 6);
  v_enriched_meta  JSONB;
BEGIN
  -- Idempotency: if we already processed this event, return the existing state.
  IF EXISTS (SELECT 1 FROM token_ledger WHERE idempotency_key = p_idempotency_key) THEN
    SELECT token_balance INTO v_new_balance FROM profiles WHERE id = p_user_id;
    RETURN jsonb_build_object(
      'ok', true,
      'replayed', true,
      'new_balance', v_new_balance
    );
  END IF;

  -- Load the original grant. Must exist, belong to this user, and be positive.
  SELECT amount, user_id INTO v_grant_amount, v_grant_user
  FROM token_ledger
  WHERE id = p_original_grant_id;

  IF v_grant_amount IS NULL THEN
    RAISE EXCEPTION 'paddle_refund_clawback: original grant % not found', p_original_grant_id;
  END IF;
  IF v_grant_user IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'paddle_refund_clawback: grant % belongs to a different user', p_original_grant_id;
  END IF;
  IF v_grant_amount <= 0 THEN
    RAISE EXCEPTION 'paddle_refund_clawback: grant % is not a positive grant (amount=%)', p_original_grant_id, v_grant_amount;
  END IF;

  -- Lock the profile row and compute clawback amount.
  SELECT token_balance INTO v_balance FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'paddle_refund_clawback: profile not found for user %', p_user_id;
  END IF;

  v_clawback  := LEAST(v_grant_amount, v_balance);
  v_shortfall := v_grant_amount - v_clawback;

  -- Nothing to claw back? Return no-op success. The caller's alert path
  -- captures the shortfall as the audit record. We skip the ledger insert
  -- because token_ledger has a nonzero CHECK on amount.
  IF v_clawback = 0 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'clawed_back', 0,
      'shortfall', v_shortfall,
      'new_balance', v_balance
    );
  END IF;

  v_enriched_meta := p_metadata || jsonb_build_object(
    'original_grant_id', p_original_grant_id,
    'original_grant_amount', v_grant_amount,
    'shortfall', v_shortfall
  );

  INSERT INTO token_ledger (
    user_id, amount, reason, idempotency_key,
    paddle_event_id, stripe_event_id, metadata
  )
  VALUES (
    p_user_id, -v_clawback, 'paddle_refund', p_idempotency_key,
    p_event_id, p_event_id, v_enriched_meta
  );

  UPDATE profiles
  SET token_balance = token_balance - v_clawback
  WHERE id = p_user_id
  RETURNING token_balance INTO v_new_balance;

  RETURN jsonb_build_object(
    'ok', true,
    'clawed_back', v_clawback,
    'shortfall', v_shortfall,
    'new_balance', v_new_balance
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. paddle_chargeback_clawback — adversarial, force full clawback, flag account
-- ─────────────────────────────────────────────────────────────────────────────
--   Same lookup pattern as refund, but:
--     - Claws back the FULL grant amount regardless of balance (can go negative)
--     - Sets profiles.payment_disputed_at = NOW()
--     - Returns whether the balance went negative so caller can alert admin

CREATE OR REPLACE FUNCTION public.paddle_chargeback_clawback(
  p_user_id           UUID,
  p_event_id          TEXT,
  p_original_grant_id UUID,
  p_idempotency_key   TEXT,
  p_metadata          JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_grant_amount   NUMERIC(20, 6);
  v_grant_user     UUID;
  v_balance        NUMERIC(20, 6);
  v_new_balance    NUMERIC(20, 6);
  v_went_negative  BOOLEAN;
  v_disputed_at    TIMESTAMPTZ;
  v_enriched_meta  JSONB;
BEGIN
  -- Idempotency
  IF EXISTS (SELECT 1 FROM token_ledger WHERE idempotency_key = p_idempotency_key) THEN
    SELECT token_balance, payment_disputed_at
      INTO v_new_balance, v_disputed_at
    FROM profiles WHERE id = p_user_id;
    RETURN jsonb_build_object(
      'ok', true,
      'replayed', true,
      'new_balance', v_new_balance,
      'disputed_at', v_disputed_at
    );
  END IF;

  -- Load original grant
  SELECT amount, user_id INTO v_grant_amount, v_grant_user
  FROM token_ledger
  WHERE id = p_original_grant_id;

  IF v_grant_amount IS NULL THEN
    RAISE EXCEPTION 'paddle_chargeback_clawback: original grant % not found', p_original_grant_id;
  END IF;
  IF v_grant_user IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'paddle_chargeback_clawback: grant % belongs to a different user', p_original_grant_id;
  END IF;
  IF v_grant_amount <= 0 THEN
    RAISE EXCEPTION 'paddle_chargeback_clawback: grant % is not a positive grant (amount=%)', p_original_grant_id, v_grant_amount;
  END IF;

  -- Lock the profile and force clawback (even into negative balance).
  SELECT token_balance INTO v_balance FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'paddle_chargeback_clawback: profile not found for user %', p_user_id;
  END IF;

  v_went_negative := (v_balance - v_grant_amount) < 0;

  v_enriched_meta := p_metadata || jsonb_build_object(
    'original_grant_id', p_original_grant_id,
    'original_grant_amount', v_grant_amount,
    'balance_before', v_balance,
    'went_negative', v_went_negative
  );

  INSERT INTO token_ledger (
    user_id, amount, reason, idempotency_key,
    paddle_event_id, stripe_event_id, metadata
  )
  VALUES (
    p_user_id, -v_grant_amount, 'paddle_chargeback', p_idempotency_key,
    p_event_id, p_event_id, v_enriched_meta
  );

  UPDATE profiles
  SET token_balance       = token_balance - v_grant_amount,
      payment_disputed_at = COALESCE(payment_disputed_at, NOW())
  WHERE id = p_user_id
  RETURNING token_balance, payment_disputed_at
    INTO v_new_balance, v_disputed_at;

  RETURN jsonb_build_object(
    'ok', true,
    'clawed_back', v_grant_amount,
    'went_negative', v_went_negative,
    'new_balance', v_new_balance,
    'disputed_at', v_disputed_at
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Lock down RPC access — service_role only (same pattern as existing RPCs)
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.paddle_refund_clawback(UUID, TEXT, UUID, TEXT, JSONB)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.paddle_chargeback_clawback(UUID, TEXT, UUID, TEXT, JSONB)  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.paddle_refund_clawback(UUID, TEXT, UUID, TEXT, JSONB)      TO service_role;
GRANT EXECUTE ON FUNCTION public.paddle_chargeback_clawback(UUID, TEXT, UUID, TEXT, JSONB)  TO service_role;
