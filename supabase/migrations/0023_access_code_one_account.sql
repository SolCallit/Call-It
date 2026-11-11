-- An access code belongs to the account(s) that redeemed it.
-- Your own code always lets you back in; an account that never claimed it is refused once the
-- code's uses are spent, so a code shared around can't open a second account.
create table if not exists public.access_code_uses (
  code       text not null references public.access_codes(code) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  used_at    timestamptz not null default now(),
  primary key (code, profile_id)
);
create index if not exists access_code_uses_profile_idx on public.access_code_uses (profile_id);
alter table public.access_code_uses enable row level security;
revoke all on public.access_code_uses from anon, authenticated;

-- Backfill whoever already redeemed a code before this table existed.
insert into public.access_code_uses (code, profile_id, used_at)
select p.access_code, p.id, coalesce(p.access_at, now())
from public.profiles p
join public.access_codes c on c.code = p.access_code
where p.access_code is not null
on conflict do nothing;

-- Returns 'ok', 'already', 'invalid', 'used_up', 'taken' or 'expired'.
--   already  — this account is already in; nothing was consumed
--   taken    — the code is spent and this account is not one of its owners
create or replace function public.redeem_access_code(p_profile uuid, p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare c public.access_codes; mine boolean;
begin
  -- Already in (redeemed earlier, or granted before the gate existed): never burn a code for them.
  if exists (select 1 from profiles where id = p_profile and access_at is not null) then return 'already'; end if;

  select * into c from access_codes where code = upper(trim(p_code)) for update;
  if not found then return 'invalid'; end if;
  if c.expires_at is not null and c.expires_at < now() then return 'expired'; end if;

  select exists (select 1 from access_code_uses u where u.code = c.code and u.profile_id = p_profile) into mine;
  if not mine then
    -- Spent codes stay with their owners: a different account is turned away, not just counted out.
    if c.uses >= c.max_uses then
      return case when exists (select 1 from access_code_uses u where u.code = c.code) then 'taken' else 'used_up' end;
    end if;
    insert into access_code_uses (code, profile_id) values (c.code, p_profile);
    update access_codes set uses = uses + 1 where code = c.code;
  end if;

  update profiles set access_at = coalesce(access_at, now()), access_code = c.code where id = p_profile;
  return 'ok';
end $$;

revoke execute on function public.redeem_access_code(uuid, text) from public, anon, authenticated;
grant  execute on function public.redeem_access_code(uuid, text) to service_role;
