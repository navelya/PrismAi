-- Strict data type architecture for node results
-- Date: 2026-05-01
-- Purpose:
--   1) Introduce a normalized data_types lookup table.
--   2) Migrate node_results.result_url -> node_results.result_data (JSONB array).
--   3) Enforce node_results.result_type as a strict foreign key to data_types.

BEGIN;

-- 1) Canonical lookup table for supported output data types.
CREATE TABLE IF NOT EXISTS public.data_types (
  id TEXT PRIMARY KEY,
  description TEXT
);

INSERT INTO public.data_types (id, description) VALUES
  ('image', 'Image files (PNG, JPG, WEBP)'),
  ('video', 'Video files (MP4, WEBM)'),
  ('audio', 'Audio files (MP3, WAV)'),
  ('3d', '3D models (GLB, OBJ)'),
  ('text', 'Plain text or Markdown prompts'),
  ('json', 'Structured JSON outputs')
ON CONFLICT (id) DO UPDATE
SET description = EXCLUDED.description;

-- 2) Add strict result_type column (if missing).
ALTER TABLE public.node_results
ADD COLUMN IF NOT EXISTS result_type TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'node_results_result_type_fkey'
      AND conrelid = 'public.node_results'::regclass
  ) THEN
    ALTER TABLE public.node_results
      ADD CONSTRAINT node_results_result_type_fkey
      FOREIGN KEY (result_type) REFERENCES public.data_types(id);
  END IF;
END $$;

-- 3) Preserve existing values by renaming result_url -> result_data when needed.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'node_results'
      AND column_name = 'result_url'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'node_results'
      AND column_name = 'result_data'
  ) THEN
    ALTER TABLE public.node_results RENAME COLUMN result_url TO result_data;
  END IF;
END $$;

-- If result_data doesn't exist (unexpected legacy state), create it now.
ALTER TABLE public.node_results
ADD COLUMN IF NOT EXISTS result_data JSONB;

-- Convert result_data to JSONB and preserve any legacy text values as array entries.
DO $$
DECLARE
  v_data_type TEXT;
BEGIN
  SELECT data_type
  INTO v_data_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'node_results'
    AND column_name = 'result_data';

  IF v_data_type IS DISTINCT FROM 'jsonb' THEN
    ALTER TABLE public.node_results
      ALTER COLUMN result_data TYPE JSONB
      USING CASE
        WHEN result_data IS NULL THEN '[]'::jsonb
        ELSE jsonb_build_array(result_data)
      END;
  END IF;
END $$;

-- Enforce array semantics for result_data.
UPDATE public.node_results
SET result_data = CASE
  WHEN result_data IS NULL THEN '[]'::jsonb
  WHEN jsonb_typeof(result_data) = 'array' THEN result_data
  ELSE jsonb_build_array(result_data)
END;

ALTER TABLE public.node_results
  ALTER COLUMN result_data SET DEFAULT '[]'::jsonb;

UPDATE public.node_results
SET result_data = '[]'::jsonb
WHERE result_data IS NULL;

ALTER TABLE public.node_results
  ALTER COLUMN result_data SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'node_results_result_data_is_array_chk'
      AND conrelid = 'public.node_results'::regclass
  ) THEN
    ALTER TABLE public.node_results
      ADD CONSTRAINT node_results_result_data_is_array_chk
      CHECK (jsonb_typeof(result_data) = 'array');
  END IF;
END $$;

-- 4) Backfill result_type from existing result_data where possible.
UPDATE public.node_results
SET result_type = CASE
  WHEN EXISTS (
    SELECT 1
    FROM jsonb_array_elements(result_data) AS e(item)
    WHERE jsonb_typeof(item) = 'string'
      AND (e.item #>> '{}') ~* '\.(png|jpe?g|webp|gif|bmp|svg)(\?.*)?$'
  ) THEN 'image'
  WHEN EXISTS (
    SELECT 1
    FROM jsonb_array_elements(result_data) AS e(item)
    WHERE jsonb_typeof(item) = 'string'
      AND (e.item #>> '{}') ~* '\.(mp4|webm|mov|avi|mkv)(\?.*)?$'
  ) THEN 'video'
  WHEN EXISTS (
    SELECT 1
    FROM jsonb_array_elements(result_data) AS e(item)
    WHERE jsonb_typeof(item) = 'string'
      AND (e.item #>> '{}') ~* '\.(mp3|wav|ogg|m4a|aac|flac)(\?.*)?$'
  ) THEN 'audio'
  WHEN EXISTS (
    SELECT 1
    FROM jsonb_array_elements(result_data) AS e(item)
    WHERE jsonb_typeof(item) = 'string'
      AND (e.item #>> '{}') ~* '\.(glb|gltf|obj|fbx|stl|usd|usdz)(\?.*)?$'
  ) THEN '3d'
  WHEN jsonb_array_length(result_data) > 0
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(result_data) AS e(item)
      WHERE jsonb_typeof(item) <> 'string'
    ) THEN 'text'
  ELSE 'json'
END
WHERE result_type IS NULL;

ALTER TABLE public.node_results
  ALTER COLUMN result_type SET DEFAULT 'json';

UPDATE public.node_results
SET result_type = 'json'
WHERE result_type IS NULL;

ALTER TABLE public.node_results
  ALTER COLUMN result_type SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_node_results_result_type
  ON public.node_results(result_type);

CREATE INDEX IF NOT EXISTS idx_node_results_session_result_type
  ON public.node_results(session_id, result_type);

COMMIT;
