# Free-monthly expiry + real top-up tracking

**Date:** 2026-05-23
**Status:** Approved design, pending implementation plan
**Scope:** Spec 1 of 2. Spec 2 (upgrade prorated-difference tuning + "paid replaces free" verification) is a separate, smaller follow-up — see "Out of scope".

## Problem

The credits system is a single fungible `profiles.token_balance`. Two consequences we want to change:

1. **Free monthly credits never expire.** `monthly_topup` only refills *up to* the plan floor; it never removes unspent credits. We want free-plan monthly credits to reset each cycle (use-it-or-lose-it), while **purchased (pack) credits are preserved** and **paid-plan monthly credits accumulate** (never expire).
2. **No real monthly-vs-top-up split.** The balance is provenance-blind, so "monthly first" consumption isn't real and the hover breakdown's derived split (`min(balance, packs)`) **breaks the moment a reset happens** (a reset raises the balance, and `min()` re-inflates the apparent top-up). Expiry therefore forces us to track the purchased portion explicitly.

## Confirmed decisions

- **Free reset:** a free user's monthly portion is set to **exactly the floor (100)** each cycle — expiring any excess, topping up if below — while preserving purchased credits.
- **Signup bonus (200):** it's "monthly" → **expires at the first reset** (after which the free monthly portion is the 100 floor).
- **Paid monthly:** **accumulates** (unspent carries over; each renewal adds a fresh full grant). Paid grants come from the Paddle webhook, not from `monthly_topup`.
- **Paid → free downgrade:** accumulated paid credits are "monthly" and **expire at the next free reset** (packs still preserved).
- **Consumption order:** **monthly first, then top-up** (now enforced in `debit_tokens`, not merely displayed).

## Accounting model: one persistent `topup_balance` column

Add a single column rather than splitting the balance, so every existing reader of `token_balance` (toolbar, `debit_tokens` sufficiency check, optimistic UI, `use-balance`) keeps working unchanged.

**Invariants:**
- `token_balance` — total spendable (meaning unchanged).
- `topup_balance` — purchased, never-expiring credits. Always clamped to `[0, max(0, token_balance)]`.
- monthly portion = `token_balance − topup_balance` (derived; drives the hover bar — now robust).

**Auditability (critical — see [reconcile cron](../../../app/api/cron/reconcile/route.ts) + `audit_balance_drift`):** the system's core money-safety invariant is `token_balance == Σ ledger.amount`, checked nightly. `topup_balance` MUST NOT escape an equivalent guarantee. Therefore **every ledger row records its effect on top-up in metadata as `topup_delta`** (0 when unchanged). Then `topup_balance` is reconstructable as `backfill_baseline + Σ(metadata.topup_delta for rows after the migration)`, and we extend the audit accordingly (below). This keeps the append-only ledger the source of truth for *both* balances.

## Schema change

Migration `supabase/migrations/<ts>_topup_balance_and_free_expiry.sql`:

```sql
-- 1. New tracked column + an immutable audit anchor captured at migration time.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS topup_balance  NUMERIC(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS topup_baseline NUMERIC(20,6) NOT NULL DEFAULT 0;

-- 2. One-time backfill. Correct *now* because no resets have ever happened:
--    purchased-remaining == min(current balance, gross packs ever bought).
--    topup_baseline freezes this value so audit_topup_drift can reconstruct
--    topup_balance as baseline + Σ(post-migration topup_delta).
UPDATE public.profiles p
SET topup_balance = LEAST(
    GREATEST(p.token_balance, 0),
    COALESCE((
      SELECT SUM(l.amount) FROM public.token_ledger l
      WHERE l.user_id = p.id AND l.reason IN ('paddle_pack_purchase','purchase')
    ), 0)
);
-- Second statement: in a single UPDATE, `topup_baseline = topup_balance` would
-- read the OLD value (0). So copy AFTER topup_balance is set.
UPDATE public.profiles SET topup_baseline = topup_balance;

-- 3. New ledger reason for the free reset (records expiry, may be negative).
ALTER TABLE public.token_ledger DROP CONSTRAINT IF EXISTS token_ledger_reason_valid;
ALTER TABLE public.token_ledger ADD CONSTRAINT token_ledger_reason_valid CHECK (reason IN (
  'signup_bonus','monthly_topup','monthly_reset','execution_debit','execution_refund',
  'purchase','subscription_grant','admin_adjustment','stripe_refund','stripe_chargeback',
  'paddle_pack_purchase','paddle_subscription_grant','paddle_refund','paddle_chargeback'
));

-- 4. Extend the tamper-proof trigger to also protect topup_balance (service-role only).
--    (Re-create prevent_token_balance_tampering to reject client UPDATEs that change
--     topup_balance, mirroring the existing token_balance guard.)
```

The tamper trigger ([20260505_credits_system.sql](../../../supabase/migrations/20260505_credits_system.sql)) must be re-created to also block client changes to `topup_balance`.

## RPC changes

All in a new migration; SECURITY DEFINER, service-role only, as today.

### `debit_tokens` — monthly-first, records `topup_spent`
Replace the conditional decrement with a locked read + split:
```sql
SELECT token_balance, topup_balance INTO v_bal, v_topup
  FROM profiles WHERE id = p_user_id FOR UPDATE;
IF v_bal < p_amount THEN RAISE EXCEPTION 'INSUFFICIENT_TOKENS' USING ERRCODE='P0001'; END IF;
v_monthly     := v_bal - v_topup;                 -- monthly portion
v_topup_spent := GREATEST(0, p_amount - v_monthly); -- only spills into top-up after monthly is gone
UPDATE profiles
   SET token_balance = v_bal   - p_amount,
       topup_balance = v_topup - v_topup_spent
 WHERE id = p_user_id;
-- ledger: amount = -p_amount, metadata gains topup_spent (for exact refunds)
--         AND topup_delta = -v_topup_spent (for the audit).
```
Idempotency guard (return current balance if key already present) is unchanged.

### `refund_tokens` — restore exactly what was taken
Read the original debit's `metadata->>'topup_spent'` and restore it to `topup_balance`:
```sql
SELECT user_id, ABS(amount), COALESCE((metadata->>'topup_spent')::numeric, 0)
  INTO v_user, v_amt, v_topup_restore
FROM token_ledger WHERE execution_id = p_execution_id AND reason = 'execution_debit' LIMIT 1;
...
UPDATE profiles
   SET token_balance = token_balance + v_amt,
       topup_balance = LEAST(token_balance + v_amt, topup_balance + v_topup_restore)
 WHERE id = v_user;
-- refund ledger row records topup_delta = the EFFECTIVE change applied
-- (after the LEAST clamp), so the audit reconstruction stays exact.
```
(Cross-migration note: debits recorded *before* this migration have no `topup_spent` metadata, so a later refund of such a debit restores `v_topup_restore = 0` — the whole refund lands in the monthly portion. This is acceptable: pre-migration top-up wasn't tracked, and most refunds occur within the same execution lifecycle, well after this change ships.)

### `credit_tokens` — route pack grants into top-up
Reason-based, so no caller signature changes:
```sql
UPDATE profiles
   SET token_balance = token_balance + p_amount,
       topup_balance = topup_balance
         + CASE WHEN p_reason IN ('paddle_pack_purchase','purchase') THEN p_amount ELSE 0 END
 WHERE id = p_user_id;
-- ledger metadata gains topup_delta = (pack ? p_amount : 0).
```
Signup bonus, monthly_topup, and subscription grants leave `topup_balance` untouched (they're monthly, `topup_delta = 0`) — so the signup bonus correctly expires at first reset, and paid grants accumulate in the monthly portion.

### `monthly_topup` — free resets, paid no-ops
```sql
-- lock subscription, get plan_id, monthly_floor, next_topup_at
IF v_plan_id <> 'free' THEN
    -- Paid: grants come from the Paddle webhook, and next_topup_at is owned by
    -- the subscription upsert (= current_period_end). Do nothing — this branch
    -- is purely defensive; the cron query (below) only selects free users, so a
    -- paid user is never passed here. Crucially do NOT advance next_topup_at, or
    -- we'd drift from Paddle's real renewal schedule.
    SELECT token_balance INTO v_bal FROM profiles WHERE id = p_user_id;
    RETURN v_bal;
END IF;

-- Free: reset the monthly portion to exactly the floor, preserve top-up.
v_idem := 'topup:' || p_user_id || ':' || to_char(v_period, 'YYYY-MM-DD');
IF EXISTS (SELECT 1 FROM token_ledger WHERE idempotency_key = v_idem) THEN
   <advance next_topup_at; return current balance>;
END IF;
SELECT token_balance, topup_balance INTO v_bal, v_topup FROM profiles WHERE id = p_user_id FOR UPDATE;
v_target := v_topup + v_floor;          -- preserve packs + fresh free allowance
v_delta  := v_target - v_bal;           -- <0 expires excess, >0 tops up
IF v_delta <> 0 THEN
   INSERT INTO token_ledger (user_id, amount, reason, idempotency_key, metadata)
   VALUES (p_user_id, v_delta, 'monthly_reset', v_idem,
           jsonb_build_object('floor', v_floor, 'balance_before', v_bal,
                              'topup_preserved', v_topup, 'plan', 'free',
                              'topup_delta', 0));   -- reset never touches top-up
   UPDATE profiles SET token_balance = v_target WHERE id = p_user_id;  -- topup_balance unchanged
END IF;
<advance next_topup_at by 1 month>;
RETURN v_target;
```

**Topup cron query gains a plan filter.** [`app/api/cron/topup/route.ts`](../../../app/api/cron/topup/route.ts) currently selects all active subs due for top-up; add `.eq('plan_id', 'free')` so only free users are processed (paid is Paddle-driven). The `monthly_topup` paid no-op above is then pure defense-in-depth.

**Cancellation sets a clean free cycle.** [`handleSubscriptionCanceled`](../../../app/api/webhooks/paddle/route.ts) already reverts the row to `plan_id='free', status='active'`. Add `next_topup_at = NOW() + INTERVAL '1 month'` to that update so a downgraded user's accumulated paid credits expire ~one month after downgrade (a clean free cycle) rather than at a stale far-future yearly period-end (or immediately).
(Known pre-existing edge, unchanged by us: if `v_delta = 0` no ledger row is written, so a *duplicate same-day* cron call could advance `next_topup_at` twice. The cron runs daily and re-selects only `next_topup_at <= now`, so this is not reachable in practice. Documented, not fixed here.)

**Behavior change to flag:** today `monthly_topup` refills *paid* users up to their plan floor too, acting as a safety net if a Paddle renewal grant is late/missing. Making it a no-op for paid removes that net — paid credits now come **only** from Paddle. This is intended (don't hand paid users free floor credits), but it means a missed renewal webhook is no longer silently papered over; it surfaces as the user simply not receiving credits until the webhook lands. Acceptable given Paddle webhook reliability + the reconcile cron.

### Clawbacks — keep top-up in sync
`paddle_refund_clawback` / `paddle_chargeback_clawback`: when the clawed grant's reason is a pack (`paddle_pack_purchase`/`purchase`), also reduce `topup_balance` by the clawed amount. After every clawback, enforce the invariant `topup_balance := LEAST(topup_balance, GREATEST(0, token_balance))` (chargebacks can drive `token_balance` negative → top-up clamps to 0). The clawback ledger row records `topup_delta` = the actual change applied to `topup_balance` (which, after clamping, may differ from the naive amount — record the *effective* delta so the audit stays exact).

### `admin_adjust_tokens` — clamp only
Leaves `topup_balance` untouched (admin grants/clawbacks count as monthly), then clamps `topup_balance := LEAST(topup_balance, GREATEST(0, token_balance))` so a large negative adjustment can't leave top-up above the total. Ledger `topup_delta` = the effective change from clamping (0 in the normal case).

## Auditability & monitoring

The reconcile cron's existing `audit_balance_drift` (which checks `token_balance == Σ ledger.amount`) is unaffected — `monthly_reset` rows carry real `amount`s, so that invariant still holds. We add a parallel guarantee for `topup_balance`:

1. **Every credit RPC records `metadata.topup_delta`** = its effect on `topup_balance` (0 when none). The list above specifies the value per RPC. This makes `topup_balance` ledger-derived going forward: `expected = backfill_baseline + Σ(topup_delta for rows created after the migration)`.
2. **New `audit_topup_drift` RPC + reconcile-cron check.** Two layers:
   - *Cheap invariant* (always): every row must satisfy `0 ≤ topup_balance ≤ GREATEST(0, token_balance)`. A violation is a hard bug.
   - *Exact reconstruction*: `topup_balance == topup_baseline + Σ COALESCE((metadata->>'topup_delta')::numeric, 0)` over **all** the user's ledger rows. No timestamp filter is needed: pre-migration rows have no `topup_delta` key (→ 0) and are already accounted for in `topup_baseline`; every post-migration row carries an effective `topup_delta`. `topup_baseline` is the `profiles` column frozen by the backfill.
   - Wire `audit_topup_drift` into [reconcile/route.ts](../../../app/api/cron/reconcile/route.ts) alongside `audit_balance_drift`, alerting on any drift.

   (If the exact-reconstruction layer proves heavy, ship the cheap invariant check in Spec 1 and treat exact reconstruction as a fast follow — but the `topup_delta` metadata MUST be recorded from day one so the history exists.)

## UI / API

- **`/api/billing/credit-breakdown`** ([route](../../../app/api/billing/credit-breakdown/route.ts)) now reads `topup_balance` directly: `topup = topup_balance`, `monthly = max(0, token_balance − topup_balance)`. Delete the fragile ledger-sum derivation. The hover bar ([CreditsBreakdownPanel](../../../components/billing/CreditsBreakdownPanel.tsx)) is unchanged — it just receives correct numbers.
- **`use-balance` / optimistic UI / toolbar:** unchanged (they read `token_balance`).

## Edge cases

- **Negative balance (chargeback):** `topup_balance` clamps to 0; monthly portion = `max(0, token_balance − topup_balance)` clamps to 0 for display.
- **Backfill correctness:** valid only because it runs before any reset has occurred; afterwards `topup_balance` is maintained incrementally.
- **Downgrade paid→free:** no special handling needed — accumulated paid credits are part of the monthly portion and the next free reset sets monthly to the floor (expiring them), packs preserved. Matches the decision.
- **Reset idempotency:** keyed by scheduled date (`topup:user:YYYY-MM-DD`), unchanged.

## Out of scope (Spec 2)

- **Upgrade prorated-difference tuning.** Mid-cycle upgrades should grant `(newCredits − oldCredits) × remaining_fraction`. Today's `computePeriodGrantCap` grants `min(newCredits × rate, maxCredits − alreadyGranted)`, which converges early-cycle but diverges mid/late-cycle. Tuning this (and confirming "paid replaces free") is a separate, smaller spec — it changes *how much* is granted, not *which bucket*, so it composes cleanly on top of this one.

## Verification

No test runner exists (per CLAUDE.md). Verify with:
- `npx tsc --noEmit` for the TS touchpoints (breakdown route).
- Ad-hoc SQL scenarios against a **dev** database (do NOT run against prod), each checking `token_balance` + `topup_balance` + the ledger row:
  1. New free user: balance 200, topup 0.
  2. Spend 150 → balance 50, topup 0 (monthly-first).
  3. Buy 400 pack → balance 450, topup 400.
  4. Spend 100 → balance 350, topup 400→… (monthly 50 first, then 50 from topup → topup 350). Verify monthly-first split + `topup_spent` metadata.
  5. Free reset → balance = topup(350) + 100 = 450, topup 350 (packs preserved, monthly reset to 100). Confirm a 4th-scenario reset where monthly was below 100 tops up; where above, expires.
  6. Refund the scenario-4 debit → balance and topup restored exactly (topup += recorded topup_spent).
  7. Paid user renewal grant (simulate `paddle_subscription_grant` via `credit_tokens`) accumulates in monthly; reset is a no-op for paid.
  8. Chargeback of a pack → topup reduced; if balance goes negative, topup clamps to 0.
- The existing `scripts/simulate-paddle-adjustment.js` harness for webhook clawback paths.
