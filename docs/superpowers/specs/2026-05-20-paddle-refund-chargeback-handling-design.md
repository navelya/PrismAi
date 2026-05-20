# Paddle Refund & Chargeback Handling — Design

**Date:** 2026-05-20
**Status:** Approved for implementation
**Scope:** Add webhook handling for Paddle refund and chargeback events. Auto-clawback granted credits, flag disputed accounts, alert admin on exceptions.

## Background

The Paddle webhook at [app/api/webhooks/paddle/route.ts](../../../app/api/webhooks/paddle/route.ts) currently handles `subscription.activated`, `subscription.updated`, `subscription.canceled`, and `transaction.completed`. It does **not** handle refunds or chargebacks. The `token_ledger.reason` CHECK constraint already includes `paddle_refund` and `paddle_chargeback` values ([supabase/migrations/20260506_paddle_billing.sql:72-86](../../../supabase/migrations/20260506_paddle_billing.sql#L72-L86)), but no code writes them.

Today, a Paddle refund leaves the user holding the originally granted credits. A chargeback does the same plus keeps the subscription active. Both are real revenue/abuse risks.

## Policy decisions (locked in during brainstorming)

| Decision | Choice |
|---|---|
| Refund initiation | Admin-driven only (user emails support → admin issues refund in Paddle) |
| Refund clawback | Auto-clawback on full refund |
| Refund clawback when balance is insufficient | Cap at 0, log shortfall, email admin |
| Partial refunds | Log + email, no credit change (admin handles credit adjustment manually) |
| Chargeback clawback | Force clawback, allow negative balance |
| Chargeback subscription effect | Auto-cancel via Paddle API, immediate |
| Chargeback account flag | Set `payment_disputed_at`, block future purchases until admin clears |
| Chargeback reverse (dispute won) | Alert admin only; no automatic credit restoration |
| Alerting channel | Email via Resend, to `ADMIN_ALERT_EMAIL` env var |
| Out of scope | Self-serve refunds, partial-refund auto-clawback, dunning, dispute UI, admin tooling for clearing the disputed flag |

## Architecture

Three layers, matching the existing Paddle-credits pattern:

1. **Database (PL/pgSQL RPCs + schema migration)** — atomic state changes
2. **Webhook handlers (TypeScript)** — Paddle event routing + Paddle API calls
3. **Email helper (TypeScript)** — admin alerts via Resend

### Components

#### 1. Schema migration

**File:** `supabase/migrations/20260520_refund_chargeback_handling.sql`

Changes:
- `ALTER TABLE profiles ADD COLUMN payment_disputed_at TIMESTAMPTZ NULL;`
- `ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_token_balance_nonneg;` (the `>= 0` CHECK named in [20260505_credits_system.sql:35](../../../supabase/migrations/20260505_credits_system.sql#L35)) — application-level guard in `debit_tokens` already prevents normal spend below zero; this CHECK now blocks legitimate chargeback clawbacks. The tamper trigger ([20260505_credits_system.sql:41-68](../../../supabase/migrations/20260505_credits_system.sql#L41-L68)) still enforces service-role-only writes.
- New RPC `paddle_refund_clawback(p_user_id UUID, p_event_id TEXT, p_original_grant_id UUID, p_idempotency_key TEXT, p_metadata JSONB) RETURNS JSONB`:
  - Looks up the original `token_ledger` grant row by `p_original_grant_id`. Asserts user matches.
  - Computes `clawback_amount = LEAST(original_grant_amount, current_balance)`.
  - Computes `shortfall = original_grant_amount - clawback_amount`.
  - Inserts a single negative-amount ledger row with reason `paddle_refund`, the supplied event_id and idempotency_key, and metadata enriched with `original_grant_id`, `shortfall`.
  - Updates `profiles.token_balance` accordingly via the tamper-bypassing service-role path used by `credit_tokens`.
  - Returns `{ ok: true, clawed_back, shortfall, new_balance }`.
  - Idempotent: replay returns the same result via the existing UNIQUE(idempotency_key) pattern from `credit_tokens` ([20260505_credits_system.sql:201-204](../../../supabase/migrations/20260505_credits_system.sql#L201-L204)).
- New RPC `paddle_chargeback_clawback(p_user_id UUID, p_event_id TEXT, p_original_grant_id UUID, p_idempotency_key TEXT, p_metadata JSONB) RETURNS JSONB`:
  - Same lookup logic as refund RPC.
  - `clawback_amount = original_grant_amount` always (no balance check — can go negative).
  - Inserts negative-amount ledger row with reason `paddle_chargeback`.
  - Sets `profiles.payment_disputed_at = NOW()` in the same transaction.
  - Returns `{ ok: true, clawed_back, went_negative, new_balance, disputed_at }`.
  - Idempotent.

Both RPCs return JSONB rather than raising on shortfall — the caller decides whether to alert.

#### 2. Email helper

**New file:** `lib/email/admin-alerts.ts`

```ts
type AlertKind = 'chargeback' | 'partial_refund' | 'clawback_shortfall' | 'chargeback_reverse';

export async function sendAdminAlert(args: {
  kind: AlertKind;
  summary: string;       // one-line subject
  details: Record<string, unknown>;  // rendered as JSON in body
}): Promise<void>;
```

Behavior:
- Reads `RESEND_API_KEY` and `ADMIN_ALERT_EMAIL` from env. If either is missing, logs an error and returns (does not throw).
- Sends plain text email via Resend SDK. Subject: `[PrismAi Billing] {kind}: {summary}`. Body: human-readable summary + JSON-stringified `details` block.
- All errors caught internally; never throws. Email failure must not break the webhook flow.

#### 3. Webhook handler

In [app/api/webhooks/paddle/route.ts](../../../app/api/webhooks/paddle/route.ts), extend the event switch:

```
case 'adjustment.created':
  await handleAdjustmentCreated(event, supabase);
  break;
```

New function `handleAdjustmentCreated(event, supabase)`:

1. Extract `action`, `status`, `transaction_id`, `items[]`, `customer_id` from event.
2. If `status !== 'approved'`, return early (we only act on approved adjustments).
3. Branch on `action`:
   - `refund` → call `handleRefund(event, supabase)`
   - `chargeback` → call `handleChargeback(event, supabase)`
   - `chargeback_reverse` → call `handleChargebackReverse(event, supabase)`
   - else → log unknown action, return.

**`handleRefund`:**
1. Resolve `user_id` from the original transaction's ledger entries: query `token_ledger` for rows with `paddle_event_id = adjustment.transaction_id` (this matches the `stripe_event_id` column the existing webhook already reuses for Paddle event IDs at [route.ts:439](../../../app/api/webhooks/paddle/route.ts#L439)). If none found → log + email partial_refund-style alert "refund for unknown transaction" + return.
2. Determine refund type:
   - **Full refund:** `adjustment.totals.total === original_transaction.totals.total` AND `adjustment.items.length === original.items.length`. Paddle exposes this distinction; verify exact field names against Paddle Billing API docs during implementation.
   - **Partial refund:** anything else.
3. **Full refund path:**
   - For each ledger row tied to the original transaction:
     - Call `paddle_refund_clawback(user_id, event.id, ledger_row.id, "paddle:adj:{event.id}:row:{ledger_row.id}", { adjustment_id, reason: 'admin_refund' })`.
     - If RPC returns `shortfall > 0`, queue a `clawback_shortfall` alert.
   - After all rows processed, send one consolidated email if any shortfall occurred.
4. **Partial refund path:**
   - Do NOT touch credits.
   - Do NOT write to `token_ledger` (the existing nonzero amount CHECK forbids a zero-amount marker, and inserting a tiny dust value would corrupt the ledger invariant).
   - Send `partial_refund` alert containing: `user_id`, `original_transaction_id`, `adjustment_id`, `refunded_amount`, `original_amount`. The Paddle dashboard is the authoritative record of the partial refund; the email is the action signal for admin.

**`handleChargeback`:**
1. Same user/transaction resolution as refund. If unknown → alert + return.
2. For each ledger row tied to the original transaction:
   - Call `paddle_chargeback_clawback(user_id, event.id, ledger_row.id, "paddle:adj:{event.id}:row:{ledger_row.id}", { adjustment_id, reason: 'chargeback' })`.
3. Resolve user's active Paddle subscription via the `subscriptions` table. If present and not already canceled:
   - Call `paddle.subscriptions.cancel(subscription_id, { effectiveFrom: 'immediately' })` via the Node SDK.
   - The resulting `subscription.canceled` webhook will sync our DB row.
4. Send `chargeback` alert with full details: user_id, original amount, total clawed back, whether balance went negative, subscription canceled (yes/no).

**`handleChargebackReverse`:**
1. Resolve user/transaction.
2. Do NOT auto-restore credits.
3. Send `chargeback_reverse` alert: "Chargeback dispute won for user X. Original clawback was Y credits. Review whether to restore."
4. Admin re-credits manually using existing admin tooling (out of scope).

All three handlers wrap their email send in `void sendAdminAlert(...)` *after* the DB commit, so a slow/down Resend never delays the webhook 200 response. Caller does not await.

#### 4. Gating reads on disputed accounts

Modify two routes to refuse new purchases when `profiles.payment_disputed_at IS NOT NULL`:

- [app/api/billing/buy-pack/route.ts](../../../app/api/billing/buy-pack/route.ts) — early return 403 `{ error: 'account_disputed', message: 'Your account has a pending payment dispute. Contact support.' }` after auth check, before any Paddle call.
- [app/api/billing/change-plan/route.ts](../../../app/api/billing/change-plan/route.ts) — same.

[app/api/billing/cancel/route.ts](../../../app/api/billing/cancel/route.ts) is NOT gated (a disputed user must still be able to stop their subscription if it's somehow still active — defensive).

Clearing the flag is admin-only via direct DB update. No admin UI in v1.

## Data flow

```
Paddle dashboard / API           Paddle webhook                 Our DB                         Resend
       │                              │                            │                              │
   admin: refund                      │                            │                              │
       ├─────────────────────────────►│                            │                              │
       │                       handleAdjustmentCreated             │                              │
       │                              │                            │                              │
       │                       full refund?                        │                              │
       │                              │── lookup ledger ──────────►│                              │
       │                              │◄── original grants ────────┤                              │
       │                              │── paddle_refund_clawback ─►│                              │
       │                              │◄── { clawed_back,          │                              │
       │                              │     shortfall } ───────────┤                              │
       │                              │                            │                              │
       │                       shortfall > 0?                      │                              │
       │                              │── sendAdminAlert ───────────────────────────────────────►│
       │                              │                            │                              │
       │◄── 200 OK ──────────────────┤                            │                              │
```

Chargeback path is similar but also calls `paddle.subscriptions.cancel` against Paddle's API between the clawback and the alert.

## Error handling

- **Unknown user / unknown transaction** → log + alert + return 200. Never error out (Paddle would retry, but the data won't be recoverable on retry).
- **RPC failure** → throw, return 500. Paddle retries with backoff. Idempotency keys make retry safe.
- **Paddle SDK failure (subscription cancel)** → log, send alert noting "chargeback processed but sub cancel failed", return 200 anyway. Admin manually cancels.
- **Resend failure** → swallow inside `sendAdminAlert`. Webhook never fails on email.
- **Signature verification failure** → existing 401 path unchanged.

## Testing strategy

This repo has no test runner. Verification approach:

1. **Manual webhook simulation** — craft a fake adjustment payload with valid signature, POST to the webhook in dev. Verify ledger row, balance, profiles.payment_disputed_at.
2. **Type checking** — `npx tsc --noEmit` (per memory: lint/build unreliable in this repo).
3. **End-to-end against Paddle sandbox** — issue a real refund in Paddle sandbox dashboard against a real test transaction, observe webhook fire, verify state.
4. **Idempotency check** — replay the same webhook payload twice, verify no double clawback.

No new automated tests; existing scripts under [scripts/](../../../scripts/) follow the manual ad-hoc pattern.

## Env additions

Add to CLAUDE.md "Required env" list:
- `RESEND_API_KEY` — Resend API key for admin alerts
- `ADMIN_ALERT_EMAIL` — destination address (e.g., `admin@prisfol.ai`)

## Open questions for implementation

1. **Exact Paddle event field names** — Paddle Billing API's adjustment payload structure (`action`, `status`, `totals`, `items[]`) must be verified against current Paddle docs and the `@paddle/paddle-node-sdk` TypeScript types during implementation. The design assumes the structure documented at https://developer.paddle.com/api-reference/adjustments/overview but is not locked to it; field names are implementation details.
2. **`paddle_event_id` vs `stripe_event_id` column** — the existing webhook reuses `stripe_event_id` to store Paddle event IDs. The 20260506 migration also added a `paddle_event_id` column. Implementation should write to BOTH for compatibility with the existing `transaction.completed` writer, but read for transaction lookup from `paddle_event_id` (the correctly-named one).

## Files touched

| File | Action |
|---|---|
| `supabase/migrations/20260520_refund_chargeback_handling.sql` | NEW |
| `lib/email/admin-alerts.ts` | NEW |
| `app/api/webhooks/paddle/route.ts` | MODIFY: add `handleAdjustmentCreated` + subhandlers |
| `app/api/billing/buy-pack/route.ts` | MODIFY: gate on `payment_disputed_at` |
| `app/api/billing/change-plan/route.ts` | MODIFY: gate on `payment_disputed_at` |
| `package.json` | MODIFY: add `resend` dep |
| `CLAUDE.md` | MODIFY: document new env vars |

## Out of scope (explicit non-goals)

- Self-serve refund flows
- Partial-refund auto-clawback
- Admin UI for reviewing/clearing disputed accounts
- Automated chargeback-reverse credit restoration
- Dunning / failed-payment retry
- Updates to the wallet UI to show dispute state
- Tests (manual verification only — matches existing repo practice)
