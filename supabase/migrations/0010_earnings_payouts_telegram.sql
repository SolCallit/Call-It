-- Callit: caller earnings, Claim payouts, and Telegram calls.
-- Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.

-- ───────────────────────── call performance (wick-proof) ─────────────────────────
-- x_avg: ~5-minute rolling average of MC / entry MC, updated every minute by /api/cron/alerts.
-- peak_x: the best x_avg the call has held. A one-candle wick can't push it up.
alter table public.posts add column if not exists x_avg        numeric;
alter table public.posts add column if not exists peak_x       numeric not null default 0;
alter table public.posts add column if not exists qualified_at timestamptz;  -- first time peak_x reached 2X
alter table public.posts add column if not exists target_at    timestamptz;  -- first time peak_x reached the caller's target
-- Where the call came from: the app, or a Telegram group.
alter table public.posts add column if not exists source       text not null default 'app';
alter table public.posts add column if not exists source_label text check (source_label is null or char_length(source_label) <= 80);
create index if not exists posts_qualified_idx on public.posts (qualified_at) where qualified_at is not null;

-- Applies a batch of x samples in one round trip: [{ "id": uuid, "x": number }, ...]
create or replace function public.apply_call_x(samples jsonb) returns void language plpgsql as $$
begin
  update public.posts p set
    x_avg        = case when p.x_avg is null then s.x else p.x_avg * 0.8 + s.x * 0.2 end,
    peak_x       = greatest(p.peak_x, case when p.x_avg is null then s.x else p.x_avg * 0.8 + s.x * 0.2 end)
  from jsonb_to_recordset(samples) as s(id uuid, x numeric)
  where p.id = s.id and s.x > 0 and s.x < 100000;
  update public.posts set qualified_at = now()
    where qualified_at is null and peak_x >= 2 and id in (select (e->>'id')::uuid from jsonb_array_elements(samples) e);
  update public.posts set target_at = now()
    where target_at is null and target_mc > 0 and entry_mc > 0 and peak_x >= target_mc / entry_mc
      and id in (select (e->>'id')::uuid from jsonb_array_elements(samples) e);
end $$;

-- ───────────────────────── earnings ledger ─────────────────────────
-- One row per buy that a call brought in. Amounts are USD; Claim pays the SOL equivalent.
create table if not exists public.earnings (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  call_id       uuid references public.posts(id) on delete set null,
  tx_signature  text not null unique,
  bought_in     boolean not null,          -- caller bought and held: bigger share
  share_pct     numeric not null,          -- % of Callit's fee (after Jupiter's cut)
  fee_usd       numeric not null,          -- the trade's total fee
  usd           numeric not null check (usd > 0),
  claim_id      uuid,
  created_at    timestamptz not null default now()
);
create index if not exists earnings_profile_idx on public.earnings (profile_id, created_at desc);
create index if not exists earnings_unclaimed_idx on public.earnings (profile_id) where claim_id is null;

create table if not exists public.claims (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  wallet      text not null,
  usd         numeric not null,
  sol_price   numeric,
  lamports    bigint,
  signature   text,
  status      text not null default 'pending' check (status in ('pending','sent','failed')),
  error       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists claims_profile_idx on public.claims (profile_id, created_at desc);
create index if not exists claims_recent_idx  on public.claims (created_at desc);
-- At most one claim in flight per user: no double payouts from double taps.
create unique index if not exists claims_one_pending on public.claims (profile_id) where status = 'pending';

-- Atomically reserves a user's unclaimed earnings (oldest first, up to p_max USD) into a new claim.
-- Returns nothing when there's less than p_min to claim or a claim is already in flight.
create or replace function public.claim_start(p_profile uuid, p_wallet text, p_min numeric, p_max numeric)
returns table (claim_id uuid, usd numeric) language plpgsql as $$
#variable_conflict use_column
declare cid uuid; total numeric;
begin
  perform 1 from public.profiles where id = p_profile for update;  -- serialize per user
  if exists (select 1 from public.claims where profile_id = p_profile and status = 'pending') then return; end if;
  select coalesce(sum(x.usd), 0) into total from (
    select e.usd, sum(e.usd) over (order by e.created_at, e.id) as run, row_number() over (order by e.created_at, e.id) as rn
    from public.earnings e where e.profile_id = p_profile and e.claim_id is null
  ) x where x.run <= p_max or x.rn = 1;
  if total < p_min then return; end if;
  insert into public.claims (profile_id, wallet, usd) values (p_profile, p_wallet, total) returning id into cid;
  update public.earnings e set claim_id = cid from (
    select e2.id, sum(e2.usd) over (order by e2.created_at, e2.id) as run, row_number() over (order by e2.created_at, e2.id) as rn
    from public.earnings e2 where e2.profile_id = p_profile and e2.claim_id is null
  ) x where e.id = x.id and (x.run <= p_max or x.rn = 1);
  return query select cid, total;
end $$;

-- A claim that never reached the chain: hand its earnings back so they can be claimed again.
create or replace function public.claim_release(p_claim uuid, p_error text) returns void language plpgsql as $$
begin
  update public.earnings set claim_id = null where claim_id = p_claim;
  update public.claims set status = 'failed', error = left(p_error, 300), updated_at = now() where id = p_claim and status = 'pending';
end $$;

-- ───────────────────────── Telegram ─────────────────────────
-- Groups where an admin turned the Callit bot on with /callit.
create table if not exists public.tg_groups (
  chat_id     bigint primary key,
  title       text,
  enabled     boolean not null default true,
  profile_id  uuid references public.profiles(id) on delete set null,  -- the group's Callit profile (unlinked callers post as it)
  added_by    bigint,
  created_at  timestamptz not null default now()
);
-- Telegram users who linked their Callit account (/link CODE). Their calls post as them and earn.
create table if not exists public.tg_users (
  tg_user_id  bigint primary key,
  profile_id  uuid not null unique references public.profiles(id) on delete cascade,
  username    text,
  created_at  timestamptz not null default now()
);
create table if not exists public.tg_link_codes (
  code        text primary key,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  expires_at  timestamptz not null
);
-- One call per token per group per day (the first person to drop the CA gets it).
create table if not exists public.tg_seen (
  chat_id     bigint not null,
  mint        text not null,
  post_id     uuid,
  created_at  timestamptz not null default now(),
  primary key (chat_id, mint)
);

-- Server-only tables: no browser access.
alter table public.earnings      enable row level security;
alter table public.claims        enable row level security;
alter table public.tg_groups     enable row level security;
alter table public.tg_users      enable row level security;
alter table public.tg_link_codes enable row level security;
alter table public.tg_seen       enable row level security;
