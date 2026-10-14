-- Callit chat upgrade: delivered/seen ticks, voice & video calls, editable groups.
-- Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.

-- 1. Delivered receipts. last_read_id (already there) = "seen". delivered_id = "reached their device":
--    bumped whenever the person's app checks in (inbox / unread badge / opening the chat).
alter table public.chat_members add column if not exists delivered_id bigint not null default 0;
update public.chat_members set delivered_id = last_read_id where delivered_id < last_read_id;

create or replace function public.chat_mark_delivered(p uuid) returns void language sql as $$
  update public.chat_members m
     set delivered_id = l.max_id
    from (select chat_id, max(id) as max_id from public.chat_messages
           where chat_id in (select chat_id from public.chat_members where profile_id = p and role <> 'banned')
           group by chat_id) l
   where m.profile_id = p and m.chat_id = l.chat_id and m.delivered_id < l.max_id;
$$;

-- 2. Group settings: announcement mode (only owner/admins can post).
alter table public.chats add column if not exists admins_only boolean not null default false;

-- 3. Calls. Media goes peer to peer (WebRTC, encrypted between devices); this table only records
--    who started what, so members can see "Join call" and the chat gets a call log line.
create table if not exists public.chat_calls (
  id          uuid primary key default gen_random_uuid(),
  chat_id     uuid not null references public.chats(id) on delete cascade,
  started_by  uuid references public.profiles(id) on delete set null,
  kind        text not null check (kind in ('audio', 'video')),
  started_at  timestamptz not null default now(),
  alive_at    timestamptz not null default now(),   -- heartbeat from anyone still on the call
  answered    boolean not null default false,
  ended_at    timestamptz
);
create index if not exists chat_calls_chat_idx on public.chat_calls (chat_id, started_at desc);
alter table public.chat_calls enable row level security;
