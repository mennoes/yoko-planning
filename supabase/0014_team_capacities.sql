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

-- Vergeet niet realtime aan te zetten via Database → Replication → public →
-- vinkje voor team_capacities.
