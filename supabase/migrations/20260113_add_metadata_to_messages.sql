-- Add metadata column to messages table to store workflow and other data
alter table public.messages 
add column if not exists metadata jsonb default '{}'::jsonb;
