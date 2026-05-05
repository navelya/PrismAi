-- Migration: Credits Reconciliation Helpers
-- Date: 2026-05-05
-- Description:
--   Two read-only helper functions used by /api/cron/reconcile to:
--     (1) find failed executions whose credits were debited but never refunded,
--     (2) audit drift between profiles.token_balance and SUM(token_ledger.amount).
--
--   Both are SECURITY DEFINER so they can read across users (cron context),
--   and locked down so only service_role can call them.

-- (1) Find executions that failed, were charged, but have no refund row.
--     The cron loops over the result and calls refund_tokens(execution_id).
CREATE OR REPLACE FUNCTION public.find_unrefunded_failed_executions(
  p_limit INTEGER DEFAULT 500
)
RETURNS TABLE (execution_id UUID)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT debit.execution_id
  FROM token_ledger debit
  JOIN executions e ON e.id = debit.execution_id
  WHERE debit.reason = 'execution_debit'
    AND e.status = 'failed'
    AND NOT EXISTS (
      SELECT 1 FROM token_ledger refund
      WHERE refund.execution_id = debit.execution_id
        AND refund.reason = 'execution_refund'
    )
  LIMIT p_limit;
$$;

-- (2) For every user, compare their cached balance to the ledger sum.
--     A user shows up here only if the two disagree — drift is the bug
--     we want to know about.
CREATE OR REPLACE FUNCTION public.audit_balance_drift()
RETURNS TABLE (
  user_id      UUID,
  balance      NUMERIC,
  ledger_sum   NUMERIC,
  drift        NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    p.id AS user_id,
    p.token_balance AS balance,
    COALESCE(SUM(l.amount), 0) AS ledger_sum,
    p.token_balance - COALESCE(SUM(l.amount), 0) AS drift
  FROM profiles p
  LEFT JOIN token_ledger l ON l.user_id = p.id
  GROUP BY p.id, p.token_balance
  HAVING p.token_balance <> COALESCE(SUM(l.amount), 0);
$$;

REVOKE ALL ON FUNCTION public.find_unrefunded_failed_executions(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_balance_drift()                      FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.find_unrefunded_failed_executions(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.audit_balance_drift()                      TO service_role;
