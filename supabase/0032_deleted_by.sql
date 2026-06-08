-- Track wie een board_item soft-deletet, zodat de papierbak kan tonen
-- "verwijderd door <naam>" naast "verwijderd op <datum>".
--
-- Plak in Supabase -> SQL Editor -> New query -> Run.

alter table public.board_items add column if not exists deleted_by uuid;
create index if not exists board_items_deleted_by_idx on public.board_items (deleted_by);
