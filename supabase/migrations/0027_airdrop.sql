-- Callit: $CALL airdrop. Allocations are loaded from the snapshot (one row per wallet per pool/community);
-- claims track the three unlock steps (call, share on X, unlock) and the final claim.
-- Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.

create table if not exists public.airdrop_allocations (
  id          bigserial primary key,
  wallet      text not null,
  pool        text not null check (pool in ('community', 'callit', 'giveaway')),
  community   text not null default '',          -- e.g. 'JUP' for the community pool, '' otherwise
  rank        int,
  tier        int not null check (tier between 1 and 4),
  tokens      numeric not null check (tokens > 0),
  created_at  timestamptz not null default now(),
  unique (wallet, pool, community)
);
create index if not exists airdrop_allocations_wallet_idx on public.airdrop_allocations (wallet);
alter table public.airdrop_allocations enable row level security;

create table if not exists public.airdrop_claims (
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  wallet        text not null,
  share_url     text,
  shared_at     timestamptz,
  unlocked_at   timestamptz,
  claimed_at    timestamptz,
  claim_tx      text,
  created_at    timestamptz not null default now(),
  primary key (profile_id, wallet)
);
alter table public.airdrop_claims enable row level security;
