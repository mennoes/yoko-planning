-- Yoko Planner — runtime-toegevoegde team-leden
-- Plak in Supabase → SQL Editor → New query → Run.
--
-- data/team.json blijft de seed-lijst. Wat je via de "+ Lid toevoegen"-knop
-- op /team toevoegt, landt hier zodat 't cross-device synct. Aan de client-
-- kant worden deze rijen bij module-load samengevoegd met teamData.members,
-- zodat elke component die `import teamData from '@/data/team.json'` doet
-- de nieuwe leden óók ziet.

create table if not exists public.team_members_extra (
  id              text primary key,
  name            text not null,
  email           text,
  weekly_capacity numeric not null default 0,
  color           text not null default '#9aadbd',
  updated_at      timestamptz default now()
);

alter table public.team_members_extra enable row level security;
drop policy if exists "Team extras lezen"    on public.team_members_extra;
drop policy if exists "Team extras bewerken" on public.team_members_extra;
create policy "Team extras lezen"    on public.team_members_extra for select to authenticated using (true);
create policy "Team extras bewerken" on public.team_members_extra for all    to authenticated using (true) with check (true);

-- Realtime aanzetten via supabase_realtime publication (idempotent).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname    = 'supabase_realtime'
      and schemaname = 'public'
      and tablename  = 'team_members_extra'
  ) then
    alter publication supabase_realtime add table public.team_members_extra;
  end if;
end$$;
