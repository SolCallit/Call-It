-- 1) Invite-only access: codes, and who has unlocked the app.
alter table public.profiles add column if not exists access_at timestamptz;
alter table public.profiles add column if not exists access_code text;
-- Everyone already signed up keeps access.
update public.profiles set access_at = coalesce(access_at, now()) where access_at is null;

create table if not exists public.access_codes (
  code        text primary key,
  max_uses    int  not null default 1 check (max_uses between 1 and 100000),
  uses        int  not null default 0,
  note        text,
  expires_at  timestamptz,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table public.access_codes enable row level security;
revoke all on public.access_codes from anon, authenticated;

-- Redeems a code for a profile in one step. Returns 'ok', 'already', 'invalid', 'used_up' or 'expired'.
create or replace function public.redeem_access_code(p_profile uuid, p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare c public.access_codes;
begin
  if exists (select 1 from profiles where id = p_profile and access_at is not null) then return 'already'; end if;
  select * into c from access_codes where code = upper(trim(p_code)) for update;
  if not found then return 'invalid'; end if;
  if c.expires_at is not null and c.expires_at < now() then return 'expired'; end if;
  if c.uses >= c.max_uses then return 'used_up'; end if;
  update access_codes set uses = uses + 1 where code = c.code;
  update profiles set access_at = now(), access_code = c.code where id = p_profile;
  return 'ok';
end $$;
revoke all on function public.redeem_access_code(uuid, text) from public, anon, authenticated;

-- 2) Wallet password: asked before a private key export.
create table if not exists public.wallet_locks (
  profile_id    uuid primary key references public.profiles(id) on delete cascade,
  hash          text not null,
  salt          text not null,
  fails         int  not null default 0,
  locked_until  timestamptz,
  reset_at      timestamptz,
  updated_at    timestamptz not null default now()
);
alter table public.wallet_locks enable row level security;
revoke all on public.wallet_locks from anon, authenticated;

-- 3) Meme market flow radar: one snapshot about every 5 minutes.
create table if not exists public.market_flow (
  at        timestamptz primary key default now(),
  net_5m    double precision,
  net_1h    double precision,
  net_6h    double precision,
  net_24h   double precision,
  buy_5m    double precision,
  sell_5m   double precision,
  buy_1h    double precision,
  sell_1h   double precision,
  tokens    int
);
alter table public.market_flow enable row level security;
revoke all on public.market_flow from anon, authenticated;
