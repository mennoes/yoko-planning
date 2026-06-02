-- Yoko Planner — eenvoudige seed voor SAS-ICU op yoko-bord. Geen DO-blok
-- nodig — gebruikt een subquery voor group_id. Run dit als 0021 niets
-- gedaan lijkt te hebben.
--
-- Plak in Supabase → SQL Editor → New query → Run.
-- Aan 't eind staat een SELECT die laat zien of 't echt op het bord landde.

insert into public.board_items (
  id, group_id, board_id, name, owner_ids, status,
  start_date, end_date, deadline, est_hours, dagen,
  notes, subitems, journal, extra, position, source, updated_at
)
select
  'sas-icu-2026',
  -- Eerste niet-Done/Vrij/Meetings-groep op yoko (typisch 'Projecten').
  (select id from public.board_groups
    where board_id = 'yoko'
      and lower(trim(name)) not in ('done','vrij','meetings & doorlopend','meetings en doorlopend','rewind')
    order by position asc
    limit 1),
  'yoko',
  'SAS-ICU',
  array['anne-fleur']::text[],
  'Working on...',
  '2026-05-04',
  '2026-07-03',
  null,
  133,
  16.6,
  null,
  '[
    {"id":"si-sas-1","name":"Kennismaking","ownerIds":["anne-fleur"],"status":"Done","startDate":"2025-11-07","endDate":"2025-11-07","estHours":2,"source":"manual"},
    {"id":"si-sas-2","name":"Inventariseren onderwerp","ownerIds":["anne-fleur"],"status":"Done","startDate":"2025-11-17","endDate":"2025-11-17","estHours":2,"source":"manual"},
    {"id":"si-sas-3","name":"Stijlonderzoek","ownerIds":["anne-fleur"],"status":"","startDate":null,"endDate":null,"estHours":0,"source":"manual"},
    {"id":"si-sas-4","name":"Storyboard","ownerIds":["anne-fleur"],"status":"Working on...","startDate":"2026-05-26","endDate":"2026-06-15","estHours":36,"source":"manual"},
    {"id":"si-sas-5","name":"Storyboard presentatie","ownerIds":["anne-fleur"],"status":"","startDate":"2026-06-12","endDate":"2026-06-12","estHours":3,"source":"manual"},
    {"id":"si-sas-6","name":"Animeren v1","ownerIds":["anne-fleur"],"status":"","startDate":"2026-06-23","endDate":"2026-07-09","estHours":60,"source":"manual"},
    {"id":"si-sas-7","name":"Opleveren v2","ownerIds":["anne-fleur"],"status":"","startDate":"2026-07-13","endDate":"2026-08-02","estHours":30,"source":"manual"}
  ]'::jsonb,
  '[]'::jsonb,
  '{"ownerHours":{"anne-fleur":133}}'::jsonb,
  9999,
  null,
  now()
on conflict (id) do update set
  group_id   = excluded.group_id,
  name       = excluded.name,
  owner_ids  = excluded.owner_ids,
  status     = excluded.status,
  start_date = excluded.start_date,
  end_date   = excluded.end_date,
  est_hours  = excluded.est_hours,
  dagen      = excluded.dagen,
  subitems   = excluded.subitems,
  extra      = excluded.extra,
  updated_at = now();

-- Verificatie — laat zien of 't gelukt is en in welke groep.
select
  bi.id,
  bi.name,
  bi.board_id,
  bg.name as group_name,
  bi.start_date,
  bi.end_date,
  jsonb_array_length(bi.subitems) as subitem_count
from public.board_items bi
left join public.board_groups bg on bg.id = bi.group_id
where bi.id = 'sas-icu-2026';
