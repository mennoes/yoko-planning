-- Yoko Planner — verplaats bestaande Google-meetings die in de oude
-- 'Doorlopend' of auto-aangemaakte 'Google Agenda'-groepen staan naar
-- één gedeelde 'Meetings & doorlopend'-groep per bord. Optioneel; nieuwe
-- syncs landen sowieso al in de juiste groep dankzij de code-aanpassing.
--
-- Plak in Supabase → SQL Editor → New query → Run.
--
-- Werking:
--   1. Voor elk bord een 'Meetings & doorlopend'-groep garanderen.
--   2. Alle board_items met source='google' die in een oude
--      'Doorlopend' of 'Google Agenda' groep staan: group_id wijzigen
--      naar de target-groep.
--   3. Lege auto-groepen (zonder items) opruimen.
--
-- User-hernoemde of user-gekozen groepen blijven onaangeraakt.

-- 1. Garandeer Meetings & doorlopend-groep per bord.
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

-- 2. Verplaats Google-items uit oude auto-groepen.
update public.board_items items
set group_id = target.id,
    updated_at = now()
from public.board_groups target,
     public.board_groups src
where items.board_id = target.board_id
  and items.board_id = src.board_id
  and items.group_id = src.id
  and items.source   = 'google'
  and lower(trim(src.name))    in ('doorlopend','google agenda')
  and lower(trim(target.name)) = 'meetings & doorlopend';

-- 3. Lege auto-groepen weghalen — alleen als ze NU helemaal leeg zijn
--    (dus user heeft er ook geen manuele items in laten staan).
delete from public.board_groups src
where lower(trim(src.name)) in ('doorlopend','google agenda')
  and not exists (
    select 1 from public.board_items i where i.group_id = src.id
  );
