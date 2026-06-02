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
