-- Callit: quote posts (quote a call or post with your own take).
alter table public.posts add column if not exists quote_ref text check (quote_ref is null or char_length(quote_ref) <= 64);
create index if not exists posts_quote_ref_idx on public.posts (quote_ref) where quote_ref is not null;
