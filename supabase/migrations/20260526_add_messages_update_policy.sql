-- Allow users to UPDATE messages belonging to their own sessions.
--
-- The messages table shipped with SELECT, INSERT, and DELETE policies but no
-- UPDATE policy, so any user-client `update` was silently filtered by RLS
-- (0 rows affected). The chat-run feature PATCHes message metadata
-- (run_proposal / inline_result_ids / execution_result) via
-- /api/messages/[id], which then failed with PGRST116 ("0 rows ... cannot
-- coerce to a single object"). This adds the missing UPDATE policy, scoped by
-- session ownership exactly like the existing SELECT/INSERT/DELETE policies.

create policy "Users can update messages of their sessions"
  on public.messages for update
  using (
    exists (
      select 1 from public.sessions
      where sessions.id = messages.session_id
      and sessions.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.sessions
      where sessions.id = messages.session_id
      and sessions.user_id = auth.uid()
    )
  );
