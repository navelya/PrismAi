-- Migration: Enable Realtime on profiles
-- Date: 2026-05-05
-- Description:
--   The credits system relies on a realtime subscription to the user's
--   profiles row to push token_balance updates back to the toolbar.
--   `profiles` was never added to the supabase_realtime publication, so
--   UPDATE events weren't being broadcast and balances only refreshed
--   on a full page reload. This migration mirrors what 20260322 did for
--   node_results.

-- 1. REPLICA IDENTITY FULL is required for realtime to deliver UPDATE
--    payloads with filters on non-primary-key columns. Safe to set
--    repeatedly.
ALTER TABLE public.profiles REPLICA IDENTITY FULL;

-- 2. Add profiles to the realtime publication. Idempotent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'profiles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
  END IF;
END $$;

DO $$
BEGIN
  RAISE NOTICE '✅ profiles table configured for Supabase Realtime';
END $$;
