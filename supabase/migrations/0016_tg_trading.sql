-- Callit: Telegram trading bot (Trojan-style bot wallets).
-- Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
-- Trading stays OFF until TG_TRADING_ON=1 and BOT_WALLET_KEY are set in Vercel.

-- One wallet per Telegram user. The secret key is AES-256-GCM encrypted with BOT_WALLET_KEY;
-- the database alone can never move funds.
create table if not exists public.tg_wallets (
  tg_user_id   bigint primary key,
  address      text not null unique,
  secret_enc   text not null,
  profile_id   uuid references public.profiles(id) on delete set null,  -- the Callit profile buys post as
  buy_amounts  numeric[] not null default '{0.1,0.5,1}',
  slippage_bps int check (slippage_bps is null or slippage_bps between 10 and 5000),
  auto_call    boolean not null default true,                            -- buys post a call on Callit
  exported_at  timestamptz,
  created_at   timestamptz not null default now()
);

-- Every button tap / command that moves money is recorded once, so a Telegram retry can never buy twice.
create table if not exists public.tg_actions (
  id          text primary key,           -- callback query id or "m:<chat>:<message id>"
  tg_user_id  bigint not null,
  action      text not null,
  mint        text,
  amount      numeric,
  signature   text,
  status      text not null default 'started' check (status in ('started', 'done', 'failed')),
  error       text,
  created_at  timestamptz not null default now()
);
create index if not exists tg_actions_user_idx on public.tg_actions (tg_user_id, created_at desc);

alter table public.tg_wallets enable row level security;
alter table public.tg_actions enable row level security;
