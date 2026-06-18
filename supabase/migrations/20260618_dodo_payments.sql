-- Migration: Dodo Payments — schema, content backfill, RPCs
-- Date: 2026-06-18
-- Description:
--   Clean cutover from Paddle → Dodo Payments.
--   Adds Dodo-specific columns alongside existing Paddle columns (left in place;
--   a later task removes Paddle code). Backfills editorial content (tagline,
--   features, accent) from plans-config.ts into the DB so the pricing surfaces
--   no longer need the static file at runtime. Adds three SECURITY DEFINER RPCs
--   that mirror the paddle_* equivalents 1:1.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. plans — editorial content + Dodo product IDs
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS tagline              TEXT,
  ADD COLUMN IF NOT EXISTS features             JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS accent               TEXT NOT NULL DEFAULT 'neutral',
  ADD COLUMN IF NOT EXISTS dodo_product_id_monthly TEXT,
  ADD COLUMN IF NOT EXISTS dodo_product_id_yearly  TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. credit_packs — editorial content + Dodo product ID
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.credit_packs
  ADD COLUMN IF NOT EXISTS tagline       TEXT,
  ADD COLUMN IF NOT EXISTS accent        TEXT NOT NULL DEFAULT 'neutral',
  ADD COLUMN IF NOT EXISTS dodo_product_id TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. subscriptions — Dodo identifiers (Paddle cols left untouched)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS dodo_customer_id     TEXT,
  ADD COLUMN IF NOT EXISTS dodo_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS dodo_product_id      TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. token_ledger — dodo_event_id + extended reason CHECK
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.token_ledger
  ADD COLUMN IF NOT EXISTS dodo_event_id TEXT;

CREATE INDEX IF NOT EXISTS idx_token_ledger_dodo_event
  ON public.token_ledger(dodo_event_id)
  WHERE dodo_event_id IS NOT NULL;

-- Drop the existing reason constraint (whichever name it was given) and replace
-- it with one that includes all original reasons PLUS the four new dodo_* ones.
ALTER TABLE public.token_ledger
  DROP CONSTRAINT IF EXISTS token_ledger_reason_valid;

ALTER TABLE public.token_ledger
  DROP CONSTRAINT IF EXISTS token_ledger_reason_check;

ALTER TABLE public.token_ledger
  ADD CONSTRAINT token_ledger_reason_valid CHECK (reason IN (
    'signup_bonus',
    'monthly_topup',
    'execution_debit',
    'execution_refund',
    'purchase',
    'subscription_grant',
    'admin_adjustment',
    'stripe_refund',
    'stripe_chargeback',
    'paddle_pack_purchase',
    'paddle_subscription_grant',
    'paddle_refund',
    'paddle_chargeback',
    'dodo_pack_purchase',
    'dodo_subscription_grant',
    'dodo_refund',
    'dodo_chargeback'
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. pricing_audit — generic dodo synced-id column
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.pricing_audit
  ADD COLUMN IF NOT EXISTS dodo_product_id_synced TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Content backfill — tagline / features / accent for plans
--    Values copied verbatim from lib/billing/plans-config.ts
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.plans SET
  tagline  = v.tagline,
  features = v.features::jsonb,
  accent   = v.accent
FROM (VALUES
  ('free',
   'For trying things out',
   '["100 credits refilled monthly","200 bonus credits on signup","Access to all standard AI models","Unlimited sessions","Community templates","Email support","Team members"]',
   'neutral'),
  ('starter',
   'For regular creators',
   '["1,500 credits refilled monthly","Unsaved credits roll over","Unlimited sessions","Access to premium AI models","Email support","Team members"]',
   'neutral'),
  ('pro',
   'For power users',
   '["5,000 credits refilled monthly","Unsaved credits roll over","Unlimited sessions","Priority email support","Team members"]',
   'highlight'),
  ('studio',
   'For agencies & teams',
   '["15,000 credits refilled monthly","Unsaved credits roll over","Unlimited sessions","Priority email support","Team members"]',
   'premium')
) AS v(id, tagline, features, accent)
WHERE public.plans.id = v.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Content backfill — tagline / accent for credit_packs
--    Values copied verbatim from lib/billing/plans-config.ts
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.credit_packs SET
  tagline = v.tagline,
  accent  = v.accent
FROM (VALUES
  ('spark', 'A quick top-up',       'neutral'),
  ('boost', 'Most popular',         'highlight'),
  ('mega',  'Best value per credit','premium')
) AS v(id, tagline, accent)
WHERE public.credit_packs.id = v.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. dodo_subscription_upsert — mirrors paddle_subscription_upsert 1:1
--    Idempotent on dodo_subscription_id. Maps Dodo subscription state →
--    our subscriptions row. Used for subscription.activated, .updated, .canceled.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.dodo_subscription_upsert(
  p_user_id                UUID,
  p_dodo_subscription_id   TEXT,
  p_dodo_customer_id       TEXT,
  p_dodo_product_id        TEXT,
  p_plan_id                TEXT,
  p_status                 TEXT,
  p_current_period_end     TIMESTAMPTZ,
  p_cancel_at_period_end   BOOLEAN,
  p_billing_cycle          TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.subscriptions (
    user_id, plan_id, status, next_topup_at,
    cancel_at_period_end, current_period_end,
    dodo_customer_id, dodo_subscription_id, dodo_product_id, billing_cycle
  )
  VALUES (
    p_user_id, p_plan_id, p_status,
    COALESCE(p_current_period_end, NOW() + INTERVAL '1 month'),
    p_cancel_at_period_end, p_current_period_end,
    p_dodo_customer_id, p_dodo_subscription_id, p_dodo_product_id, p_billing_cycle
  )
  ON CONFLICT (user_id) DO UPDATE
    SET plan_id               = EXCLUDED.plan_id,
        status                = EXCLUDED.status,
        cancel_at_period_end  = EXCLUDED.cancel_at_period_end,
        current_period_end    = EXCLUDED.current_period_end,
        dodo_customer_id      = EXCLUDED.dodo_customer_id,
        dodo_subscription_id  = EXCLUDED.dodo_subscription_id,
        dodo_product_id       = EXCLUDED.dodo_product_id,
        billing_cycle         = EXCLUDED.billing_cycle,
        updated_at            = NOW();
END;
$$;

REVOKE ALL ON FUNCTION public.dodo_subscription_upsert(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dodo_subscription_upsert(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN, TEXT) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. dodo_refund_clawback — mirrors paddle_refund_clawback 1:1
--    Admin-driven refund; caps clawback at current balance (never goes negative).
--    Idempotent on p_idempotency_key.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.dodo_refund_clawback(
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
    RAISE EXCEPTION 'dodo_refund_clawback: original grant % not found', p_original_grant_id;
  END IF;
  IF v_grant_user IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'dodo_refund_clawback: grant % belongs to a different user', p_original_grant_id;
  END IF;
  IF v_grant_amount <= 0 THEN
    RAISE EXCEPTION 'dodo_refund_clawback: grant % is not a positive grant (amount=%)', p_original_grant_id, v_grant_amount;
  END IF;

  -- Lock the profile row and compute clawback amount.
  SELECT token_balance INTO v_balance FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'dodo_refund_clawback: profile not found for user %', p_user_id;
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
    dodo_event_id, stripe_event_id, metadata
  )
  VALUES (
    p_user_id, -v_clawback, 'dodo_refund', p_idempotency_key,
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

REVOKE ALL ON FUNCTION public.dodo_refund_clawback(UUID, TEXT, UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dodo_refund_clawback(UUID, TEXT, UUID, TEXT, JSONB) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. dodo_chargeback_clawback — mirrors paddle_chargeback_clawback 1:1
--     Adversarial: force full clawback regardless of balance (can go negative).
--     Sets profiles.payment_disputed_at = NOW(). Idempotent on p_idempotency_key.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.dodo_chargeback_clawback(
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
    RAISE EXCEPTION 'dodo_chargeback_clawback: original grant % not found', p_original_grant_id;
  END IF;
  IF v_grant_user IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'dodo_chargeback_clawback: grant % belongs to a different user', p_original_grant_id;
  END IF;
  IF v_grant_amount <= 0 THEN
    RAISE EXCEPTION 'dodo_chargeback_clawback: grant % is not a positive grant (amount=%)', p_original_grant_id, v_grant_amount;
  END IF;

  -- Lock the profile and force clawback (even into negative balance).
  SELECT token_balance INTO v_balance FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'dodo_chargeback_clawback: profile not found for user %', p_user_id;
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
    dodo_event_id, stripe_event_id, metadata
  )
  VALUES (
    p_user_id, -v_grant_amount, 'dodo_chargeback', p_idempotency_key,
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

REVOKE ALL ON FUNCTION public.dodo_chargeback_clawback(UUID, TEXT, UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dodo_chargeback_clawback(UUID, TEXT, UUID, TEXT, JSONB) TO service_role;

COMMIT;
