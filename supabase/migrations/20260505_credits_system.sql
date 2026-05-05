-- Migration: Credits / Tokens System (foundation, no Stripe yet)
-- Date: 2026-05-05
-- Description:
--   Introduces the credits economy: balance column on profiles, append-only ledger,
--   plans + subscriptions tables (free plan only for now), and SECURITY DEFINER
--   RPCs for every mutation. Also extends handle_new_user() to seed a free
--   subscription + 200-credit signup bonus.
--
--   Stripe-specific columns exist (stripe_subscription_id, stripe_customer_id,
--   stripe_price_id) but stay NULL until the Stripe integration lands later.
--
-- Security model:
--   - profiles.token_balance has a CHECK (>= 0) constraint as a hard floor
--   - A BEFORE INSERT/UPDATE trigger blocks any non-service-role attempt to
--     change token_balance (mirrors the is_admin tampering pattern)
--   - All mutation RPCs are SECURITY DEFINER and EXECUTE is granted only to
--     service_role — end users cannot call them via supabase.rpc()
--   - Every ledger row has a UNIQUE idempotency_key — retries are safe
--   - RLS on ledger/subscriptions/plans is read-only for the owning user

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. profiles.token_balance column + CHECK + tamper-proof trigger
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS token_balance NUMERIC(20, 6) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_token_balance_nonneg'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_token_balance_nonneg CHECK (token_balance >= 0);
  END IF;
END $$;

-- Block clients from modifying token_balance directly. Same pattern as
-- prevent_admin_self_elevation in 20260505_admin_role_hardening.sql.
CREATE OR REPLACE FUNCTION public.prevent_token_balance_tampering()
RETURNS TRIGGER AS $$
BEGIN
  -- Privileged contexts: server-side API with service_role JWT, or no-JWT
  -- contexts (migrations, supabase admin, server-internal). RLS requires
  -- auth.uid() = id for any client UPDATE, so a regular user cannot reach
  -- this trigger with auth.uid() NULL.
  IF auth.role() = 'service_role' OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.token_balance IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Permission denied: token_balance can only be modified by the credits RPCs.';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.token_balance IS DISTINCT FROM OLD.token_balance THEN
    RAISE EXCEPTION 'Permission denied: token_balance can only be modified by the credits RPCs.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS profiles_prevent_token_balance_tampering ON public.profiles;
CREATE TRIGGER profiles_prevent_token_balance_tampering
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_token_balance_tampering();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. plans table (catalog) — seed free plan only; paid plans added with Stripe
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.plans (
  id              TEXT PRIMARY KEY,
  display_name    TEXT NOT NULL,
  monthly_floor   NUMERIC(20, 6) NOT NULL,
  signup_bonus    NUMERIC(20, 6) NOT NULL DEFAULT 0,
  price_cents     INTEGER,            -- NULL for free
  stripe_price_id TEXT,               -- NULL until Stripe integration
  is_active       BOOLEAN NOT NULL DEFAULT true,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT plans_floor_nonneg CHECK (monthly_floor >= 0),
  CONSTRAINT plans_bonus_nonneg CHECK (signup_bonus >= 0)
);

INSERT INTO public.plans (id, display_name, monthly_floor, signup_bonus, sort_order)
VALUES ('free', 'Free', 100, 200, 0)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. subscriptions table — every user has exactly one row (free or paid)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.subscriptions (
  user_id                UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id                TEXT NOT NULL REFERENCES public.plans(id),
  status                 TEXT NOT NULL DEFAULT 'active',
  next_topup_at          TIMESTAMPTZ NOT NULL,
  cancel_at_period_end   BOOLEAN NOT NULL DEFAULT false,
  current_period_end     TIMESTAMPTZ,             -- NULL for free
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT UNIQUE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT subscriptions_status_valid CHECK (status IN ('active', 'canceled', 'past_due'))
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_topup_due
  ON public.subscriptions(next_topup_at)
  WHERE status = 'active';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. token_ledger table — append-only, idempotent, source of truth
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.token_ledger (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  amount           NUMERIC(20, 6) NOT NULL,
  reason           TEXT NOT NULL,
  execution_id     UUID REFERENCES public.executions(id) ON DELETE SET NULL,
  stripe_event_id  TEXT,
  idempotency_key  TEXT NOT NULL UNIQUE,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT token_ledger_amount_nonzero CHECK (amount <> 0),
  CONSTRAINT token_ledger_reason_valid CHECK (reason IN (
    'signup_bonus',
    'monthly_topup',
    'execution_debit',
    'execution_refund',
    'purchase',
    'subscription_grant',
    'admin_adjustment',
    'stripe_refund',
    'stripe_chargeback'
  ))
);

CREATE INDEX IF NOT EXISTS idx_token_ledger_user_created
  ON public.token_ledger(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_token_ledger_execution
  ON public.token_ledger(execution_id)
  WHERE execution_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS — owners can read, only service_role can write
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.plans         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.token_ledger  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plans_read_active ON public.plans;
CREATE POLICY plans_read_active ON public.plans
  FOR SELECT
  USING (is_active = true);

DROP POLICY IF EXISTS subscriptions_read_own ON public.subscriptions;
CREATE POLICY subscriptions_read_own ON public.subscriptions
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS token_ledger_read_own ON public.token_ledger;
CREATE POLICY token_ledger_read_own ON public.token_ledger
  FOR SELECT
  USING (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policies → only service_role can write.

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Mutation RPCs (SECURITY DEFINER, service_role only)
-- ─────────────────────────────────────────────────────────────────────────────

-- credit_tokens: positive grant. Idempotent on idempotency_key.
CREATE OR REPLACE FUNCTION public.credit_tokens(
  p_user_id          UUID,
  p_amount           NUMERIC,
  p_reason           TEXT,
  p_idempotency_key  TEXT,
  p_execution_id     UUID DEFAULT NULL,
  p_stripe_event_id  TEXT DEFAULT NULL,
  p_metadata         JSONB DEFAULT '{}'::jsonb
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new_balance NUMERIC(20, 6);
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'credit_tokens requires a positive amount, got %', p_amount;
  END IF;

  IF EXISTS (SELECT 1 FROM token_ledger WHERE idempotency_key = p_idempotency_key) THEN
    SELECT token_balance INTO v_new_balance FROM profiles WHERE id = p_user_id;
    RETURN v_new_balance;
  END IF;

  INSERT INTO token_ledger (
    user_id, amount, reason, idempotency_key,
    execution_id, stripe_event_id, metadata
  )
  VALUES (
    p_user_id, p_amount, p_reason, p_idempotency_key,
    p_execution_id, p_stripe_event_id, p_metadata
  );

  UPDATE profiles
  SET token_balance = token_balance + p_amount
  WHERE id = p_user_id
  RETURNING token_balance INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    RAISE EXCEPTION 'credit_tokens: profile not found for user %', p_user_id;
  END IF;

  RETURN v_new_balance;
END;
$$;

-- debit_tokens: subtract. Atomic check-and-decrement; raises INSUFFICIENT_TOKENS if too low.
CREATE OR REPLACE FUNCTION public.debit_tokens(
  p_user_id          UUID,
  p_amount           NUMERIC,
  p_reason           TEXT,
  p_idempotency_key  TEXT,
  p_execution_id     UUID DEFAULT NULL,
  p_metadata         JSONB DEFAULT '{}'::jsonb
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new_balance NUMERIC(20, 6);
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'debit_tokens requires a positive amount, got %', p_amount;
  END IF;

  -- Idempotency: if this exact key was already debited, return current balance.
  IF EXISTS (SELECT 1 FROM token_ledger WHERE idempotency_key = p_idempotency_key) THEN
    SELECT token_balance INTO v_new_balance FROM profiles WHERE id = p_user_id;
    RETURN v_new_balance;
  END IF;

  -- Atomic conditional debit. If balance < amount, no row matches → NOT FOUND.
  UPDATE profiles
  SET token_balance = token_balance - p_amount
  WHERE id = p_user_id AND token_balance >= p_amount
  RETURNING token_balance INTO v_new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSUFFICIENT_TOKENS' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO token_ledger (
    user_id, amount, reason, idempotency_key, execution_id, metadata
  )
  VALUES (
    p_user_id, -p_amount, p_reason, p_idempotency_key, p_execution_id, p_metadata
  );

  RETURN v_new_balance;
END;
$$;

-- refund_tokens: refund the prior debit for an execution. Idempotent per execution.
-- Returns NULL if nothing to refund (no prior debit, or already refunded).
CREATE OR REPLACE FUNCTION public.refund_tokens(
  p_execution_id  UUID,
  p_reason        TEXT DEFAULT 'execution_failed'
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id      UUID;
  v_debit_amount NUMERIC(20, 6);
  v_idem         TEXT := 'refund:' || p_execution_id::text;
  v_new_balance  NUMERIC(20, 6);
BEGIN
  IF EXISTS (SELECT 1 FROM token_ledger WHERE idempotency_key = v_idem) THEN
    RETURN NULL;
  END IF;

  SELECT user_id, ABS(amount)
    INTO v_user_id, v_debit_amount
  FROM token_ledger
  WHERE execution_id = p_execution_id
    AND reason = 'execution_debit'
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO token_ledger (
    user_id, amount, reason, idempotency_key, execution_id, metadata
  )
  VALUES (
    v_user_id, v_debit_amount, 'execution_refund', v_idem, p_execution_id,
    jsonb_build_object('refund_reason', p_reason)
  );

  UPDATE profiles
  SET token_balance = token_balance + v_debit_amount
  WHERE id = v_user_id
  RETURNING token_balance INTO v_new_balance;

  RETURN v_new_balance;
END;
$$;

-- monthly_topup: refill to plan floor if below; advance next_topup_at by 1 month.
-- Idempotent on the scheduled period (not the calendar month) — so a delayed cron
-- never double-grants and never skips a period due to month-boundary drift.
CREATE OR REPLACE FUNCTION public.monthly_topup(p_user_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan_id        TEXT;
  v_floor          NUMERIC(20, 6);
  v_period_marker  TIMESTAMPTZ;
  v_balance        NUMERIC(20, 6);
  v_grant          NUMERIC(20, 6);
  v_idem           TEXT;
  v_new_balance    NUMERIC(20, 6);
BEGIN
  -- Lock the subscription row so concurrent cron runs serialize on this user.
  SELECT s.plan_id, p.monthly_floor, s.next_topup_at
    INTO v_plan_id, v_floor, v_period_marker
  FROM subscriptions s
  JOIN plans p ON p.id = s.plan_id
  WHERE s.user_id = p_user_id AND s.status = 'active'
  FOR UPDATE OF s;

  IF v_floor IS NULL THEN
    RETURN NULL;
  END IF;

  -- The idempotency key is tied to the SCHEDULED date, not "now".
  -- Even if the cron runs late, the same scheduled topup gets the same key.
  v_idem := 'topup:' || p_user_id::text || ':' || to_char(v_period_marker, 'YYYY-MM-DD');

  -- Already processed this scheduled topup? Just advance and bail.
  IF EXISTS (SELECT 1 FROM token_ledger WHERE idempotency_key = v_idem) THEN
    UPDATE subscriptions
    SET next_topup_at = v_period_marker + INTERVAL '1 month',
        updated_at    = NOW()
    WHERE user_id = p_user_id;
    SELECT token_balance INTO v_new_balance FROM profiles WHERE id = p_user_id;
    RETURN v_new_balance;
  END IF;

  SELECT token_balance INTO v_balance FROM profiles WHERE id = p_user_id FOR UPDATE;

  IF v_balance < v_floor THEN
    v_grant := v_floor - v_balance;
    INSERT INTO token_ledger (user_id, amount, reason, idempotency_key, metadata)
    VALUES (
      p_user_id, v_grant, 'monthly_topup', v_idem,
      jsonb_build_object(
        'floor', v_floor,
        'balance_before', v_balance,
        'plan', v_plan_id,
        'scheduled_for', v_period_marker
      )
    );
    UPDATE profiles
    SET token_balance = v_balance + v_grant
    WHERE id = p_user_id
    RETURNING token_balance INTO v_new_balance;
  ELSE
    v_new_balance := v_balance;
  END IF;

  UPDATE subscriptions
  SET next_topup_at = v_period_marker + INTERVAL '1 month',
      updated_at    = NOW()
  WHERE user_id = p_user_id;

  RETURN v_new_balance;
END;
$$;

-- admin_adjust_tokens: support tool. Positive to grant, negative to claw back.
-- Caller must pass an idempotency_key (UI generates a UUID per ticket).
CREATE OR REPLACE FUNCTION public.admin_adjust_tokens(
  p_target_user_id   UUID,
  p_amount           NUMERIC,
  p_admin_user_id    UUID,
  p_note             TEXT,
  p_idempotency_key  TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new_balance NUMERIC(20, 6);
BEGIN
  IF p_amount = 0 THEN
    RAISE EXCEPTION 'admin_adjust_tokens requires a nonzero amount';
  END IF;

  IF EXISTS (SELECT 1 FROM token_ledger WHERE idempotency_key = p_idempotency_key) THEN
    SELECT token_balance INTO v_new_balance FROM profiles WHERE id = p_target_user_id;
    RETURN v_new_balance;
  END IF;

  -- Atomic update; for negative amounts, refuse if it would drive balance below 0.
  UPDATE profiles
  SET token_balance = token_balance + p_amount
  WHERE id = p_target_user_id
    AND (p_amount > 0 OR token_balance + p_amount >= 0)
  RETURNING token_balance INTO v_new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSUFFICIENT_TOKENS' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO token_ledger (user_id, amount, reason, idempotency_key, metadata)
  VALUES (
    p_target_user_id, p_amount, 'admin_adjustment', p_idempotency_key,
    jsonb_build_object(
      'admin_user_id', p_admin_user_id,
      'note', p_note
    )
  );

  RETURN v_new_balance;
END;
$$;

-- Lock down RPC access — only service_role can execute these.
REVOKE ALL ON FUNCTION public.credit_tokens(UUID, NUMERIC, TEXT, TEXT, UUID, TEXT, JSONB)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.debit_tokens(UUID, NUMERIC, TEXT, TEXT, UUID, JSONB)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_tokens(UUID, TEXT)                                          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.monthly_topup(UUID)                                                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_adjust_tokens(UUID, NUMERIC, UUID, TEXT, TEXT)               FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.credit_tokens(UUID, NUMERIC, TEXT, TEXT, UUID, TEXT, JSONB)     TO service_role;
GRANT EXECUTE ON FUNCTION public.debit_tokens(UUID, NUMERIC, TEXT, TEXT, UUID, JSONB)            TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_tokens(UUID, TEXT)                                       TO service_role;
GRANT EXECUTE ON FUNCTION public.monthly_topup(UUID)                                             TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_adjust_tokens(UUID, NUMERIC, UUID, TEXT, TEXT)            TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Extend handle_new_user() to seed subscription + signup bonus
--    Replaces the version from supabase_setup.sql; keeps the original profile insert.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_signup_bonus NUMERIC(20, 6);
BEGIN
  INSERT INTO public.profiles (id, preferences)
  VALUES (NEW.id, '{}'::jsonb)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.subscriptions (user_id, plan_id, status, next_topup_at)
  VALUES (NEW.id, 'free', 'active', NOW() + INTERVAL '1 month')
  ON CONFLICT (user_id) DO NOTHING;

  SELECT signup_bonus INTO v_signup_bonus FROM public.plans WHERE id = 'free';

  IF v_signup_bonus IS NOT NULL AND v_signup_bonus > 0 THEN
    PERFORM public.credit_tokens(
      NEW.id,
      v_signup_bonus,
      'signup_bonus',
      'signup:' || NEW.id::text,
      NULL,
      NULL,
      jsonb_build_object('plan', 'free')
    );
  END IF;

  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Backfill existing users
--    Give every existing auth.users row a free subscription + 200-credit bonus.
--    Idempotent: signup_bonus key is per-user, ON CONFLICT keeps it safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.profiles (id, preferences)
SELECT u.id, '{}'::jsonb
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL;

INSERT INTO public.subscriptions (user_id, plan_id, status, next_topup_at)
SELECT u.id, 'free', 'active', NOW() + INTERVAL '1 month'
FROM auth.users u
LEFT JOIN public.subscriptions s ON s.user_id = u.id
WHERE s.user_id IS NULL;

DO $$
DECLARE
  v_bonus NUMERIC(20, 6);
  v_user RECORD;
BEGIN
  SELECT signup_bonus INTO v_bonus FROM public.plans WHERE id = 'free';
  IF v_bonus IS NULL OR v_bonus <= 0 THEN RETURN; END IF;

  FOR v_user IN SELECT id FROM auth.users LOOP
    PERFORM public.credit_tokens(
      v_user.id,
      v_bonus,
      'signup_bonus',
      'signup:' || v_user.id::text,
      NULL, NULL,
      jsonb_build_object('plan', 'free', 'backfill', true)
    );
  END LOOP;
END $$;
