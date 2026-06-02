# Admin Pricing Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin "Pricing" section that edits subscription-plan and credit-pack pricing, auto-creates new Paddle prices for money changes, and makes the DB the live source of truth everywhere pricing is read.

**Architecture:** Mutable pricing moves from the hardcoded `lib/billing/plans-config.ts` into Supabase (`plans` + new `credit_packs`). A cached server helper `getPricing()` returns the existing `PlanDisplay`/`CreditPack` shapes by merging DB rows with the static structure (feature lists/accents) still kept in the config. Server read-sites call `getPricing()` directly; client components fetch a new public `GET /api/pricing`. Admin `PATCH` routes write the DB, and on a price change create a new Paddle price (`paddle.prices.create`), archive the old one, record the old id in a history table (so grandfathered subscribers still resolve), and write an audit row.

**Tech Stack:** Next.js App Router (route handlers + server/client components), Supabase (Postgres + service-role client), `@paddle/paddle-node-sdk`, TypeScript, Tailwind, Lucide icons.

---

## Conventions for this repo (read first)

- **No test runner exists.** "Verify" steps use `npx tsc --noEmit` (per repo memory, `npm run lint`/`build` are unreliable) plus a hand-run integration script under `scripts/` (the repo's existing `node scripts/<file>.js` convention) and a manual sandbox checklist. Do **not** introduce Jest/Vitest.
- **Migrations** live in `supabase/migrations/` named `YYYYMMDD_description.sql`, are idempotent (`IF NOT EXISTS`, `ON CONFLICT`), enable RLS, and rely on the service-role client for writes. Run them against the live Supabase project the same way the team already applies migrations (Supabase SQL editor / CLI) — there is no automated migration runner in this repo.
- **Money is stored in integer cents** in the DB (`price_cents`, `price_yearly_cents`); the `PlanDisplay`/`CreditPack` shapes expose dollars (`priceMonthly` etc.). `getPricing()` does the cents→dollars conversion.
- **Commit after every task** with the exact message shown.

## File Structure

**Create:**
- `supabase/migrations/20260602_admin_pricing_panel.sql` — schema + seed for pricing tables.
- `lib/billing/pricing-source.ts` — `getPricing()`, async `lookupPlanByPriceId`/`lookupPackByPriceId`, `bustPricingCache()`.
- `lib/billing/paddle-pricing.ts` — Paddle price create/archive/product-id helpers.
- `app/api/pricing/route.ts` — public `GET` returning live pricing for client components.
- `app/api/admin/pricing/route.ts` — admin `GET` (plans + packs + recent audit).
- `app/api/admin/pricing/plan/[id]/route.ts` — admin `PATCH` plan.
- `app/api/admin/pricing/pack/[id]/route.ts` — admin `PATCH` pack.
- `lib/api/admin-pricing.ts` — typed client wrapper for the admin pricing API.
- `lib/billing/use-pricing.ts` — `usePricing()` client hook (fetches `/api/pricing`).
- `components/admin/PricingAdminContent.tsx` — the admin Pricing section UI.
- `scripts/verify-pricing.js` — sandbox integration check.

**Modify:**
- `lib/billing/plans-config.ts` — keep static structure + add `getPlanStatic`/`getPackStatic` accessors; keep types/`PLANS`/`CREDIT_PACKS` as static defaults/seed.
- `lib/billing/paddle-mapping.ts` — re-export the new async lookups (back-compat shim) OR delete after callers migrate (Task 3 decides).
- `app/api/webhooks/paddle/route.ts` — use async DB lookups + DB credits.
- `app/api/billing/buy-pack/route.ts`, `change-plan/route.ts`, `schedule-plan-change/route.ts`, `sync/route.ts` — use async DB lookups + `getPricing()`.
- `app/pricing/page.tsx` (server) — use `getPricing()`.
- `components/billing/PlansModal.tsx`, `components/billing/PlanBillingView.tsx`, `app/checkout/[planId]/page.tsx`, `app/billing/success/page.tsx` — use `usePricing()`.
- `app/admin/page.tsx` — add `pricing` section + nav item + import.

---

## Task 1: Migration — pricing tables + seed

**Files:**
- Create: `supabase/migrations/20260602_admin_pricing_panel.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Admin Pricing Panel: DB becomes source of truth for mutable pricing.
-- Extends plans, adds credit_packs, pricing_price_history, pricing_audit.

-- 1. Extend plans (is_active + price_cents already exist).
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS price_yearly_cents INTEGER,
  ADD COLUMN IF NOT EXISTS paddle_product_id  TEXT;

-- Seed yearly prices for existing paid plans (cents). Free stays NULL.
UPDATE public.plans SET price_yearly_cents = 9600  WHERE id = 'starter' AND price_yearly_cents IS NULL;
UPDATE public.plans SET price_yearly_cents = 28800 WHERE id = 'pro'     AND price_yearly_cents IS NULL;
UPDATE public.plans SET price_yearly_cents = 75800 WHERE id = 'studio'  AND price_yearly_cents IS NULL;

-- 2. Credit packs table.
CREATE TABLE IF NOT EXISTS public.credit_packs (
  id                TEXT PRIMARY KEY,
  display_name      TEXT NOT NULL,
  price_cents       INTEGER NOT NULL,
  credits           NUMERIC(20, 6) NOT NULL,
  paddle_price_id   TEXT,
  paddle_product_id TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT credit_packs_price_nonneg   CHECK (price_cents >= 0),
  CONSTRAINT credit_packs_credits_nonneg CHECK (credits >= 0)
);

INSERT INTO public.credit_packs (id, display_name, price_cents, credits, paddle_price_id, sort_order)
VALUES
  ('spark', 'Spark', 500,  400,  'pri_01kqytm9mh25em74b5qqyhm27z', 0),
  ('boost', 'Boost', 1500, 1300, 'pri_01kqytnd6qbyrn3fd5my0vwps9', 1),
  ('mega',  'Mega',  4000, 4000, 'pri_01kqytpgfvenk10v1385483q5j', 2)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.credit_packs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credit_packs_read_active ON public.credit_packs;
CREATE POLICY credit_packs_read_active ON public.credit_packs
  FOR SELECT USING (is_active = true);

-- 3. Archived Paddle price ids -> plan/pack, so grandfathered subs still resolve.
CREATE TABLE IF NOT EXISTS public.pricing_price_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paddle_price_id TEXT NOT NULL UNIQUE,
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('plan', 'pack')),
  entity_id       TEXT NOT NULL,
  cycle           TEXT CHECK (cycle IN ('monthly', 'yearly')),
  archived_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed history with the CURRENT live ids so lookups keep working through cutover.
INSERT INTO public.pricing_price_history (paddle_price_id, entity_type, entity_id, cycle)
VALUES
  ('pri_01kqyt5610btfnb67xrtkb7qvz', 'plan', 'starter', 'monthly'),
  ('pri_01kqyt6mzx7qh85wet1bnf297c', 'plan', 'starter', 'yearly'),
  ('pri_01kqytdt35r7jz9y2kgqgj0tcq', 'plan', 'pro',     'monthly'),
  ('pri_01kqytf0qpxjqjs8myxwtp8ms5', 'plan', 'pro',     'yearly'),
  ('pri_01kqytgjx3bw3bg5xnkerfbayh', 'plan', 'studio',  'monthly'),
  ('pri_01kqyth9sh1jredw1g3ekqr6kf', 'plan', 'studio',  'yearly'),
  ('pri_01kqytm9mh25em74b5qqyhm27z', 'pack', 'spark',   NULL),
  ('pri_01kqytnd6qbyrn3fd5my0vwps9', 'pack', 'boost',   NULL),
  ('pri_01kqytpgfvenk10v1385483q5j', 'pack', 'mega',    NULL)
ON CONFLICT (paddle_price_id) DO NOTHING;

ALTER TABLE public.pricing_price_history ENABLE ROW LEVEL SECURITY;
-- No SELECT policy: service-role only (webhook/admin read via service client).

-- 4. Audit trail for every pricing change.
CREATE TABLE IF NOT EXISTS public.pricing_audit (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  changed_by             UUID NOT NULL,
  entity_type            TEXT NOT NULL CHECK (entity_type IN ('plan', 'pack')),
  entity_id              TEXT NOT NULL,
  field                  TEXT NOT NULL,
  old_value              TEXT,
  new_value              TEXT,
  paddle_price_id_created TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.pricing_audit ENABLE ROW LEVEL SECURITY;
-- No SELECT policy: service-role only.
```

- [ ] **Step 2: Apply the migration**

Apply against the project's Supabase (SQL editor or CLI), the same way other migrations in `supabase/migrations/` are applied. There is no repo runner.

Verify in Supabase:
- `select id, price_cents, price_yearly_cents, is_active from plans order by sort_order;` → starter/pro/studio have monthly + yearly cents.
- `select * from credit_packs order by sort_order;` → 3 rows.
- `select count(*) from pricing_price_history;` → 9.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260602_admin_pricing_panel.sql
git commit -m "feat(billing): add pricing tables (credit_packs, price history, audit)"
```

---

## Task 2: `getPricing()` source-of-truth helper

**Files:**
- Modify: `lib/billing/plans-config.ts` (add static accessors; keep existing exports)
- Create: `lib/billing/pricing-source.ts`

- [ ] **Step 1: Add static accessors to `plans-config.ts`**

Append at the end of `lib/billing/plans-config.ts` (keeps all existing exports intact):

```typescript
// =============================================================================
// STATIC STRUCTURE ACCESSORS (non-pricing fields kept in code)
// =============================================================================
// getPricing() merges DB pricing onto these. name/tagline/features/accent are
// editorial and stay in code; price/credits/availability/paddle ids come from DB.

export function getPlanStatic(id: string): Pick<PlanDisplay, 'name' | 'tagline' | 'features' | 'accent'> | null {
    const p = PLANS.find(x => x.id === id);
    if (!p) return null;
    return { name: p.name, tagline: p.tagline, features: p.features, accent: p.accent };
}

export function getPackStatic(id: string): Pick<CreditPack, 'name' | 'tagline' | 'accent'> | null {
    const p = CREDIT_PACKS.find(x => x.id === id);
    if (!p) return null;
    return { name: p.name, tagline: p.tagline, accent: p.accent };
}
```

- [ ] **Step 2: Create `lib/billing/pricing-source.ts`**

```typescript
/**
 * Runtime source of truth for plan / credit-pack pricing.
 *
 * Reads the `plans` and `credit_packs` tables (service-role) and merges the
 * editorial fields (name/tagline/features/accent) from plans-config.ts, then
 * returns the SAME shapes the codebase already uses (PlanDisplay / CreditPack)
 * so call sites barely change.
 *
 * Cached in-process for a short TTL to keep the webhook hot path cheap. Admin
 * writes call bustPricingCache().
 */
import { createServiceClient } from '@/lib/supabase/service';
import {
    PLANS,
    CREDIT_PACKS,
    getPlanStatic,
    getPackStatic,
    type PlanDisplay,
    type CreditPack,
    type PlanId,
    type CreditPackId,
} from './plans-config';

interface PlanRow {
    id: string;
    display_name: string;
    monthly_floor: number | string;
    signup_bonus: number | string;
    price_cents: number | null;
    price_yearly_cents: number | null;
    paddle_price_id_monthly: string | null;
    paddle_price_id_yearly: string | null;
    paddle_product_id: string | null;
    is_active: boolean;
    sort_order: number;
}

interface PackRow {
    id: string;
    display_name: string;
    price_cents: number;
    credits: number | string;
    paddle_price_id: string | null;
    paddle_product_id: string | null;
    is_active: boolean;
    sort_order: number;
}

interface HistoryRow {
    paddle_price_id: string;
    entity_type: 'plan' | 'pack';
    entity_id: string;
    cycle: 'monthly' | 'yearly' | null;
}

export interface PricingSnapshot {
    plans: PlanDisplay[];
    packs: CreditPack[];
    history: HistoryRow[];
}

const TTL_MS = 60_000;
let cache: { snapshot: PricingSnapshot; at: number } | null = null;

function mapPlan(row: PlanRow): PlanDisplay {
    const stat = getPlanStatic(row.id);
    return {
        id: row.id as PlanId,
        name: stat?.name ?? row.display_name,
        tagline: stat?.tagline ?? '',
        priceMonthly: Number(row.price_cents ?? 0) / 100,
        priceYearly: row.price_yearly_cents != null ? Number(row.price_yearly_cents) / 100 : undefined,
        monthlyCredits: Number(row.monthly_floor),
        signupBonus: Number(row.signup_bonus),
        features: stat?.features ?? [],
        accent: stat?.accent ?? 'neutral',
        available: row.is_active,
        paddlePriceIdMonthly: row.paddle_price_id_monthly ?? undefined,
        paddlePriceIdYearly: row.paddle_price_id_yearly ?? undefined,
    };
}

function mapPack(row: PackRow): CreditPack {
    const stat = getPackStatic(row.id);
    return {
        id: row.id as CreditPackId,
        name: stat?.name ?? row.display_name,
        tagline: stat?.tagline ?? '',
        price: Number(row.price_cents) / 100,
        credits: Number(row.credits),
        accent: stat?.accent ?? 'neutral',
        available: row.is_active,
        paddlePriceId: row.paddle_price_id ?? undefined,
    };
}

async function loadSnapshot(): Promise<PricingSnapshot> {
    const supabase = createServiceClient();
    const [plansRes, packsRes, histRes] = await Promise.all([
        supabase.from('plans').select('*').order('sort_order'),
        supabase.from('credit_packs').select('*').order('sort_order'),
        supabase.from('pricing_price_history').select('paddle_price_id, entity_type, entity_id, cycle'),
    ]);

    if (plansRes.error || packsRes.error || histRes.error) {
        // Fall back to static config so reads never hard-fail.
        return { plans: PLANS, packs: CREDIT_PACKS, history: [] };
    }

    return {
        plans: (plansRes.data as PlanRow[]).map(mapPlan),
        packs: (packsRes.data as PackRow[]).map(mapPack),
        history: histRes.data as HistoryRow[],
    };
}

export async function getPricing(): Promise<PricingSnapshot> {
    const now = Date.now();
    if (cache && now - cache.at < TTL_MS) return cache.snapshot;
    const snapshot = await loadSnapshot();
    cache = { snapshot, at: now };
    return snapshot;
}

export function bustPricingCache(): void {
    cache = null;
}

export interface PlanPriceLookup {
    planId: PlanId;
    cycle: 'monthly' | 'yearly';
}

export interface PackPriceLookup {
    packId: CreditPackId;
}

/** Resolve a Paddle price id to a plan + cycle (live or archived). */
export async function lookupPlanByPriceId(priceId: string): Promise<PlanPriceLookup | null> {
    const snap = await getPricing();
    for (const p of snap.plans) {
        if (p.paddlePriceIdMonthly === priceId) return { planId: p.id, cycle: 'monthly' };
        if (p.paddlePriceIdYearly === priceId) return { planId: p.id, cycle: 'yearly' };
    }
    const h = snap.history.find(x => x.paddle_price_id === priceId && x.entity_type === 'plan');
    if (h) return { planId: h.entity_id as PlanId, cycle: (h.cycle ?? 'monthly') as 'monthly' | 'yearly' };
    return null;
}

/** Resolve a Paddle price id to a credit pack (live or archived). */
export async function lookupPackByPriceId(priceId: string): Promise<PackPriceLookup | null> {
    const snap = await getPricing();
    const live = snap.packs.find(p => p.paddlePriceId === priceId);
    if (live) return { packId: live.id };
    const h = snap.history.find(x => x.paddle_price_id === priceId && x.entity_type === 'pack');
    if (h) return { packId: h.entity_id as CreditPackId };
    return null;
}

/** Current granted monthly credits for a plan (always the live value). */
export async function monthlyCreditsForPlan(planId: string): Promise<number> {
    const snap = await getPricing();
    return snap.plans.find(p => p.id === planId)?.monthlyCredits ?? 0;
}

/** Current credits for a pack (live value). */
export async function creditsForPack(packId: string): Promise<number> {
    const snap = await getPricing();
    return snap.packs.find(p => p.id === packId)?.credits ?? 0;
}
```

Note: confirm the service client import path/name in Step 3 before relying on it.

- [ ] **Step 3: Verify the service-client import**

Run: `npx tsc --noEmit`
If it errors on `createServiceClient`/`@/lib/supabase/service`, open `lib/supabase/service.ts`, read its actual export name, and fix the import in `pricing-source.ts` to match. Re-run `npx tsc --noEmit` until clean for this file.

- [ ] **Step 4: Commit**

```bash
git add lib/billing/plans-config.ts lib/billing/pricing-source.ts
git commit -m "feat(billing): add getPricing() DB source of truth + price lookups"
```

---

## Task 3: Refactor the Paddle webhook to DB pricing

**Files:**
- Modify: `app/api/webhooks/paddle/route.ts`

- [ ] **Step 1: Swap the imports**

Replace the two import lines (currently around lines 20–21):

```typescript
import { lookupPlanByPriceId, lookupPackByPriceId } from '@/lib/billing/paddle-mapping';
import { PLANS } from '@/lib/billing/plans-config';
```

with:

```typescript
import {
    lookupPlanByPriceId,
    lookupPackByPriceId,
    monthlyCreditsForPlan,
    creditsForPack,
} from '@/lib/billing/pricing-source';
```

- [ ] **Step 2: Await the lookups + read credit amounts from DB**

The lookups are now async AND no longer carry credit amounts (the old `PackLookup.credits` / `PlanLookup.monthlyCredits` are gone — credits are always read live from the plan/pack row, per the "credits update for everyone" decision). Update each call site (line numbers from current file; match by code):

**Pack grant (lines ~214–230).** The lookup loses `.credits`; fetch it live:
```typescript
const pack = await lookupPackByPriceId(priceId);
if (pack) {
    const packCredits = await creditsForPack(pack.packId);
    await grantCredits(supabase, {
        userId,
        amount: packCredits,            // was pack.credits
        reason: 'paddle_pack_purchase',
        idempotencyKey: `paddle:tx:${data.id}:item:${priceId}`,
        paddleEventId: eventId,
        metadata: {
            paddle_transaction_id: data.id,
            paddle_price_id: priceId,
            pack_id: pack.packId,
        },
    });
    continue;
}
```

**Plan lookup (line ~233):**
```typescript
const plan = await lookupPlanByPriceId(priceId);
```

**Plan grant (line ~249).** The lookup loses `.monthlyCredits`; fetch it live and keep the existing `rate`/cap logic intact:
```typescript
const rate = parseProrationRate(item.proration);
const planMonthlyCredits = await monthlyCreditsForPlan(plan.planId);
const wouldGrant = Math.max(0, Math.round(planMonthlyCredits * rate));
if (wouldGrant === 0) continue;
```

Also update the first plan lookup near line 100:
```typescript
const lookup = priceId ? await lookupPlanByPriceId(priceId) : null;
```
(Anywhere downstream metadata stored `plan.monthlyCredits`, store `planMonthlyCredits` instead.)

- [ ] **Step 3: Replace the local `monthlyCreditsForPlan` helper**

Delete the local helper (current lines ~374–377):

```typescript
function monthlyCreditsForPlan(planId: string): number {
    const plan = PLANS.find((p) => p.id === planId);
    return plan?.monthlyCredits ?? 0;
}
```

Find its caller (around line 322, `incomingPlanCredits`) and make it await the imported async version:

```typescript
const incomingPlanCredits = await monthlyCreditsForPlan(incomingPlanId);
```

Ensure the enclosing function is `async` (it is — it's a webhook handler path). If `incomingPlanCredits` is computed inside a non-async helper, make that helper `async` and `await` its callers.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no errors in `app/api/webhooks/paddle/route.ts`. Fix any missed `await` (TS will flag `Property 'planId' does not exist on type 'Promise<...>'`).

- [ ] **Step 5: Commit**

```bash
git add app/api/webhooks/paddle/route.ts
git commit -m "refactor(webhook): resolve plan/pack pricing from DB not config"
```

---

## Task 4: Refactor billing routes to DB pricing

**Files:**
- Modify: `app/api/billing/buy-pack/route.ts`
- Modify: `app/api/billing/change-plan/route.ts`
- Modify: `app/api/billing/schedule-plan-change/route.ts`
- Modify: `app/api/billing/sync/route.ts`

- [ ] **Step 1: `buy-pack/route.ts`**

Replace imports (lines ~36–37):
```typescript
import { lookupPackByPriceId } from '@/lib/billing/paddle-mapping';
import { CREDIT_PACKS } from '@/lib/billing/plans-config';
```
with:
```typescript
import { getPricing, lookupPackByPriceId } from '@/lib/billing/pricing-source';
```

Replace the pack lookup (lines ~80–89):
```typescript
const { packs } = await getPricing();
const pack = packs.find((p) => p.id === body.packId);
if (!pack || !pack.paddlePriceId) {
    return NextResponse.json({ error: 'Unknown or unavailable pack' }, { status: 400 });
}
const lookup = await lookupPackByPriceId(pack.paddlePriceId);
if (!lookup || lookup.packId !== pack.id) {
    return NextResponse.json({ error: 'Pack price mapping mismatch' }, { status: 400 });
}
```
(Keep the existing downstream `items: [{ priceId: pack.paddlePriceId, quantity: 1 }]` and response shape. Match the exact error-response style already used in this file if it differs.)

- [ ] **Step 2: `change-plan/route.ts`**

Replace import (line ~17):
```typescript
import { lookupPlanByPriceId } from '@/lib/billing/paddle-mapping';
```
with:
```typescript
import { lookupPlanByPriceId } from '@/lib/billing/pricing-source';
```
Await the call (line ~61):
```typescript
const target = await lookupPlanByPriceId(priceId);
```

- [ ] **Step 3: `schedule-plan-change/route.ts`**

Replace import (line ~18):
```typescript
import { lookupPlanByPriceId } from '@/lib/billing/paddle-mapping';
```
with:
```typescript
import { lookupPlanByPriceId } from '@/lib/billing/pricing-source';
```
Await the call (line ~39):
```typescript
const target = await lookupPlanByPriceId(body.priceId);
```
(`target.planId` / `target.cycle` usages stay the same.)

- [ ] **Step 4: `sync/route.ts`**

Replace import (line ~19):
```typescript
import { lookupPlanByPriceId } from '@/lib/billing/paddle-mapping';
```
with:
```typescript
import { lookupPlanByPriceId } from '@/lib/billing/pricing-source';
```
Await the call (line ~93):
```typescript
const lookup = priceId ? await lookupPlanByPriceId(priceId) : null;
```

- [ ] **Step 5: Delete the obsolete mapping file**

`lib/billing/paddle-mapping.ts` now has no importers. Delete it:
```bash
git rm lib/billing/paddle-mapping.ts
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit`
Expected: clean. If anything still imports `paddle-mapping`, TS will report the missing module — fix that importer to use `pricing-source`.

- [ ] **Step 7: Commit**

```bash
git add app/api/billing/buy-pack/route.ts app/api/billing/change-plan/route.ts app/api/billing/schedule-plan-change/route.ts app/api/billing/sync/route.ts
git commit -m "refactor(billing): read pricing/lookups from DB source"
```

---

## Task 5: Public pricing route + server pricing page

**Files:**
- Create: `app/api/pricing/route.ts`
- Modify: `app/pricing/page.tsx`

- [ ] **Step 1: Create the public read route**

```typescript
// app/api/pricing/route.ts
import { NextResponse } from 'next/server';
import { getPricing } from '@/lib/billing/pricing-source';

export const runtime = 'nodejs';

export async function GET() {
    const { plans, packs } = await getPricing();
    return NextResponse.json(
        { plans, packs },
        { headers: { 'Cache-Control': 'public, max-age=30, s-maxage=30' } },
    );
}
```

- [ ] **Step 2: Make `app/pricing/page.tsx` read from DB**

It is a server component. Replace the static import (line ~3):
```typescript
import { PLANS, CREDIT_PACKS, type PlanDisplay, type CreditPack } from '@/lib/billing/plans-config';
```
with:
```typescript
import { type PlanDisplay, type CreditPack } from '@/lib/billing/plans-config';
import { getPricing } from '@/lib/billing/pricing-source';
```
Make the page component `async` and read pricing at the top of the component body, then use `plans`/`packs` where `PLANS`/`CREDIT_PACKS` were used (lines ~90 and ~143):
```typescript
export default async function PricingPage() {
    const { plans, packs } = await getPricing();
    // ...existing JSX, replacing PLANS.map(...) with plans.map(...) and
    //                    CREDIT_PACKS.map(...) with packs.map(...)
}
```
(If `PricingPage` is not the exact export name, adapt to the actual default export. Keep `PlanCard`/pack rendering unchanged — they take `PlanDisplay`/`CreditPack`.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/api/pricing/route.ts app/pricing/page.tsx
git commit -m "feat(pricing): serve live pricing via /api/pricing and SSR pricing page"
```

---

## Task 6: Client `usePricing()` hook + client read-sites

**Files:**
- Create: `lib/billing/use-pricing.ts`
- Modify: `components/billing/PlansModal.tsx`
- Modify: `components/billing/PlanBillingView.tsx`
- Modify: `app/checkout/[planId]/page.tsx`
- Modify: `app/billing/success/page.tsx`

- [ ] **Step 1: Create the hook (with static fallback for first paint)**

```typescript
// lib/billing/use-pricing.ts
'use client';

import { useEffect, useState } from 'react';
import { PLANS, CREDIT_PACKS, type PlanDisplay, type CreditPack } from './plans-config';

interface PricingState {
    plans: PlanDisplay[];
    packs: CreditPack[];
    loading: boolean;
}

// Module-level cache so multiple components share one fetch.
let shared: { plans: PlanDisplay[]; packs: CreditPack[] } | null = null;

export function usePricing(): PricingState {
    const [state, setState] = useState<PricingState>(
        shared
            ? { ...shared, loading: false }
            : { plans: PLANS, packs: CREDIT_PACKS, loading: true },
    );

    useEffect(() => {
        if (shared) return;
        let alive = true;
        fetch('/api/pricing')
            .then((r) => r.json())
            .then((data) => {
                if (!alive) return;
                shared = { plans: data.plans, packs: data.packs };
                setState({ ...shared, loading: false });
            })
            .catch(() => {
                if (alive) setState((s) => ({ ...s, loading: false }));
            });
        return () => {
            alive = false;
        };
    }, []);

    return state;
}

export function getPlanFrom(plans: PlanDisplay[], id: string | null | undefined): PlanDisplay | null {
    if (!id) return null;
    return plans.find((p) => p.id === id) ?? null;
}

export function getPackFrom(packs: CreditPack[], id: string | null | undefined): CreditPack | null {
    if (!id) return null;
    return packs.find((p) => p.id === id) ?? null;
}
```

- [ ] **Step 2: `PlansModal.tsx`**

Replace the static import (line ~8):
```typescript
import { PLANS, CREDIT_PACKS, type PlanDisplay, type CreditPack } from '@/lib/billing/plans-config';
```
with:
```typescript
import { type PlanDisplay, type CreditPack } from '@/lib/billing/plans-config';
import { usePricing } from '@/lib/billing/use-pricing';
```
Inside the `PlansModal` component body, add near the top:
```typescript
const { plans, packs } = usePricing();
```
Replace `PLANS.map(` → `plans.map(` (line ~115), `CREDIT_PACKS.map(` → `packs.map(` (line ~143), and the `PLANS.find(` usages (lines ~341, ~623) → `plans.find(`. If a sub-component (`PlanCTA`, `CreditPackCard`) needs `plans`, pass it as a prop rather than importing the array.

- [ ] **Step 3: `PlanBillingView.tsx`**

Replace import (line ~7):
```typescript
import { getPlanDisplay, PLANS } from '@/lib/billing/plans-config';
```
with:
```typescript
import { usePricing, getPlanFrom } from '@/lib/billing/use-pricing';
```
In the component body add:
```typescript
const { plans } = usePricing();
```
Replace `getPlanDisplay(subscription?.planId ?? 'free')` (line ~72) → `getPlanFrom(plans, subscription?.planId ?? 'free')`, and the `PLANS.find(...)` (line ~341) → `plans.find(...)`.

- [ ] **Step 4: `app/checkout/[planId]/page.tsx`**

Replace import (line ~10):
```typescript
import { getPlanDisplay } from '@/lib/billing/plans-config';
```
with:
```typescript
import { usePricing, getPlanFrom } from '@/lib/billing/use-pricing';
```
In the component body add `const { plans } = usePricing();` and replace `getPlanDisplay(planId)` (line ~27) → `getPlanFrom(plans, planId)`. The downstream `plan?.paddlePriceIdYearly` / `plan.priceMonthly` reads are unchanged. Note: because pricing loads async, guard the existing `if (!plan ...)` checks behind the hook's `loading` flag so the page shows a spinner until pricing arrives (add `const { plans, loading } = usePricing();` and early-return a loader while `loading`).

- [ ] **Step 5: `app/billing/success/page.tsx`**

Replace import (line ~9):
```typescript
import { getPlanDisplay, type PlanId } from '@/lib/billing/plans-config';
```
with:
```typescript
import { type PlanId } from '@/lib/billing/plans-config';
import { usePricing, getPlanFrom } from '@/lib/billing/use-pricing';
```
Add `const { plans } = usePricing();` and replace `getPlanDisplay(confirmedRow.plan_id as PlanId)` (line ~72) → `getPlanFrom(plans, confirmedRow.plan_id as PlanId)`.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit`
Expected: clean. Watch for any remaining `getPlanDisplay`/`PLANS`/`CREDIT_PACKS` imports in client files (TS flags unused/missing). `getPlanDisplay`/`getCreditPack` may still be exported from config for any server caller — leave them exported.

- [ ] **Step 7: Commit**

```bash
git add lib/billing/use-pricing.ts components/billing/PlansModal.tsx components/billing/PlanBillingView.tsx app/checkout/[planId]/page.tsx app/billing/success/page.tsx
git commit -m "feat(billing): client components read live pricing via usePricing()"
```

---

## Task 7: Paddle price create/archive helpers

**Files:**
- Create: `lib/billing/paddle-pricing.ts`

- [ ] **Step 1: Inspect the SDK price API surface**

Read `node_modules/@paddle/paddle-node-sdk` types for the prices resource (or its README) to confirm method names and the create payload shape. The methods used below are `paddle.prices.get(id)`, `paddle.prices.create(payload)`, `paddle.prices.update(id, payload)`. Adjust property names in Step 2 to match the installed SDK version if they differ.

- [ ] **Step 2: Create the helper**

```typescript
/**
 * Paddle price mutations for the admin pricing panel.
 *
 * Paddle prices are immutable in amount, so changing a price means creating a
 * NEW price under the same product and archiving the old one. Existing
 * subscriptions keep referencing the old (archived) price — that's the
 * grandfathering guarantee.
 */
import { getPaddle } from './paddle-server';

export interface CreatePriceArgs {
    productId: string;
    /** Whole-dollar amount from the admin UI. Converted to minor units here. */
    amountDollars: number;
    /** 'month' | 'year' for subscriptions; omit for one-time packs. */
    interval?: 'month' | 'year';
    description: string;
}

/** Derive (and let the caller cache) the parent product id from an existing price. */
export async function getProductIdForPrice(priceId: string): Promise<string> {
    const paddle = getPaddle();
    const price = await paddle.prices.get(priceId);
    const productId = (price as any).productId;
    if (!productId) throw new Error(`Could not resolve product id for price ${priceId}`);
    return productId;
}

/** Create a new Paddle price and return its id. */
export async function createPaddlePrice(args: CreatePriceArgs): Promise<string> {
    const paddle = getPaddle();
    const amount = String(Math.round(args.amountDollars * 100)); // minor units, USD
    const payload: any = {
        description: args.description,
        productId: args.productId,
        unitPrice: { amount, currencyCode: 'USD' },
    };
    if (args.interval) {
        payload.billingCycle = { interval: args.interval, frequency: 1 };
    }
    const created = await paddle.prices.create(payload);
    const id = (created as any).id;
    if (!id) throw new Error('Paddle price creation returned no id');
    return id;
}

/** Archive an old price so it can't be used for new checkouts (existing subs unaffected). */
export async function archivePaddlePrice(priceId: string): Promise<void> {
    const paddle = getPaddle();
    await paddle.prices.update(priceId, { status: 'archived' } as any);
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: clean (the `as any` casts insulate against minor SDK type drift; tighten them once Step 1 confirms exact types).

- [ ] **Step 4: Commit**

```bash
git add lib/billing/paddle-pricing.ts
git commit -m "feat(billing): Paddle price create/archive helpers"
```

---

## Task 8: Admin pricing API routes

**Files:**
- Create: `app/api/admin/pricing/route.ts`
- Create: `app/api/admin/pricing/plan/[id]/route.ts`
- Create: `app/api/admin/pricing/pack/[id]/route.ts`

- [ ] **Step 1: `GET /api/admin/pricing`**

```typescript
// app/api/admin/pricing/route.ts
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';

export const runtime = 'nodejs';

export async function GET() {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const [plansRes, packsRes, auditRes] = await Promise.all([
        auth.supabase.from('plans').select('*').order('sort_order'),
        auth.supabase.from('credit_packs').select('*').order('sort_order'),
        auth.supabase.from('pricing_audit').select('*').order('created_at', { ascending: false }).limit(50),
    ]);

    if (plansRes.error || packsRes.error || auditRes.error) {
        return NextResponse.json({ error: 'Failed to load pricing' }, { status: 500 });
    }

    return NextResponse.json({
        plans: plansRes.data,
        packs: packsRes.data,
        audit: auditRes.data,
    });
}
```

- [ ] **Step 2: `PATCH /api/admin/pricing/plan/[id]`**

```typescript
// app/api/admin/pricing/plan/[id]/route.ts
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { bustPricingCache } from '@/lib/billing/pricing-source';
import { getProductIdForPrice, createPaddlePrice, archivePaddlePrice } from '@/lib/billing/paddle-pricing';

export const runtime = 'nodejs';

interface PlanPatchBody {
    price_monthly_dollars?: number;
    price_yearly_dollars?: number;
    monthly_floor?: number;   // granted monthly credits
    is_active?: boolean;
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const planId = params.id;
    const body = (await req.json()) as PlanPatchBody;

    const { data: plan, error: loadErr } = await auth.supabase
        .from('plans').select('*').eq('id', planId).single();
    if (loadErr || !plan) {
        return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    }
    if (planId === 'free') {
        return NextResponse.json({ error: 'The free plan has no editable price' }, { status: 400 });
    }

    const updates: Record<string, any> = {};
    const auditRows: any[] = [];

    // --- Money changes -> new Paddle price per affected cycle ---
    async function handleCycle(
        dollars: number | undefined,
        currentCents: number | null,
        currentPriceId: string | null,
        interval: 'month' | 'year',
        priceCol: string,
        idCol: string,
    ) {
        if (dollars == null) return;
        const newCents = Math.round(dollars * 100);
        if (newCents === (currentCents ?? -1)) return; // no change
        if (newCents < 0) throw new Error('Price must be >= 0');
        if (!currentPriceId) throw new Error(`Plan ${planId} has no existing ${interval} price to clone the product from`);

        const productId = plan.paddle_product_id ?? (await getProductIdForPrice(currentPriceId));
        if (!plan.paddle_product_id) updates.paddle_product_id = productId;

        const newPriceId = await createPaddlePrice({
            productId,
            amountDollars: dollars,
            interval,
            description: `${plan.display_name} ${interval === 'month' ? 'Monthly' : 'Yearly'}`,
        });

        updates[priceCol] = newCents;
        updates[idCol] = newPriceId;

        // Record old id so grandfathered subs still resolve, then archive it.
        await auth.supabase.from('pricing_price_history').insert({
            paddle_price_id: currentPriceId,
            entity_type: 'plan',
            entity_id: planId,
            cycle: interval === 'month' ? 'monthly' : 'yearly',
        });
        try {
            await archivePaddlePrice(currentPriceId);
        } catch (e) {
            console.error('[admin/pricing] archive old price failed (non-fatal):', e);
        }

        auditRows.push({
            changed_by: auth.user.id, entity_type: 'plan', entity_id: planId,
            field: priceCol, old_value: String(currentCents ?? ''), new_value: String(newCents),
            paddle_price_id_created: newPriceId,
        });
    }

    try {
        await handleCycle(body.price_monthly_dollars, plan.price_cents, plan.paddle_price_id_monthly,
            'month', 'price_cents', 'paddle_price_id_monthly');
        await handleCycle(body.price_yearly_dollars, plan.price_yearly_cents, plan.paddle_price_id_yearly,
            'year', 'price_yearly_cents', 'paddle_price_id_yearly');
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Paddle price update failed' }, { status: 502 });
    }

    // --- DB-only changes ---
    if (body.monthly_floor != null && Number(body.monthly_floor) !== Number(plan.monthly_floor)) {
        if (body.monthly_floor < 0) return NextResponse.json({ error: 'Credits must be >= 0' }, { status: 400 });
        updates.monthly_floor = body.monthly_floor;
        auditRows.push({ changed_by: auth.user.id, entity_type: 'plan', entity_id: planId,
            field: 'monthly_floor', old_value: String(plan.monthly_floor), new_value: String(body.monthly_floor) });
    }
    if (body.is_active != null && body.is_active !== plan.is_active) {
        updates.is_active = body.is_active;
        auditRows.push({ changed_by: auth.user.id, entity_type: 'plan', entity_id: planId,
            field: 'is_active', old_value: String(plan.is_active), new_value: String(body.is_active) });
    }

    if (Object.keys(updates).length === 0) {
        return NextResponse.json({ ok: true, unchanged: true });
    }

    updates.updated_at = new Date().toISOString();
    const { error: updErr } = await auth.supabase.from('plans').update(updates).eq('id', planId);
    if (updErr) {
        // A new Paddle price may have been created; surface so admin can reconcile.
        console.error('[admin/pricing] DB update failed after Paddle changes:', updErr, updates);
        return NextResponse.json({ error: 'Saved price in Paddle but DB write failed — check logs', detail: updErr.message }, { status: 500 });
    }
    if (auditRows.length) await auth.supabase.from('pricing_audit').insert(auditRows);

    bustPricingCache();
    return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: `PATCH /api/admin/pricing/pack/[id]`**

```typescript
// app/api/admin/pricing/pack/[id]/route.ts
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { bustPricingCache } from '@/lib/billing/pricing-source';
import { getProductIdForPrice, createPaddlePrice, archivePaddlePrice } from '@/lib/billing/paddle-pricing';

export const runtime = 'nodejs';

interface PackPatchBody {
    price_dollars?: number;
    credits?: number;
    is_active?: boolean;
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const packId = params.id;
    const body = (await req.json()) as PackPatchBody;

    const { data: pack, error: loadErr } = await auth.supabase
        .from('credit_packs').select('*').eq('id', packId).single();
    if (loadErr || !pack) {
        return NextResponse.json({ error: 'Pack not found' }, { status: 404 });
    }

    const updates: Record<string, any> = {};
    const auditRows: any[] = [];

    // --- Price change -> new one-time Paddle price ---
    if (body.price_dollars != null) {
        const newCents = Math.round(body.price_dollars * 100);
        if (newCents !== pack.price_cents) {
            if (newCents < 0) return NextResponse.json({ error: 'Price must be >= 0' }, { status: 400 });
            if (!pack.paddle_price_id) {
                return NextResponse.json({ error: 'Pack has no existing Paddle price to clone the product from' }, { status: 400 });
            }
            try {
                const productId = pack.paddle_product_id ?? (await getProductIdForPrice(pack.paddle_price_id));
                if (!pack.paddle_product_id) updates.paddle_product_id = productId;
                const newPriceId = await createPaddlePrice({
                    productId, amountDollars: body.price_dollars,
                    description: `${pack.display_name} credit pack`,
                }); // no interval -> one-time
                updates.price_cents = newCents;
                updates.paddle_price_id = newPriceId;
                await auth.supabase.from('pricing_price_history').insert({
                    paddle_price_id: pack.paddle_price_id, entity_type: 'pack', entity_id: packId, cycle: null,
                });
                try { await archivePaddlePrice(pack.paddle_price_id); }
                catch (e) { console.error('[admin/pricing] archive old pack price failed (non-fatal):', e); }
                auditRows.push({ changed_by: auth.user.id, entity_type: 'pack', entity_id: packId,
                    field: 'price_cents', old_value: String(pack.price_cents), new_value: String(newCents),
                    paddle_price_id_created: newPriceId });
            } catch (e: any) {
                return NextResponse.json({ error: e.message || 'Paddle price update failed' }, { status: 502 });
            }
        }
    }

    // --- DB-only changes ---
    if (body.credits != null && Number(body.credits) !== Number(pack.credits)) {
        if (body.credits < 0) return NextResponse.json({ error: 'Credits must be >= 0' }, { status: 400 });
        updates.credits = body.credits;
        auditRows.push({ changed_by: auth.user.id, entity_type: 'pack', entity_id: packId,
            field: 'credits', old_value: String(pack.credits), new_value: String(body.credits) });
    }
    if (body.is_active != null && body.is_active !== pack.is_active) {
        updates.is_active = body.is_active;
        auditRows.push({ changed_by: auth.user.id, entity_type: 'pack', entity_id: packId,
            field: 'is_active', old_value: String(pack.is_active), new_value: String(body.is_active) });
    }

    if (Object.keys(updates).length === 0) return NextResponse.json({ ok: true, unchanged: true });

    updates.updated_at = new Date().toISOString();
    const { error: updErr } = await auth.supabase.from('credit_packs').update(updates).eq('id', packId);
    if (updErr) {
        console.error('[admin/pricing] pack DB update failed after Paddle changes:', updErr, updates);
        return NextResponse.json({ error: 'Saved price in Paddle but DB write failed — check logs', detail: updErr.message }, { status: 500 });
    }
    if (auditRows.length) await auth.supabase.from('pricing_audit').insert(auditRows);

    bustPricingCache();
    return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: clean. If the Next version types `params` as a `Promise` (Next 15), change the signatures to `{ params }: { params: Promise<{ id: string }> }` and `const { id } = await params;` — check an existing dynamic admin route (e.g. `app/api/admin/users/[id]/route.ts`) for the exact shape this repo uses and match it.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/pricing
git commit -m "feat(admin): pricing API — read + PATCH plan/pack with Paddle sync + audit"
```

---

## Task 9: Typed admin client wrapper

**Files:**
- Create: `lib/api/admin-pricing.ts`

- [ ] **Step 1: Create the wrapper (mirrors `lib/api/admin.ts` style)**

```typescript
// lib/api/admin-pricing.ts
export interface AdminPlanRow {
    id: string;
    display_name: string;
    monthly_floor: number;
    signup_bonus: number;
    price_cents: number | null;
    price_yearly_cents: number | null;
    paddle_price_id_monthly: string | null;
    paddle_price_id_yearly: string | null;
    is_active: boolean;
    sort_order: number;
}

export interface AdminPackRow {
    id: string;
    display_name: string;
    price_cents: number;
    credits: number;
    paddle_price_id: string | null;
    is_active: boolean;
    sort_order: number;
}

export interface PricingAuditRow {
    id: string;
    changed_by: string;
    entity_type: 'plan' | 'pack';
    entity_id: string;
    field: string;
    old_value: string | null;
    new_value: string | null;
    paddle_price_id_created: string | null;
    created_at: string;
}

export const pricingAdminApi = {
    get: async (): Promise<{ plans: AdminPlanRow[]; packs: AdminPackRow[]; audit: PricingAuditRow[] }> => {
        const res = await fetch('/api/admin/pricing');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load pricing');
        return data;
    },

    updatePlan: async (id: string, patch: {
        price_monthly_dollars?: number;
        price_yearly_dollars?: number;
        monthly_floor?: number;
        is_active?: boolean;
    }) => {
        const res = await fetch(`/api/admin/pricing/plan/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update plan');
        return data;
    },

    updatePack: async (id: string, patch: {
        price_dollars?: number;
        credits?: number;
        is_active?: boolean;
    }) => {
        const res = await fetch(`/api/admin/pricing/pack/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update pack');
        return data;
    },
};
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/api/admin-pricing.ts
git commit -m "feat(admin): typed client wrapper for pricing API"
```

---

## Task 10: Admin Pricing UI + wire into admin page

**Files:**
- Create: `components/admin/PricingAdminContent.tsx`
- Modify: `app/admin/page.tsx`

- [ ] **Step 1: Create `PricingAdminContent.tsx`**

```typescript
'use client';

import React, { useEffect, useState } from 'react';
import { ArrowLeft, Save, AlertTriangle } from 'lucide-react';
import { pricingAdminApi, type AdminPlanRow, type AdminPackRow, type PricingAuditRow } from '@/lib/api/admin-pricing';
import { ConfirmationModal } from '@/components/ui/ConfirmationModal';

type Tab = 'plans' | 'packs';

export function PricingAdminContent({ onMobileBack }: { onMobileBack: () => void }) {
    const [tab, setTab] = useState<Tab>('plans');
    const [plans, setPlans] = useState<AdminPlanRow[]>([]);
    const [packs, setPacks] = useState<AdminPackRow[]>([]);
    const [audit, setAudit] = useState<PricingAuditRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        try {
            const data = await pricingAdminApi.get();
            setPlans(data.plans);
            setPacks(data.packs);
            setAudit(data.audit);
            setError(null);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { load(); }, []);

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center gap-3">
                <button onClick={onMobileBack} className="md:hidden p-2 rounded-lg hover:bg-white/5">
                    <ArrowLeft className="w-4 h-4" />
                </button>
                <h1 className="text-xl font-black font-display">Pricing</h1>
            </div>

            <div className="flex items-center bg-white/5 p-1 rounded-2xl border border-white/10 w-fit">
                {(['plans', 'packs'] as Tab[]).map((t) => (
                    <button
                        key={t}
                        onClick={() => setTab(t)}
                        className={`px-5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
                            tab === t ? 'bg-white/10 text-content-primary ring-1 ring-white/20' : 'text-content-tertiary hover:text-content-secondary'
                        }`}
                    >
                        {t === 'plans' ? 'Plans' : 'Credit Packs'}
                    </button>
                ))}
            </div>

            {error && <div className="text-red-400 text-sm">{error}</div>}
            {loading ? (
                <div className="text-content-tertiary text-sm">Loading…</div>
            ) : tab === 'plans' ? (
                <PlansEditor plans={plans} onSaved={load} />
            ) : (
                <PacksEditor packs={packs} onSaved={load} />
            )}

            <AuditList audit={audit} />
        </div>
    );
}

function PlansEditor({ plans, onSaved }: { plans: AdminPlanRow[]; onSaved: () => void }) {
    return (
        <div className="space-y-4">
            {plans.map((p) => <PlanRow key={p.id} plan={p} onSaved={onSaved} />)}
        </div>
    );
}

function PlanRow({ plan, onSaved }: { plan: AdminPlanRow; onSaved: () => void }) {
    const isFree = plan.id === 'free';
    const [monthly, setMonthly] = useState((plan.price_cents ?? 0) / 100);
    const [yearly, setYearly] = useState((plan.price_yearly_cents ?? 0) / 100);
    const [credits, setCredits] = useState(plan.monthly_floor);
    const [active, setActive] = useState(plan.is_active);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const moneyChanged = monthly !== (plan.price_cents ?? 0) / 100 || yearly !== (plan.price_yearly_cents ?? 0) / 100;
    const anyChanged = moneyChanged || credits !== plan.monthly_floor || active !== plan.is_active;

    const doSave = async () => {
        setSaving(true);
        setErr(null);
        try {
            await pricingAdminApi.updatePlan(plan.id, {
                price_monthly_dollars: monthly,
                price_yearly_dollars: yearly,
                monthly_floor: credits,
                is_active: active,
            });
            setConfirmOpen(false);
            onSaved();
        } catch (e: any) {
            setErr(e.message);
        } finally {
            setSaving(false);
        }
    };

    const onSaveClick = () => {
        if (moneyChanged) setConfirmOpen(true);
        else doSave();
    };

    return (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
            <div className="flex items-center justify-between">
                <span className="font-bold">{plan.display_name}</span>
                <label className="flex items-center gap-2 text-xs text-content-tertiary">
                    <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} disabled={isFree} />
                    Active
                </label>
            </div>
            {!isFree && (
                <div className="grid grid-cols-3 gap-3">
                    <Field label="Monthly $" value={monthly} onChange={setMonthly} />
                    <Field label="Yearly $" value={yearly} onChange={setYearly} />
                    <Field label="Monthly credits" value={credits} onChange={setCredits} step={1} />
                </div>
            )}
            {isFree && (
                <div className="grid grid-cols-3 gap-3">
                    <Field label="Monthly credits" value={credits} onChange={setCredits} step={1} />
                </div>
            )}
            {err && <div className="text-red-400 text-xs">{err}</div>}
            <button
                onClick={onSaveClick}
                disabled={!anyChanged || saving}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 text-xs font-bold disabled:opacity-40"
            >
                <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save'}
            </button>

            <ConfirmationModal
                isOpen={confirmOpen}
                onClose={() => setConfirmOpen(false)}
                onConfirm={doSave}
                title="Create a new Paddle price?"
                message={`This creates a new Paddle price for ${plan.display_name}. Existing subscribers keep their current price; new purchases use the new amount.`}
                confirmLabel="Create & apply"
            />
        </div>
    );
}

function PacksEditor({ packs, onSaved }: { packs: AdminPackRow[]; onSaved: () => void }) {
    return (
        <div className="space-y-4">
            {packs.map((p) => <PackRow key={p.id} pack={p} onSaved={onSaved} />)}
        </div>
    );
}

function PackRow({ pack, onSaved }: { pack: AdminPackRow; onSaved: () => void }) {
    const [price, setPrice] = useState(pack.price_cents / 100);
    const [credits, setCredits] = useState(pack.credits);
    const [active, setActive] = useState(pack.is_active);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const moneyChanged = price !== pack.price_cents / 100;
    const anyChanged = moneyChanged || credits !== pack.credits || active !== pack.is_active;

    const doSave = async () => {
        setSaving(true);
        setErr(null);
        try {
            await pricingAdminApi.updatePack(pack.id, { price_dollars: price, credits, is_active: active });
            setConfirmOpen(false);
            onSaved();
        } catch (e: any) {
            setErr(e.message);
        } finally {
            setSaving(false);
        }
    };

    const onSaveClick = () => {
        if (moneyChanged) setConfirmOpen(true);
        else doSave();
    };

    return (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
            <div className="flex items-center justify-between">
                <span className="font-bold">{pack.display_name}</span>
                <label className="flex items-center gap-2 text-xs text-content-tertiary">
                    <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
                    Active
                </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
                <Field label="Price $" value={price} onChange={setPrice} />
                <Field label="Credits" value={credits} onChange={setCredits} step={1} />
            </div>
            {err && <div className="text-red-400 text-xs">{err}</div>}
            <button
                onClick={onSaveClick}
                disabled={!anyChanged || saving}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 text-xs font-bold disabled:opacity-40"
            >
                <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save'}
            </button>

            <ConfirmationModal
                isOpen={confirmOpen}
                onClose={() => setConfirmOpen(false)}
                onConfirm={doSave}
                title="Create a new Paddle price?"
                message={`This creates a new Paddle price for the ${pack.display_name} pack. Future purchases use the new amount.`}
                confirmLabel="Create & apply"
            />
        </div>
    );
}

function Field({ label, value, onChange, step = 0.01 }: { label: string; value: number; onChange: (n: number) => void; step?: number }) {
    return (
        <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-content-tertiary mb-1">{label}</span>
            <input
                type="number"
                step={step}
                min={0}
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-sm"
            />
        </label>
    );
}

function AuditList({ audit }: { audit: PricingAuditRow[] }) {
    if (!audit.length) return null;
    return (
        <details className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-content-tertiary flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5" /> Change history ({audit.length})
            </summary>
            <ul className="mt-3 space-y-1 text-xs text-content-secondary">
                {audit.map((a) => (
                    <li key={a.id}>
                        <span className="text-content-tertiary">{new Date(a.created_at).toLocaleString()}</span>{' '}
                        — {a.entity_type} <b>{a.entity_id}</b>.{a.field}: {a.old_value ?? '∅'} → {a.new_value ?? '∅'}
                        {a.paddle_price_id_created ? ` (new price ${a.paddle_price_id_created})` : ''}
                    </li>
                ))}
            </ul>
        </details>
    );
}
```

Note: confirm `ConfirmationModal`'s actual prop names by reading `components/ui/ConfirmationModal.tsx` before relying on `isOpen/onClose/onConfirm/title/message/confirmLabel`; adjust to its real API (it's already imported in `app/admin/page.tsx`, so the props are discoverable there too).

- [ ] **Step 2: Wire into `app/admin/page.tsx`**

1. Add the import near the other content-component imports (after line ~50):
```typescript
import { PricingAdminContent } from '@/components/admin/PricingAdminContent';
```
2. Extend the section type (line 57):
```typescript
type SectionId = 'models' | 'users' | 'pricing';
```
3. Add a nav item to `sectionNavItems` (after the users item, ~line 67). Use an already-imported icon (`Calculator` is imported):
```typescript
{ id: 'pricing', label: 'Pricing', icon: <Calculator className="w-4 h-4" /> },
```
4. Update the section resolver (line ~94) so the URL param recognizes `pricing`:
```typescript
const activeSection: SectionId =
    sectionParam === 'users' ? 'users' : sectionParam === 'pricing' ? 'pricing' : 'models';
```
5. Add the conditional render (after line ~189):
```typescript
{activeSection === 'pricing' && <PricingAdminContent onMobileBack={() => setMobileShowContent(false)} />}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add components/admin/PricingAdminContent.tsx app/admin/page.tsx
git commit -m "feat(admin): Pricing section UI with plan/pack editors + audit history"
```

---

## Task 11: Sandbox verification script + manual checklist

**Files:**
- Create: `scripts/verify-pricing.js`

- [ ] **Step 1: Create the verification script**

```javascript
// scripts/verify-pricing.js
// Run: node scripts/verify-pricing.js
// Reads pricing tables and exercises the Paddle SANDBOX price-create/archive
// path end-to-end. Requires .env.local with SUPABASE_SERVICE_ROLE_KEY,
// NEXT_PUBLIC_SUPABASE_URL, PADDLE_API_KEY, PADDLE_ENVIRONMENT=sandbox.
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const { Paddle, Environment } = require('@paddle/paddle-node-sdk');

async function main() {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const { data: plans } = await supabase.from('plans').select('*').order('sort_order');
    const { data: packs } = await supabase.from('credit_packs').select('*').order('sort_order');
    console.log('PLANS:', plans.map(p => `${p.id} $${(p.price_cents ?? 0) / 100}/mo cr=${p.monthly_floor} active=${p.is_active}`));
    console.log('PACKS:', packs.map(p => `${p.id} $${p.price_cents / 100} cr=${p.credits} active=${p.is_active}`));

    const env = (process.env.PADDLE_ENVIRONMENT || 'sandbox').toLowerCase();
    if (env !== 'sandbox') {
        console.log('PADDLE_ENVIRONMENT is not sandbox — skipping Paddle write test.');
        return;
    }
    const paddle = new Paddle(process.env.PADDLE_API_KEY, { environment: Environment.sandbox });

    const starter = plans.find(p => p.id === 'starter');
    const oldId = starter.paddle_price_id_monthly;
    const price = await paddle.prices.get(oldId);
    console.log('Resolved product for starter monthly:', price.productId);

    const created = await paddle.prices.create({
        description: 'VERIFY TEMP Starter Monthly',
        productId: price.productId,
        unitPrice: { amount: '2000', currencyCode: 'USD' },
        billingCycle: { interval: 'month', frequency: 1 },
    });
    console.log('Created sandbox price:', created.id);
    await paddle.prices.update(created.id, { status: 'archived' });
    console.log('Archived the temp price. End-to-end Paddle path OK.');
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run the script against sandbox**

Run: `node scripts/verify-pricing.js`
Expected: prints plan/pack rows, resolves a product id, creates a sandbox price, archives it, prints "End-to-end Paddle path OK."
(If the SDK property names differ, this is where you discover it — reconcile `lib/billing/paddle-pricing.ts` with what works here.)

- [ ] **Step 3: Manual UI checklist (dev server)**

Run `npm run dev`, sign in as an admin, go to `/admin?section=pricing`:
- [ ] Plans + Credit Packs tabs render current values from DB.
- [ ] Change Starter monthly $10 → $20, Save → confirm modal appears → confirm. Reload: value persists, a new `paddle_price_id_monthly` is stored (check DB), old id is in `pricing_price_history`, an audit row exists.
- [ ] `/pricing` (logged out, hard refresh) shows $20 for Starter.
- [ ] Open the Plans modal in-app → Starter shows $20; starting checkout uses the new price id.
- [ ] Change Boost credits 1300 → 1500 (no price change) → saves with NO confirm modal, NO new Paddle price, audit row written.
- [ ] Toggle a plan inactive → it disappears from the public pricing surfaces.
- [ ] Simulate/replay a `transaction.completed` webhook carrying the OLD archived Starter price id → webhook resolves it to `starter` and grants the CURRENT credit amount (decision: credits update for everyone).

- [ ] **Step 4: Final type check + commit**

Run: `npx tsc --noEmit`
Expected: clean across the whole project.

```bash
git add scripts/verify-pricing.js
git commit -m "chore(billing): sandbox verification script for pricing panel"
```

---

## Done criteria

- Admin can edit subscription monthly/yearly price, granted credits, availability, and credit-pack price/credits/availability from `/admin?section=pricing`.
- A money change creates a new Paddle price, archives the old one, records history, writes an audit row, and is reflected on `/pricing`, in-app plans modal, and checkout.
- Credit/availability changes never touch Paddle.
- Existing subscribers' archived price ids still resolve in the webhook and grant current credits.
- `npx tsc --noEmit` is clean; the sandbox script passes.
