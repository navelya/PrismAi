-- Migration: time-windowed template popularity
-- Date: 2026-06-06
-- - template_usage_events: one row per clone, so we can compute "popular in the
--   last two weeks" (distinct from the all-time workflow_templates.usage_count).
-- - increment_template_usage() now ALSO logs an event row (SECURITY DEFINER, so
--   it bypasses RLS — there is intentionally no user INSERT policy).
-- - popular_template_ids(): top-N most-cloned published templates in a window.

-- 1. EVENTS TABLE
CREATE TABLE IF NOT EXISTS public.template_usage_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES public.workflow_templates(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  used_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Window queries scan by recency, then group by template.
CREATE INDEX IF NOT EXISTS idx_template_usage_events_recent
  ON public.template_usage_events (used_at DESC, template_id);

-- 2. RLS — rows are written ONLY through the SECURITY DEFINER RPC below, so no
--    user INSERT policy is needed. Admins may read for analytics.
ALTER TABLE public.template_usage_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read template usage" ON public.template_usage_events;
CREATE POLICY "Admins read template usage"
  ON public.template_usage_events FOR SELECT
  USING (public.is_admin());
-- (service role bypasses RLS for cron/analytics)

-- 3. RPC: bump all-time usage_count AND log a timestamped event (clone path).
CREATE OR REPLACE FUNCTION public.increment_template_usage(p_template_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.workflow_templates
    SET usage_count = usage_count + 1
    WHERE id = p_template_id AND status = 'published';
  IF FOUND THEN
    INSERT INTO public.template_usage_events (template_id, user_id)
    VALUES (p_template_id, auth.uid());
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.increment_template_usage(UUID) TO authenticated;

-- 4. RPC: top-N published templates by clone count within the last p_days.
--    SECURITY DEFINER so authed users get popularity without reading the events
--    table directly.
CREATE OR REPLACE FUNCTION public.popular_template_ids(p_days INT DEFAULT 14, p_limit INT DEFAULT 10)
RETURNS TABLE (template_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.template_id
  FROM public.template_usage_events e
  JOIN public.workflow_templates t ON t.id = e.template_id
  WHERE e.used_at > NOW() - (p_days || ' days')::interval
    AND t.status = 'published'
  GROUP BY e.template_id
  ORDER BY COUNT(*) DESC, MAX(e.used_at) DESC
  LIMIT p_limit;
$$;
GRANT EXECUTE ON FUNCTION public.popular_template_ids(INT, INT) TO authenticated;

DO $$ BEGIN RAISE NOTICE '✅ template popularity (events + RPCs) installed.'; END $$;
