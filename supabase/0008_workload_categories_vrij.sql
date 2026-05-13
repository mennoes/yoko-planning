-- Yoko Planner — workload-categorie 'vrij' toevoegen aan de CHECK constraint.
-- Plak in Supabase → SQL Editor → New query → Run.

alter table public.workload_categories
  drop constraint if exists workload_categories_category_check;

alter table public.workload_categories
  add constraint workload_categories_category_check
  check (category in ('meeting','overhead','maken','vrij'));
