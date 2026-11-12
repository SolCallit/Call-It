-- Proof that a trade went through Callit with Callit's fee on it.
-- /api/swap/order saves every order that carries Callit's referral fee; /api/swap/execute stamps the
-- signature when it lands. A trade only earns fee shares, cashback and volume points if its signature
-- is here, so a swap made elsewhere (no Callit fee paid) can't be submitted to farm payouts or points.
create table if not exists public.swap_orders (
  request_id  text primary key,
  taker       text not null,
  fee_bps     int  not null check (fee_bps between 0 and 1000),
  fee_mint    text,
  signature   text unique,
  created_at  timestamptz not null default now()
);
create index if not exists swap_orders_created_idx on public.swap_orders (created_at);
alter table public.swap_orders enable row level security;
revoke all on public.swap_orders from anon, authenticated;
