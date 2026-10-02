-- Callit edit 4: bookmarks, social notifications (follows, likes, reposts, replies),
-- and username changes. Run once in Supabase → SQL Editor → New query → paste → Run.
-- Safe to re-run.

-- ───────────────────────── bookmarks ─────────────────────────
-- post_ref is text (same as reactions) so it can point at a real post or a demo post.
create table if not exists public.bookmarks (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  post_ref    text not null check (char_length(post_ref) <= 64),
  created_at  timestamptz not null default now(),
  primary key (profile_id, post_ref)
);
create index if not exists bookmarks_profile_created_idx on public.bookmarks (profile_id, created_at desc);
-- Private: only the server (service role) reads/writes them for the signed-in user.
alter table public.bookmarks enable row level security;

-- ───────────────────────── notifications ─────────────────────────
-- Who triggered it (shown as their avatar + name) and new social kinds.
alter table public.notifications add column if not exists actor_handle text;
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('welcome','calls','earn','mentions','alerts','follows','likes','reposts','replies','system'));
-- One notification per (actor, kind, link): liking, unliking and liking again doesn't spam.
create unique index if not exists notifications_social_once
  on public.notifications (profile_id, kind, actor_handle, coalesce(link, ''))
  where kind in ('follows','likes','reposts');

-- ───────────────────────── usernames ─────────────────────────
-- Users can pick their own @username. Follows, mutes, blocks and list members point at
-- handles, so a rename carries them over to the new handle automatically.
alter table public.profiles add column if not exists handle_changed_at timestamptz;

create or replace function public.profiles_handle_renamed() returns trigger language plpgsql as $$
begin
  if new.handle is distinct from old.handle then
    update public.follows      set target_handle = new.handle where target_handle = old.handle;
    update public.mutes        set target_handle = new.handle where target_handle = old.handle;
    update public.blocks       set target_handle = new.handle where target_handle = old.handle;
    update public.list_members set target_handle = new.handle where target_handle = old.handle;
    update public.notifications set actor_handle = new.handle where actor_handle = old.handle;
    new.handle_changed_at = now();
  end if;
  return new;
end $$;
drop trigger if exists profiles_handle_renamed on public.profiles;
create trigger profiles_handle_renamed before update of handle on public.profiles
  for each row execute function public.profiles_handle_renamed();
