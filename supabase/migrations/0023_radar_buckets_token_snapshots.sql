-- Radar market-cap buckets + per-token snapshots.
-- market_flow_buckets: one row per MC band (plus 'majors') per 5-minute radar snapshot,
--   so the radar can later chart where money rotates between bands over time.
-- token_snapshots: the most-traded tokens' features every snapshot — the tuning data that
--   lets Heat / AI Auto accuracy be measured against what actually happened afterwards.
-- Both are written by the server with the service role only; clients never read them directly.

create table if not exists public.market_flow_buckets (
  at timestamptz not null,
  bucket text not null,
  tokens int not null default 0,
  buy_5m double precision not null default 0,
  sell_5m double precision not null default 0,
  buy_1h double precision not null default 0,
  sell_1h double precision not null default 0,
  buy_24h double precision not null default 0,
  sell_24h double precision not null default 0,
  primary key (at, bucket)
);
create index if not exists market_flow_buckets_at on public.market_flow_buckets (at);
alter table public.market_flow_buckets enable row level security;
revoke all on public.market_flow_buckets from anon, authenticated;

create table if not exists public.token_snapshots (
  at timestamptz not null,
  mint text not null,
  sym text,
  mc double precision,
  price double precision,
  liq double precision,
  holders int,
  organic double precision,
  launchpad text,
  buy_5m double precision not null default 0,
  sell_5m double precision not null default 0,
  buy_1h double precision not null default 0,
  sell_1h double precision not null default 0,
  chg_5m double precision,
  chg_1h double precision,
  chg_24h double precision,
  primary key (mint, at)
);
create index if not exists token_snapshots_at on public.token_snapshots (at);
alter table public.token_snapshots enable row level security;
revoke all on public.token_snapshots from anon, authenticated;
