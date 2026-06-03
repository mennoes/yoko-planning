-- Yoko Planner — eenmalige dedup van Google-items met dezelfde iCalUID
-- (en aanvullend: zelfde naam + start_date op hetzelfde bord). Wordt
-- triggered door scenario's als 'Vincent opent app, sync rebuilt items
-- die al door Menno waren toegevoegd → dubbel'.
--
-- Werkwijze:
--  1. Per (board_id, ical_uid) → bewaar de oudste rij, soft-delete de
--     rest (deleted_at = now()). Soft-delete dus reversibel via /trash.
--  2. Per (board_id, lower(name), start_date) waar ical_uid IS NULL —
--     dat zijn legacy-rijen → idem: oudste behouden, rest soft-delete.
--
-- Plak in Supabase → SQL Editor → New query → Run.

-- 1. Dedup op iCalUID
with ranked as (
  select id, board_id, ical_uid, created_at,
         row_number() over (partition by board_id, ical_uid order by created_at asc, id asc) as rn
  from public.board_items
  where source = 'google'
    and ical_uid is not null
    and deleted_at is null
)
update public.board_items
   set deleted_at = now()
 where id in (select id from ranked where rn > 1);

-- 2. Dedup op naam + datum (legacy rows zonder iCalUID)
with ranked as (
  select id, board_id, lower(trim(name)) as nname, start_date, created_at,
         row_number() over (
           partition by board_id, lower(trim(name)), start_date
           order by created_at asc, id asc
         ) as rn
  from public.board_items
  where source = 'google'
    and ical_uid is null
    and deleted_at is null
    and start_date is not null
    and name is not null
)
update public.board_items
   set deleted_at = now()
 where id in (select id from ranked where rn > 1);

-- 3. Verificatie — zou nul of weinig moeten zijn
select 'Resterende ical_uid duplicaten:' as label, count(*) as count
from (
  select 1 from public.board_items
  where source = 'google' and ical_uid is not null and deleted_at is null
  group by board_id, ical_uid having count(*) > 1
) t
union all
select 'Resterende name+date duplicaten:' as label, count(*) as count
from (
  select 1 from public.board_items
  where source = 'google' and ical_uid is null and deleted_at is null
    and start_date is not null and name is not null
  group by board_id, lower(trim(name)), start_date having count(*) > 1
) t;
