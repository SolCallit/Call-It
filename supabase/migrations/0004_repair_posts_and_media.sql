-- Callit: repair posts + media storage. Safe to run any number of times.
-- Supabase → SQL Editor → New query → paste ALL of this → Run.
--
-- Why: if `posts` was created before 0003 existed, `create table if not exists`
-- skipped it, so newer columns are missing and inserts fail. This adds anything
-- missing, recreates the media bucket, and reloads the API schema cache.

create extension if not exists pgcrypto;

alter table public.posts add column if not exists profile_id    uuid references public.profiles(id) on delete cascade;
alter table public.posts add column if not exists kind          text;
alter table public.posts add column if not exists body          text not null default '';
alter table public.posts add column if not exists media         text[] not null default '{}';
alter table public.posts add column if not exists mint          text;
alter table public.posts add column if not exists token_sym     text;
alter table public.posts add column if not exists token_name    text;
alter table public.posts add column if not exists chain         text default 'Solana';
alter table public.posts add column if not exists entry_mc      numeric;
alter table public.posts add column if not exists target_mc     numeric;
alter table public.posts add column if not exists horizon       text;
alter table public.posts add column if not exists buy_usd       numeric not null default 0;
alter table public.posts add column if not exists buy_sig       text;
alter table public.posts add column if not exists perp_market   text;
alter table public.posts add column if not exists perp_side     text;
alter table public.posts add column if not exists perp_leverage numeric;
alter table public.posts add column if not exists perp_entry    numeric;
alter table public.posts add column if not exists perp_target   numeric;
alter table public.posts add column if not exists perp_stop     numeric;
alter table public.posts add column if not exists created_at    timestamptz not null default now();
alter table public.posts add column if not exists deleted_at    timestamptz;

-- Rate-limit trigger (re-created so it matches the columns above).
create or replace function public.posts_rate_limit() returns trigger language plpgsql as $$
begin
  if (select count(*) from public.posts
       where profile_id = new.profile_id and created_at > now() - interval '24 hours') >= 50 then
    raise exception 'daily_post_limit';
  end if;
  return new;
end $$;
drop trigger if exists posts_rate_limit on public.posts;
create trigger posts_rate_limit before insert on public.posts
  for each row execute function public.posts_rate_limit();

alter table public.posts enable row level security;
drop policy if exists "Posts are public" on public.posts;
create policy "Posts are public" on public.posts for select using (deleted_at is null);

-- Media bucket: public read, images only, 5 MB. Uploads go through /api/media.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Make the API see the new columns immediately.
notify pgrst, 'reload schema';

-- Check: this should list every column above. If it does, posting works.
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'posts' order by ordinal_position;
