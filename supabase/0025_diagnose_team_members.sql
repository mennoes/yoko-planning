-- DIAGNOSE: laat zien wat er in team_members staat zodat we weten waarom
-- nieuw-toegevoegde leden niet op /team verschijnen. Plak in Supabase →
-- SQL Editor → New query → Run en plak de output terug in de chat.

-- 1. Bestaat de kind-kolom?
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'team_members'
order by ordinal_position;

-- 2. Hoeveel rijen, en welke?
select id, name, email, kind, weekly_capacity, position, hidden, created_at
from public.team_members
order by created_at desc nulls last, id;

-- 3. Specifiek: zit Manuel erin?
select id, name, email, kind, created_at
from public.team_members
where lower(name) like '%manuel%' or lower(id) like '%manuel%';
