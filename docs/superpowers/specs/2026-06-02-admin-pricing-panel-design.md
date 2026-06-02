# Admin Pricing Panel — Design Spec

**Date:** 2026-06-02
**Status:** Approved for planning
**Author:** Brainstormed with admin (naveh-elya)

## Problem

Pricing for subscription plans and one-time credit packs is hardcoded in
[`lib/billing/plans-config.ts`](../../../lib/billing/plans-config.ts), with Paddle
price IDs (`pri_...`) embedded. Changing a price (e.g. Starter $10 → $20) or a
pack's credit amount today requires a code edit + redeploy, and a manual price
creation in the Paddle dashboard. The admin wants to make these changes from a
new tab in the admin page, with the change taking real effect everywhere —
including creating the corresponding price in Paddle automatically.

## Goals

- A new **Pricing** section in the admin page (`/admin?section=pricing`) with two
  tabs: **Plans** and **Credit Packs**.
- Admin can edit, for existing plans/packs:
  - Subscription monthly/yearly **price** (USD).
  - Credit pack **price** (USD).
  - **Granted credits** (monthly credits per plan; credits per pack).
  - **Availability** toggle.
- Money changes auto-create a new Paddle price via the Paddle API and switch all
  future checkouts to it.
- Every change is audited (who, when, old → new, new Paddle price ID).

## Non-Goals (v1)

- Creating brand-new plans/packs or deleting existing ones (edit-only for v1).
- Per-model execution `credit_cost` editing — already handled in the Models tab.
- Multi-currency — USD only, matching today's config.
- Re-pricing or migrating existing subscribers (see Grandfathering below).

## Key Decisions

1. **Grandfathering (price).** Existing subscribers keep their current Paddle
   price. A price change creates a *new* Paddle price object; only new checkouts
   use it. We never touch existing Paddle subscriptions. (Paddle amounts are
   immutable, so a new price object is required regardless.)
2. **Credit amounts are NOT grandfathered.** Changing a plan's granted credits
   applies to everyone at their next renewal, because the webhook reads current
   pricing at grant time. Only the *price* is grandfathered. Pack credit changes
   apply to future purchases (already true).
3. **DB is the source of truth (Approach A).** Mutable pricing fields move out of
   `plans-config.ts` into the DB. The config keeps only static structure (feature
   bullet lists, plan ids, accents) and serves as the one-time seed.
4. **Auto-create Paddle prices.** Money edits call `paddle.prices.create()`
   server-side; the admin never touches the Paddle dashboard.

## Architecture

### 1. Data model (Supabase migrations)

**Extend `plans` table** (already has `id`, `display_name`, `monthly_floor`,
`signup_bonus`, `paddle_price_id_monthly`, `paddle_price_id_yearly`):

- `price_monthly_cents INTEGER` — display/charge price, monthly.
- `price_yearly_cents INTEGER` — display/charge price, yearly.
- `available BOOLEAN NOT NULL DEFAULT true`.
- `paddle_product_id TEXT` — cached product id (derived from a price on first
  edit; used as the parent when creating new prices).

(`monthly_floor` is the granted monthly credits and is reused as-is.)

**New `credit_packs` table:**

```
id           TEXT PRIMARY KEY      -- 'spark' | 'boost' | 'mega'
display_name TEXT NOT NULL
tagline      TEXT
price_cents  INTEGER NOT NULL
credits      NUMERIC(20,6) NOT NULL
paddle_price_id     TEXT
paddle_product_id   TEXT
available    BOOLEAN NOT NULL DEFAULT true
accent       TEXT
sort_order   INTEGER NOT NULL DEFAULT 0
```

**New `pricing_price_history` table** — keeps archived (old) Paddle price IDs so
the webhook can still resolve a grandfathered subscriber's price ID back to its
plan/pack:

```
id            UUID PK DEFAULT gen_random_uuid()
paddle_price_id TEXT NOT NULL UNIQUE  -- the archived price id
entity_type   TEXT NOT NULL           -- 'plan' | 'pack'
entity_id     TEXT NOT NULL           -- plan id or pack id
cycle         TEXT                    -- 'monthly' | 'yearly' (plans only)
archived_at   TIMESTAMPTZ NOT NULL DEFAULT now()
```

**New `pricing_audit` table:**

```
id            UUID PK DEFAULT gen_random_uuid()
changed_by    UUID NOT NULL           -- admin user id
entity_type   TEXT NOT NULL           -- 'plan' | 'pack'
entity_id     TEXT NOT NULL
field         TEXT NOT NULL           -- e.g. 'price_monthly_cents', 'credits', 'available'
old_value     TEXT
new_value     TEXT
paddle_price_id_created TEXT          -- null for non-money edits
created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
```

A seed migration backfills `plans` and `credit_packs` from the current
`plans-config.ts` values (and seeds `pricing_price_history` with the current
price IDs so nothing breaks on cutover). RLS: these tables are admin/service-role
only; the public pricing read goes through a server route, not direct table RLS.

### 2. Pricing read path (`getPricing()`)

New server helper in `lib/billing/pricing-source.ts`:

- `getPricing()` reads `plans` + `credit_packs` from the DB (service-role or
  anon-safe read), merges in the static structure from `plans-config.ts` (feature
  lists, accents, taglines), and returns the **same shapes** the codebase uses
  today: `PlanDisplay[]` and `CreditPack[]`.
- Cached in-memory with a short TTL (e.g. 60s) to avoid a DB hit per request;
  cache is busted on admin write.
- `lookupPlanByPriceId()` / `lookupPackByPriceId()` (today in
  [`paddle-mapping.ts`](../../../lib/billing/paddle-mapping.ts)) are reimplemented
  to resolve against the DB:
  - First check the live `plans`/`credit_packs` price IDs.
  - Then fall back to `pricing_price_history` for archived IDs.
  - **Credits are always read from the current plan/pack row**, never frozen per
    price ID — this implements decision #2 (credits update for all at renewal).

**Read sites to refactor** from importing the config to calling `getPricing()` /
the new lookups:

- [`app/api/webhooks/paddle/route.ts`](../../../app/api/webhooks/paddle/route.ts)
  (credit granting + price→plan/pack mapping).
- `app/api/billing/buy-pack`, `app/api/billing/change-plan`,
  `app/api/billing/schedule-plan-change`, `app/api/billing/sync` — anywhere that
  reads plan/pack price IDs or credit amounts.
- [`app/checkout/[planId]/page.tsx`](../../../app/checkout/[planId]/page.tsx) and
  the public [`app/pricing/page.tsx`](../../../app/pricing/page.tsx) + account
  billing UI: these get pricing from a new cached public route
  **`GET /api/pricing`** (or server props) instead of importing the config.

`plans-config.ts` is trimmed to static structure + seed defaults; existing
exported types (`PlanId`, `CreditPackId`, `PlanDisplay`, `CreditPack`) are kept.

### 3. Admin API + Paddle write logic

All routes behind `requireAdmin()` (`lib/api/auth.ts`), service-role client.

- `GET /api/admin/pricing` — returns current `plans` + `credit_packs` from DB +
  recent audit rows.
- `PATCH /api/admin/pricing/plan/[id]` — body may include
  `price_monthly_cents`, `price_yearly_cents`, `monthly_floor` (credits),
  `available`.
- `PATCH /api/admin/pricing/pack/[id]` — body may include `price_cents`,
  `credits`, `available`.

**Money-field change flow (per affected cycle):**

1. Resolve the parent Paddle `product_id`: use cached `paddle_product_id`, else
   `paddle.prices.get(currentPriceId)` → `productId`, then cache it.
2. `paddle.prices.create({ productId, unitPrice: { amount: '<cents>',
   currencyCode: 'USD' }, billingCycle })` — `billingCycle` set for plan
   subscriptions (`{ interval: 'month'|'year', frequency: 1 }`), omitted for
   one-time packs.
3. On success: write the new `pri_...` into the plan/pack row (DB).
4. Insert the **old** price ID into `pricing_price_history`.
5. Archive the old Paddle price: `paddle.prices.update(oldId, { status:
   'archived' })` (stops new checkouts; existing subscriptions are unaffected).
6. Write a `pricing_audit` row with `paddle_price_id_created`.
7. Bust the `getPricing()` cache.

**Ordering & failure handling:**

- Create-in-Paddle → write DB → archive old. If the Paddle create fails, abort
  with no state change. If the DB write fails *after* a successful create, the
  new Paddle price is an orphan (harmless — never referenced) and we send an
  admin alert (existing Resend alert path). No money moves during price creation,
  so there is no refund/clawback concern.
- Archiving the old price is best-effort; failure to archive is logged but does
  not roll back (the new price is already live; the old one being usable a bit
  longer is low-risk).

**Credit/availability-only change flow:** DB write + audit row + cache bust. No
Paddle call.

### 4. Admin UI

New sidebar section `?section=pricing` following the existing
[`app/admin/page.tsx`](../../../app/admin/page.tsx) pattern, gated by the same
admin layout. Two segmented tabs:

- **Plans** — table/cards of the 4 plans. Free is read-only (no Paddle price).
  Editable fields per paid plan: monthly price, yearly price, monthly credits,
  available. Inline edit with a Save action per row.
- **Credit Packs** — the 3 packs. Editable: price, credits, available.

Saving a row that changed a **money** field opens a confirmation modal:

> "This creates a new Paddle price for **<plan/pack>**. Existing subscribers keep
> their current price; new purchases use the new amount. Continue?"

Credit/availability-only saves skip the Paddle warning. A collapsible
**Change history** panel shows recent `pricing_audit` rows (who, what, when).

Frontend talks to the API via typed wrappers in `lib/api/admin-pricing.ts`
(mirroring `lib/api/admin.ts`).

## Data Flow Summary

```
Admin edits price ──▶ PATCH /api/admin/pricing/plan/[id]
                       │  (requireAdmin)
                       ├─ paddle.prices.get → productId
                       ├─ paddle.prices.create($20) → new pri_
                       ├─ UPDATE plans SET paddle_price_id_* , price_*_cents
                       ├─ INSERT pricing_price_history (old pri_)
                       ├─ paddle.prices.update(old, archived)
                       ├─ INSERT pricing_audit
                       └─ bust getPricing() cache

New checkout ────────▶ getPricing() → new pri_  ──▶ Paddle checkout @ $20
Existing sub renews ─▶ webhook: lookupPlanByPriceId(old pri_)
                       → history → plan id → CURRENT credits granted @ old $10
Public /pricing ─────▶ GET /api/pricing → getPricing() → shows $20
```

## Error Handling

- Paddle create failure → 502 to admin, no DB change, surfaced in UI.
- DB write failure after Paddle create → orphan price, admin alert, 500 to admin.
- Invalid input (negative price, non-numeric, zero credits where not allowed) →
  400 with validation message.
- Missing `PADDLE_API_KEY` / insufficient API scope → clear error in UI.

## Testing

No automated test runner in this repo. Verification plan:

- `npx tsc --noEmit` for type safety (per repo memory: lint/build unreliable).
- Manual on Paddle **sandbox**: change Starter monthly price, confirm a new
  sandbox price is created, old is archived, `/pricing` and checkout show the new
  amount, and a brand-new checkout uses the new price.
- Confirm an existing sandbox subscriber on the old price still resolves in the
  webhook (simulate `transaction.completed` with the archived price ID) and gets
  current credits.
- Confirm credit-only and availability-only edits make no Paddle call.
- Confirm audit rows are written for each change.

## Open Risks

- Paddle API key must have write scope for `prices`. Verify in sandbox first.
- The read-site refactor touches several billing routes; each must be checked to
  ensure it no longer imports the config's mutable fields directly.
