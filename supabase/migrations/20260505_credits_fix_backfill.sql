-- Migration: Credits System — Trigger Fix + Re-run Backfill
-- Date: 2026-05-05
-- Description:
--   The tamper-proof trigger from 20260505_credits_system was too strict:
--   it allowed auth.role() = 'service_role' but rejected NULL — and during
--   a migration/SQL-editor context, auth.role() is NULL, not 'service_role'.
--   That caused the backfill block to fail silently (the surrounding
--   EXCEPTION WHEN OTHERS swallowed it), leaving balances at 0 and the
--   ledger empty for all existing users.
--
--   Fix: also pass through when auth.uid() IS NULL. This is safe because
--   the RLS policies on profiles require auth.uid() = id for any client
--   write, so a regular user cannot reach the trigger with auth.uid() NULL.
--   Then re-run the backfill (without swallowing exceptions this time).

CREATE OR REPLACE FUNCTION public.prevent_token_balance_tampering()
RETURNS TRIGGER AS $$
BEGIN
  -- Privileged contexts: server-side API with service_role JWT, or
  -- no-JWT contexts (migrations, supabase admin, server-internal).
  IF auth.role() = 'service_role' OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.token_balance IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Permission denied: token_balance can only be modified by the credits RPCs.';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.token_balance IS DISTINCT FROM OLD.token_balance THEN
    RAISE EXCEPTION 'Permission denied: token_balance can only be modified by the credits RPCs.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-run backfill. credit_tokens is idempotent on idempotency_key, so users
-- who somehow got credited already won't be double-granted. No EXCEPTION
-- swallowing this time — if anything fails, fail the migration loudly.
DO $$
DECLARE
  v_bonus NUMERIC(20, 6);
  v_user RECORD;
BEGIN
  SELECT signup_bonus INTO v_bonus FROM public.plans WHERE id = 'free';
  IF v_bonus IS NULL OR v_bonus <= 0 THEN
    RAISE NOTICE 'No signup bonus configured for free plan — skipping backfill.';
    RETURN;
  END IF;

  FOR v_user IN SELECT id FROM auth.users LOOP
    PERFORM public.credit_tokens(
      v_user.id,
      v_bonus,
      'signup_bonus',
      'signup:' || v_user.id::text,
      NULL, NULL,
      jsonb_build_object('plan', 'free', 'backfill', true)
    );
  END LOOP;
END $$;
