-- Yoko Planner — SAS-ICU project op yoko-bord, in groep 'Projecten' (of de
-- eerste niet-Done/Vrij/Meetings-groep als 'Projecten' niet bestaat).
-- Subitems uit het Monday-overzicht: 7 stuks, Anne-Fleur als owner.
--
-- Plak in Supabase → SQL Editor → New query → Run.
-- Idempotent: re-runnen overschrijft het bestaande SAS-ICU-item.

do $$
declare
  v_board_id   text := 'yoko';
  v_group_id   text;
  v_item_id    text := 'sas-icu-2026';
  v_item_pos   int;
begin
  -- Kies een geschikte groep — eerst 'Projecten' / 'Lopende projecten',
  -- anders de eerste groep die geen Done / Vrij / Meetings is.
  select id into v_group_id
  from public.board_groups
  where board_id = v_board_id
    and lower(trim(name)) in ('projecten','lopende projecten')
  order by position asc
  limit 1;

  if v_group_id is null then
    select id into v_group_id
    from public.board_groups
    where board_id = v_board_id
      and lower(trim(name)) not in ('done','vrij','meetings & doorlopend','meetings en doorlopend','rewind')
    order by position asc
    limit 1;
  end if;

  if v_group_id is null then
    raise exception 'Geen geschikte groep gevonden op bord %', v_board_id;
  end if;

  -- Positie onderaan de groep
  select coalesce(max(position) + 1, 0) into v_item_pos
  from public.board_items
  where group_id = v_group_id;

  insert into public.board_items (
    id, group_id, board_id, name, owner_ids, status,
    start_date, end_date, deadline, est_hours, dagen,
    notes, subitems, journal, extra, position, source,
    updated_at
  ) values (
    v_item_id,
    v_group_id,
    v_board_id,
    'SAS-ICU',
    array['anne-fleur']::text[],
    'Working on...',
    '2026-05-04',
    '2026-07-03',
    null,
    133,                 -- som van subitem-uren: 2+2+36+3+60+30 = 133 (Stijlonderzoek heeft geen est)
    16.6,                -- 133u / 8u = 16.6 dagen
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
    v_item_pos,
    null,
    now()
  )
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

  raise notice 'SAS-ICU geplaatst in groep % (item-id %)', v_group_id, v_item_id;
end$$;
