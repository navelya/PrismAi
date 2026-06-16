-- Model variants: several "views" of one model identity (same name, different
-- settings / sub-category). A variant group is a SET of peer ai_models rows that
-- elect ONE representative (the primary, shown in user-facing lists). NOT a
-- hierarchy — no parent FK.
--
-- Defaults make every existing row, and every newly-created plain model, its own
-- singleton group that is already primary: zero backfill, current behaviour
-- unchanged. A "variant" is just another ai_models row sharing variant_group_id
-- with is_primary = false.

ALTER TABLE public.ai_models
  ADD COLUMN IF NOT EXISTS variant_group_id UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT true;

-- The load-bearing invariant: at most ONE primary per group, enforced by the DB.
CREATE UNIQUE INDEX IF NOT EXISTS ai_models_one_primary_per_group
  ON public.ai_models (variant_group_id)
  WHERE is_primary;

-- Fast group lookup for the admin "manage variants" view.
CREATE INDEX IF NOT EXISTS ai_models_variant_group_idx
  ON public.ai_models (variant_group_id);

-- Promote a variant to be its group's primary. Single statement so Postgres
-- evaluates the partial unique index against the final tuples — no transient
-- two-primary state, no ordering hazard, idempotent if target is already primary.
-- SECURITY INVOKER (default): runs under the caller's RLS rights, exactly like the
-- existing admin model update/delete routes.
CREATE OR REPLACE FUNCTION public.promote_model_variant(target_id BIGINT)
RETURNS VOID
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE public.ai_models m
  SET is_primary = (m.id = target_id)
  WHERE m.variant_group_id = (
    SELECT variant_group_id FROM public.ai_models WHERE id = target_id
  );
$$;

-- Delete a model and, if it was its group's primary, promote a deterministic
-- survivor so the group is never left without a primary. Atomic (single function
-- call). Non-primary delete = plain delete; last-in-group delete = plain delete.
CREATE OR REPLACE FUNCTION public.delete_model_and_reseat_primary(target_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  grp UUID;
  was_primary BOOLEAN;
  survivor BIGINT;
BEGIN
  SELECT variant_group_id, is_primary INTO grp, was_primary
  FROM public.ai_models WHERE id = target_id;

  IF grp IS NULL THEN
    RETURN; -- nothing to delete
  END IF;

  DELETE FROM public.ai_models WHERE id = target_id;

  IF was_primary THEN
    SELECT id INTO survivor
    FROM public.ai_models
    WHERE variant_group_id = grp
    ORDER BY is_active DESC, id ASC
    LIMIT 1;

    IF survivor IS NOT NULL THEN
      UPDATE public.ai_models SET is_primary = true WHERE id = survivor;
    END IF;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.promote_model_variant(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_model_and_reseat_primary(BIGINT) TO authenticated;
