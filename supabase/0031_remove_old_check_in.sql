-- Identificeer en (optioneel) verwijder de oude 'Wekelijkse check-in'
-- variant. We doen 't in twee stappen — eerst kijken, dan beslissen.
--
-- Plak in Supabase → SQL Editor → New query → Run.

-- STAP 1 — kijk welke rijen er zijn voor zowel oude als nieuwe naam.
select id, board_id, group_id, name, ical_uid, deleted_at, start_date, end_date
from public.board_items
where source = 'google'
  and (
    lower(name) like '%wekelijkse check-in%'
    or lower(name) like '%check-in menno%odette%'
    or lower(name) like '%check-in%menno%'
  )
order by name, deleted_at nulls first, id;
