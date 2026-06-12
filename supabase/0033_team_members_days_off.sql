-- Yoko Planner — werkdagen ook op team_members opslaan i.p.v. alleen
-- profiles.days_off. Profiles vereist een auth.users-koppeling
-- (FK + RLS auth.uid()=user_id), dus voor teamleden die nooit hebben
-- ingelogd (zoals Manuel, of net-toegevoegde freelancers) had je geen
-- profiles-rij en bleef hun days_off-update silent op 0 rows hangen.
--
-- team_members heeft geen auth-dependency en is de juiste tabel voor
-- team-scope settings. days_off slaan we op als text[] met de strings
-- 'mon','tue','wed','thu','fri' — zelfde shape als profiles.days_off.
--
-- Plak in Supabase → SQL Editor → New query → Run.

alter table public.team_members
  add column if not exists days_off text[] default '{}'::text[];

-- Realtime subscription bestaat al voor team_members (zie 0017); een
-- nieuwe kolom hoeft niet apart toegevoegd te worden.
