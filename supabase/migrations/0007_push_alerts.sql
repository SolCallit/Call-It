-- Callit: push alerts (follows, token bells, wallet tracking, price/2x alerts).
-- Run once in Supabase → SQL Editor → New query → paste → Run.

create table if not exists public.push_subs (
  endpoint    text primary key,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  p256dh      text not null,
  auth        text not null,
  ua          text,
  created_at  timestamptz not null default now()
);
create index if not exists push_subs_profile_idx on public.push_subs (profile_id);

-- What each user wants pushed. Missing row = defaults (all on, quiet off).
create table if not exists public.alert_prefs (
  profile_id  uuid primary key references public.profiles(id) on delete cascade,
  follows     boolean not null default true,   -- calls, buys, sells by callers you follow
  bells       boolean not null default true,   -- token bells (price moves, new calls, big buys)
  wallets     boolean not null default true,   -- tracked outside wallets
  milestones  boolean not null default true,   -- 2x / 5x / 10x on calls you made or follow
  quiet       boolean not null default false,
  updated_at  timestamptz not null default now()
);

-- 🔔 on a token.
create table if not exists public.token_bells (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  mint        text not null,
  sym         text,
  pct         numeric not null default 20 check (pct between 5 and 500),
  base_price  numeric,
  base_at     timestamptz,
  created_at  timestamptz not null default now(),
  primary key (profile_id, mint)
);
create index if not exists token_bells_mint_idx on public.token_bells (mint);

-- Outside wallets a user tracks, GMGN-style.
create table if not exists public.tracked_wallets (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  address     text not null check (address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  label       text check (char_length(label) <= 30),
  created_at  timestamptz not null default now(),
  primary key (profile_id, address)
);
create index if not exists tracked_wallets_address_idx on public.tracked_wallets (address);

-- One alert per key per user (dedupe + rate limit).
create table if not exists public.alert_log (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  key         text not null,
  created_at  timestamptz not null default now(),
  primary key (profile_id, key)
);
create index if not exists alert_log_recent_idx on public.alert_log (profile_id, created_at desc);

-- Small key/value store for server settings (e.g. the Helius webhook id).
create table if not exists public.app_kv (
  k text primary key,
  v text,
  updated_at timestamptz not null default now()
);

-- Server-only tables: no browser access at all.
alter table public.push_subs       enable row level security;
alter table public.alert_prefs     enable row level security;
alter table public.token_bells     enable row level security;
alter table public.tracked_wallets enable row level security;
alter table public.alert_log       enable row level security;
alter table public.app_kv          enable row level security;
