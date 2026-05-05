-- Migration: Admin Role Hardening
-- Date: 2026-05-05
-- Description:
--   Prevents privilege escalation via direct profile updates.
--   The 20260313 migration added profiles.is_admin and public.is_admin(), but nothing
--   stops an authenticated user from running `update profiles set is_admin = true
--   where id = auth.uid()` if the profiles UPDATE policy lets owners edit their own row.
--   This trigger blocks any change to is_admin unless the caller is already an admin
--   or is using the service role (server-side privileged context).

CREATE OR REPLACE FUNCTION public.prevent_admin_self_elevation()
RETURNS TRIGGER AS $$
BEGIN
  IF (NEW.is_admin IS DISTINCT FROM OLD.is_admin) THEN
    -- Allow if running as service_role (server-side admin tooling).
    -- Otherwise the caller must already be an admin.
    IF auth.role() <> 'service_role' AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'Permission denied: only admins can change the is_admin flag.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS profiles_prevent_admin_self_elevation ON public.profiles;
CREATE TRIGGER profiles_prevent_admin_self_elevation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_admin_self_elevation();
