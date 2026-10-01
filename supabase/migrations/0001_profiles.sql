-- Callit: profiles
-- Run once in Supabase → SQL Editor → New query → paste → Run.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id             uuid primary key default gen_random_uuid(),
  privy_id       text not null unique,
  handle         text not null unique check (handle ~ '^[a-z0-9_]{3,20}$'),
  display_name   text check (char_length(display_name) <= 40),
  bio            text check (char_length(bio) <= 160),
  website        text check (char_length(website) <= 80),
  x_handle       text check (char_length(x_handle) <= 30),
  avatar_url     text,
  banner_url     text,
  wallet_address text unique,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists profiles_wallet_idx on public.profiles (wallet_address);

-- keep updated_at fresh
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Row level security: anyone can read public profiles; all writes go through
-- the server (service role), which checks the user's Privy token first.
alter table public.profiles enable row level security;
drop policy if exists "Public profiles are readable" on public.profiles;
create policy "Public profiles are readable" on public.profiles for select using (true);
