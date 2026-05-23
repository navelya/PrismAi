# Free-monthly expiry + top-up tracking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make free-plan monthly credits expire each cycle (purchased packs preserved, paid monthly accumulates) by adding a real, ledger-audited `topup_balance` bucket and monthly-first consumption.

**Architecture:** One new `profiles.topup_balance` column (+ `topup_baseline` audit anchor); `token_balance` keeps its meaning so existing readers are untouched. Every credits RPC maintains `topup_balance` and records `metadata.topup_delta` so the append-only ledger stays the source of truth for both balances. `monthly_topup` becomes free-only (reset to floor, preserve top-up); paid grants stay Paddle-driven.

**Tech Stack:** Postgres (Supabase migrations, plpgsql RPCs), Next.js API routes (TypeScript).

**Money-critical constraints:**
- The implementing agent **cannot apply migrations** (no DB access). Tasks 1–5 write SQL into one migration file; **Task 10 is a human handoff** to apply it on a **dev** database and run the verification scenarios before prod.
- TS tasks verify with `npx tsc --noEmit` (the reliable check here — `lint`/`build` are flaky per repo notes).
- All work stays on `main` (no branch), per the user's instruction.

## File map

- **Create:** `supabase/migrations/20260523_topup_balance_and_free_expiry.sql` — schema + all RPC re-creations + audit RPC (Tasks 1–5, one file built up in order).
- **Modify:** `app/api/cron/topup/route.ts` — free-only filter (Task 6).
- **Modify:** `app/api/webhooks/paddle/route.ts` — `handleSubscriptionCanceled` sets `next_topup_at` (Task 7).
- **Modify:** `app/api/billing/credit-breakdown/route.ts` — read `topup_balance` directly (Task 8).
- **Modify:** `app/api/cron/reconcile/route.ts` — call `audit_topup_drift` + alert (Task 9).

Reference: [spec](../specs/2026-05-23-free-monthly-expiry-and-topup-tracking-design.md).

---

### Task 1: Migration — schema, backfill, ledger reason, tamper trigger

**Files:** Create `supabase/migrations/20260523_topup_balance_and_free_expiry.sql`

- [ ] **Step 1: Create the migration file with the schema block**

```sql
-- Migration: Free-monthly expiry + top-up tracking
-- Date: 2026-05-23
-- See docs/superpowers/specs/2026-05-23-free-monthly-expiry-and-topup-tracking-design.md
-- Adds profiles.topup_balance (purchased, never-expiring) + topup_baseline (audit
-- anchor); rewrites the credits RPCs for monthly-first consumption and free resets;
-- every row records metadata.topup_delta so topup_balance is ledger-auditable.

-- ── 1. Columns ────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS topup_balance  NUMERIC(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS topup_baseline NUMERIC(20,6) NOT NULL DEFAULT 0;

-- ── 2. One-time backfill (correct only because no reset has happened yet) ───────
UPDATE public.profiles p
SET topup_balance = LEAST(
    GREATEST(p.token_balance, 0),
    COALESCE((
      SELECT SUM(l.amount) FROM public.token_ledger l
      WHERE l.user_id = p.id AND l.reason IN ('paddle_pack_purchase','purchase')
    ), 0)
);
-- Separate statement: a single UPDATE's `topup_baseline = topup_balance` would read
-- the OLD value (0). Copy AFTER topup_balance is set.
UPDATE public.profiles SET topup_baseline = topup_balance;

-- ── 3. New ledger reason for the free reset (amount may be negative = expiry) ───
ALTER TABLE public.token_ledger DROP CONSTRAINT IF EXISTS token_ledger_reason_valid;
ALTER TABLE public.token_ledger ADD CONSTRAINT token_ledger_reason_valid CHECK (reason IN (
  'signup_bonus','monthly_topup','monthly_reset','execution_debit','execution_refund',
  'purchase','subscription_grant','admin_adjustment','stripe_refund','stripe_chargeback',
  'paddle_pack_purchase','paddle_subscription_grant','paddle_refund','paddle_chargeback'
));

-- ── 4. Extend the tamper-proof trigger to also guard topup_balance ─────────────
CREATE OR REPLACE FUNCTION public.prevent_token_balance_tampering()
RETURNS TRIGGER AS $$
BEGIN
  IF auth.role() = 'service_role' OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND (NEW.token_balance IS DISTINCT FROM 0 OR NEW.topup_balance IS DISTINCT FROM 0) THEN
    RAISE EXCEPTION 'Permission denied: token/topup balance can only be modified by the credits RPCs.';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.token_balance IS DISTINCT FROM OLD.token_balance
                           OR NEW.topup_balance IS DISTINCT FROM OLD.topup_balance) THEN
    RAISE EXCEPTION 'Permission denied: token/topup balance can only be modified by the credits RPCs.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- (Trigger profiles_prevent_token_balance_tampering already bound to this function.)
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260523_topup_balance_and_free_expiry.sql
git commit -m "feat(billing): topup_balance schema + backfill + tamper guard (migration WIP)"
```

---

### Task 2: Migration — `debit_tokens` (monthly-first) + `refund_tokens`

**Files:** Append to `supabase/migrations/20260523_topup_balance_and_free_expiry.sql`

- [ ] **Step 1: Append `debit_tokens`**

```sql
-- ── 5. debit_tokens — consume monthly first, record topup_spent + topup_delta ──
CREATE OR REPLACE FUNCTION public.debit_tokens(
  p_user_id UUID, p_amount NUMERIC, p_reason TEXT, p_idempotency_key TEXT,
  p_execution_id UUID DEFAULT NULL, p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_bal NUMERIC(20,6); v_topup NUMERIC(20,6); v_monthly NUMERIC(20,6); v_topup_spent NUMERIC(20,6);
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'debit_tokens requires a positive amount, got %', p_amount; END IF;
  IF EXISTS (SELECT 1 FROM token_ledger WHERE idempotency_key = p_idempotency_key) THEN
    SELECT token_balance INTO v_bal FROM profiles WHERE id = p_user_id;
    RETURN v_bal;
  END IF;
  SELECT token_balance, topup_balance INTO v_bal, v_topup FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF v_bal IS NULL THEN RAISE EXCEPTION 'debit_tokens: profile not found for user %', p_user_id; END IF;
  IF v_bal < p_amount THEN RAISE EXCEPTION 'INSUFFICIENT_TOKENS' USING ERRCODE = 'P0001'; END IF;
  v_monthly     := v_bal - v_topup;                 -- monthly portion
  v_topup_spent := GREATEST(0, p_amount - v_monthly); -- spills into top-up only after monthly is gone
  UPDATE profiles
     SET token_balance = v_bal   - p_amount,
         topup_balance = v_topup - v_topup_spent
   WHERE id = p_user_id;
  INSERT INTO token_ledger (user_id, amount, reason, idempotency_key, execution_id, metadata)
  VALUES (p_user_id, -p_amount, p_reason, p_idempotency_key, p_execution_id,
          p_metadata || jsonb_build_object('topup_spent', v_topup_spent, 'topup_delta', -v_topup_spent));
  RETURN v_bal - p_amount;
END; $$;
```

- [ ] **Step 2: Append `refund_tokens`**

```sql
-- ── 6. refund_tokens — restore exactly what was taken (topup from metadata) ────
CREATE OR REPLACE FUNCTION public.refund_tokens(
  p_execution_id UUID, p_reason TEXT DEFAULT 'execution_failed'
) RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_user_id UUID; v_debit_amount NUMERIC(20,6); v_topup_spent NUMERIC(20,6);
  v_idem TEXT := 'refund:' || p_execution_id::text;
  v_bal NUMERIC(20,6); v_topup NUMERIC(20,6);
  v_new_balance NUMERIC(20,6); v_new_topup NUMERIC(20,6); v_topup_delta NUMERIC(20,6);
BEGIN
  IF EXISTS (SELECT 1 FROM token_ledger WHERE idempotency_key = v_idem) THEN RETURN NULL; END IF;
  SELECT user_id, ABS(amount), COALESCE((metadata->>'topup_spent')::numeric, 0)
    INTO v_user_id, v_debit_amount, v_topup_spent
  FROM token_ledger WHERE execution_id = p_execution_id AND reason = 'execution_debit' LIMIT 1;
  IF v_user_id IS NULL THEN RETURN NULL; END IF;
  SELECT token_balance, topup_balance INTO v_bal, v_topup FROM profiles WHERE id = v_user_id FOR UPDATE;
  v_new_balance := v_bal + v_debit_amount;
  v_new_topup   := LEAST(GREATEST(0, v_new_balance), v_topup + v_topup_spent);
  v_topup_delta := v_new_topup - v_topup;  -- effective change after clamp
  INSERT INTO token_ledger (user_id, amount, reason, idempotency_key, execution_id, metadata)
  VALUES (v_user_id, v_debit_amount, 'execution_refund', v_idem, p_execution_id,
          jsonb_build_object('refund_reason', p_reason, 'topup_delta', v_topup_delta));
  UPDATE profiles SET token_balance = v_new_balance, topup_balance = v_new_topup WHERE id = v_user_id;
  RETURN v_new_balance;
END; $$;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260523_topup_balance_and_free_expiry.sql
git commit -m "feat(billing): monthly-first debit_tokens + topup-aware refund_tokens"
```

---

### Task 3: Migration — `credit_tokens` + `monthly_topup`

**Files:** Append to `supabase/migrations/20260523_topup_balance_and_free_expiry.sql`

- [ ] **Step 1: Append `credit_tokens` (route packs to top-up)**

```sql
-- ── 7. credit_tokens — pack grants land in top-up; others are monthly ──────────
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
  v_topup_delta := CASE WHEN p_reason IN ('paddle_pack_purchase','purchase') THEN p_amount ELSE 0 END;
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
```

- [ ] **Step 2: Append `monthly_topup` (free-only reset)**

```sql
-- ── 8. monthly_topup — free: reset monthly to floor, preserve top-up; paid: no-op
CREATE OR REPLACE FUNCTION public.monthly_topup(p_user_id UUID)
RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_plan_id TEXT; v_floor NUMERIC(20,6); v_period TIMESTAMPTZ;
  v_bal NUMERIC(20,6); v_topup NUMERIC(20,6); v_target NUMERIC(20,6); v_delta NUMERIC(20,6);
  v_idem TEXT; v_new_balance NUMERIC(20,6);
BEGIN
  SELECT s.plan_id, p.monthly_floor, s.next_topup_at INTO v_plan_id, v_floor, v_period
  FROM subscriptions s JOIN plans p ON p.id = s.plan_id
  WHERE s.user_id = p_user_id AND s.status = 'active' FOR UPDATE OF s;
  IF v_floor IS NULL THEN RETURN NULL; END IF;

  IF v_plan_id <> 'free' THEN
    -- Paid: grants come from Paddle; next_topup_at is owned by the subscription
    -- upsert. Do nothing (defensive; the cron only selects free users). Do NOT
    -- advance next_topup_at or we'd drift from Paddle's renewal schedule.
    SELECT token_balance INTO v_new_balance FROM profiles WHERE id = p_user_id;
    RETURN v_new_balance;
  END IF;

  v_idem := 'topup:' || p_user_id::text || ':' || to_char(v_period, 'YYYY-MM-DD');
  IF EXISTS (SELECT 1 FROM token_ledger WHERE idempotency_key = v_idem) THEN
    UPDATE subscriptions SET next_topup_at = v_period + INTERVAL '1 month', updated_at = NOW()
      WHERE user_id = p_user_id;
    SELECT token_balance INTO v_new_balance FROM profiles WHERE id = p_user_id;
    RETURN v_new_balance;
  END IF;

  SELECT token_balance, topup_balance INTO v_bal, v_topup FROM profiles WHERE id = p_user_id FOR UPDATE;
  v_target := v_topup + v_floor;   -- preserve packs + fresh free allowance
  v_delta  := v_target - v_bal;    -- <0 expires excess, >0 tops up
  IF v_delta <> 0 THEN
    INSERT INTO token_ledger (user_id, amount, reason, idempotency_key, metadata)
    VALUES (p_user_id, v_delta, 'monthly_reset', v_idem,
            jsonb_build_object('floor', v_floor, 'balance_before', v_bal,
                               'topup_preserved', v_topup, 'plan', 'free', 'topup_delta', 0));
    UPDATE profiles SET token_balance = v_target WHERE id = p_user_id;  -- topup_balance unchanged
  END IF;
  UPDATE subscriptions SET next_topup_at = v_period + INTERVAL '1 month', updated_at = NOW()
    WHERE user_id = p_user_id;
  RETURN v_target;
END; $$;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260523_topup_balance_and_free_expiry.sql
git commit -m "feat(billing): pack-aware credit_tokens + free-only monthly_topup reset"
```

---

### Task 4: Migration — `admin_adjust_tokens` + clawbacks

**Files:** Append to `supabase/migrations/20260523_topup_balance_and_free_expiry.sql`

- [ ] **Step 1: Append `admin_adjust_tokens`**

```sql
-- ── 9. admin_adjust_tokens — clamp top-up to [0, balance], record effective delta
CREATE OR REPLACE FUNCTION public.admin_adjust_tokens(
  p_target_user_id UUID, p_amount NUMERIC, p_admin_user_id UUID, p_note TEXT, p_idempotency_key TEXT
) RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_bal NUMERIC(20,6); v_topup NUMERIC(20,6); v_new_bal NUMERIC(20,6);
  v_new_topup NUMERIC(20,6); v_topup_delta NUMERIC(20,6);
BEGIN
  IF p_amount = 0 THEN RAISE EXCEPTION 'admin_adjust_tokens requires a nonzero amount'; END IF;
  IF EXISTS (SELECT 1 FROM token_ledger WHERE idempotency_key = p_idempotency_key) THEN
    SELECT token_balance INTO v_bal FROM profiles WHERE id = p_target_user_id;
    RETURN v_bal;
  END IF;
  SELECT token_balance, topup_balance INTO v_bal, v_topup FROM profiles WHERE id = p_target_user_id FOR UPDATE;
  IF v_bal IS NULL THEN RAISE EXCEPTION 'admin_adjust_tokens: profile not found for user %', p_target_user_id; END IF;
  v_new_bal := v_bal + p_amount;
  IF p_amount < 0 AND v_new_bal < 0 THEN RAISE EXCEPTION 'INSUFFICIENT_TOKENS' USING ERRCODE = 'P0001'; END IF;
  v_new_topup   := LEAST(v_topup, GREATEST(0, v_new_bal));  -- monthly-counted; only clamp
  v_topup_delta := v_new_topup - v_topup;
  UPDATE profiles SET token_balance = v_new_bal, topup_balance = v_new_topup WHERE id = p_target_user_id;
  INSERT INTO token_ledger (user_id, amount, reason, idempotency_key, metadata)
  VALUES (p_target_user_id, p_amount, 'admin_adjustment', p_idempotency_key,
          jsonb_build_object('admin_user_id', p_admin_user_id, 'note', p_note, 'topup_delta', v_topup_delta));
  RETURN v_new_bal;
END; $$;
```

- [ ] **Step 2: Append `paddle_refund_clawback` (reduce top-up if the grant was a pack)**

```sql
-- ── 10. paddle_refund_clawback — top-up-aware ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.paddle_refund_clawback(
  p_user_id UUID, p_event_id TEXT, p_original_grant_id UUID, p_idempotency_key TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_grant_amount NUMERIC(20,6); v_grant_user UUID; v_grant_reason TEXT;
  v_balance NUMERIC(20,6); v_topup NUMERIC(20,6);
  v_clawback NUMERIC(20,6); v_shortfall NUMERIC(20,6);
  v_new_balance NUMERIC(20,6); v_new_topup NUMERIC(20,6); v_topup_delta NUMERIC(20,6);
  v_reduce NUMERIC(20,6); v_enriched_meta JSONB;
BEGIN
  IF EXISTS (SELECT 1 FROM token_ledger WHERE idempotency_key = p_idempotency_key) THEN
    SELECT token_balance INTO v_new_balance FROM profiles WHERE id = p_user_id;
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'new_balance', v_new_balance);
  END IF;

  SELECT amount, user_id, reason INTO v_grant_amount, v_grant_user, v_grant_reason
  FROM token_ledger WHERE id = p_original_grant_id;
  IF v_grant_amount IS NULL THEN RAISE EXCEPTION 'paddle_refund_clawback: original grant % not found', p_original_grant_id; END IF;
  IF v_grant_user IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION 'paddle_refund_clawback: grant % belongs to a different user', p_original_grant_id; END IF;
  IF v_grant_amount <= 0 THEN RAISE EXCEPTION 'paddle_refund_clawback: grant % is not a positive grant (amount=%)', p_original_grant_id, v_grant_amount; END IF;

  SELECT token_balance, topup_balance INTO v_balance, v_topup FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF v_balance IS NULL THEN RAISE EXCEPTION 'paddle_refund_clawback: profile not found for user %', p_user_id; END IF;

  v_clawback  := LEAST(v_grant_amount, v_balance);
  v_shortfall := v_grant_amount - v_clawback;
  IF v_clawback = 0 THEN
    RETURN jsonb_build_object('ok', true, 'clawed_back', 0, 'shortfall', v_shortfall, 'new_balance', v_balance);
  END IF;

  v_new_balance := v_balance - v_clawback;
  v_reduce      := CASE WHEN v_grant_reason IN ('paddle_pack_purchase','purchase') THEN v_clawback ELSE 0 END;
  v_new_topup   := LEAST(GREATEST(0, v_topup - v_reduce), GREATEST(0, v_new_balance));
  v_topup_delta := v_new_topup - v_topup;

  v_enriched_meta := p_metadata || jsonb_build_object(
    'original_grant_id', p_original_grant_id, 'original_grant_amount', v_grant_amount,
    'shortfall', v_shortfall, 'topup_delta', v_topup_delta);

  INSERT INTO token_ledger (user_id, amount, reason, idempotency_key, paddle_event_id, stripe_event_id, metadata)
  VALUES (p_user_id, -v_clawback, 'paddle_refund', p_idempotency_key, p_event_id, p_event_id, v_enriched_meta);

  UPDATE profiles SET token_balance = v_new_balance, topup_balance = v_new_topup WHERE id = p_user_id;
  RETURN jsonb_build_object('ok', true, 'clawed_back', v_clawback, 'shortfall', v_shortfall, 'new_balance', v_new_balance);
END; $$;
```

- [ ] **Step 3: Append `paddle_chargeback_clawback`**

```sql
-- ── 11. paddle_chargeback_clawback — top-up-aware, force full clawback ─────────
CREATE OR REPLACE FUNCTION public.paddle_chargeback_clawback(
  p_user_id UUID, p_event_id TEXT, p_original_grant_id UUID, p_idempotency_key TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_grant_amount NUMERIC(20,6); v_grant_user UUID; v_grant_reason TEXT;
  v_balance NUMERIC(20,6); v_topup NUMERIC(20,6);
  v_new_balance NUMERIC(20,6); v_new_topup NUMERIC(20,6); v_topup_delta NUMERIC(20,6);
  v_reduce NUMERIC(20,6); v_went_negative BOOLEAN; v_disputed_at TIMESTAMPTZ; v_enriched_meta JSONB;
BEGIN
  IF EXISTS (SELECT 1 FROM token_ledger WHERE idempotency_key = p_idempotency_key) THEN
    SELECT token_balance, payment_disputed_at INTO v_new_balance, v_disputed_at FROM profiles WHERE id = p_user_id;
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'new_balance', v_new_balance, 'disputed_at', v_disputed_at);
  END IF;

  SELECT amount, user_id, reason INTO v_grant_amount, v_grant_user, v_grant_reason
  FROM token_ledger WHERE id = p_original_grant_id;
  IF v_grant_amount IS NULL THEN RAISE EXCEPTION 'paddle_chargeback_clawback: original grant % not found', p_original_grant_id; END IF;
  IF v_grant_user IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION 'paddle_chargeback_clawback: grant % belongs to a different user', p_original_grant_id; END IF;
  IF v_grant_amount <= 0 THEN RAISE EXCEPTION 'paddle_chargeback_clawback: grant % is not a positive grant (amount=%)', p_original_grant_id, v_grant_amount; END IF;

  SELECT token_balance, topup_balance INTO v_balance, v_topup FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF v_balance IS NULL THEN RAISE EXCEPTION 'paddle_chargeback_clawback: profile not found for user %', p_user_id; END IF;

  v_new_balance   := v_balance - v_grant_amount;
  v_went_negative := v_new_balance < 0;
  v_reduce        := CASE WHEN v_grant_reason IN ('paddle_pack_purchase','purchase') THEN v_grant_amount ELSE 0 END;
  v_new_topup     := LEAST(GREATEST(0, v_topup - v_reduce), GREATEST(0, v_new_balance));
  v_topup_delta   := v_new_topup - v_topup;

  v_enriched_meta := p_metadata || jsonb_build_object(
    'original_grant_id', p_original_grant_id, 'original_grant_amount', v_grant_amount,
    'balance_before', v_balance, 'went_negative', v_went_negative, 'topup_delta', v_topup_delta);

  INSERT INTO token_ledger (user_id, amount, reason, idempotency_key, paddle_event_id, stripe_event_id, metadata)
  VALUES (p_user_id, -v_grant_amount, 'paddle_chargeback', p_idempotency_key, p_event_id, p_event_id, v_enriched_meta);

  UPDATE profiles
     SET token_balance = v_new_balance, topup_balance = v_new_topup,
         payment_disputed_at = COALESCE(payment_disputed_at, NOW())
   WHERE id = p_user_id
   RETURNING payment_disputed_at INTO v_disputed_at;
  RETURN jsonb_build_object('ok', true, 'clawed_back', v_grant_amount, 'went_negative', v_went_negative,
                            'new_balance', v_new_balance, 'disputed_at', v_disputed_at);
END; $$;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260523_topup_balance_and_free_expiry.sql
git commit -m "feat(billing): top-up-aware admin_adjust + refund/chargeback clawbacks"
```

---

### Task 5: Migration — `audit_topup_drift` RPC

**Files:** Append to `supabase/migrations/20260523_topup_balance_and_free_expiry.sql`

- [ ] **Step 1: Append the audit RPC + grants**

```sql
-- ── 12. audit_topup_drift — reconstruct topup_balance from baseline + Σ topup_delta
--   Surfaces (a) invariant violations (topup outside [0, max(0,balance)]) and
--   (b) drift between the cached topup_balance and its ledger reconstruction.
CREATE OR REPLACE FUNCTION public.audit_topup_drift()
RETURNS TABLE (user_id UUID, topup_balance NUMERIC, expected NUMERIC, drift NUMERIC, invariant_ok BOOLEAN)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT
    p.id,
    p.topup_balance,
    p.topup_baseline + COALESCE((
      SELECT SUM(COALESCE((l.metadata->>'topup_delta')::numeric, 0))
      FROM token_ledger l WHERE l.user_id = p.id
    ), 0) AS expected,
    p.topup_balance - (p.topup_baseline + COALESCE((
      SELECT SUM(COALESCE((l.metadata->>'topup_delta')::numeric, 0))
      FROM token_ledger l WHERE l.user_id = p.id
    ), 0)) AS drift,
    (p.topup_balance >= 0 AND p.topup_balance <= GREATEST(0, p.token_balance)) AS invariant_ok
  FROM profiles p
  WHERE
    p.topup_balance <> (p.topup_baseline + COALESCE((
      SELECT SUM(COALESCE((l.metadata->>'topup_delta')::numeric, 0))
      FROM token_ledger l WHERE l.user_id = p.id
    ), 0))
    OR NOT (p.topup_balance >= 0 AND p.topup_balance <= GREATEST(0, p.token_balance));
$$;

REVOKE ALL ON FUNCTION public.audit_topup_drift() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_topup_drift() TO service_role;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260523_topup_balance_and_free_expiry.sql
git commit -m "feat(billing): audit_topup_drift RPC for ledger-based topup reconciliation"
```

---

### Task 6: Topup cron — free-only

**Files:** Modify `app/api/cron/topup/route.ts` (the `.from('subscriptions').select(...)` query, ~lines 29–34)

- [ ] **Step 1: Add the plan filter**

Add `.eq('plan_id', 'free')` to the query so only free users are processed (paid is Paddle-driven):

```typescript
        const { data: due, error: fetchError } = await supabase
            .from('subscriptions')
            .select('user_id, plan_id, next_topup_at')
            .eq('status', 'active')
            .eq('plan_id', 'free')
            .lte('next_topup_at', new Date().toISOString())
            .limit(BATCH_LIMIT);
```

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit` → expect EXIT 0.
```bash
git add app/api/cron/topup/route.ts
git commit -m "feat(billing): topup cron processes free plan only (paid is Paddle-driven)"
```

---

### Task 7: Cancellation sets a clean free cycle

**Files:** Modify `app/api/webhooks/paddle/route.ts` (`handleSubscriptionCanceled`, the `.update({...})` at ~lines 168–177)

- [ ] **Step 1: Add `next_topup_at` to the downgrade update**

```typescript
        .update({
            plan_id: 'free',
            status: 'active',
            cancel_at_period_end: false,
            current_period_end: null,
            next_topup_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            paddle_subscription_id: null,
            paddle_price_id: null,
            billing_cycle: null,
            updated_at: new Date().toISOString(),
        })
```

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit` → expect EXIT 0.
```bash
git add app/api/webhooks/paddle/route.ts
git commit -m "feat(billing): start a clean free cycle on subscription cancel (next_topup_at)"
```

---

### Task 8: Breakdown endpoint reads `topup_balance` directly

**Files:** Modify `app/api/billing/credit-breakdown/route.ts` (full rewrite of the handler body)

- [ ] **Step 1: Replace the ledger-sum derivation with a direct read**

```typescript
import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';

/**
 * GET /api/billing/credit-breakdown — split the balance into monthly (plan-origin)
 * vs top-up (purchased). Now reads the authoritative profiles.topup_balance column
 * (maintained by the credits RPCs); monthly is the remainder. The earlier ledger
 * derivation was removed because it breaks once free resets occur.
 */
export async function GET() {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;

    const { data: profile } = await supabase
        .from('profiles')
        .select('token_balance, topup_balance')
        .eq('id', user.id)
        .single();

    const balance = Number(profile?.token_balance ?? 0);
    const topupRaw = Number(profile?.topup_balance ?? 0);
    const safeBalance = Math.max(0, balance);
    const topup = Math.max(0, Math.min(safeBalance, topupRaw));
    const monthly = Math.max(0, safeBalance - topup);

    return NextResponse.json({ balance, monthly, topup });
}
```

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit` → expect EXIT 0.
```bash
git add app/api/billing/credit-breakdown/route.ts
git commit -m "feat(billing): credit-breakdown reads authoritative topup_balance column"
```

---

### Task 9: Reconcile cron audits top-up drift

**Files:** Modify `app/api/cron/reconcile/route.ts` (after the existing `audit_balance_drift` block, ~lines 58–88)

- [ ] **Step 1: Add the `audit_topup_drift` call + alert, mirroring the balance-drift block**

After the existing balance-drift handling, add:

```typescript
        // ── (3) Top-up bucket drift audit ─────────────────────────────────────
        const { data: topupDrifts, error: topupDriftError } = await supabase
            .rpc('audit_topup_drift');

        if (topupDriftError) {
            console.error('[Cron/Reconcile] audit_topup_drift failed:', topupDriftError);
        }

        const topupDriftCount = topupDrifts?.length ?? 0;
        if (topupDriftCount > 0) {
            console.error(
                `[Cron/Reconcile] 🚨 TOPUP DRIFT detected for ${topupDriftCount} user(s):`,
                JSON.stringify(topupDrifts, null, 2)
            );
        }
```

Then include `topupDriftCount` and `topupDrifts?.slice(0, 50) ?? []` in the JSON response object alongside the existing `driftCount`/`drifts` fields.

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit` → expect EXIT 0.
```bash
git add app/api/cron/reconcile/route.ts
git commit -m "feat(billing): reconcile cron audits topup_balance drift"
```

---

### Task 10: HUMAN HANDOFF — apply migration to a dev DB + verify

> The implementing agent stops here and hands these steps to the user. **Do not run against prod.**

- [ ] **Step 1:** Apply `supabase/migrations/20260523_topup_balance_and_free_expiry.sql` to a **dev** Supabase database.
- [ ] **Step 2:** Run each scenario, checking `token_balance`, `topup_balance`, and the new ledger row's `metadata.topup_delta`:
  1. New free user → balance 200, topup 0.
  2. Spend 150 (`debit_tokens`) → balance 50, topup 0; ledger `topup_spent`=0, `topup_delta`=0.
  3. Grant a 400 pack (`credit_tokens` reason `paddle_pack_purchase`) → balance 450, topup 400; `topup_delta`=400.
  4. Spend 100 → balance 350, topup 350; ledger `topup_spent`=50, `topup_delta`=-50 (monthly 50 used first, then 50 from top-up).
  5. `monthly_topup` (free) → balance 450 (=350 topup + 100 floor), topup 350; `monthly_reset` row `topup_delta`=0.
  6. `refund_tokens` for the scenario-4 debit → balance +100, topup +50 restored; refund row `topup_delta`=50.
  7. Simulate a paid renewal (`credit_tokens` reason `paddle_subscription_grant`) → accumulates in monthly (topup unchanged); `monthly_topup` on a paid sub is a no-op.
  8. `paddle_chargeback_clawback` on a pack grant → topup reduced; if balance goes negative, topup clamps to 0; `topup_delta` = effective reduction.
- [ ] **Step 3:** Run `SELECT * FROM audit_balance_drift();` and `SELECT * FROM audit_topup_drift();` → both return **zero rows**.
- [ ] **Step 4:** Exercise webhook clawbacks via `scripts/simulate-paddle-adjustment.js`.
- [ ] **Step 5:** Only after dev verification passes, apply the migration to prod.

---

## Self-review

**Spec coverage:** schema+backfill+trigger (Task 1) ✓; monthly-first debit + exact refund (Task 2) ✓; pack-routing credit + free reset (Task 3) ✓; admin + clawbacks top-up sync (Task 4) ✓; audit_topup_drift (Task 5) ✓; free-only cron (Task 6) ✓; cancel→clean free cycle (Task 7) ✓; breakdown reads column (Task 8) ✓; reconcile audit wiring (Task 9) ✓; dev-DB verification (Task 10) ✓. Out-of-scope (upgrade proration tuning) correctly omitted — that's Spec 2.

**Placeholder scan:** none — every RPC body and edit is complete.

**Type/identifier consistency:** `topup_balance`, `topup_baseline`, `topup_delta`, `topup_spent` used consistently across all RPCs and the audit. `metadata.topup_delta` recorded by every write (debit, credit, refund, monthly_reset=0, admin, both clawbacks) and summed by `audit_topup_drift`. `monthly_reset` reason added to the CHECK constraint (Task 1) before it's inserted (Task 3). RPC signatures preserved verbatim from the existing definitions (so `REVOKE/GRANT` and callers are unaffected).
