-- Internal admin "done" marker for AI models.
-- Purely organizational/bookkeeping: independent of is_active, no runtime effect.
-- All existing rows default to false (not done).
ALTER TABLE public.ai_models
  ADD COLUMN IF NOT EXISTS is_done BOOLEAN NOT NULL DEFAULT false;
