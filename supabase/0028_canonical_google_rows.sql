-- Consolideer alle Google-rijen per iCalUID naar één canonical rij.
-- Soft-delete (deleted_at) op alle duplicaten zodat ze via /trash
-- terug te halen zijn als er per ongeluk iets weg gaat.
--
-- Werkwijze: per iCalUID houden we de rij met de LAAGSTE id (alfabetisch).
-- Owners van duplicaten worden in de canonical samengevoegd; daarna
-- soft-delete op de rest.
--
-- Plak in Supabase → SQL Editor → New query → Run.

-- 1. Owners mergen in canonical (rij met laagste id per ical_uid).
with grouped as (
  select id, ical_uid, owner_ids,
         row_number() over (partition by ical_uid order by id asc) as rn,
         min(id) over (partition by ical_uid) as canonical_id
  from public.board_items
  where source = 'google'
    and ical_uid is not null
    and deleted_at is null
),
canonical_owners as (
  select canonical_id,
         array(
           select distinct unnest(coalesce(owner_ids, '{}'::text[]))
           from grouped g2
           where g2.ical_uid = grouped.ical_uid
         ) as merged_owners
  from grouped
  where rn = 1
)
update public.board_items bi
   set owner_ids = canonical_owners.merged_owners
  from canonical_owners
 where bi.id = canonical_owners.canonical_id;

-- 2. Soft-delete alle non-canonical duplicaten.
with grouped as (
  select id,
         row_number() over (partition by ical_uid order by id asc) as rn
  from public.board_items
  where source = 'google'
    and ical_uid is not null
    and deleted_at is null
)
update public.board_items
   set deleted_at = now()
 where id in (select id from grouped where rn > 1);

-- 3. Verificatie — zou nul moeten zijn.
select count(*) as resterende_dupes
from (
  select 1 from public.board_items
  where source = 'google' and ical_uid is not null and deleted_at is null
  group by ical_uid having count(*) > 1
) t;
