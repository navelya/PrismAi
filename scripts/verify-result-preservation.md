# Verify: results survive session deletion

Prereq: migration `20260602_preserve_results_on_session_delete.sql` applied;
cron + webhook + helper changes deployed (or running `npm run dev`).

1. Create a session; run a workflow whose leaf node is an AI generator that
   produces an image. Wait for it to finish.
2. Open the Assets gallery — confirm the image appears.
3. In Supabase, capture the keeper row and its file:
   ```sql
   SELECT id, session_id, execution_id, user_id, result_type, result_data
   FROM node_results
   WHERE session_id = '<SESSION_ID>' AND status = 'completed';
   ```
   Note `result_data` (the `/results/<nodeId>/...` URL) and that `user_id` is set.
4. Soft-delete the session from the UI (sidebar delete).
5. Trigger the cleanup cron:
   `curl -H "Authorization: Bearer $CRON_SECRET" "$NEXT_PUBLIC_APP_URL/api/cron/cleanup-sessions"`
6. Confirm preservation:
   - [ ] The keeper row still exists, now with `session_id IS NULL` and
     `execution_id IS NULL` and `user_id` still set:
     ```sql
     SELECT id, session_id, execution_id, user_id FROM node_results WHERE id = '<KEEPER_ID>';
     ```
   - [ ] The keeper's `result_data` URL still loads in a browser (file kept).
   - [ ] The Assets gallery (all-sessions view) still shows the image.
   - [ ] Ephemeral artifacts are gone: the session's `thumbnails/...` storage is
     empty, and any `character`/intermediate node_results rows for that session
     are deleted.
   - [ ] The session row is gone and its messages cascaded away.
