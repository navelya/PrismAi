-- Enable UUID extension if not enabled
create extension if not exists "uuid-ossp";

-- 1. Sessions Table
create table if not exists public.sessions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text default 'New Workflow',
  canvas_state jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. Messages Table
create table if not exists public.messages (
  id uuid default gen_random_uuid() primary key,
  session_id uuid references public.sessions(id) on delete cascade not null,
  role text not null check (role in ('user', 'assistant')),
  content text,
  images text[], -- Array of image URLs/Paths (optional, for convenience)
  created_at timestamptz default now()
);

-- 3. Images Table (Metadata only, file in Storage)
create table if not exists public.images (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  storage_path text not null,
  prompt text, -- For AI generated images
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

-- Enable RLS
alter table public.sessions enable row level security;
alter table public.messages enable row level security;
alter table public.images enable row level security;

-- Policies for Sessions
create policy "Users can view their own sessions"
  on public.sessions for select
  using (auth.uid() = user_id);

create policy "Users can insert their own sessions"
  on public.sessions for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own sessions"
  on public.sessions for update
  using (auth.uid() = user_id);

create policy "Users can delete their own sessions"
  on public.sessions for delete
  using (auth.uid() = user_id);

-- Policies for Messages
-- (Access depends on session ownership)
create policy "Users can view messages of their sessions"
  on public.messages for select
  using (
    exists (
      select 1 from public.sessions
      where sessions.id = messages.session_id
      and sessions.user_id = auth.uid()
    )
  );

create policy "Users can insert messages to their sessions"
  on public.messages for insert
  with check (
    exists (
      select 1 from public.sessions
      where sessions.id = messages.session_id
      and sessions.user_id = auth.uid()
    )
  );

-- Policies for Images
create policy "Users can view their own images"
  on public.images for select
  using (auth.uid() = user_id);

create policy "Users can insert their own images"
  on public.images for insert
  with check (auth.uid() = user_id);

-- Create Storage Bucket 'chat-assets' if not exists
-- Note: This is usually done via UI or specialized API, but including SQL for reference
insert into storage.buckets (id, name, public)
values ('chat-assets', 'chat-assets', true)
on conflict (id) do nothing;

-- Storage Policy: Users can upload to their own folder (optional organization) or global if public
create policy "Authenticated users can upload images"
  on storage.objects for insert
  with check ( bucket_id = 'chat-assets' and auth.role() = 'authenticated' );

create policy "Public access to chat assets"
  on storage.objects for select
  using ( bucket_id = 'chat-assets' );
