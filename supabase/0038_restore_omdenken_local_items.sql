-- Deze twee niet-Google-items stonden al in de lokaal aangemaakte
-- Omdenken-agenda voordat die gedeeld werd. De eerste remote pull kon ze
-- daardoor niet kennen. Herstel ze idempotent in een aparte projectgroep.
do $$
declare
  target_group text := 'g_omdenken_overig';
  next_position integer;
begin
  insert into public.board_groups (id, board_id, name, color, collapsed, position)
  values (target_group, 'omdenken', 'Projecten', '#c73561', false, 1)
  on conflict (id) do update set
    board_id = excluded.board_id,
    name = excluded.name,
    color = excluded.color,
    deleted_at = null;

  select coalesce(max(position) + 1, 0) into next_position
  from public.board_items
  where board_id = 'omdenken' and deleted_at is null;

  if not exists (
    select 1 from public.board_items
    where board_id = 'omdenken' and deleted_at is null and lower(trim(name)) = 'sollicitatie'
  ) then
    insert into public.board_items (id, board_id, group_id, name, owner_ids, est_hours, position, updated_at)
    values ('it_omdenken_sollicitatie', 'omdenken', target_group, 'Sollicitatie', '{}', 0, next_position, now());
    next_position := next_position + 1;
  end if;

  if not exists (
    select 1 from public.board_items
    where board_id = 'omdenken' and deleted_at is null and lower(trim(name)) = 'podcast vormgeving'
  ) then
    insert into public.board_items (id, board_id, group_id, name, owner_ids, est_hours, position, updated_at)
    values ('it_omdenken_podcast_vormgeving', 'omdenken', target_group, 'Podcast vormgeving', '{}', 0, next_position, now());
  end if;
end $$;
