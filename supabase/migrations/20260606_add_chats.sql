-- Per-session chat history (step 2).
--
-- A session (workflow) can now hold MULTIPLE chats. The session still owns the
-- one canvas; chats are independent conversation threads against it.
--   - sessions.active_chat_id → the live chat (new messages land here).
--   - messages.chat_id        → which chat a message belongs to.
-- "New chat" creates a chat + flips active_chat_id (the old chat is archived,
-- not deleted). The history dropdown lists a session's chats.

create table if not exists public.chats (
  id uuid default gen_random_uuid() primary key,
  session_id uuid references public.sessions(id) on delete cascade not null,
  title text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.messages
  add column if not exists chat_id uuid references public.chats(id) on delete cascade;

alter table public.sessions
  add column if not exists active_chat_id uuid references public.chats(id) on delete set null;

create index if not exists idx_chats_session_id on public.chats(session_id, updated_at desc);
create index if not exists idx_messages_chat_id on public.messages(chat_id, created_at);

-- ── RLS: a chat is accessible exactly when its parent session is ────────────
alter table public.chats enable row level security;

create policy "Users can view chats of their sessions"
  on public.chats for select
  using (exists (select 1 from public.sessions s where s.id = chats.session_id and s.user_id = auth.uid()));

create policy "Users can insert chats to their sessions"
  on public.chats for insert
  with check (exists (select 1 from public.sessions s where s.id = chats.session_id and s.user_id = auth.uid()));

create policy "Users can update chats of their sessions"
  on public.chats for update
  using (exists (select 1 from public.sessions s where s.id = chats.session_id and s.user_id = auth.uid()));

create policy "Users can delete chats of their sessions"
  on public.chats for delete
  using (exists (select 1 from public.sessions s where s.id = chats.session_id and s.user_id = auth.uid()));

-- ── Auto-fill messages.chat_id from the session's active chat on insert ─────
-- Every existing insert path (plan / tasks / main brain loop) writes only
-- session_id; this trigger stamps the right chat without touching that code.
-- SECURITY DEFINER + fixed search_path so it can read sessions under RLS safely.
create or replace function public.set_message_chat_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.chat_id is null then
    select active_chat_id into new.chat_id from public.sessions where id = new.session_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_message_chat_id on public.messages;
create trigger trg_set_message_chat_id
  before insert on public.messages
  for each row execute function public.set_message_chat_id();

-- ── Backfill: one chat per existing session, holding its current messages ───
-- Idempotent: the NOT EXISTS / IS NULL guards make re-runs safe.
insert into public.chats (id, session_id, title, created_at, updated_at)
select gen_random_uuid(), s.id, nullif(s.title, ''), s.created_at, s.updated_at
from public.sessions s
where not exists (select 1 from public.chats c where c.session_id = s.id);

update public.sessions s
set active_chat_id = c.id
from public.chats c
where c.session_id = s.id and s.active_chat_id is null;

update public.messages m
set chat_id = c.id
from public.chats c
where m.session_id = c.session_id and m.chat_id is null;
