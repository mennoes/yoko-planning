-- Yoko Planner — verplaats ALLE Google-items naar de 'Meetings & doorlopend'-
-- groep per bord, ongeacht waar ze nu staan. Gebruik dit als 0019 niets
-- veranderde omdat je items in andere groepen (bv. 'Projecten') zitten.
--
-- LET OP: dit overschrijft eventuele handmatige plaatsingen van
-- Google-items. Vrij/vakantie- en Done-groepen blijven onaangetast.
--
-- Plak in Supabase → SQL Editor → New query → Run.

-- 1. Zorg dat elk bord een 'Meetings & doorlopend'-groep heeft.
insert into public.board_groups (id, board_id, name, color, collapsed, position)
select
  'g_meetings_' || b.id || '_' || extract(epoch from now())::bigint,
  b.id,
  'Meetings & doorlopend',
  '#D8B62E',
  false,
  coalesce((select max(position) + 1 from public.board_groups where board_id = b.id), 0)
from public.boards b
where not exists (
  select 1 from public.board_groups g
  where g.board_id = b.id
    and lower(trim(g.name)) in ('meetings & doorlopend','meetings en doorlopend')
);

-- 2. Verplaats ALLE Google-source items naar de Meetings-groep, MITS:
--    - status niet 'Done' is (die blijven in hun groep, doorgaans Done)
--    - en de huidige groep is geen 'Vrij' of 'Done' (we willen die niet
--      onbedoeld leeg trekken)
update public.board_items items
set group_id = (
  select g.id from public.board_groups g
  where g.board_id = items.board_id
    and lower(trim(g.name)) in ('meetings & doorlopend','meetings en doorlopend')
  limit 1
),
updated_at = now()
where items.source = 'google'
  and coalesce(items.status, '') <> 'Done'
  and items.group_id not in (
    select g.id from public.board_groups g
    where lower(trim(g.name)) in ('vrij','done','meetings & doorlopend','meetings en doorlopend')
  );

-- 3. Lege auto-groepen weghalen — alleen oude 'Doorlopend' / 'Google
--    Agenda' die nu geen items meer hebben. 'Projecten' en andere
--    door-gebruikers-gemaakte groepen laten we met rust, ook als ze
--    nu leeg blijken.
delete from public.board_groups src
where lower(trim(src.name)) in ('doorlopend','google agenda')
  and not exists (
    select 1 from public.board_items i where i.group_id = src.id
  );
