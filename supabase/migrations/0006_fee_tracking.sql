-- Callit: fee tracking for the admin Radar.
-- Run once in Supabase → SQL Editor → New query → paste → Run.
--
-- Every buy/sell/swap now stores the fee rate Callit charged and its USD value,
-- stamped by the server (never trusted from the browser).
alter table public.transactions add column if not exists fee_bps numeric not null default 0;
alter table public.transactions add column if not exists fee_usd numeric not null default 0;

-- Radar reads by time window.
create index if not exists transactions_created_idx on public.transactions (created_at desc);
