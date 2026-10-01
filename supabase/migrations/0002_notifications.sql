-- Callit: notifications
-- Run once in Supabase → SQL Editor → New query → paste → Run.

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  kind        text not null check (kind in ('welcome','calls','earn','mentions','alerts','follows','system')),
  title       text not null check (char_length(title) <= 140),
  body        text check (char_length(body) <= 400),
  link        text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_profile_created_idx
  on public.notifications (profile_id, created_at desc);

-- One welcome per user, even if sign-up races.
create unique index if not exists notifications_one_welcome
  on public.notifications (profile_id) where kind = 'welcome';

-- Private: no public read or write. The server reads and writes them for the
-- signed-in user after checking their Privy token.
alter table public.notifications enable row level security;

-- Track the welcome email so it's only ever sent once.
alter table public.profiles add column if not exists welcome_email_sent_at timestamptz;
