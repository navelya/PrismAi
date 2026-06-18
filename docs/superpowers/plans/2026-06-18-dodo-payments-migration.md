# Dodo Payments Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Paddle with Dodo Payments as the sole payment provider (subscriptions + credit packs), keeping all existing billing/credits logic, and make every plan/pack attribute fully admin-editable from the DB so edits propagate everywhere (home, pricing, account, legal).

**Architecture:** Dodo's model is simpler than Paddle — **price lives on the product** (one Dodo product per plan-cycle and per pack; price is updated *in place*, no archived price IDs). Checkout is a **server-created hosted checkout session** (redirect to `checkout_url`, no client SDK/token). Webhooks use the **`standardwebhooks`** spec. We move ALL plan/pack content (name, tagline, features, accent, prices, credits) into the `plans`/`credit_packs` tables; admin CRUD writes the DB and syncs Dodo products via API; all display surfaces read the DB through the existing `pricing-source` / `usePricing` layer. Clean cutover: Paddle code is removed, no live-subscription migration.

**Tech Stack:** Next.js (app router), Supabase (Postgres + RLS + RPC), `dodopayments` Node SDK, `standardwebhooks`, TypeScript, Zustand store, Tailwind.

## Global Constraints

- **No test runner exists.** Verify every task with `npx tsc --noEmit` (authoritative — `npm run lint`/`build` are unreliable here per repo memory). Integration "tests" are ad-hoc scripts in `scripts/` run with `node scripts/<file>.js` against live sandbox + env.
- **Money is integer cents** everywhere (DB `*_cents`, Dodo `price`/`product_price` fields). Credits are NUMERIC.
- **Env var names:** server `DODO_API_KEY`, `DODO_ENVIRONMENT` (value `sandbox` → SDK `test_mode`; `live`/`production` → `live_mode`), `DODO_WEBHOOK_KEY` (signing secret, created in Task 13). No `NEXT_PUBLIC_DODO_*` — checkout is server-side redirect.
- **Dodo SDK:** `import DodoPayments from 'dodopayments'`; `new DodoPayments({ bearerToken: process.env.DODO_API_KEY, environment })`. Resources: `products.{create,update,archive}`, `subscriptions.{create,changePlan,charge,update,retrieve}`, `checkoutSessions.create`, `customers.{create,retrieve}`, `refunds.create`, `webhooks.create`.
- **Dodo price object:** `RecurringPrice { type:'recurring_price', price:<cents>, currency:'USD', payment_frequency_count:1, payment_frequency_interval:'Month'|'Year', subscription_period_count:1, subscription_period_interval:'Month'|'Year' }`; `OneTimePrice { type:'one_time_price', price:<cents>, currency:'USD' }`. `tax_category:'saas'` for plans, `'digital_products'` for packs. `products.update(id,{price})` updates price in place.
- **Webhook payload:** `{ business_id, type: WebhookEventType, timestamp, data }`; `data` is discriminated on `payload_type` (`'Payment'|'Subscription'|'Refund'|'Dispute'|...`). `metadata` set at checkout flows back on `data`. Events used: `payment.succeeded`, `payment.failed`, `subscription.active`, `subscription.renewed`, `subscription.on_hold`, `subscription.cancelled`, `subscription.expired`, `subscription.plan_changed`, `refund.succeeded`, `dispute.opened`, `dispute.won`, `dispute.lost`.
- **Idempotency:** every credit grant/clawback goes through an RPC keyed by a unique `idempotency_key` (pattern `dodo:<event_type>:<payment_or_sub_id>` / `dodo:tx:<payment_id>`). Replays are no-ops.
- **Refund-before-dispatch accounting must survive** — `/api/executions/start` debit + `refund_tokens` RPC path is unchanged by this migration. Do not touch execution-cost code.
- **Service-role Supabase client** only in the webhook/cron/scripts. User-facing billing routes use the RLS session client + SECURITY DEFINER RPCs.
- **CLAUDE.md env block + ARCHITECTURE/DEPLOYMENT/STARTUP docs** must be updated from Paddle→Dodo as part of the relevant tasks.

---

## File Structure

**New files**
- `lib/billing/dodo-server.ts` — SDK singleton + env resolution.
- `lib/billing/dodo-products.ts` — build Price objects; create/update/archive plan & pack products; `syncPlanProducts`, `syncPackProduct`.
- `app/api/webhooks/dodo/route.ts` — webhook ingestion (replaces paddle route).
- `app/api/billing/checkout/route.ts` — server-creates a Dodo checkout session, returns `{ url }`.
- `app/api/admin/pricing/plan/route.ts` — POST create plan (+ existing `[id]` for PATCH/DELETE).
- `app/api/admin/pricing/pack/route.ts` — POST create pack (+ existing `[id]` for PATCH/DELETE).
- `app/api/admin/pricing/sync/route.ts` — POST: (re)sync all/one item to Dodo.
- `supabase/migrations/20260618_dodo_payments.sql` — schema + content backfill + RPCs.
- `scripts/dodo-provision.js` — create/refresh Dodo products from DB, write product IDs back.
- `scripts/dodo-setup-webhook.js` — create the Dodo webhook endpoint, print/append `DODO_WEBHOOK_KEY`.
- `scripts/verify-dodo-pricing.js` — read-only sanity check (DB rows ↔ Dodo products).

**Modified files**
- `lib/billing/plans-config.ts` — strip hardcoded Paddle IDs; keep only static *fallback* defaults + types; content now DB-sourced.
- `lib/billing/pricing-source.ts` — read/serve new content columns; `lookupPlanByProductId`/`lookupPackByProductId`; drop Paddle price-history lookups.
- `lib/billing/use-pricing.ts` — surface new content fields in the client snapshot.
- `lib/billing/cost.ts` — unchanged (verify only).
- `app/api/billing/{change-plan,buy-pack,cancel,resume,schedule-plan-change,payment-method,sync,invoices,...}/route.ts` — port Paddle→Dodo.
- `app/api/pricing/route.ts` — return new content fields.
- `app/api/admin/pricing/route.ts` — return content + Dodo product IDs + sync status.
- `app/api/admin/pricing/plan/[id]/route.ts`, `.../pack/[id]/route.ts` — PATCH all fields + DELETE; sync Dodo.
- `app/checkout/[planId]/page.tsx` — redirect via `/api/billing/checkout` (no Paddle.js).
- `components/admin/PricingAdminContent.tsx` — full CRUD UI (add/remove, all fields, features editor, sync).
- `components/marketing/HomeClient.tsx`, `components/billing/PlansModal.tsx`, `components/billing/PlanBillingView.tsx`, `components/account/*` — read content from DB snapshot.
- `app/legal/refund/page.tsx`, `app/legal/terms/page.tsx`, `app/legal/privacy/page.tsx` — merchant-of-record Paddle→Dodo; pull plan facts from DB.
- `CLAUDE.md`, `ARCHITECTURE.md`, `DEPLOYMENT.md`, `STARTUP.md`, `.env.local.example` — Paddle→Dodo env + notes.

**Deleted files**
- `lib/billing/paddle-client.ts`, `lib/billing/paddle-server.ts`, `lib/billing/paddle-pricing.ts`, `app/api/webhooks/paddle/route.ts`.
- `@paddle/paddle-js`, `@paddle/paddle-node-sdk` removed from `package.json`.

---

## PHASE 1 — Data model & content migration

### Task 1: DB migration — schema, content backfill, RPCs

**Files:**
- Create: `supabase/migrations/20260618_dodo_payments.sql`
- Reference (read for column names/RPC bodies to mirror): `supabase/migrations/20260506_paddle_billing.sql`, `20260520_refund_chargeback_handling.sql`, `20260602_admin_pricing_panel.sql`, `20260505_credits_system.sql`

**Interfaces:**
- Produces (DB):
  - `plans` new cols: `tagline text`, `features jsonb NOT NULL DEFAULT '[]'`, `accent text NOT NULL DEFAULT 'neutral'`, `dodo_product_id_monthly text`, `dodo_product_id_yearly text`.
  - `credit_packs` new cols: `tagline text`, `accent text NOT NULL DEFAULT 'neutral'`, `dodo_product_id text`.
  - `subscriptions` new cols: `dodo_customer_id text`, `dodo_subscription_id text`, `dodo_product_id text`. (Paddle cols left in place but unused.)
  - `token_ledger.reason` CHECK extended with `'dodo_pack_purchase','dodo_subscription_grant','dodo_refund','dodo_chargeback'`. `token_ledger` gets `dodo_event_id text` (idempotency/event ref).
  - RPCs (SECURITY DEFINER): `dodo_subscription_upsert(...)`, `dodo_refund_clawback(...)`, `dodo_chargeback_clawback(...)` — mirror the `paddle_*` equivalents 1:1, swapping the id columns to `dodo_*` and reason strings to `dodo_*`.
  - `pricing_audit.dodo_product_id_synced text` (nullable) replacing the Paddle-specific audit column usage (keep old column nullable).

- [ ] **Step 1: Read the four reference migrations** to copy exact column types and RPC bodies. Pay attention to `credit_tokens` signature (it already takes `p_stripe_event_id` and `p_idempotency_key`) and the `paddle_subscription_upsert` / `paddle_refund_clawback` / `paddle_chargeback_clawback` bodies.

- [ ] **Step 2: Write the migration.** Structure:
```sql
-- 20260618_dodo_payments.sql  (clean cutover Paddle -> Dodo)
begin;

-- 1. plans: content + dodo product ids
alter table public.plans
  add column if not exists tagline text,
  add column if not exists features jsonb not null default '[]'::jsonb,
  add column if not exists accent text not null default 'neutral',
  add column if not exists dodo_product_id_monthly text,
  add column if not exists dodo_product_id_yearly text;

-- 2. credit_packs: content + dodo product id
alter table public.credit_packs
  add column if not exists tagline text,
  add column if not exists accent text not null default 'neutral',
  add column if not exists dodo_product_id text;

-- 3. subscriptions: dodo identifiers
alter table public.subscriptions
  add column if not exists dodo_customer_id text,
  add column if not exists dodo_subscription_id text,
  add column if not exists dodo_product_id text;

-- 4. token_ledger: dodo reasons + event id
alter table public.token_ledger
  add column if not exists dodo_event_id text;
alter table public.token_ledger drop constraint if exists token_ledger_reason_check;
alter table public.token_ledger add constraint token_ledger_reason_check
  check (reason in (
    /* keep ALL existing reasons verbatim from 20260506/20260520, then add: */
    'dodo_pack_purchase','dodo_subscription_grant','dodo_refund','dodo_chargeback'
  ));

-- 5. pricing_audit: generic synced-id column
alter table public.pricing_audit
  add column if not exists dodo_product_id_synced text;

-- 6. CONTENT BACKFILL from the (about-to-be-removed) hardcoded plans-config.ts.
--    Values copied verbatim from lib/billing/plans-config.ts at plan time.
update public.plans set tagline = v.tagline, features = v.features::jsonb, accent = v.accent
from (values
  ('free',    '<tagline>', '<features json>', '<accent>'),
  ('starter', '<tagline>', '<features json>', '<accent>'),
  ('pro',     '<tagline>', '<features json>', '<accent>'),
  ('studio',  '<tagline>', '<features json>', '<accent>')
) as v(id, tagline, features, accent)
where public.plans.id = v.id;

update public.credit_packs set tagline = v.tagline, accent = v.accent
from (values
  ('spark','<tagline>','<accent>'),
  ('boost','<tagline>','<accent>'),
  ('mega', '<tagline>','<accent>')
) as v(id, tagline, accent)
where public.credit_packs.id = v.id;

-- 7. RPCs: copy paddle_subscription_upsert / paddle_refund_clawback /
--    paddle_chargeback_clawback bodies verbatim into dodo_* names, replacing
--    paddle_* column refs with dodo_* and reason 'paddle_*' -> 'dodo_*'.
--    (full bodies inlined here — see reference migrations)

commit;
```
**IMPORTANT for the implementer:** Replace every `<...>` placeholder with the *actual* current values read from `lib/billing/plans-config.ts` (Task done in same session — read that file first). Inline the *full* RPC bodies; do not leave `/* ... */` comments in the final file.

- [ ] **Step 3: Apply the migration to live Supabase.** This repo applies SQL via the Supabase SQL editor / `scripts/` against the live project. Provide the file path and run the project's apply step (check `scripts/` for an existing `apply-migration` helper; if none, the operator applies via dashboard — log this clearly).

- [ ] **Step 4: Verify** with a read-only script `scripts/verify-dodo-pricing.js` stub that selects `id, tagline, features, accent, dodo_product_id_monthly` from `plans` and prints rows. Expected: 4 plan rows + 3 pack rows with non-null tagline/features.

- [ ] **Step 5: Commit** `git add supabase/migrations/20260618_dodo_payments.sql && git commit -m "feat(billing): dodo payments schema + content backfill + RPCs"`

---

## PHASE 2 — Dodo server library

### Task 2: `lib/billing/dodo-server.ts` — SDK singleton

**Files:** Create `lib/billing/dodo-server.ts`; reference `lib/billing/paddle-server.ts`.

**Interfaces:**
- Produces: `getDodo(): DodoPayments` (cached singleton), `getDodoEnvironment(): 'test_mode'|'live_mode'`.

- [ ] **Step 1: Implement.**
```ts
import DodoPayments from 'dodopayments';

let cached: DodoPayments | null = null;

export function getDodoEnvironment(): 'test_mode' | 'live_mode' {
  const e = (process.env.DODO_ENVIRONMENT || 'sandbox').toLowerCase();
  return e === 'live' || e === 'live_mode' || e === 'production' ? 'live_mode' : 'test_mode';
}

export function getDodo(): DodoPayments {
  if (cached) return cached;
  const bearerToken = process.env.DODO_API_KEY;
  if (!bearerToken) throw new Error('DODO_API_KEY is not set');
  cached = new DodoPayments({ bearerToken, environment: getDodoEnvironment() });
  return cached;
}
```
- [ ] **Step 2:** `npx tsc --noEmit` → PASS. **Step 3:** commit.

### Task 3: `lib/billing/dodo-products.ts` — product/price builders + sync

**Files:** Create `lib/billing/dodo-products.ts`; reference `lib/billing/paddle-pricing.ts`.

**Interfaces:**
- Consumes: `getDodo` (Task 2).
- Produces:
  - `buildRecurringPrice(cents:number, interval:'Month'|'Year'): RecurringPrice`
  - `buildOneTimePrice(cents:number): OneTimePrice`
  - `syncPlanProducts(plan:{id,display_name,tagline,price_cents,price_yearly_cents,dodo_product_id_monthly,dodo_product_id_yearly}): Promise<{monthly:string, yearly:string|null}>` — create product if id missing else `products.update` price; returns product ids.
  - `syncPackProduct(pack:{id,display_name,tagline,price_cents,dodo_product_id}): Promise<{product_id:string}>`
  - `archiveProduct(productId:string): Promise<void>`

- [ ] **Step 1: Implement** using `tax_category:'saas'` for plans, `'digital_products'` for packs, `currency:'USD'`, `payment_frequency_count:1`, `subscription_period_count:1`. For each plan: monthly product (interval `Month`) always; yearly product only if `price_yearly_cents != null`. Create with `products.create({ name, description, tax_category, price })`; update with `products.update(id, { price })`. Return the resolved ids.
- [ ] **Step 2:** `npx tsc --noEmit` → PASS. **Step 3:** commit.

---

## PHASE 3 — Pricing source & config (DB-driven content)

### Task 4: `lib/billing/plans-config.ts` — reduce to fallback defaults + types

**Files:** Modify `lib/billing/plans-config.ts`.

**Interfaces:**
- Produces: same exported `PLANS`, `CREDIT_PACKS`, `getPlanDisplay`, `getCreditPack`, `PlanStatic`, `PackStatic` type names — but with **all Paddle price-ID fields removed** and content kept only as *fallback* defaults. Add `dodoProductIdMonthly?`/`dodoProductIdYearly?` to types as optional (filled from DB).

- [ ] **Step 1:** Delete `paddlePriceIdMonthly/Yearly`, `paddlePriceId` fields. Keep `id,name,tagline,priceMonthly,priceYearly,monthlyCredits,signupBonus,features,accent,available`. Add optional `dodoProductId*` to the type. Keep the current values as the offline fallback.
- [ ] **Step 2:** `npx tsc --noEmit` (expect downstream type errors where Paddle fields were read — those files are fixed in later tasks; if errors are ONLY in not-yet-migrated paddle files, note and proceed). **Step 3:** commit.

### Task 5: `lib/billing/pricing-source.ts` — serve content, map by product id

**Files:** Modify `lib/billing/pricing-source.ts`.

**Interfaces:**
- Consumes: `plans`/`credit_packs` rows incl. new content cols.
- Produces:
  - `getPricing()` returns plans/packs with `{id,name,tagline,features,accent,priceMonthly,priceYearly,monthlyCredits,signupBonus,available,dodoProductIdMonthly,dodoProductIdYearly}` and packs `{id,name,tagline,accent,price,credits,available,dodoProductId}` — merge DB over fallback.
  - `lookupPlanByProductId(productId): {planId, cycle:'monthly'|'yearly'} | null`
  - `lookupPackByProductId(productId): {packId} | null`
  - `monthlyCreditsForPlan(planId)`, `creditsForPack(packId)` (unchanged behavior).
  - `bustPricingCache()` (keep).
- Remove: `lookupPlanByPriceId`/`lookupPackByPriceId` Paddle-history lookups (no history table needed — product ids are stable).

- [ ] **Step 1:** Rewrite the DB select to pull new columns and map by `dodo_product_id_monthly/yearly`/`dodo_product_id`. Keep the 60s in-process cache + static fallback.
- [ ] **Step 2:** `npx tsc --noEmit` (Paddle-route errors expected until Phase 4). **Step 3:** commit.

### Task 6: `lib/billing/use-pricing.ts` + `app/api/pricing/route.ts` — content to client

**Files:** Modify `lib/billing/use-pricing.ts`, `app/api/pricing/route.ts`.

**Interfaces:**
- Produces: `/api/pricing` JSON includes `tagline,features,accent` for plans and `tagline,accent` for packs; `usePricing()` snapshot exposes the same. **Never** expose Dodo product IDs or any secret to the client beyond what checkout needs (checkout is server-side, so product IDs stay server-only).

- [ ] **Step 1:** Extend the public route's projection + the hook's type. **Step 2:** `npx tsc --noEmit` → PASS. **Step 3:** commit.

---

## PHASE 4 — User-facing billing routes (Paddle→Dodo port)

> Each route mirrors the existing Paddle route's *logic*; only the provider calls + id columns change. Read the existing file, then apply the transformation. After each task: `npx tsc --noEmit` + commit.

### Task 7: `app/api/billing/checkout/route.ts` (new) + checkout page

**Files:** Create `app/api/billing/checkout/route.ts`; modify `app/checkout/[planId]/page.tsx`; delete `lib/billing/paddle-client.ts`.

**Interfaces:**
- Consumes: `getDodo`, `getPricing`, RLS session client (for the signed-in user + their `dodo_customer_id`).
- Produces: `POST /api/billing/checkout {planId, cycle:'monthly'|'yearly'}` → `{ url }`. Server: resolve product id from pricing source; build `checkoutSessions.create({ product_cart:[{product_id, quantity:1}], customer: existingCustomerId ? {customer_id} : {email,name}, metadata:{ user_id, kind:'subscription', plan_id, cycle }, subscription_data:{}, return_url:`${APP_URL}/billing/success` })`; return `checkout_url`.

- [ ] **Step 1:** Implement the route. **Step 2:** Rewrite `app/checkout/[planId]/page.tsx` to POST to this route on confirm and `window.location.href = url` (remove all `@paddle/paddle-js`, frame target, `updateItems`). Keep the cycle toggle + legal links; merchant-of-record text → "Dodo Payments". **Step 3:** `npx tsc --noEmit`. **Step 4:** commit.

### Task 8: `buy-pack` route — `subscriptions.charge` or checkout

**Files:** Modify `app/api/billing/buy-pack/route.ts`.

**Interfaces:**
- Logic mirror: active Dodo sub → `subscriptions.charge(dodo_subscription_id, { product_price: <pack price cents>, metadata:{ user_id, kind:'pack', pack_id } })` (silent, reuses mandate). No active sub → return `{ requiresCheckout:true, url }` where url is a one-time `checkoutSessions.create` with the pack product in `product_cart` + `metadata.kind='pack'`. Credit grant happens on `payment.succeeded` webhook keyed by payment id. Keep the `payment_disputed_at` gate.

- [ ] **Step 1:** Port. **Step 2:** tsc. **Step 3:** commit.

### Task 9: `change-plan` + `schedule-plan-change` + `cancel` + `resume`

**Files:** Modify `app/api/billing/change-plan/route.ts`, `schedule-plan-change/route.ts`, `cancel/route.ts`, `resume/route.ts`.

**Interfaces:**
- `change-plan`: `subscriptions.changePlan(dodo_subscription_id, { product_id:<new>, proration_billing_mode:'prorated_immediately', effective_at:'immediately' })`. Keep `payment_disputed_at` gate + `pending_plan_change` clearing.
- `schedule-plan-change`: same but `effective_at:'next_billing_date'` (or store `pending_plan_change_product_id`).
- `cancel`: `subscriptions.update(dodo_subscription_id, { cancel_at_next_billing_date:true })` for period-end; immediate = `{ status:'cancelled' }`.
- `resume`: `subscriptions.update(id, { cancel_at_next_billing_date:false })`.

- [ ] **Step 1:** Port all four. **Step 2:** tsc. **Step 3:** commit.

### Task 10: `payment-method` + `sync` + `invoices` + remaining billing routes

**Files:** Modify `app/api/billing/payment-method/route.ts`, `sync/route.ts`, `invoices/route.ts`, `invoices/[id]/pdf/route.ts`, and any other `app/api/billing/*` still importing Paddle (grep `paddle` under `app/api/billing`).

**Interfaces:**
- `payment-method`: `subscriptions.updatePaymentMethod(id, { type:'new', return_url })` → return its URL (Dodo customer/payment portal).
- `sync`: `subscriptions.retrieve(dodo_subscription_id)` → upsert row via `dodo_subscription_upsert` RPC.
- `invoices`: `payments.list({ customer_id })` / Dodo invoice endpoint; map to the existing response shape. If Dodo lacks a direct PDF, return the hosted invoice URL.

- [ ] **Step 1:** Port; grep to ensure no `@paddle` import remains under `app/api/billing`. **Step 2:** tsc. **Step 3:** commit.

---

## PHASE 5 — Webhook

### Task 11: `app/api/webhooks/dodo/route.ts` (new)

**Files:** Create `app/api/webhooks/dodo/route.ts`; delete `app/api/webhooks/paddle/route.ts`; reference the deleted file for grant-cap / refund / chargeback logic to preserve.

**Interfaces:**
- Consumes: `standardwebhooks` `Webhook(process.env.DODO_WEBHOOK_KEY)`, `createServiceClient()`, `getPricing`/`lookupPlanByProductId`/`lookupPackByProductId`, RPCs `credit_tokens`, `dodo_subscription_upsert`, `dodo_refund_clawback`, `dodo_chargeback_clawback`.
- Runtime: `nodejs` (not edge). Read **raw** body for signature verification.

- [ ] **Step 1: Signature + routing skeleton.**
```ts
export const runtime = 'nodejs';
import { Webhook } from 'standardwebhooks';
// read raw text body; verify with headers webhook-id/webhook-signature/webhook-timestamp
const wh = new Webhook(process.env.DODO_WEBHOOK_KEY!);
await wh.verify(rawBody, { 'webhook-id':..., 'webhook-signature':..., 'webhook-timestamp':... }); // 401 on fail
const evt = JSON.parse(rawBody); // { type, data, business_id, timestamp }
```
- [ ] **Step 2: Map events** (port the Paddle handlers' *intent*):
  - `payment.succeeded` → if `metadata.kind==='pack'` grant pack credits (idempotency `dodo:tx:<payment_id>`); if it's the initial subscription payment, the grant is handled by `subscription.active`/`renewed` (avoid double-grant — gate by metadata.kind / payload).
  - `subscription.active` & `subscription.renewed` → resolve plan via `lookupPlanByProductId(product_id)`, grant `monthlyCreditsForPlan` with **the same billing-period cap logic** the Paddle handler used (anchor at most recent fresh-period grant; `min(wouldGrant, maxCredits - alreadyGranted)`), upsert subscription via `dodo_subscription_upsert`. Idempotency `dodo:sub:<subscription_id>:<period>`.
  - `subscription.plan_changed`/`subscription.updated` → upsert row (no re-grant on same-cycle swap, mirror Paddle).
  - `subscription.cancelled`/`subscription.expired`/`subscription.on_hold` → set status, no grant.
  - `refund.succeeded` → `dodo_refund_clawback` (cap clawback at balance; admin alert on shortfall/partial).
  - `dispute.opened`/`dispute.lost` → `dodo_chargeback_clawback` (force, allow negative) + set `payment_disputed_at` + cancel sub via API + admin alert. `dispute.won` → admin alert to manually restore.
  - Map user via `metadata.user_id`, fallback `dodo_customer_id` lookup; never grant if unresolved.
- [ ] **Step 3:** `npx tsc --noEmit` → PASS.
- [ ] **Step 4:** Adversarial self-review of double-grant + idempotency + cap logic against the old Paddle file (request-code-review style). **Step 5:** commit.

---

## PHASE 6 — Admin CRUD + Dodo sync

### Task 12: Admin API — create/edit/delete/sync

**Files:** Modify `app/api/admin/pricing/route.ts`, `app/api/admin/pricing/plan/[id]/route.ts`, `app/api/admin/pricing/pack/[id]/route.ts`; create `app/api/admin/pricing/plan/route.ts` (POST), `app/api/admin/pricing/pack/route.ts` (POST), `app/api/admin/pricing/sync/route.ts` (POST).

**Interfaces:**
- All admin routes use `requireAdmin()` + RLS session client; **Dodo product mutations** go through `syncPlanProducts`/`syncPackProduct` (server SDK). After any write: update DB, call `syncPlan/PackProduct` to create/update Dodo product, store returned ids, `bustPricingCache()`, write `pricing_audit` row.
- `GET /api/admin/pricing` → plans+packs incl. content fields, `dodo_product_id_*`, derived `synced:boolean`, audit (50).
- `PATCH .../plan/[id]` → partial update of ANY field (`display_name,tagline,features,accent,price_cents,price_yearly_cents,monthly_floor,signup_bonus,is_active,sort_order`); re-sync Dodo if price/name changed.
- `POST .../plan` → create new plan row (free-form `id`, validated slug) + create Dodo products.
- `DELETE .../plan/[id]` → archive Dodo products + soft-delete (`is_active=false`) or hard-delete if no subscribers reference it.
- Same trio for packs.
- `POST .../sync` `{ scope:'all'|'plan'|'pack', id? }` → idempotent (re)provision.

- [ ] **Step 1:** Implement POST/PATCH/DELETE/sync. Validate slug ids, prevent deleting a plan with active subscriptions (return 409). **Step 2:** tsc. **Step 3:** commit.

### Task 13: `scripts/dodo-provision.js` + `scripts/dodo-setup-webhook.js`

**Files:** Create both scripts.

**Interfaces:**
- `dodo-provision.js`: load env, service Supabase client, read `plans`+`credit_packs`, for each call `syncPlanProducts`/`syncPackProduct` *logic* (reimplement inline in JS or import compiled — simplest: inline the SDK calls), write `dodo_product_id_*` back, print a summary table. Idempotent.
- `dodo-setup-webhook.js`: `getDodo().webhooks.create({ url:`${NEXT_PUBLIC_APP_URL}/api/webhooks/dodo`, ... })`; capture `.secret`; print it and append `DODO_WEBHOOK_KEY=<secret>` to `.env.local` if absent (never overwrite an existing one).

- [ ] **Step 1:** Implement. **Step 2: RUN** `node scripts/dodo-provision.js` against sandbox — expect Dodo products created + product IDs written to DB (verify with `verify-dodo-pricing.js`). **Step 3: RUN** `node scripts/dodo-setup-webhook.js` — expect endpoint created + `DODO_WEBHOOK_KEY` captured. (If `NEXT_PUBLIC_APP_URL` is localhost, still create it and log that deliverability needs a public URL/tunnel.) **Step 4:** commit (scripts only; never commit `.env.local`).

### Task 14: `components/admin/PricingAdminContent.tsx` — full CRUD UI

**Files:** Modify `components/admin/PricingAdminContent.tsx` (+ small subcomponents if it grows unwieldy); reuse `components/ui/*` primitives and the shared `Modal`/`ConfirmationModal`.

**Interfaces:**
- Consumes: the extended admin API (Task 12).
- Produces: Plans tab + Packs tab each with: list of editable cards (all fields: name, tagline, features list-editor add/remove rows, accent select, monthly $, yearly $, monthly credits, signup bonus, active toggle, sort order), an **Add plan/pack** button (opens shared `Modal` form), per-card **Delete** (ConfirmationModal) and **Sync to Dodo** button + synced/needs-sync badge showing the Dodo product IDs, and a global **Sync all**. Save → PATCH/POST → toast + refresh. **All popups via shared `Modal`** (per CLAUDE.md).

- [ ] **Step 1:** Build the UI against existing admin patterns. **Step 2:** tsc. **Step 3:** commit.

---

## PHASE 7 — Display surfaces & content propagation

### Task 15: Marketing/home + in-app plan UIs read DB content

**Files:** Modify `components/marketing/HomeClient.tsx`, `components/billing/PlansModal.tsx`, `components/billing/PlanBillingView.tsx`, `components/account/AccountModal.tsx` + its `PlanPricingTab`/`CreditsBillingTab`.

**Interfaces:**
- Consumes: `usePricing()` snapshot (now incl. `tagline,features,accent`). Remove any hardcoded plan name/feature/tagline literals; render from the snapshot. Checkout CTAs call `/api/billing/checkout` (Task 7) or open `PlansModal` as before.

- [ ] **Step 1:** Replace hardcoded content reads with snapshot fields across these components. **Step 2:** tsc. **Step 3:** commit.

### Task 16: Legal pages — provider switch + dynamic plan facts

**Files:** Modify `app/legal/refund/page.tsx`, `app/legal/terms/page.tsx`, `app/legal/privacy/page.tsx`.

**Interfaces:**
- Replace every "Paddle"/"Paddle.com Market Limited"/"merchant of record" reference with **Dodo Payments**. Where prices/plan names appear, source them from the pricing layer (server component → `getPricing()`); keep static prose in-code (per decision). Verify no remaining "paddle" string under `app/legal`.

- [ ] **Step 1:** Edit copy + wire any plan-fact references. **Step 2:** tsc + `grep -ri paddle app/legal` → none. **Step 3:** commit.

---

## PHASE 8 — Remove Paddle & finalize

### Task 17: Delete Paddle code, deps, env; update docs

**Files:** Delete `lib/billing/paddle-*.ts`, `app/api/webhooks/paddle/route.ts`; edit `package.json` (drop `@paddle/paddle-js`, `@paddle/paddle-node-sdk`); edit `.env.local.example`, `CLAUDE.md`, `ARCHITECTURE.md`, `DEPLOYMENT.md`, `STARTUP.md`.

- [ ] **Step 1:** `grep -rni "paddle" --include=*.ts --include=*.tsx app lib components scripts` → ZERO functional references (only historical migration files may mention it). Delete dead files.
- [ ] **Step 2:** `npm uninstall @paddle/paddle-js @paddle/paddle-node-sdk`.
- [ ] **Step 3:** Update docs: in `CLAUDE.md` env block, replace the Paddle paragraph with Dodo (`DODO_API_KEY`, `DODO_ENVIRONMENT`, `DODO_WEBHOOK_KEY`; webhook at `/api/webhooks/dodo`; hosted-redirect checkout; product-per-plan-cycle model; admin CRUD syncs Dodo). Mirror in `ARCHITECTURE.md`/`DEPLOYMENT.md`/`STARTUP.md`/`.env.local.example`.
- [ ] **Step 4:** `npx tsc --noEmit` → PASS (whole tree). **Step 5:** commit.

### Task 18: Full verification pass

- [ ] **Step 1:** `npx tsc --noEmit` clean.
- [ ] **Step 2:** `node scripts/verify-dodo-pricing.js` → DB rows ↔ Dodo product IDs all present & consistent.
- [ ] **Step 3:** Manual smoke checklist (documented in plan output, since no e2e runner): admin add a pack → appears on home/pricing; edit a plan price → propagates; checkout redirect builds a valid `checkout_url`; webhook signature verifies on a sample Dodo test event.
- [ ] **Step 4:** Use `superpowers:requesting-code-review` on the full diff (correctness focus: webhook idempotency/cap, refund/chargeback, double-grant, money units).
- [ ] **Step 5:** Final commit + summary.

---

## Self-Review (author)

- **Spec coverage:** clean cutover ✓ (Task 17); full DB-driven CRUD + all copy ✓ (Tasks 1,5,6,12,14,15); auto-switch legal + dynamic facts ✓ (Task 16); CLI provisioning of subscriptions & credits ✓ (Task 13); same billing logic preserved ✓ (Tasks 8–11 mirror Paddle intent incl. grant-cap/refund/chargeback). Admin edits propagate everywhere ✓ (Phase 7 reads the single pricing source).
- **Type consistency:** `lookupPlanByProductId`/`lookupPackByProductId`, `syncPlanProducts`/`syncPackProduct`, `dodo_subscription_upsert`/`dodo_refund_clawback`/`dodo_chargeback_clawback`, `dodo_product_id_monthly/yearly`/`dodo_product_id` used consistently across tasks.
- **Placeholders:** the only `<...>` placeholders are in the migration content-backfill + RPC bodies, which Task 1 explicitly resolves by reading `plans-config.ts` and the reference migrations in-session (cannot be literal here without those file contents). All other steps are concrete.
- **Open risk:** webhook deliverability requires a public `NEXT_PUBLIC_APP_URL`; Task 13 logs this. Operator must apply the migration (Task 1 Step 3) and the run produces `DODO_WEBHOOK_KEY` (Task 13).
