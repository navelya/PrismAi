-- Per-connected-media pricing for ai_generator models.
-- cost_per_image / cost_per_video are added to the run cost for each image/video
-- item wired into the model's image/video input handles. Default 0 = free (today's behavior).
ALTER TABLE public.ai_models
  ADD COLUMN IF NOT EXISTS cost_per_image NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_per_video NUMERIC NOT NULL DEFAULT 0;
