-- Yoko Planner — team-leden beheerbaar via /team-admin UI (Supabase is
-- bron-van-waarheid; data/team.json blijft fallback-seed bij eerste run).
-- Plak in Supabase → SQL Editor → New query → Run.

create table if not exists public.team_members (
  id              text primary key,
  name            text not null,
  email           text default '',
  color           text default '#9aadbd',
  weekly_capacity numeric default 0,
  position        int default 0,
  hidden          boolean default false,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

alter table public.team_members enable row level security;
drop policy if exists "Team-leden lezen"    on public.team_members;
drop policy if exists "Team-leden bewerken" on public.team_members;
create policy "Team-leden lezen"    on public.team_members for select to authenticated using (true);
create policy "Team-leden bewerken" on public.team_members for all    to authenticated using (true) with check (true);

-- Realtime: cross-device updates wanneer een admin een lid toevoegt of bijwerkt.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname    = 'supabase_realtime'
      and schemaname = 'public'
      and tablename  = 'team_members'
  ) then
    alter publication supabase_realtime add table public.team_members;
  end if;
end$$;
