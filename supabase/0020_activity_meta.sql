-- Yoko Planner — gestructureerde before/after voor activity-entries
-- Plak in Supabase → SQL Editor → New query → Run.
--
-- Voeg een 'meta' JSONB-kolom toe aan public.activity. Bedoeld voor:
--   { field: 'startDate' | 'endDate' | 'estHours' | 'status' | 'ownerIds' | …,
--     before: <oude waarde>,
--     after:  <nieuwe waarde>,
--     boardId: 'yoko',
--     itemName: 'Lopende projecten S03 E01' }
--
-- De /activity-drawer leest meta.before voor de 'Ongedaan maken'-knop —
-- entries zonder meta blijven leesbaar maar zonder undo.

alter table public.activity add column if not exists meta jsonb;
create index if not exists activity_meta_board_idx on public.activity ((meta ->> 'boardId'));
