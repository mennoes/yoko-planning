-- Volledige Google-items opruim in één keer:
--  A. Soft-delete alle non-canonical rijen per iCalUID
--  B. Revive de canonical rij als die soft-deleted is
--  C. Diagnose-output
--
-- Idempotent. Plak in Supabase → SQL Editor → New query → Run.

-- A. Per iCalUID: rij met laagste id = canonical, rest soft-delete.
with ranked as (
  select id, ical_uid,
         row_number() over (partition by ical_uid order by id asc) as rn
  from public.board_items
  where source = 'google'
    and ical_uid is not null
)
update public.board_items
   set deleted_at = now()
 where id in (select id from ranked where rn > 1)
   and deleted_at is null;

-- B. Owners van soft-deleted dupes mergen in canonical.
with grouped as (
  select bi.ical_uid,
         array(
           select distinct unnest(coalesce(owner_ids, '{}'::text[]))
           from public.board_items
           where ical_uid = bi.ical_uid
             and source = 'google'
         ) as all_owners
  from public.board_items bi
  where bi.source = 'google'
    and bi.ical_uid is not null
  group by bi.ical_uid
),
canonical as (
  select distinct on (ical_uid) id, ical_uid
  from public.board_items
  where source = 'google' and ical_uid is not null
  order by ical_uid, id asc
)
update public.board_items
   set owner_ids = grouped.all_owners
  from grouped, canonical
 where public.board_items.id = canonical.id
   and canonical.ical_uid = grouped.ical_uid;

-- C. Revive canonical als die ten onrechte soft-deleted is.
with ranked as (
  select id,
         row_number() over (partition by ical_uid order by id asc) as rn
  from public.board_items
  where source = 'google'
    and ical_uid is not null
)
update public.board_items
   set deleted_at = null
 where id in (select id from ranked where rn = 1)
   and deleted_at is not null;

-- DIAGNOSE — wat staat er nu?
select 'levend per iCalUID (zou 1 per uniek event moeten zijn)' as label,
       count(*) as count
from (
  select 1 from public.board_items
  where source = 'google' and ical_uid is not null and deleted_at is null
  group by ical_uid
) t
union all
select 'duplicaten over (zou 0 moeten zijn)',
       count(*)
from (
  select 1 from public.board_items
  where source = 'google' and ical_uid is not null and deleted_at is null
  group by ical_uid having count(*) > 1
) t
union all
select 'totale Google-rijen levend', count(*)
from public.board_items
where source = 'google' and deleted_at is null
union all
select 'Weekstart rijen levend', count(*)
from public.board_items
where source = 'google' and deleted_at is null and lower(name) like '%weekstart%';

-- Lijst van overgebleven Weekstart-rijen na opschoning.
select id, board_id, group_id, name, ical_uid, deleted_at
from public.board_items
where lower(name) like '%weekstart%'
order by deleted_at nulls first, id;
