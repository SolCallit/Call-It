-- Callit: full database lockdown + row level security on by default.
-- Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- The browser never reads or writes tables with the public (anon) key: every read and write goes
-- through Callit's server with the service role. The only thing the browser uses Supabase for is
-- Realtime broadcast (call signalling), which doesn't touch these tables. So the public key gets
-- no access to any table, view, sequence or function in the public schema.

-- 1. Drop every policy on public tables (the old "anyone can read" ones exposed privy_id and Telegram ids,
--    plus any added by hand in the dashboard). With no policies, RLS lets the browser roles see nothing.
do $$
declare p record;
begin
  for p in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- 2. Row level security on for every table that exists now (belt and braces; all should already be on).
do $$
declare t record;
begin
  for t in select schemaname, tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table %I.%I enable row level security', t.schemaname, t.tablename);
  end loop;
end $$;

-- 3. The public and signed-in browser roles get nothing in the public schema, now or later.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated, public;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated, public;
-- The server keeps full access.
grant usage on schema public to service_role;
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all functions in schema public to service_role;
alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;

-- 4. Row level security turns itself on for any table created in the future, even one made by hand
--    in the Table Editor. (Skipped quietly if this project doesn't allow event triggers.)
create or replace function public.rls_on_new_tables() returns event_trigger language plpgsql as $$
declare obj record;
begin
  for obj in select * from pg_event_trigger_ddl_commands() where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO') loop
    if obj.schema_name = 'public' then
      execute format('alter table %s enable row level security', obj.object_identity);
    end if;
  end loop;
end $$;
revoke all on function public.rls_on_new_tables() from anon, authenticated, public;
do $$
begin
  drop event trigger if exists callit_rls_on_new_tables;
  create event trigger callit_rls_on_new_tables on ddl_command_end
    when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
    execute function public.rls_on_new_tables();
exception when insufficient_privilege then
  raise notice 'Event triggers are not allowed on this project; RLS is still on for every existing table.';
end $$;

-- 5. Check: this should return no rows. Any row = a table without RLS.
select tablename as table_without_rls from pg_tables where schemaname = 'public' and not rowsecurity;
