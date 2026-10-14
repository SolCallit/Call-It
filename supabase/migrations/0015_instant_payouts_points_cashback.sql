-- Callit: instant payouts on target, points, and buyer cashback.
-- Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.

-- ───────────────────────── earnings: callers + cashback in one ledger ─────────────────────────
alter table public.earnings add column if not exists kind text not null default 'caller';
do $$ begin
  alter table public.earnings add constraint earnings_kind_chk check (kind in ('caller', 'cashback'));
exception when duplicate_object then null; end $$;
create index if not exists earnings_kind_idx on public.earnings (profile_id, kind) where claim_id is null;

-- ───────────────────────── points ─────────────────────────
-- One row per thing that earned points. ref is unique, so nothing is ever counted twice.
create table if not exists public.points (
  id          bigint generated always as identity primary key,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  kind        text not null check (kind in ('trade', 'call', 'bonus', 'admin')),
  amount      numeric not null,
  ref         text not null unique,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists points_profile_idx on public.points (profile_id, created_at desc);
create index if not exists points_month_idx on public.points (created_at, profile_id);
alter table public.points enable row level security;

create or replace function public.points_of(p uuid) returns numeric language sql stable as $$
  select coalesce(sum(amount), 0) from public.points where profile_id = p
$$;

-- Top users by points for a period (monthly rewards, the Points board).
create or replace function public.points_board(p_since timestamptz, p_limit int)
returns table (profile_id uuid, handle text, display_name text, avatar_url text, pts numeric) language sql stable as $$
  select x.profile_id, pr.handle, pr.display_name, pr.avatar_url, x.pts from (
    select profile_id, sum(amount) as pts from public.points where created_at >= p_since group by profile_id
  ) x join public.profiles pr on pr.id = x.profile_id
  order by x.pts desc limit p_limit
$$;

-- ───────────────────────── what's ready to pay ─────────────────────────
-- Caller earnings pay once the call hits its target (or 2X when the caller set no target).
-- Cashback pays once the buyer has at least p_cb_points points.
create or replace function public.earning_ready(e public.earnings, p_cb_points numeric) returns boolean language sql stable as $$
  select case
    when e.kind = 'cashback' then public.points_of(e.profile_id) >= p_cb_points
    else e.call_id is null or exists (
      select 1 from public.posts p where p.id = e.call_id
        and (p.target_at is not null or coalesce(p.target_mc, 0) <= 0 or coalesce(p.entry_mc, 0) <= 0))
  end
$$;

drop function if exists public.claim_start(uuid, text, numeric, numeric);
create or replace function public.claim_start(p_profile uuid, p_wallet text, p_min numeric, p_max numeric, p_cb_points numeric)
returns table (claim_id uuid, usd numeric) language plpgsql as $$
#variable_conflict use_column
declare cid uuid; total numeric;
begin
  perform 1 from public.profiles where id = p_profile for update;  -- serialize per user
  if exists (select 1 from public.claims where profile_id = p_profile and status = 'pending') then return; end if;
  select coalesce(sum(x.usd), 0) into total from (
    select e.usd, sum(e.usd) over (order by e.created_at, e.id) as run, row_number() over (order by e.created_at, e.id) as rn
    from public.earnings e where e.profile_id = p_profile and e.claim_id is null and public.earning_ready(e, p_cb_points)
  ) x where x.run <= p_max or x.rn = 1;
  if total < p_min then return; end if;
  insert into public.claims (profile_id, wallet, usd) values (p_profile, p_wallet, total) returning id into cid;
  update public.earnings e set claim_id = cid from (
    select e2.id, sum(e2.usd) over (order by e2.created_at, e2.id) as run, row_number() over (order by e2.created_at, e2.id) as rn
    from public.earnings e2 where e2.profile_id = p_profile and e2.claim_id is null and public.earning_ready(e2, p_cb_points)
  ) x where e.id = x.id and (x.run <= p_max or x.rn = 1);
  return query select cid, total;
end $$;

drop function if exists public.payout_queue(numeric, int);
create or replace function public.payout_queue(p_min numeric, p_limit int, p_cb_points numeric)
returns table (profile_id uuid, wallet text, usd numeric) language sql stable as $$
  select e.profile_id, p.wallet_address, sum(e.usd) as usd
  from public.earnings e join public.profiles p on p.id = e.profile_id
  where e.claim_id is null and p.wallet_address is not null and public.earning_ready(e, p_cb_points)
  group by e.profile_id, p.wallet_address
  having sum(e.usd) >= p_min
  order by sum(e.usd) desc
  limit p_limit
$$;

-- Server only.
revoke execute on function public.claim_start(uuid, text, numeric, numeric, numeric) from public, anon, authenticated;
revoke execute on function public.payout_queue(numeric, int, numeric)                from public, anon, authenticated;
revoke execute on function public.earning_ready(public.earnings, numeric)            from public, anon, authenticated;
revoke execute on function public.points_of(uuid)                                    from public, anon, authenticated;
revoke execute on function public.points_board(timestamptz, int)                     from public, anon, authenticated;
grant  execute on function public.claim_start(uuid, text, numeric, numeric, numeric) to service_role;
grant  execute on function public.payout_queue(numeric, int, numeric)                to service_role;
grant  execute on function public.earning_ready(public.earnings, numeric)            to service_role;
grant  execute on function public.points_of(uuid)                                    to service_role;
grant  execute on function public.points_board(timestamptz, int)                     to service_role;
