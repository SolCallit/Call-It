-- Callit: pin search_path on every public function (Supabase security advisor: function_search_path_mutable).
-- Run once in Supabase → SQL Editor. Safe to re-run.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f' loop
    execute format('alter function %s set search_path = public, pg_temp', f.sig);
  end loop;
end $$;
