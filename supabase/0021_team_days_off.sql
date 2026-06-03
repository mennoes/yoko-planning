-- Yoko Planner — vrije dagen per teamlid
-- Plak in Supabase → SQL Editor → New query → Run.
--
-- Voegt een int[]-kolom toe aan team_capacities met ISO weekday-nummers
-- van vrije dagen (1=Ma, 2=Di, …, 7=Zo). Bijv. Menno die vrijdag vrij
-- is → days_off = '{5}'. De werkdruk-distributie en de week-zoom in
-- /planning slaan deze dagen over.

alter table public.team_capacities add column if not exists days_off int[];
