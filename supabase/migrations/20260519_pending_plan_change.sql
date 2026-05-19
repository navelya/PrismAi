-- Migration: Scheduled plan changes
-- Date: 2026-05-19
-- Description:
--   Adds a column to `public.subscriptions` that records a desired plan
--   change to apply at the end of the current billing period. Used by the
--   "Schedule downgrade" flow — the user keeps their current (higher) plan
--   until the period rolls over, then a cron applies the change.
--
--   Paddle Billing doesn't natively support scheduled plan changes (its
--   `scheduled_change` field only allows cancel/pause/resume), so we model
--   it ourselves and apply via `subscriptions.update` at the boundary.

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS pending_plan_change_price_id TEXT;

-- Index helps the cron find due changes quickly.
CREATE INDEX IF NOT EXISTS idx_subscriptions_pending_plan_change
  ON public.subscriptions(current_period_end)
  WHERE pending_plan_change_price_id IS NOT NULL;
