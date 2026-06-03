-- Diagnose: zoek elk spoor van 'Gerolsteiner'. Run in Supabase →
-- SQL Editor → New query → Run en deel de output.

-- 1. Levende rijen op alle borden.
select id, board_id, group_id, name, source, status, start_date, end_date, deleted_at
from public.board_items
where lower(name) like '%gerolst%';

-- 2. Soft-deleted rijen (zouden via /trash terug te halen moeten zijn).
select id, board_id, group_id, name, source, status, start_date, end_date, deleted_at
from public.board_items
where lower(name) like '%gerolst%' and deleted_at is not null
order by deleted_at desc;

-- 3. Activity log — wie heeft 'm wanneer aangepast?
select ts, user_id, action, target, detail
from public.activity
where (lower(detail) like '%gerolst%' or lower(action) like '%gerolst%')
order by ts desc
limit 20;

-- 4. Snapshots die het mogelijk nog bevatten — recentste 5 yoko-versies.
select id, snapshot_at, trigger,
       jsonb_array_length(data->'items') as items,
       (select count(*) from jsonb_array_elements(data->'items') i
        where lower(i->>'name') like '%gerolst%') as gerolst_hits
from public.board_snapshots
where board_id = 'yoko'
order by snapshot_at desc
limit 5;
