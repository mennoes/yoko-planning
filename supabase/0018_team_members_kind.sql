-- Yoko Planner — team_members categorie (yoko / freelance / unassigned)
-- voor de /team-admin en /team UI-splitsing.
-- Plak in Supabase → SQL Editor → New query → Run.

alter table public.team_members
  add column if not exists kind text not null default 'yoko';

-- Seed correcte categorieën voor de bekende crew zodat /team gelijk
-- goed gegroepeerd staat. Idempotent — bestaande non-default waardes
-- blijven gerespecteerd.
update public.team_members set kind = 'yoko'
  where id in ('menno','vincent','odette','anne-fleur','kars')
    and kind = 'yoko';

update public.team_members set kind = 'unassigned'
  where id = 'unassigned';

-- Alle overige bestaande leden → freelance (was de impliciete categorie).
update public.team_members set kind = 'freelance'
  where id not in ('menno','vincent','odette','anne-fleur','kars','unassigned')
    and kind = 'yoko';
