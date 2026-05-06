-- Migration: Paddle Billing Integration
-- Date: 2026-05-06
-- Description:
--   Adds Paddle-specific columns alongside the existing stripe_* columns
--   (the original schema was scaffolded for Stripe; Paddle is the actual
--   provider, kept side-by-side so a future migration to Stripe via Atlas
--   doesn't require a destructive schema change).
--
--   Also seeds the three paid plans (starter, pro, studio) into public.plans
--   with their Paddle Price IDs, and extends the token_ledger.reason check
--   to include paddle_* event reasons used by the webhook handler.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. plans — add paddle price columns and seed paid plans
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS paddle_price_id_monthly TEXT,
  ADD COLUMN IF NOT EXISTS paddle_price_id_yearly  TEXT;

-- Idempotent seeds. ON CONFLICT lets us re-run the migration safely if the
-- IDs ever change (e.g. moving sandbox → production).
INSERT INTO public.plans (id, display_name, monthly_floor, signup_bonus, price_cents, sort_order, paddle_price_id_monthly, paddle_price_id_yearly)
VALUES
  ('starter', 'Starter', 1500,  0, 1000,  1, 'pri_01kqyt5610btfnb67xrtkb7qvz', 'pri_01kqyt6mzx7qh85wet1bnf297c'),
  ('pro',     'Pro',     5000,  0, 3000,  2, 'pri_01kqytdt35r7jz9y2kgqgj0tcq', 'pri_01kqytf0qpxjqjs8myxwtp8ms5'),
  ('studio',  'Studio',  15000, 0, 7900,  3, 'pri_01kqytgjx3bw3bg5xnkerfbayh', 'pri_01kqyth9sh1jredw1g3ekqr6kf')
ON CONFLICT (id) DO UPDATE
  SET display_name             = EXCLUDED.display_name,
      monthly_floor            = EXCLUDED.monthly_floor,
      price_cents              = EXCLUDED.price_cents,
      sort_order               = EXCLUDED.sort_order,
      paddle_price_id_monthly  = EXCLUDED.paddle_price_id_monthly,
      paddle_price_id_yearly   = EXCLUDED.paddle_price_id_yearly,
      updated_at               = NOW();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. subscriptions — add paddle ID columns
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS paddle_customer_id     TEXT,
  ADD COLUMN IF NOT EXISTS paddle_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS paddle_price_id        TEXT,
  ADD COLUMN IF NOT EXISTS billing_cycle          TEXT
    CHECK (billing_cycle IS NULL OR billing_cycle IN ('monthly', 'yearly'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_paddle_subscription
  ON public.subscriptions(paddle_subscription_id)
  WHERE paddle_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subscriptions_paddle_customer
  ON public.subscriptions(paddle_customer_id)
  WHERE paddle_customer_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. token_ledger — add paddle_event_id column + extend reasons
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.token_ledger
  ADD COLUMN IF NOT EXISTS paddle_event_id TEXT;

CREATE INDEX IF NOT EXISTS idx_token_ledger_paddle_event
  ON public.token_ledger(paddle_event_id)
  WHERE paddle_event_id IS NOT NULL;

-- Replace the reason CHECK with one that includes paddle_* reasons.
ALTER TABLE public.token_ledger
  DROP CONSTRAINT IF EXISTS token_ledger_reason_valid;

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
    'paddle_chargeback'
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. paddle_subscription_upsert — RPC the webhook calls
-- ─────────────────────────────────────────────────────────────────────────────
--   Idempotent on paddle_subscription_id. Maps Paddle subscription state →
--   our `subscriptions` row. Used for subscription.activated, .updated, and
--   .canceled events.

CREATE OR REPLACE FUNCTION public.paddle_subscription_upsert(
  p_user_id                UUID,
  p_paddle_subscription_id TEXT,
  p_paddle_customer_id     TEXT,
  p_paddle_price_id        TEXT,
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
    paddle_customer_id, paddle_subscription_id, paddle_price_id, billing_cycle
  )
  VALUES (
    p_user_id, p_plan_id, p_status,
    COALESCE(p_current_period_end, NOW() + INTERVAL '1 month'),
    p_cancel_at_period_end, p_current_period_end,
    p_paddle_customer_id, p_paddle_subscription_id, p_paddle_price_id, p_billing_cycle
  )
  ON CONFLICT (user_id) DO UPDATE
    SET plan_id                 = EXCLUDED.plan_id,
        status                  = EXCLUDED.status,
        cancel_at_period_end    = EXCLUDED.cancel_at_period_end,
        current_period_end      = EXCLUDED.current_period_end,
        paddle_customer_id      = EXCLUDED.paddle_customer_id,
        paddle_subscription_id  = EXCLUDED.paddle_subscription_id,
        paddle_price_id         = EXCLUDED.paddle_price_id,
        billing_cycle           = EXCLUDED.billing_cycle,
        updated_at              = NOW();
END;
$$;

REVOKE ALL ON FUNCTION public.paddle_subscription_upsert(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paddle_subscription_upsert(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN, TEXT) TO service_role;
