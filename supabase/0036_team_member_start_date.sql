-- Nieuwe teamleden kunnen vooraf worden klaargezet. Ze worden vanaf hun
-- startdatum automatisch zichtbaar in de planner en teamkeuzes.
alter table public.team_members
  add column if not exists start_date date;

comment on column public.team_members.start_date is
  'Eerste dag waarop dit teamlid automatisch zichtbaar wordt in de planner.';
