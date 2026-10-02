-- Callit: posts (meme / perps / random), reactions, replies, social graph,
-- watchlist, lists, transactions ledger and media storage.
-- Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- Security model (same as profiles/notifications): Row Level Security is ON for
-- every table. Public content (posts, replies, reaction counts, follows) is
-- readable by anyone; ALL writes go through our API with the service role,
-- after the server has verified the user's Privy token.

-- ───────────────────────── posts ─────────────────────────
create table if not exists public.posts (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  kind          text not null check (kind in ('meme','perps','random')),
  body          text not null default '' check (char_length(body) <= 280),
  media         text[] not null default '{}' check (cardinality(media) <= 4),

  -- meme call: token snapshot + entry stamped at post time
  mint          text,
  token_sym     text check (char_length(token_sym) <= 20),
  token_name    text check (char_length(token_name) <= 60),
  chain         text default 'Solana',
  entry_mc      numeric,
  target_mc     numeric,
  horizon       text check (horizon in ('24 hours','3 days','7 days','30 days')),
  buy_usd       numeric not null default 0,
  buy_sig       text,

  -- perps call
  perp_market   text check (perp_market in ('SOL','BTC','ETH')),
  perp_side     text check (perp_side in ('long','short')),
  perp_leverage numeric check (perp_leverage between 1 and 100),
  perp_entry    numeric,
  perp_target   numeric,
  perp_stop     numeric,

  created_at    timestamptz not null default now(),
  deleted_at    timestamptz,

  constraint meme_needs_token  check (kind <> 'meme'  or (mint is not null and entry_mc > 0)),
  constraint perps_needs_trade check (kind <> 'perps' or (perp_market is not null and perp_side is not null and perp_entry > 0)),
  constraint random_has_content check (kind <> 'random' or char_length(body) > 0 or cardinality(media) > 0)
);
create index if not exists posts_feed_idx    on public.posts (kind, created_at desc) where deleted_at is null;
create index if not exists posts_profile_idx on public.posts (profile_id, created_at desc) where deleted_at is null;
create index if not exists posts_mint_idx    on public.posts (mint) where deleted_at is null;

-- Daily posting limit (anti-spam). Calls and random posts share one budget.
create or replace function public.posts_rate_limit() returns trigger language plpgsql as $$
begin
  if (select count(*) from public.posts
       where profile_id = new.profile_id and created_at > now() - interval '24 hours') >= 50 then
    raise exception 'daily_post_limit';
  end if;
  return new;
end $$;
drop trigger if exists posts_rate_limit on public.posts;
create trigger posts_rate_limit before insert on public.posts
  for each row execute function public.posts_rate_limit();

-- ───────────────────────── reactions + replies ─────────────────────────
-- post_ref is text so it can point at a real post (uuid) or a built-in demo post id.
create table if not exists public.post_reactions (
  post_ref    text not null check (char_length(post_ref) <= 64),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  kind        text not null check (kind in ('like','repost')),
  created_at  timestamptz not null default now(),
  primary key (post_ref, profile_id, kind)
);
create index if not exists post_reactions_profile_idx on public.post_reactions (profile_id);

create table if not exists public.post_replies (
  id          uuid primary key default gen_random_uuid(),
  post_ref    text not null check (char_length(post_ref) <= 64),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  body        text not null default '' check (char_length(body) <= 280),
  media       text[] not null default '{}' check (cardinality(media) <= 4),
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists post_replies_post_idx on public.post_replies (post_ref, created_at desc);

-- ───────────────────────── social graph ─────────────────────────
-- target_handle (not a profile id) so following/muting works for every caller shown in the app.
create table if not exists public.follows (
  profile_id     uuid not null references public.profiles(id) on delete cascade,
  target_handle  text not null check (target_handle ~ '^[A-Za-z0-9_]{1,30}$'),
  created_at     timestamptz not null default now(),
  primary key (profile_id, target_handle)
);
create index if not exists follows_target_idx on public.follows (target_handle);

create table if not exists public.mutes (
  profile_id     uuid not null references public.profiles(id) on delete cascade,
  target_handle  text not null check (target_handle ~ '^[A-Za-z0-9_]{1,30}$'),
  created_at     timestamptz not null default now(),
  primary key (profile_id, target_handle)
);

create table if not exists public.blocks (
  profile_id     uuid not null references public.profiles(id) on delete cascade,
  target_handle  text not null check (target_handle ~ '^[A-Za-z0-9_]{1,30}$'),
  created_at     timestamptz not null default now(),
  primary key (profile_id, target_handle)
);

create table if not exists public.lists (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 40),
  created_at  timestamptz not null default now(),
  unique (profile_id, name)
);

create table if not exists public.list_members (
  list_id        uuid not null references public.lists(id) on delete cascade,
  target_handle  text not null check (target_handle ~ '^[A-Za-z0-9_]{1,30}$'),
  created_at     timestamptz not null default now(),
  primary key (list_id, target_handle)
);

create table if not exists public.watchlist (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  token_key   text not null check (char_length(token_key) <= 64),
  created_at  timestamptz not null default now(),
  primary key (profile_id, token_key)
);

-- ───────────────────────── transactions ledger ─────────────────────────
-- Every real on-chain action made in Callit. The signature is the proof; the
-- server checks it on-chain (verified = true when the user's wallet signed it).
-- call_ref links a buy to the call it came from: the basis for caller fees.
create table if not exists public.transactions (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  wallet       text not null,
  kind         text not null check (kind in ('buy','sell','swap','withdraw','deposit')),
  signature    text not null unique check (char_length(signature) between 64 and 100),
  in_mint      text,
  in_amount    numeric,
  out_mint     text,
  out_amount   numeric,
  usd_value    numeric,
  to_address   text,
  call_ref     text,
  label        text check (char_length(label) <= 160),
  verified     boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists transactions_profile_idx on public.transactions (profile_id, created_at desc);
create index if not exists transactions_call_idx on public.transactions (call_ref) where call_ref is not null;

-- ───────────────────────── RLS ─────────────────────────
alter table public.posts           enable row level security;
alter table public.post_reactions  enable row level security;
alter table public.post_replies    enable row level security;
alter table public.follows         enable row level security;
alter table public.mutes           enable row level security;
alter table public.blocks          enable row level security;
alter table public.lists           enable row level security;
alter table public.list_members    enable row level security;
alter table public.watchlist       enable row level security;
alter table public.transactions    enable row level security;

drop policy if exists "Posts are public" on public.posts;
create policy "Posts are public" on public.posts for select using (deleted_at is null);
drop policy if exists "Replies are public" on public.post_replies;
create policy "Replies are public" on public.post_replies for select using (deleted_at is null);
drop policy if exists "Reactions are public" on public.post_reactions;
create policy "Reactions are public" on public.post_reactions for select using (true);
drop policy if exists "Follows are public" on public.follows;
create policy "Follows are public" on public.follows for select using (true);
-- mutes, blocks, lists, list_members, watchlist, transactions: private (server only).

-- ───────────────────────── media storage ─────────────────────────
-- Public-read bucket for post images, avatars and banners. Uploads go through
-- /api/media (signed-in users only, images only, 5 MB max).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
