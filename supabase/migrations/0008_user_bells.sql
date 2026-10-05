-- Callit: X-style 🔔 on a profile. Following alone sends no pop-ups; ringing the bell does.
create table if not exists public.user_bells (
  profile_id     uuid not null references public.profiles(id) on delete cascade,
  target_handle  text not null check (target_handle ~ '^[A-Za-z0-9_]{1,30}$'),
  level          text not null default 'all' check (level in ('all','calls')),
  created_at     timestamptz not null default now(),
  primary key (profile_id, target_handle)
);
create index if not exists user_bells_target_idx on public.user_bells (target_handle);
alter table public.user_bells enable row level security;
