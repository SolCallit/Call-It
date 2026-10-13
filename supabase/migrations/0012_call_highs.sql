-- Callit: record the real high a call reached, so "Target hit" shows even when the pump was quick.
-- Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- hi_x   : highest MC / entry MC seen since the call (raw, includes wicks). Display only.
-- hit_at : first time hi_x reached the caller's target. Display only.
-- Payouts still use the wick-proof peak_x / target_at from 0010, so farmers can't game fees.
alter table public.posts add column if not exists hi_x   numeric not null default 0;
alter table public.posts add column if not exists hit_at timestamptz;

create or replace function public.apply_call_x(samples jsonb) returns void language plpgsql as $$
begin
  update public.posts p set
    x_avg  = case when p.x_avg is null then s.x else p.x_avg * 0.8 + s.x * 0.2 end,
    peak_x = greatest(p.peak_x, case when p.x_avg is null then s.x else p.x_avg * 0.8 + s.x * 0.2 end),
    hi_x   = greatest(p.hi_x, s.x)
  from jsonb_to_recordset(samples) as s(id uuid, x numeric)
  where p.id = s.id and s.x > 0 and s.x < 100000;
  update public.posts set qualified_at = now()
    where qualified_at is null and peak_x >= 2 and id in (select (e->>'id')::uuid from jsonb_array_elements(samples) e);
  update public.posts set target_at = now()
    where target_at is null and target_mc > 0 and entry_mc > 0 and peak_x >= target_mc / entry_mc
      and id in (select (e->>'id')::uuid from jsonb_array_elements(samples) e);
  update public.posts set hit_at = now()
    where hit_at is null and target_mc > 0 and entry_mc > 0 and hi_x >= target_mc / entry_mc
      and id in (select (e->>'id')::uuid from jsonb_array_elements(samples) e);
end $$;

-- Calls that already reached their target on the smoothed peak count as hit too.
update public.posts set hit_at = target_at, hi_x = greatest(hi_x, peak_x) where hit_at is null and target_at is not null;
