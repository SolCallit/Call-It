-- Callit SI Assistant: AI financial advisor in your wallet.
-- Goals per user, trade proposals that wait for approval, proactive flags on holdings,
-- and per-turn logs + feedback that feed the eval suite.
-- Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.

-- What the user is trying to do. The advisor reads this on every turn.
create table if not exists public.si_profiles (
  profile_id     uuid primary key references public.profiles(id) on delete cascade,
  risk           text not null default 'balanced' check (risk in ('careful', 'balanced', 'degen')),
  goal           text not null default 'grow' check (goal in ('grow', 'stack_sol', 'protect', 'runners')),
  max_trade_pct  numeric not null default 10 check (max_trade_pct > 0 and max_trade_pct <= 100),
  notes          text,                      -- anything else they told SI, in their words (<= 500 chars)
  watch          boolean not null default true, -- proactive flags on their holdings
  watched_at     timestamptz,
  updated_at     timestamptz not null default now()
);
alter table public.si_profiles enable row level security;

-- A trade SI suggested. Nothing moves until the user approves it and signs in their own wallet.
create table if not exists public.si_proposals (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  side        text not null check (side in ('buy', 'sell')),
  mint        text not null,
  sym         text,
  sol_amount  numeric,                 -- buys: SOL to spend
  sell_pct    numeric,                 -- sells: % of the holding
  reason      text not null,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'executed', 'expired', 'failed')),
  signature   text,
  log_id      uuid,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '10 minutes',
  decided_at  timestamptz
);
create index if not exists si_proposals_profile_idx on public.si_proposals (profile_id, created_at desc);
alter table public.si_proposals enable row level security;

-- One row per assistant turn: what it saw, did and said. Kept 30 days. Feeds evals.
create table if not exists public.si_logs (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid references public.profiles(id) on delete cascade,
  prompt_version text not null,
  model          text not null,
  question       text,
  reply          text,
  tools          jsonb not null default '[]',   -- [{name, input, ms, ok}]
  checks         jsonb not null default '{}',   -- guard results (ungrounded numbers, execution claims...)
  usage          jsonb not null default '{}',   -- tokens in/out/cache
  latency_ms     int,
  steps          int,
  created_at     timestamptz not null default now()
);
create index if not exists si_logs_created_idx on public.si_logs (created_at desc);
alter table public.si_logs enable row level security;

create table if not exists public.si_feedback (
  log_id      uuid primary key references public.si_logs(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  rating      smallint not null check (rating in (-1, 1)),
  note        text,
  created_at  timestamptz not null default now()
);
alter table public.si_feedback enable row level security;

-- Proactive flags: something changed in a holding. One per (user, token, kind) per day.
create table if not exists public.si_flags (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  mint        text not null,
  sym         text,
  kind        text not null,            -- dump, pump, liquidity, authority, concentration, danger
  severity    smallint not null default 1 check (severity between 1 and 3),
  title       text not null,
  detail      text not null,
  data        jsonb not null default '{}',
  dedupe      text not null unique,
  seen        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists si_flags_profile_idx on public.si_flags (profile_id, created_at desc);
alter table public.si_flags enable row level security;

-- Last market snapshot per held token, so the watcher can spot liquidity pulls between runs.
create table if not exists public.si_marks (
  mint        text primary key,
  liq         numeric,
  price       numeric,
  at          timestamptz not null default now()
);
alter table public.si_marks enable row level security;
