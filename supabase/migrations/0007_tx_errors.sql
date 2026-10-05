-- Failed withdrawals / swaps, so the admin panel shows the real reason instead of guessing.
create table if not exists public.tx_errors (
  id bigint generated always as identity primary key,
  privy_id text,
  wallet text,
  action text not null,           -- withdraw | swap | buy | sell
  stage text,                     -- prepare | sign | send | execute
  message text,                   -- readable text
  raw jsonb,                      -- full error object
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists tx_errors_created_idx on public.tx_errors (created_at desc);
alter table public.tx_errors enable row level security; -- service role only
