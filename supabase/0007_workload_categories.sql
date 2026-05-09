-- Yoko Planner — workload categorie-overrides (per item, gedeeld team-breed)
-- Plak in Supabase → SQL Editor → New query → Run.

create table if not exists public.workload_categories (
  item_id    text primary key,
  category   text not null check (category in ('meeting','overhead','maken')),
  updated_at timestamptz default now()
);

alter table public.workload_categories enable row level security;
drop policy if exists "Workload categories lezen"    on public.workload_categories;
drop policy if exists "Workload categories bewerken" on public.workload_categories;
create policy "Workload categories lezen"    on public.workload_categories for select to authenticated using (true);
create policy "Workload categories bewerken" on public.workload_categories for all    to authenticated using (true) with check (true);

-- Vergeet niet realtime aan te zetten via Database → Replication → public →
-- vinkje voor workload_categories.
