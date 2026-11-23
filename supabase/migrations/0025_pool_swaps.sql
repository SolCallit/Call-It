-- Callit: own swap indexer. Swaps decoded from Helius for pools people are viewing; candles and the
-- Trades list are built from these. Kept ~3 days per pool (older history comes from GeckoTerminal).
-- Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.

create table if not exists public.pool_swaps (
  pool  text not null,
  sig   text not null,
  mint  text not null,
  t     timestamptz not null,
  side  text not null check (side in ('buy', 'sell')),
  px    numeric not null,          -- USD per token
  usd   numeric not null,          -- trade size in USD
  amt   numeric not null,          -- tokens
  who   text,                      -- trader wallet
  primary key (pool, sig)
);
create index if not exists pool_swaps_pool_t_idx on public.pool_swaps (pool, t desc);
alter table public.pool_swaps enable row level security;

create table if not exists public.pool_sync (
  pool       text primary key,
  mint       text,
  last_sig   text,                 -- newest signature already indexed
  synced_at  timestamptz
);
alter table public.pool_sync enable row level security;
