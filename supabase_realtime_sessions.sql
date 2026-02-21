-- Run this in your Supabase SQL Editor to enable Realtime for sessions

-- Enable Realtime for the sessions table (required for live Sidebar title updates)
ALTER PUBLICATION supabase_realtime ADD TABLE public.sessions;
