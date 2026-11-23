-- Callit: hold bonus. A caller who bought in, hit their target and keeps holding earns up to +20%
-- extra on all the buy fees their call brought in. Selling out (or 7 days after target) locks it.
-- Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.

alter table public.earnings drop constraint if exists earnings_kind_chk;
alter table public.earnings add constraint earnings_kind_chk check (kind in ('caller', 'cashback', 'hold'));

create table if not exists public.call_holds (
  call_id     uuid primary key references public.posts(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  started_at  timestamptz not null,              -- when the call hit its target
  last_at     timestamptz not null,              -- last time the position was checked
  held_min    numeric not null default 0,        -- minutes held at $50+, weighted by % still held and token strength
  max_ui      numeric not null default 0,        -- biggest balance seen since target (for "% still held")
  last_ui     numeric not null default 0,
  last_usd    numeric not null default 0,
  bonus_pct   numeric not null default 0,        -- live bonus, 0..20
  status      text not null default 'open' check (status in ('open', 'settled', 'void')),
  note        text,
  settled_at  timestamptz,
  bonus_usd   numeric
);
create index if not exists call_holds_open_idx on public.call_holds (last_at) where status = 'open';
create index if not exists call_holds_profile_idx on public.call_holds (profile_id);
alter table public.call_holds enable row level security;
