-- Character drafts: a character dismissed from the editor without Cancel is
-- kept as a draft. Drafts are hidden from the @ mention picker and the side
-- characters panel (the default list query filters is_draft = false) and shown
-- only on the assets page. Existing rows default to active (false).
alter table public.characters
  add column if not exists is_draft boolean not null default false;
