-- Zorg dat Omdenken als gedeelde agenda bestaat en verplaats bestaande
-- Google-meetings atomair uit Yoko. Veilig om vaker uit te voeren.
do $$
declare
  target_group text;
  next_position integer;
begin
  insert into public.boards (id, name, emoji, color, position)
  select
    'omdenken', 'Omdenken', '📋', '#c73561',
    coalesce((select max(position) + 1 from public.boards), 0)
  on conflict (id) do update set
    name = excluded.name,
    color = excluded.color;

  select id into target_group
  from public.board_groups
  where board_id = 'omdenken' and deleted_at is null
    and lower(trim(name)) in ('meetings & doorlopend', 'meetings en doorlopend', 'meetings')
  order by position
  limit 1;

  if target_group is null then
    target_group := 'g_omdenken_meetings';
    insert into public.board_groups (id, board_id, name, color, collapsed, position)
    values (target_group, 'omdenken', 'Meetings & doorlopend', '#c73561', false, 0)
    on conflict (id) do update set
      board_id = excluded.board_id,
      name = excluded.name,
      color = excluded.color,
      deleted_at = null;
  end if;

  select coalesce(max(position) + 1, 0) into next_position
  from public.board_items
  where board_id = 'omdenken' and deleted_at is null;

  update public.board_items
  set board_id = 'omdenken', group_id = target_group,
      position = next_position + coalesce(position, 0), updated_at = now()
  where board_id = 'yoko' and deleted_at is null
    and name ilike '%omdenken%';

  update public.calendar_routing_rules
  set board_id = 'omdenken', enabled = true, position = 0
  where lower(pattern) = 'omdenken';
  if not found then
    insert into public.calendar_routing_rules (pattern, board_id, enabled, position)
    values ('omdenken', 'omdenken', true, 0);
  end if;
end $$;
