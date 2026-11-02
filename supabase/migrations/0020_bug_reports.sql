-- Bug reports, security reports and feature ideas from users.
-- Written and read only by the server (service role); admins see them in Admin › Reports.
create table if not exists public.bug_reports (
  id          bigint generated always as identity primary key,
  profile_id  uuid references public.profiles(id) on delete set null,
  kind        text not null default 'bug' check (kind in ('bug', 'security', 'idea')),
  body        text not null check (char_length(body) between 10 and 2000),
  contact     text,
  page        text,
  user_agent  text,
  viewport    int,
  ip          text,
  created_at  timestamptz not null default now()
);
create index if not exists bug_reports_created_idx on public.bug_reports (created_at desc);
create index if not exists bug_reports_profile_idx on public.bug_reports (profile_id, created_at desc);
create index if not exists bug_reports_ip_idx on public.bug_reports (ip, created_at desc);

alter table public.bug_reports enable row level security;
revoke all on public.bug_reports from anon, authenticated;
