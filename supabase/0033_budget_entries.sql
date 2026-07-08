-- Yoko Planner — budget/omzet-tracking (alleen Menno + Vincent)
-- Plak in Supabase → SQL Editor → New query → Run.

create table if not exists public.budget_entries (
  id         uuid primary key default gen_random_uuid(),
  member_id  text not null,               -- wiens omzet dit is ('menno' | 'vincent')
  quarter    text not null,               -- 'YYYY-Q1'..'YYYY-Q4'
  amount     numeric not null default 0,  -- omzet in euro's
  label      text,                        -- optionele toelichting (klant/project)
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists budget_entries_quarter_idx on public.budget_entries(quarter);
create index if not exists budget_entries_member_idx  on public.budget_entries(member_id);

alter table public.budget_entries enable row level security;

drop policy if exists "Budget lezen"       on public.budget_entries;
drop policy if exists "Budget schrijven"   on public.budget_entries;
drop policy if exists "Budget bewerken"    on public.budget_entries;
drop policy if exists "Budget verwijderen" on public.budget_entries;

-- Alleen Menno + Vincent mogen budget-data zien/bewerken, gematcht via hun
-- profiel.member_id (zelfde patroon als notifications-update in 0009).
-- Dit is server-side afgedwongen — een sidebar-filter alleen is client-side
-- en dus omzeilbaar door direct de route te openen.
create policy "Budget lezen"
  on public.budget_entries for select
  to authenticated using (
    (select member_id from public.profiles where user_id = auth.uid()) in ('menno', 'vincent')
  );

create policy "Budget schrijven"
  on public.budget_entries for insert
  to authenticated with check (
    (select member_id from public.profiles where user_id = auth.uid()) in ('menno', 'vincent')
  );

create policy "Budget bewerken"
  on public.budget_entries for update
  to authenticated using (
    (select member_id from public.profiles where user_id = auth.uid()) in ('menno', 'vincent')
  );

create policy "Budget verwijderen"
  on public.budget_entries for delete
  to authenticated using (
    (select member_id from public.profiles where user_id = auth.uid()) in ('menno', 'vincent')
  );

-- Vergeet niet realtime aan te zetten via Database → Publications →
-- supabase_realtime → vinkje voor 'budget_entries' (live updates tussen
-- Menno & Vincent).
