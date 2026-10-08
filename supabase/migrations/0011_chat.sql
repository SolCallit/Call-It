-- Callit: real chat. DMs, private groups (encrypted) and public groups (guarded).
-- Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- kind:
--   dm      two people. Body encrypted at rest.
--   private invite-only group. Body encrypted at rest, no content filter.
--   public  anyone can find, read and join. Links and scam phrases are filtered on send.
-- All reads and writes go through the server (service role), which checks the Privy token
-- and membership first. Row level security is on with no policies, so the browser's anon key
-- can't read a single message directly.

create table if not exists public.chats (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('dm', 'private', 'public')),
  title        text check (title is null or char_length(title) between 1 and 48),
  about        text check (about is null or char_length(about) <= 160),
  avatar_url   text,
  mint         text,                                   -- optional token the group is about
  owner_id     uuid references public.profiles(id) on delete set null,
  dm_key       text unique,                            -- "<smaller id>:<larger id>" so a pair has one DM
  invite_code  text unique,
  member_count int  not null default 0,
  last_at      timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index if not exists chats_public_idx on public.chats (kind, last_at desc) where kind = 'public';

create table if not exists public.chat_members (
  chat_id      uuid not null references public.chats(id) on delete cascade,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'admin', 'member', 'banned')),
  muted        boolean not null default false,
  last_read_id bigint not null default 0,
  joined_at    timestamptz not null default now(),
  primary key (chat_id, profile_id)
);
create index if not exists chat_members_profile_idx on public.chat_members (profile_id);

create table if not exists public.chat_messages (
  id          bigint generated always as identity primary key,
  chat_id     uuid not null references public.chats(id) on delete cascade,
  profile_id  uuid references public.profiles(id) on delete set null,
  kind        text not null default 'text' check (kind in ('text', 'system')),
  body        text not null check (char_length(body) <= 4000),   -- ciphertext when enc
  enc         boolean not null default false,
  reply_to    bigint references public.chat_messages(id) on delete set null,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists chat_messages_chat_idx on public.chat_messages (chat_id, id desc);
create index if not exists chat_messages_rate_idx on public.chat_messages (profile_id, created_at desc);

alter table public.chats         enable row level security;
alter table public.chat_members  enable row level security;
alter table public.chat_messages enable row level security;

-- Member counts stay right without the app counting rows.
create or replace function public.chat_member_count() returns trigger language plpgsql as $$
begin
  update public.chats c set member_count = (
    select count(*) from public.chat_members m where m.chat_id = c.id and m.role <> 'banned')
  where c.id = coalesce(new.chat_id, old.chat_id);
  return null;
end $$;
drop trigger if exists chat_members_count on public.chat_members;
create trigger chat_members_count after insert or update of role or delete on public.chat_members
  for each row execute function public.chat_member_count();

-- New messages bump the chat to the top of everyone's inbox.
create or replace function public.chat_touch() returns trigger language plpgsql as $$
begin update public.chats set last_at = new.created_at where id = new.chat_id; return null; end $$;
drop trigger if exists chat_messages_touch on public.chat_messages;
create trigger chat_messages_touch after insert on public.chat_messages
  for each row execute function public.chat_touch();

-- One round trip for the whole inbox: each chat, its last message, unread count (capped at 99)
-- and, for DMs, the other person.
create or replace function public.chat_inbox(p uuid) returns table (
  id uuid, kind text, title text, about text, avatar_url text, mint text, invite_code text,
  role text, muted boolean, member_count int, last_read_id bigint,
  last_id bigint, last_body text, last_enc boolean, last_kind text, last_at timestamptz, last_handle text,
  unread int, peer_handle text, peer_name text, peer_avatar text
) language sql stable as $$
  select c.id, c.kind, c.title, c.about, c.avatar_url, c.mint,
         case when c.kind = 'public' or m.role in ('owner', 'admin') then c.invite_code end,
         m.role, m.muted, c.member_count, m.last_read_id,
         l.id, l.body, l.enc, l.kind, coalesce(l.created_at, c.created_at), lp.handle,
         (select count(*)::int from (
            select 1 from public.chat_messages x
            where x.chat_id = c.id and x.id > m.last_read_id and x.deleted_at is null
              and (x.profile_id is distinct from p)
            limit 99) z),
         pp.handle, pp.display_name, pp.avatar_url
  from public.chat_members m
  join public.chats c on c.id = m.chat_id
  left join lateral (
    select y.id, y.body, y.enc, y.kind, y.created_at, y.profile_id from public.chat_messages y
    where y.chat_id = c.id and y.deleted_at is null order by y.id desc limit 1) l on true
  left join public.profiles lp on lp.id = l.profile_id
  left join lateral (
    select pr.handle, pr.display_name, pr.avatar_url from public.chat_members o
    join public.profiles pr on pr.id = o.profile_id
    where c.kind = 'dm' and o.chat_id = c.id and o.profile_id <> p limit 1) pp on true
  where m.profile_id = p and m.role <> 'banned'
  order by coalesce(l.created_at, c.created_at) desc
  limit 200;
$$;
