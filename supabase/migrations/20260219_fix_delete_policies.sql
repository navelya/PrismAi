-- Fix missing DELETE policies for messages and images

-- 1. Messages Delete Policy
-- This allows the "revert" function to delete future messages
create policy "Users can delete messages of their sessions"
  on public.messages for delete
  using (
    exists (
      select 1 from public.sessions
      where sessions.id = messages.session_id
      and sessions.user_id = auth.uid()
    )
  );

-- 2. Images Delete Policy (for completeness)
create policy "Users can delete their own images"
  on public.images for delete
  using (auth.uid() = user_id);
