-- Migration: shared (Prisfol) characters
-- Date: 2026-05-26
-- Description: Adds is_shared to characters so admins can publish their own
--              characters to everyone (read-only for non-owners). SELECT widens
--              to include shared rows; UPDATE/DELETE stay owner-only. A trigger
--              guards the share flag so only admins (or service_role) can set it.

-- 1. COLUMN
ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS is_shared BOOLEAN NOT NULL DEFAULT false;

-- 2. INDEX (fast shared-pool listing)
CREATE INDEX IF NOT EXISTS idx_characters_shared
  ON public.characters (is_shared, deleted_at)
  WHERE is_shared = true;

-- 3. WIDEN SELECT: own rows OR any shared row
DROP POLICY IF EXISTS "Users read their own characters" ON public.characters;
DROP POLICY IF EXISTS "Users read own or shared characters" ON public.characters;
CREATE POLICY "Users read own or shared characters"
  ON public.characters FOR SELECT
  USING (user_id = auth.uid() OR is_shared = true);

-- UPDATE/DELETE policies are intentionally left unchanged (owner-only):
-- that is what makes shared characters read-only for non-owners.

-- 4. ADMIN-ONLY SHARE GUARD (defense-in-depth on top of the route check)
CREATE OR REPLACE FUNCTION public.enforce_admin_only_share()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Only gate the transition INTO shared. Unsharing and unrelated edits by the
  -- owner are never blocked.
  IF NEW.is_shared = true
     AND (TG_OP = 'INSERT' OR COALESCE(OLD.is_shared, false) = false)
     AND auth.role() <> 'service_role'
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can share characters';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_characters_enforce_share ON public.characters;
CREATE TRIGGER trg_characters_enforce_share
  BEFORE INSERT OR UPDATE ON public.characters
  FOR EACH ROW EXECUTE FUNCTION public.enforce_admin_only_share();

-- 5. SYSTEM NOTICE
DO $$
BEGIN
  RAISE NOTICE '✅ characters.is_shared added; SELECT widened; admin-only share guard installed.';
END $$;
