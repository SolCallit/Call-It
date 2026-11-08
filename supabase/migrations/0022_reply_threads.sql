-- Callit: threaded replies.
-- Replies were a flat list, so a conversation about one point buried everything else.
-- parent_id points at the top-level reply a response belongs under (Instagram style: one
-- level deep, children collapsed behind "View N replies"). Null = a top-level reply.
-- Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.

alter table public.post_replies
  add column if not exists parent_id uuid references public.post_replies(id) on delete cascade;

-- Fetching the children of the replies on one post.
create index if not exists post_replies_parent_idx
  on public.post_replies (parent_id, created_at)
  where parent_id is not null;

-- Top-level replies for a post, newest first (the thread list itself).
create index if not exists post_replies_roots_idx
  on public.post_replies (post_ref, created_at desc)
  where parent_id is null and deleted_at is null;
