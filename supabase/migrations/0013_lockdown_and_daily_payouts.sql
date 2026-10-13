-- Callit: security lockdown + daily auto-payouts.
-- Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.

-- Only the server (service role) may call these. Browsers holding the public anon key cannot.
revoke execute on function public.apply_call_x(jsonb)                         from public, anon, authenticated;
revoke execute on function public.claim_start(uuid, text, numeric, numeric)   from public, anon, authenticated;
revoke execute on function public.claim_release(uuid, text)                   from public, anon, authenticated;
revoke execute on function public.chat_inbox(uuid)                            from public, anon, authenticated;
grant  execute on function public.apply_call_x(jsonb)                         to service_role;
grant  execute on function public.claim_start(uuid, text, numeric, numeric)   to service_role;
grant  execute on function public.claim_release(uuid, text)                   to service_role;
grant  execute on function public.chat_inbox(uuid)                            to service_role;

-- A claim can only hand earnings back while it is still pending. Before, releasing a claim that had
-- already been sent would have freed its earnings to be paid a second time.
create or replace function public.claim_release(p_claim uuid, p_error text) returns void language plpgsql as $$
begin
  update public.claims set status = 'failed', error = left(p_error, 300), updated_at = now()
    where id = p_claim and status = 'pending';
  if found then
    update public.earnings set claim_id = null where claim_id = p_claim;
  end if;
end $$;
revoke execute on function public.claim_release(uuid, text) from public, anon, authenticated;
grant  execute on function public.claim_release(uuid, text) to service_role;

-- Daily auto-payout picks up everyone with unclaimed earnings, biggest first.
create or replace function public.payout_queue(p_min numeric, p_limit int)
returns table (profile_id uuid, wallet text, usd numeric) language sql stable as $$
  select e.profile_id, p.wallet_address, sum(e.usd) as usd
  from public.earnings e join public.profiles p on p.id = e.profile_id
  where e.claim_id is null and p.wallet_address is not null
  group by e.profile_id, p.wallet_address
  having sum(e.usd) >= p_min
  order by sum(e.usd) desc
  limit p_limit
$$;
revoke execute on function public.payout_queue(numeric, int) from public, anon, authenticated;
grant  execute on function public.payout_queue(numeric, int) to service_role;
