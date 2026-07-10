-- Yoko Planner — verwachte omzet per project (alleen Menno + Vincent)
-- Plak in Supabase → SQL Editor → New query → Run.

create table if not exists public.project_revenue (
  id         uuid primary key default gen_random_uuid(),
  item_id    text not null,               -- board_items.id — geen FK: items kunnen
                                           -- tussen boards verhuizen of verwijderd worden,
                                           -- de omzet-regel moet dat overleven/negeerbaar zijn
  board_id   text not null,
  amount     numeric not null default 0,  -- verwachte/bevestigde omzet in euro's
  confirmed  boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (item_id)
);

create index if not exists project_revenue_item_idx  on public.project_revenue(item_id);
create index if not exists project_revenue_board_idx on public.project_revenue(board_id);

alter table public.project_revenue enable row level security;

drop policy if exists "Project omzet lezen"       on public.project_revenue;
drop policy if exists "Project omzet schrijven"   on public.project_revenue;
drop policy if exists "Project omzet bewerken"    on public.project_revenue;
drop policy if exists "Project omzet verwijderen" on public.project_revenue;

-- Zelfde afscherming als budget_entries (0033) — alleen Menno + Vincent.
create policy "Project omzet lezen"
  on public.project_revenue for select
  to authenticated using (
    (select member_id from public.profiles where user_id = auth.uid()) in ('menno', 'vincent')
  );

create policy "Project omzet schrijven"
  on public.project_revenue for insert
  to authenticated with check (
    (select member_id from public.profiles where user_id = auth.uid()) in ('menno', 'vincent')
  );

create policy "Project omzet bewerken"
  on public.project_revenue for update
  to authenticated using (
    (select member_id from public.profiles where user_id = auth.uid()) in ('menno', 'vincent')
  );

create policy "Project omzet verwijderen"
  on public.project_revenue for delete
  to authenticated using (
    (select member_id from public.profiles where user_id = auth.uid()) in ('menno', 'vincent')
  );

-- Vergeet niet realtime aan te zetten via Database → Publications →
-- supabase_realtime → vinkje voor 'project_revenue'.
