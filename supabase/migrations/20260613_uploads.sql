-- Migration: User upload index
-- Date: 2026-06-13
-- Purpose: Tag every genuine user file-upload so the Assets surfaces can list
--          them in a dedicated "Uploads" tab. Uploads are saved to the
--          `chat-assets` storage bucket but were never recorded in any table —
--          both the Assets panel and Assets page only read `node_results`
--          (generated results), so uploads never appeared anywhere. The bucket
--          can't be listed cleanly either: a canvas upload shares the
--          `{userId}/{sessionId}/thumbnails/{nodeId}/...` path namespace with
--          generated thumbnails and carries no media-type metadata. This narrow
--          index is the only place an upload is cleanly marked as a user upload.
--
--          One row is inserted by POST /api/upload for each tracked file upload
--          (track=1), and removed by DELETE /api/upload when the storage file is
--          deleted (e.g. removing media from a media_input node, or the Uploads
--          tab's hard-delete) — so the list never shows a dangling URL.

CREATE TABLE IF NOT EXISTS public.uploads (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url           TEXT NOT NULL,
  storage_path  TEXT NOT NULL,
  media_type    TEXT NOT NULL CHECK (media_type IN ('image', 'video', 'audio')),
  mime_type     TEXT,
  session_id    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- De-dupe by URL per user (a re-upload of the same object is idempotent).
CREATE UNIQUE INDEX IF NOT EXISTS uploads_user_url_key ON public.uploads(user_id, url);
-- The Uploads tab lists a user's uploads newest-first.
CREATE INDEX IF NOT EXISTS idx_uploads_user_created ON public.uploads(user_id, created_at DESC);
-- DELETE /api/upload cleans rows by storage_path.
CREATE INDEX IF NOT EXISTS idx_uploads_user_path ON public.uploads(user_id, storage_path);

ALTER TABLE public.uploads ENABLE ROW LEVEL SECURITY;

-- A user manages only their own uploads. The upload route uses the RLS-scoped
-- session client, so auth.uid() = user_id holds for inserts/deletes.
DROP POLICY IF EXISTS "uploads_select_own" ON public.uploads;
CREATE POLICY "uploads_select_own" ON public.uploads
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "uploads_insert_own" ON public.uploads;
CREATE POLICY "uploads_insert_own" ON public.uploads
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "uploads_delete_own" ON public.uploads;
CREATE POLICY "uploads_delete_own" ON public.uploads
  FOR DELETE USING (user_id = auth.uid());
