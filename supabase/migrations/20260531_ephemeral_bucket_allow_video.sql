-- Allow video output in the ephemeral bucket.
--
-- The blur and compositor ephemeral executors encode H.264 mp4 and upload the
-- result to `workflow-ephemeral-tmp` via uploadEphemeralResult(). That bucket was
-- created in 20260321_workflow_engine_v2.sql with an image-only allowed_mime_types
-- list, so Supabase Storage rejected the upload with:
--     "mime type video/mp4 is not supported"
-- which surfaced at dispatch time and blocked any node downstream of a
-- video-processing ephemeral node (e.g. an ai_generator fed by a blurred clip).
--
-- Widen the allow-list to cover the video types these executors emit, and raise
-- the size limit since encoded video easily exceeds the old 50MB image cap.
-- Files here are still TTL'd by pg_cron (4h), so the larger cap is short-lived.

UPDATE storage.buckets
SET
  allowed_mime_types = ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/webm', 'video/quicktime'
  ],
  file_size_limit = 209715200 -- 200MB
WHERE id = 'workflow-ephemeral-tmp';
