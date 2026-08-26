-- Teamleden die gestopt zijn (bv. een afgeronde stage) blijven zichtbaar
-- voor historie/toewijzingen, maar tellen niet meer mee in de actieve
-- capaciteitsplanning. Losstaand van 'hidden' (dat verbergt een lid
-- volledig) — inactief blijft gewoon zichtbaar, alleen gegroepeerd apart.
alter table public.team_members
  add column if not exists inactive boolean not null default false;

comment on column public.team_members.inactive is
  'Lid is gestopt (bv. stage afgerond) — blijft zichtbaar maar telt niet mee in actieve capaciteit.';
