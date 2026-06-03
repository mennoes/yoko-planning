-- Revive ALLE soft-deleted Google-rijen — die zijn slachtoffer van
-- eerdere sync-bugs. Per iCalUID houden we de oudst-gemaakte (laagste
-- id) als canonical, de rest blijft soft-deleted.
--
-- Plak in Supabase → SQL Editor → New query → Run.

-- 1. Per ical_uid: bewaar laagste-id rij, zet deleted_at = null.
with ranked as (
  select id, ical_uid,
         row_number() over (partition by ical_uid order by id asc) as rn
  from public.board_items
  where source = 'google'
    and ical_uid is not null
)
update public.board_items
   set deleted_at = null
 where id in (select id from ranked where rn = 1)
   and deleted_at is not null;

-- 2. Diagnose: hoeveel Google-rijen leven nu, en hoeveel zijn soft-deleted?
select 'levend, met ical_uid' as label, count(*) as count
from public.board_items
where source = 'google' and ical_uid is not null and deleted_at is null
union all
select 'soft-deleted, met ical_uid', count(*)
from public.board_items
where source = 'google' and ical_uid is not null and deleted_at is not null
union all
select 'levend, ZONDER ical_uid (legacy)', count(*)
from public.board_items
where source = 'google' and ical_uid is null and deleted_at is null;

-- 3. Vind Weekstart specifiek.
select id, board_id, group_id, name, ical_uid, deleted_at, external_user_id, start_date
from public.board_items
where source = 'google'
  and lower(name) like '%weekstart%'
order by deleted_at nulls first, id;
