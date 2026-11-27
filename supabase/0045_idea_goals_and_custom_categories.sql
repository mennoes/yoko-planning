-- Een idee kan aan een bovenliggend doel hangen. Tegelijk laten we de
-- categorie bewust vrij: de UI ondersteunt sinds 0044 ook eigen categorieën.
alter table public.ideas
  add column if not exists goal text not null default '';

alter table public.ideas
  drop constraint if exists ideas_category_check;
