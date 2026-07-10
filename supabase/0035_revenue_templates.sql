-- Yoko Planner — omzet-sjablonen voor terugkerende projectreeksen
-- (alleen Menno + Vincent). Plak in Supabase → SQL Editor → New query → Run.

create table if not exists public.revenue_templates (
  id             uuid primary key default gen_random_uuid(),
  pattern        text not null,   -- genormaliseerde naam (zie lib/subitemRules.ts normalizeTitle)
  board_id       text not null,
  default_amount numeric not null default 0,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now(),
  unique (board_id, pattern)
);

create index if not exists revenue_templates_board_idx on public.revenue_templates(board_id);

alter table public.revenue_templates enable row level security;

drop policy if exists "Omzet-sjablonen lezen"       on public.revenue_templates;
drop policy if exists "Omzet-sjablonen schrijven"   on public.revenue_templates;
drop policy if exists "Omzet-sjablonen bewerken"    on public.revenue_templates;
drop policy if exists "Omzet-sjablonen verwijderen" on public.revenue_templates;

-- Zelfde afscherming als budget_entries (0033) / project_revenue (0034).
create policy "Omzet-sjablonen lezen"
  on public.revenue_templates for select
  to authenticated using (
    (select member_id from public.profiles where user_id = auth.uid()) in ('menno', 'vincent')
  );

create policy "Omzet-sjablonen schrijven"
  on public.revenue_templates for insert
  to authenticated with check (
    (select member_id from public.profiles where user_id = auth.uid()) in ('menno', 'vincent')
  );

create policy "Omzet-sjablonen bewerken"
  on public.revenue_templates for update
  to authenticated using (
    (select member_id from public.profiles where user_id = auth.uid()) in ('menno', 'vincent')
  );

create policy "Omzet-sjablonen verwijderen"
  on public.revenue_templates for delete
  to authenticated using (
    (select member_id from public.profiles where user_id = auth.uid()) in ('menno', 'vincent')
  );

-- Vergeet niet realtime aan te zetten via Database → Publications →
-- supabase_realtime → vinkje voor 'revenue_templates'.
