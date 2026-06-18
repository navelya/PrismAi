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

-- Mirror the Paddle indexes: unique guard against subscription-id collision +
-- fast webhook lookup by customer id.
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_dodo_subscription
  ON public.subscriptions (dodo_subscription_id) WHERE dodo_subscription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_subscriptions_dodo_customer
  ON public.subscriptions (dodo_customer_id) WHERE dodo_customer_id IS NOT NULL;

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
    'monthly_reset',
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
-- 9. dodo_refund_clawback — topup-aware (mirrors paddle_refund_clawback from
--    20260523_topup_balance_and_free_expiry.sql, renamed for Dodo).
--    Admin-driven refund; caps clawback at current balance (never goes negative).
--    Adjusts topup_balance alongside token_balance. Idempotent on p_idempotency_key.
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
  v_grant_amount  NUMERIC(20,6); v_grant_user UUID; v_grant_reason TEXT;
  v_balance       NUMERIC(20,6); v_topup NUMERIC(20,6);
  v_clawback      NUMERIC(20,6); v_shortfall NUMERIC(20,6);
  v_new_balance   NUMERIC(20,6); v_new_topup NUMERIC(20,6); v_topup_delta NUMERIC(20,6);
  v_reduce        NUMERIC(20,6); v_enriched_meta JSONB;
BEGIN
  -- Idempotency: if we already processed this event, return the existing state.
  IF EXISTS (SELECT 1 FROM token_ledger WHERE idempotency_key = p_idempotency_key) THEN
    SELECT token_balance INTO v_new_balance FROM profiles WHERE id = p_user_id;
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'new_balance', v_new_balance);
  END IF;

  -- Load the original grant. Must exist, belong to this user, and be positive.
  SELECT amount, user_id, reason INTO v_grant_amount, v_grant_user, v_grant_reason
  FROM token_ledger WHERE id = p_original_grant_id;

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
  SELECT token_balance, topup_balance INTO v_balance, v_topup
  FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'dodo_refund_clawback: profile not found for user %', p_user_id;
  END IF;

  v_clawback  := LEAST(v_grant_amount, v_balance);
  v_shortfall := v_grant_amount - v_clawback;

  -- Nothing to claw back? Return no-op success. The caller's alert path
  -- captures the shortfall as the audit record. We skip the ledger insert
  -- because token_ledger has a nonzero CHECK on amount.
  IF v_clawback = 0 THEN
    RETURN jsonb_build_object('ok', true, 'clawed_back', 0, 'shortfall', v_shortfall, 'new_balance', v_balance);
  END IF;

  v_new_balance := v_balance - v_clawback;
  -- Only reduce topup_balance when clawing back a top-up grant (pack purchase).
  v_reduce      := CASE WHEN v_grant_reason IN ('dodo_pack_purchase','paddle_pack_purchase','purchase') THEN v_clawback ELSE 0 END;
  v_new_topup   := LEAST(GREATEST(0, v_topup - v_reduce), GREATEST(0, v_new_balance));
  v_topup_delta := v_new_topup - v_topup;

  v_enriched_meta := p_metadata || jsonb_build_object(
    'original_grant_id', p_original_grant_id,
    'original_grant_amount', v_grant_amount,
    'shortfall', v_shortfall,
    'topup_delta', v_topup_delta
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
  SET token_balance = v_new_balance,
      topup_balance = v_new_topup
  WHERE id = p_user_id;

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
-- 10. dodo_chargeback_clawback — topup-aware (mirrors paddle_chargeback_clawback
--     from 20260523_topup_balance_and_free_expiry.sql, renamed for Dodo).
--     Adversarial: force full clawback regardless of balance (can go negative).
--     Adjusts topup_balance alongside token_balance.
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
  v_grant_amount  NUMERIC(20,6); v_grant_user UUID; v_grant_reason TEXT;
  v_balance       NUMERIC(20,6); v_topup NUMERIC(20,6);
  v_new_balance   NUMERIC(20,6); v_new_topup NUMERIC(20,6); v_topup_delta NUMERIC(20,6);
  v_reduce        NUMERIC(20,6); v_went_negative BOOLEAN;
  v_disputed_at   TIMESTAMPTZ; v_enriched_meta JSONB;
BEGIN
  -- Idempotency
  IF EXISTS (SELECT 1 FROM token_ledger WHERE idempotency_key = p_idempotency_key) THEN
    SELECT token_balance, payment_disputed_at
      INTO v_new_balance, v_disputed_at
    FROM profiles WHERE id = p_user_id;
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'new_balance', v_new_balance, 'disputed_at', v_disputed_at);
  END IF;

  -- Load original grant
  SELECT amount, user_id, reason INTO v_grant_amount, v_grant_user, v_grant_reason
  FROM token_ledger WHERE id = p_original_grant_id;

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
  SELECT token_balance, topup_balance INTO v_balance, v_topup
  FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'dodo_chargeback_clawback: profile not found for user %', p_user_id;
  END IF;

  v_new_balance   := v_balance - v_grant_amount;
  v_went_negative := v_new_balance < 0;
  -- Only reduce topup_balance when clawing back a top-up grant (pack purchase).
  v_reduce        := CASE WHEN v_grant_reason IN ('dodo_pack_purchase','paddle_pack_purchase','purchase') THEN v_grant_amount ELSE 0 END;
  v_new_topup     := LEAST(GREATEST(0, v_topup - v_reduce), GREATEST(0, v_new_balance));
  v_topup_delta   := v_new_topup - v_topup;

  v_enriched_meta := p_metadata || jsonb_build_object(
    'original_grant_id', p_original_grant_id,
    'original_grant_amount', v_grant_amount,
    'balance_before', v_balance,
    'went_negative', v_went_negative,
    'topup_delta', v_topup_delta
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
  SET token_balance       = v_new_balance,
      topup_balance       = v_new_topup,
      payment_disputed_at = COALESCE(payment_disputed_at, NOW())
  WHERE id = p_user_id
  RETURNING payment_disputed_at INTO v_disputed_at;

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

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. credit_tokens — classify dodo_pack_purchase as a top-up (never-expiring)
--    Same body as 20260523, with 'dodo_pack_purchase' added to the top-up reason
--    set so Dodo credit-pack purchases land in topup_balance instead of being
--    treated as expirable monthly credits.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.credit_tokens(
  p_user_id UUID, p_amount NUMERIC, p_reason TEXT, p_idempotency_key TEXT,
  p_execution_id UUID DEFAULT NULL, p_stripe_event_id TEXT DEFAULT NULL, p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_new_balance NUMERIC(20,6); v_topup_delta NUMERIC(20,6);
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'credit_tokens requires a positive amount, got %', p_amount; END IF;
  IF EXISTS (SELECT 1 FROM token_ledger WHERE idempotency_key = p_idempotency_key) THEN
    SELECT token_balance INTO v_new_balance FROM profiles WHERE id = p_user_id;
    RETURN v_new_balance;
  END IF;
  v_topup_delta := CASE WHEN p_reason IN ('paddle_pack_purchase','dodo_pack_purchase','purchase') THEN p_amount ELSE 0 END;
  INSERT INTO token_ledger (user_id, amount, reason, idempotency_key, execution_id, stripe_event_id, metadata)
  VALUES (p_user_id, p_amount, p_reason, p_idempotency_key, p_execution_id, p_stripe_event_id,
          p_metadata || jsonb_build_object('topup_delta', v_topup_delta));
  UPDATE profiles
     SET token_balance = token_balance + p_amount,
         topup_balance = topup_balance + v_topup_delta
   WHERE id = p_user_id
   RETURNING token_balance INTO v_new_balance;
  IF v_new_balance IS NULL THEN RAISE EXCEPTION 'credit_tokens: profile not found for user %', p_user_id; END IF;
  RETURN v_new_balance;
END; $$;

COMMIT;
