-- "New chat" soft-clear boundary.
--
-- Pressing "New chat" inside a session starts a clean conversation WITHOUT
-- changing sessions or touching the canvas. Instead of deleting messages, we
-- stamp a per-session boundary: messages created at/before `cleared_at` are
-- hidden from the UI and excluded from the AI context (the chat brain only
-- receives client-sent messages, so a cleared store already cuts context — this
-- column makes the clear survive a reload).
--
-- Non-destructive by design: the old messages stay in the table, so a future
-- "chat history" feature can surface them per session.
ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS cleared_at TIMESTAMPTZ DEFAULT NULL;
