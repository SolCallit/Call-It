-- On-chain call receipts.
-- When a call is made, Callit writes its immutable facts to Solana as a memo. The entry market cap
-- is then provable by anyone from the chain, instead of trusted from this database.
alter table public.posts add column if not exists attest_sig  text;
alter table public.posts add column if not exists attest_hash text;
alter table public.posts add column if not exists attest_at   timestamptz;
create index if not exists posts_attest_idx on public.posts (attest_at) where attest_sig is not null;
