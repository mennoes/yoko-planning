-- Yoko Planner — team-capaciteiten per persoon (gedeeld team-breed)
-- Plak in Supabase → SQL Editor → New query → Run.

create table if not exists public.team_capacities (
  member_id        text primary key,
  weekly_capacity  numeric not null default 0,
  updated_at       timestamptz default now()
);

alter table public.team_capacities enable row level security;
drop policy if exists "Team capacities lezen"    on public.team_capacities;
drop policy if exists "Team capacities bewerken" on public.team_capacities;
create policy "Team capacities lezen"    on public.team_capacities for select to authenticated using (true);
create policy "Team capacities bewerken" on public.team_capacities for all    to authenticated using (true) with check (true);

-- Realtime aanzetten — dit deed je vroeger via Database → Replication, maar
-- die pagina is in de huidige Supabase-UI weg. Onderstaand DO-blok voegt de
-- tabel idempotent toe aan de supabase_realtime-publicatie, zodat
-- cross-device updates direct binnenkomen zonder UI-klik.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname    = 'supabase_realtime'
      and schemaname = 'public'
      and tablename  = 'team_capacities'
  ) then
    alter publication supabase_realtime add table public.team_capacities;
  end if;
end$$;
