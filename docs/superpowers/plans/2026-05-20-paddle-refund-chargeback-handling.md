# Paddle Refund & Chargeback Handling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Paddle webhook handling for refunds and chargebacks. Auto-clawback granted credits, flag disputed accounts, alert admin via email.

**Architecture:** Three layers matching the existing Paddle-credits pattern. DB migration adds `payment_disputed_at` column, drops the `>= 0` CHECK on `profiles.token_balance`, and creates two SECURITY DEFINER RPCs (`paddle_refund_clawback`, `paddle_chargeback_clawback`). Webhook gains a single `adjustment.created` switch branch that routes to per-action handlers in [app/api/webhooks/paddle/route.ts](../../../app/api/webhooks/paddle/route.ts). Admin alerts use a thin Resend wrapper.

**Tech Stack:** Next.js 14 App Router, Supabase Postgres + PL/pgSQL RPCs, `@paddle/paddle-node-sdk`, `resend` (new), TypeScript.

**Spec:** [2026-05-20-paddle-refund-chargeback-handling-design.md](../specs/2026-05-20-paddle-refund-chargeback-handling-design.md)

**Repo verification convention:** No test runner exists ([CLAUDE.md](../../../CLAUDE.md)). Verification uses `npx tsc --noEmit` for type safety (per [memory/verification-commands.md](../../../../../.claude/projects/c--Projects-Prisfol-PrismAi/memory/verification-commands.md)) and ad-hoc Node scripts for runtime checks, matching the existing pattern in [scripts/](../../../scripts/).

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/20260520_refund_chargeback_handling.sql` | NEW | `payment_disputed_at` column, drop nonneg CHECK, two clawback RPCs |
| `lib/email/admin-alerts.ts` | NEW | Resend wrapper. One exported function `sendAdminAlert`. Never throws. |
| `app/api/webhooks/paddle/route.ts` | MODIFY | Add `adjustment.created` case + `handleAdjustmentCreated` and three sub-handlers |
| `app/api/billing/buy-pack/route.ts` | MODIFY | Refuse purchase when `profiles.payment_disputed_at IS NOT NULL` |
| `app/api/billing/change-plan/route.ts` | MODIFY | Refuse plan change when `profiles.payment_disputed_at IS NOT NULL` |
| `package.json` | MODIFY | Add `resend` dependency |
| `CLAUDE.md` | MODIFY | Document `RESEND_API_KEY`, `ADMIN_ALERT_EMAIL` env vars |
| `scripts/simulate-paddle-adjustment.js` | NEW | Manual webhook smoke-test script |

---

## Task 1: Add Resend dependency and email helper

**Files:**
- Create: `lib/email/admin-alerts.ts`
- Modify: `package.json`

- [ ] **Step 1: Install resend**

Run: `npm install resend@^4.0.0`
Expected: `package.json` updated, `package-lock.json` updated, no errors.

- [ ] **Step 2: Create the email helper**

Create `lib/email/admin-alerts.ts`:

```ts
/**
 * Admin alerts for billing exception cases.
 *
 * Used by the Paddle webhook to notify admin of chargebacks, partial refunds,
 * and clawback shortfalls. All errors caught internally — email send failure
 * must never break the webhook flow.
 */
import { Resend } from 'resend';

export type AdminAlertKind =
    | 'chargeback'
    | 'partial_refund'
    | 'clawback_shortfall'
    | 'chargeback_reverse'
    | 'unknown_user';

interface SendAdminAlertArgs {
    kind: AdminAlertKind;
    summary: string;
    details: Record<string, unknown>;
}

export async function sendAdminAlert(args: SendAdminAlertArgs): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    const to = process.env.ADMIN_ALERT_EMAIL;
    const from = process.env.ADMIN_ALERT_FROM || 'alerts@prismai.local';

    if (!apiKey || !to) {
        console.error('[Admin Alert] RESEND_API_KEY or ADMIN_ALERT_EMAIL not configured — alert suppressed.', {
            kind: args.kind,
            summary: args.summary,
        });
        return;
    }

    const subject = `[PrismAi Billing] ${args.kind}: ${args.summary}`;
    const body = [
        `Kind: ${args.kind}`,
        `Summary: ${args.summary}`,
        '',
        'Details:',
        JSON.stringify(args.details, null, 2),
        '',
        `Sent: ${new Date().toISOString()}`,
    ].join('\n');

    try {
        const resend = new Resend(apiKey);
        await resend.emails.send({
            from,
            to,
            subject,
            text: body,
        });
    } catch (err: any) {
        console.error('[Admin Alert] Resend send failed:', err?.message ?? err, {
            kind: args.kind,
            summary: args.summary,
        });
    }
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean exit, no new errors. Pre-existing errors elsewhere in the repo are OK; the only thing that matters is no errors introduced by `lib/email/admin-alerts.ts`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json lib/email/admin-alerts.ts
git commit -m "feat(billing): add Resend-based admin alert helper for billing exceptions"
```

---

## Task 2: Schema migration — column, dropped CHECK, two clawback RPCs

**Files:**
- Create: `supabase/migrations/20260520_refund_chargeback_handling.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260520_refund_chargeback_handling.sql`:

```sql
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

  -- Nothing to claw back AND no shortfall to record? Treat as no-op success.
  IF v_clawback = 0 AND v_shortfall = 0 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'clawed_back', 0,
      'shortfall', 0,
      'new_balance', v_balance
    );
  END IF;

  v_enriched_meta := p_metadata || jsonb_build_object(
    'original_grant_id', p_original_grant_id,
    'original_grant_amount', v_grant_amount,
    'shortfall', v_shortfall
  );

  -- Insert the clawback ledger row. Skip the insert if clawback amount is 0
  -- (ledger has a nonzero CHECK on amount); still set payment_disputed_at? No,
  -- refunds don't set the disputed flag. But we must record the shortfall
  -- somehow. Solution: when clawback > 0 we write a negative-amount row; the
  -- shortfall lives in its metadata. When clawback = 0, we skip the ledger
  -- row entirely and the caller's alert is the audit record.
  IF v_clawback > 0 THEN
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
  ELSE
    v_new_balance := v_balance;
  END IF;

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
```

- [ ] **Step 2: Apply the migration to local Supabase**

Run: `npx supabase db push` (or whatever command this project uses — check [STARTUP.md](../../../STARTUP.md) if unsure).
Expected: migration applied without error. If `supabase` CLI is not available, run the SQL directly via the Supabase dashboard SQL editor against your dev project.

- [ ] **Step 3: Verify the schema changes landed**

Run via the Supabase SQL editor or `psql`:
```sql
\d public.profiles
\df+ paddle_refund_clawback
\df+ paddle_chargeback_clawback
```
Expected:
- `payment_disputed_at TIMESTAMPTZ` column present
- No `profiles_token_balance_nonneg` constraint listed
- Both functions present with `SECURITY DEFINER`, `service_role` execute grant

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260520_refund_chargeback_handling.sql
git commit -m "feat(db): refund + chargeback clawback RPCs, payment_disputed_at column"
```

---

## Task 3: Gating reads on disputed accounts

**Files:**
- Modify: `app/api/billing/buy-pack/route.ts`
- Modify: `app/api/billing/change-plan/route.ts`

- [ ] **Step 1: Gate buy-pack route**

In [app/api/billing/buy-pack/route.ts](../../../app/api/billing/buy-pack/route.ts), insert this block **after the auth check (after line 45)** and **before any other logic**:

```ts
        // Dispute gate: refuse new purchases while a chargeback is unresolved.
        // Admin clears profiles.payment_disputed_at directly in the DB once the
        // dispute is resolved (no admin UI in v1).
        {
            const service = createServiceClient();
            const { data: profile } = await service
                .from('profiles')
                .select('payment_disputed_at')
                .eq('id', user.id)
                .maybeSingle();

            if (profile?.payment_disputed_at) {
                return NextResponse.json(
                    {
                        error: 'account_disputed',
                        message: 'Your account has a pending payment dispute. Contact support.',
                    },
                    { status: 403 },
                );
            }
        }
```

(The `createServiceClient` import is already present in this file at line 28 — no new import needed.)

- [ ] **Step 2: Gate change-plan route**

In [app/api/billing/change-plan/route.ts](../../../app/api/billing/change-plan/route.ts), insert the same block **after the auth check (after line 31)** and **before the body parse**. The `createServiceClient` import is already present at line 15.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean. Both routes still compile.

- [ ] **Step 4: Commit**

```bash
git add app/api/billing/buy-pack/route.ts app/api/billing/change-plan/route.ts
git commit -m "feat(billing): refuse purchases when payment_disputed_at is set"
```

---

## Task 4: Webhook event router + handleAdjustmentCreated dispatcher

**Files:**
- Modify: `app/api/webhooks/paddle/route.ts`

- [ ] **Step 1: Add the new case to the event switch**

In [app/api/webhooks/paddle/route.ts](../../../app/api/webhooks/paddle/route.ts), insert in the `switch (event.eventType)` block (around line 52-73), **after the `TransactionPaymentFailed` case and before `default`**:

```ts
            case EventName.AdjustmentCreated:
                await handleAdjustmentCreated(event.data, event.eventId, supabase);
                break;
```

(If `EventName.AdjustmentCreated` isn't exported by `@paddle/paddle-node-sdk@3.8.0`, fall back to the string literal: `case 'adjustment.created' as any:`. Verify by reading the SDK's exported enum at `node_modules/@paddle/paddle-node-sdk/dist/index.d.ts`.)

- [ ] **Step 2: Add the dispatcher function**

Append to the bottom of `app/api/webhooks/paddle/route.ts`, after `mapPaddleStatusToOurs`:

```ts
// =============================================================================
// ADJUSTMENT (REFUND / CHARGEBACK) HANDLERS
// =============================================================================

/**
 * Paddle emits `adjustment.created` for refunds, chargebacks, and chargeback
 * reversals. We only act when `status === 'approved'` — pending adjustments
 * may be revoked. Each action routes to its own subhandler. Unknown actions
 * are logged + ignored so Paddle doesn't retry forever.
 */
async function handleAdjustmentCreated(data: any, eventId: string, supabase: ReturnType<typeof createServiceClient>) {
    if (data?.status !== 'approved') {
        console.log('[Paddle Webhook] Skipping non-approved adjustment:', data?.id, 'status:', data?.status);
        return;
    }

    const action: string = data?.action ?? '';
    switch (action) {
        case 'refund':
            await handleRefund(data, eventId, supabase);
            break;
        case 'chargeback':
            await handleChargeback(data, eventId, supabase);
            break;
        case 'chargeback_reverse':
            await handleChargebackReverse(data, eventId, supabase);
            break;
        default:
            console.warn('[Paddle Webhook] Unknown adjustment action:', action, 'id:', data?.id);
    }
}

// Placeholder subhandlers — filled in by tasks 5/6/7.
async function handleRefund(data: any, eventId: string, supabase: ReturnType<typeof createServiceClient>) {
    console.log('[Paddle Webhook] Refund stub:', data?.id, 'event:', eventId);
}

async function handleChargeback(data: any, eventId: string, supabase: ReturnType<typeof createServiceClient>) {
    console.log('[Paddle Webhook] Chargeback stub:', data?.id, 'event:', eventId);
}

async function handleChargebackReverse(data: any, eventId: string, supabase: ReturnType<typeof createServiceClient>) {
    console.log('[Paddle Webhook] Chargeback reverse stub:', data?.id, 'event:', eventId);
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/api/webhooks/paddle/route.ts
git commit -m "feat(webhook): stub adjustment.created dispatcher for refund/chargeback"
```

---

## Task 5: Implement handleRefund

**Files:**
- Modify: `app/api/webhooks/paddle/route.ts`

- [ ] **Step 1: Add the original-grant lookup helper**

Append to `app/api/webhooks/paddle/route.ts` (above the adjustment handlers section, near the existing helpers):

```ts
/**
 * Find the ledger rows that recorded the original positive grant(s) for a
 * given Paddle transaction. We stored `paddle_transaction_id` in metadata
 * when we credited the user via grantCredits().
 */
async function findOriginalGrants(
    supabase: ReturnType<typeof createServiceClient>,
    paddleTransactionId: string,
): Promise<Array<{ id: string; user_id: string; amount: number; reason: string; metadata: any }>> {
    const { data, error } = await supabase
        .from('token_ledger')
        .select('id, user_id, amount, reason, metadata')
        .in('reason', ['paddle_pack_purchase', 'paddle_subscription_grant'])
        .filter('metadata->>paddle_transaction_id', 'eq', paddleTransactionId);

    if (error) {
        console.error('[Paddle Webhook] findOriginalGrants failed:', error);
        return [];
    }
    return (data ?? []) as any;
}
```

- [ ] **Step 2: Add the refund-classification helper**

Append after `findOriginalGrants`:

```ts
/**
 * Classify a Paddle adjustment as a full or partial refund relative to the
 * granted ledger total. Sum of negative item amounts in the adjustment should
 * match the sum of grants if it's a full refund.
 *
 * Paddle adjustment items don't directly expose the priceId in older payload
 * shapes; we use the dollar total as the comparison. Implementation detail
 * subject to verification against Paddle's actual payload during smoke testing.
 */
function isFullRefund(adjustment: any, originalTxTotalCents: number): boolean {
    const totalsRaw = adjustment?.totals?.total ?? adjustment?.payoutTotals?.total;
    if (totalsRaw == null) return false;
    const adjustmentTotal = typeof totalsRaw === 'number' ? totalsRaw : Number.parseFloat(String(totalsRaw));
    if (!Number.isFinite(adjustmentTotal)) return false;
    // Paddle totals are positive amounts representing the refund/adjustment size.
    return Math.abs(adjustmentTotal - originalTxTotalCents) < 1;
}
```

- [ ] **Step 3: Replace the handleRefund stub**

Replace the stub `handleRefund` body with:

```ts
async function handleRefund(data: any, eventId: string, supabase: ReturnType<typeof createServiceClient>) {
    const adjustmentId: string = data?.id ?? '';
    const txId: string = data?.transactionId ?? '';

    if (!txId) {
        console.error('[Paddle Webhook] Refund missing transactionId:', adjustmentId);
        void sendAdminAlert({
            kind: 'unknown_user',
            summary: 'Refund event without transactionId',
            details: { adjustmentId, eventId, raw: data },
        });
        return;
    }

    const grants = await findOriginalGrants(supabase, txId);
    if (grants.length === 0) {
        console.warn('[Paddle Webhook] Refund for unknown transaction:', txId);
        void sendAdminAlert({
            kind: 'unknown_user',
            summary: `Refund for transaction with no recorded grants`,
            details: { adjustmentId, eventId, paddleTransactionId: txId },
        });
        return;
    }

    const userId = grants[0].user_id;

    // Sum of all positive grants tied to this transaction (in credits — what we owe)
    const grantedCredits = grants.reduce((sum, g) => sum + Number(g.amount), 0);

    // Sum of money on the adjustment (in minor units / cents)
    const originalTotalCents = Number(data?.originalTotals?.total ?? data?.transactionTotals?.total ?? 0);
    const adjustmentTotalCents = Number(data?.totals?.total ?? 0);
    const fullRefund = originalTotalCents > 0 && isFullRefund(data, originalTotalCents);

    if (!fullRefund) {
        // Partial refund — admin handles credit adjustment manually.
        void sendAdminAlert({
            kind: 'partial_refund',
            summary: `Partial refund seen for user ${userId} — no auto-clawback`,
            details: {
                userId,
                adjustmentId,
                eventId,
                paddleTransactionId: txId,
                originalTotalCents,
                adjustmentTotalCents,
                grantedCredits,
            },
        });
        return;
    }

    // Full refund — claw back each grant row independently.
    let totalClawedBack = 0;
    let totalShortfall = 0;

    for (const grant of grants) {
        const idemKey = `paddle:adj:${adjustmentId}:row:${grant.id}`;
        const { data: rpcResult, error } = await supabase.rpc('paddle_refund_clawback', {
            p_user_id: userId,
            p_event_id: eventId,
            p_original_grant_id: grant.id,
            p_idempotency_key: idemKey,
            p_metadata: {
                paddle_adjustment_id: adjustmentId,
                paddle_transaction_id: txId,
                refund_reason: data?.reason ?? null,
            },
        });

        if (error) {
            console.error('[Paddle Webhook] paddle_refund_clawback RPC failed:', error);
            throw new Error(error.message);
        }

        const result = rpcResult as { clawed_back?: number; shortfall?: number };
        totalClawedBack += Number(result?.clawed_back ?? 0);
        totalShortfall  += Number(result?.shortfall  ?? 0);
    }

    if (totalShortfall > 0) {
        void sendAdminAlert({
            kind: 'clawback_shortfall',
            summary: `Refund clawback short by ${totalShortfall} credits for user ${userId}`,
            details: {
                userId,
                adjustmentId,
                eventId,
                paddleTransactionId: txId,
                totalGranted: grantedCredits,
                totalClawedBack,
                totalShortfall,
            },
        });
    }
}
```

- [ ] **Step 4: Add the import for sendAdminAlert**

At the top of `app/api/webhooks/paddle/route.ts`, near the other imports (around line 21), add:

```ts
import { sendAdminAlert } from '@/lib/email/admin-alerts';
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add app/api/webhooks/paddle/route.ts
git commit -m "feat(webhook): full-refund auto-clawback, partial-refund alert"
```

---

## Task 6: Implement handleChargeback

**Files:**
- Modify: `app/api/webhooks/paddle/route.ts`

- [ ] **Step 1: Replace the handleChargeback stub**

Replace the stub `handleChargeback` body with:

```ts
async function handleChargeback(data: any, eventId: string, supabase: ReturnType<typeof createServiceClient>) {
    const adjustmentId: string = data?.id ?? '';
    const txId: string = data?.transactionId ?? '';

    if (!txId) {
        console.error('[Paddle Webhook] Chargeback missing transactionId:', adjustmentId);
        void sendAdminAlert({
            kind: 'unknown_user',
            summary: 'Chargeback event without transactionId',
            details: { adjustmentId, eventId, raw: data },
        });
        return;
    }

    const grants = await findOriginalGrants(supabase, txId);
    if (grants.length === 0) {
        console.warn('[Paddle Webhook] Chargeback for unknown transaction:', txId);
        void sendAdminAlert({
            kind: 'unknown_user',
            summary: `Chargeback for transaction with no recorded grants`,
            details: { adjustmentId, eventId, paddleTransactionId: txId },
        });
        return;
    }

    const userId = grants[0].user_id;
    let totalClawedBack = 0;
    let anyWentNegative = false;

    // Force-clawback every grant. RPC allows negative balance.
    for (const grant of grants) {
        const idemKey = `paddle:adj:${adjustmentId}:row:${grant.id}`;
        const { data: rpcResult, error } = await supabase.rpc('paddle_chargeback_clawback', {
            p_user_id: userId,
            p_event_id: eventId,
            p_original_grant_id: grant.id,
            p_idempotency_key: idemKey,
            p_metadata: {
                paddle_adjustment_id: adjustmentId,
                paddle_transaction_id: txId,
                chargeback_reason: data?.reason ?? null,
            },
        });

        if (error) {
            console.error('[Paddle Webhook] paddle_chargeback_clawback RPC failed:', error);
            throw new Error(error.message);
        }

        const result = rpcResult as { clawed_back?: number; went_negative?: boolean };
        totalClawedBack += Number(result?.clawed_back ?? 0);
        if (result?.went_negative) anyWentNegative = true;
    }

    // Cancel the active subscription (if any) via Paddle API. The resulting
    // subscription.canceled webhook will sync our DB row.
    let subscriptionCanceled: { ok: boolean; subscriptionId?: string; error?: string } = { ok: false };
    const { data: sub } = await supabase
        .from('subscriptions')
        .select('paddle_subscription_id, status')
        .eq('user_id', userId)
        .maybeSingle();

    if (sub?.paddle_subscription_id && sub.status === 'active') {
        try {
            const paddle = getPaddle();
            await paddle.subscriptions.cancel(sub.paddle_subscription_id, {
                effectiveFrom: 'immediately',
            });
            subscriptionCanceled = { ok: true, subscriptionId: sub.paddle_subscription_id };
        } catch (cancelErr: any) {
            subscriptionCanceled = {
                ok: false,
                subscriptionId: sub.paddle_subscription_id,
                error: cancelErr?.message ?? String(cancelErr),
            };
            console.error('[Paddle Webhook] Failed to cancel sub after chargeback:', cancelErr);
        }
    }

    void sendAdminAlert({
        kind: 'chargeback',
        summary: `Chargeback received for user ${userId} (${totalClawedBack} credits clawed back)`,
        details: {
            userId,
            adjustmentId,
            eventId,
            paddleTransactionId: txId,
            totalClawedBack,
            anyWentNegative,
            subscriptionCanceled,
            chargebackReason: data?.reason ?? null,
        },
    });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/api/webhooks/paddle/route.ts
git commit -m "feat(webhook): chargeback force-clawback, auto-cancel sub, flag account"
```

---

## Task 7: Implement handleChargebackReverse

**Files:**
- Modify: `app/api/webhooks/paddle/route.ts`

- [ ] **Step 1: Replace the handleChargebackReverse stub**

Replace the stub `handleChargebackReverse` body with:

```ts
async function handleChargebackReverse(data: any, eventId: string, supabase: ReturnType<typeof createServiceClient>) {
    const adjustmentId: string = data?.id ?? '';
    const txId: string = data?.transactionId ?? '';

    // Best-effort user lookup so the alert is actionable.
    let userId: string | null = null;
    if (txId) {
        const grants = await findOriginalGrants(supabase, txId);
        if (grants.length > 0) userId = grants[0].user_id;
    }

    void sendAdminAlert({
        kind: 'chargeback_reverse',
        summary: userId
            ? `Chargeback reversed for user ${userId} — review whether to restore credits`
            : `Chargeback reversed for unknown user — investigate`,
        details: {
            userId,
            adjustmentId,
            eventId,
            paddleTransactionId: txId,
            note: 'No automatic credit restoration. Admin must decide manually based on dispute outcome and user behavior.',
        },
    });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/api/webhooks/paddle/route.ts
git commit -m "feat(webhook): alert admin on chargeback_reverse (no auto credit restoration)"
```

---

## Task 8: Document new env vars

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the required env section**

In [CLAUDE.md](../../../CLAUDE.md), find the line starting `Required env (in \`.env.local\`):` and append at the end (before the period closing the sentence):

```
, `RESEND_API_KEY` (admin alert emails for billing exceptions), `ADMIN_ALERT_EMAIL` (destination for billing alerts), `ADMIN_ALERT_FROM` (optional, defaults to `alerts@prismai.local`)
```

So the final sentence reads (showing only the new tail):

> `...CRON_SECRET`, `RESEND_API_KEY` (admin alert emails for billing exceptions), `ADMIN_ALERT_EMAIL` (destination for billing alerts), `ADMIN_ALERT_FROM` (optional, defaults to `alerts@prismai.local`).

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add RESEND_API_KEY + ADMIN_ALERT_EMAIL env vars"
```

---

## Task 9: Smoke-test script for manual webhook simulation

**Files:**
- Create: `scripts/simulate-paddle-adjustment.js`

- [ ] **Step 1: Create the simulation script**

Create `scripts/simulate-paddle-adjustment.js`:

```js
/**
 * Manual smoke test for the Paddle adjustment.created webhook handler.
 *
 * Usage:
 *   ADJUSTMENT_KIND=refund TX_ID=txn_xxx node scripts/simulate-paddle-adjustment.js
 *   ADJUSTMENT_KIND=chargeback TX_ID=txn_xxx node scripts/simulate-paddle-adjustment.js
 *   ADJUSTMENT_KIND=chargeback_reverse TX_ID=txn_xxx node scripts/simulate-paddle-adjustment.js
 *
 * Prerequisites:
 *   - Dev server running on http://localhost:3000
 *   - PADDLE_WEBHOOK_SECRET configured in .env.local (signature verification
 *     will fail otherwise — this script signs the payload with the same secret)
 *   - TX_ID corresponds to a real transaction recorded in token_ledger (i.e.
 *     a paddle_pack_purchase or paddle_subscription_grant whose metadata
 *     contains paddle_transaction_id = TX_ID)
 *
 * Note: The Paddle SDK's `webhooks.unmarshal` performs an HMAC check. Replicating
 * the exact signature format requires the same algorithm Paddle uses. Easiest
 * path for local testing is to TEMPORARILY remove the signature check in the
 * webhook (commenting out lines 39-43 of route.ts), run this script, then restore
 * the check before committing. End-to-end signature verification is covered by
 * Paddle Sandbox testing in step 3 below.
 */
const crypto = require('crypto');

const KIND = process.env.ADJUSTMENT_KIND || 'refund';
const TX_ID = process.env.TX_ID;
const URL = process.env.WEBHOOK_URL || 'http://localhost:3000/api/webhooks/paddle';

if (!TX_ID) {
    console.error('Usage: TX_ID=txn_xxx ADJUSTMENT_KIND=refund node scripts/simulate-paddle-adjustment.js');
    process.exit(1);
}

const adjustmentId = `adj_test_${Date.now()}`;
const eventId = `evt_test_${Date.now()}`;

const payload = {
    eventId,
    eventType: 'adjustment.created',
    occurredAt: new Date().toISOString(),
    data: {
        id: adjustmentId,
        action: KIND, // 'refund' | 'chargeback' | 'chargeback_reverse'
        status: 'approved',
        transactionId: TX_ID,
        reason: `local smoke test (${KIND})`,
        totals: {
            total: '1000', // adjust to match the original transaction's total cents
        },
        originalTotals: {
            total: '1000',
        },
    },
};

(async () => {
    const body = JSON.stringify(payload);
    console.log(`Posting ${KIND} adjustment for tx ${TX_ID} to ${URL}`);
    console.log(`Payload:`, JSON.stringify(payload, null, 2));

    const res = await fetch(URL, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'paddle-signature': 'ts=0;h1=local-smoke-test',
        },
        body,
    });

    console.log(`Response: ${res.status} ${res.statusText}`);
    const text = await res.text();
    console.log(text);
})();
```

- [ ] **Step 2: Run the smoke tests**

Prerequisites: dev server running (`npm run dev`), a known transaction ID from `token_ledger` (query: `SELECT metadata->>'paddle_transaction_id', amount, user_id FROM token_ledger WHERE reason IN ('paddle_pack_purchase','paddle_subscription_grant') ORDER BY created_at DESC LIMIT 5;`), and the webhook signature check temporarily disabled (see note in script).

For each kind, run:
```bash
ADJUSTMENT_KIND=refund TX_ID=<your tx id> node scripts/simulate-paddle-adjustment.js
ADJUSTMENT_KIND=chargeback TX_ID=<your tx id> node scripts/simulate-paddle-adjustment.js
ADJUSTMENT_KIND=chargeback_reverse TX_ID=<your tx id> node scripts/simulate-paddle-adjustment.js
```

Expected after refund:
- New negative-amount row in `token_ledger` with `reason='paddle_refund'`
- `profiles.token_balance` reduced by `min(grant_amount, prior_balance)`
- Console (or email if Resend configured) shows shortfall alert if balance was insufficient

Expected after chargeback:
- New negative-amount row with `reason='paddle_chargeback'`
- `profiles.token_balance` reduced by full grant amount (can be negative)
- `profiles.payment_disputed_at` set to NOW()
- Subscription canceled in Paddle (if one was active)
- Chargeback alert email/log

Expected after chargeback_reverse:
- No DB writes
- chargeback_reverse alert email/log

- [ ] **Step 3: Run idempotency check**

Re-run the same simulation twice with the same `TX_ID` and same generated `eventId` (modify the script to use a fixed `adjustmentId` for this check):
- Second run must be a no-op (no new ledger rows, no balance change).
- Webhook returns 200 both times.

- [ ] **Step 4: Restore signature check + final type-check**

Re-enable signature verification in route.ts if you disabled it.
Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add scripts/simulate-paddle-adjustment.js
git commit -m "test(scripts): smoke-test script for paddle adjustment webhook"
```

---

## Self-review checklist (for the implementer to run before claiming done)

- [ ] All 9 tasks committed.
- [ ] `npx tsc --noEmit` passes.
- [ ] A refund simulation (`ADJUSTMENT_KIND=refund`) produces exactly one negative ledger row per original grant, balance is reduced correctly, shortfall path alerts.
- [ ] A chargeback simulation produces a negative ledger row, `payment_disputed_at` is set, subscription is canceled (if user had an active one).
- [ ] Replaying the same adjustment payload twice is a no-op (idempotency).
- [ ] `buy-pack` and `change-plan` return 403 with `account_disputed` when `payment_disputed_at` is non-null.
- [ ] Setting `payment_disputed_at = NULL` manually restores purchase ability.
- [ ] `CLAUDE.md` lists the new env vars.
- [ ] Signature verification in `route.ts` is NOT disabled in the committed code (it should only be disabled locally during smoke testing).

## Spec coverage verification

| Spec requirement | Implementing task(s) |
|---|---|
| `adjustment.created` event handling | Task 4 (dispatch), 5/6/7 (subhandlers) |
| Full-refund auto-clawback | Task 5 + Task 2 (RPC) |
| Partial-refund alert-only | Task 5 |
| Chargeback force-clawback (allow negative) | Task 6 + Task 2 (RPC + drop CHECK) |
| Chargeback sub cancel | Task 6 |
| `payment_disputed_at` flag | Task 2 (column) + Task 6 (set) + Task 3 (gate) |
| Chargeback-reverse alert | Task 7 |
| Email via Resend | Task 1 |
| Idempotency | Task 2 (RPC patterns) + Task 9 (verified) |
| Env documentation | Task 8 |
| Manual smoke testing | Task 9 |
