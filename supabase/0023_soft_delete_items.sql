-- Yoko Planner — soft-delete voor board_items + board_groups.
-- Verwijderingen zetten 'deleted_at' i.p.v. een hard DELETE, zodat de
-- /trash-pagina ze kan tonen en herstellen. Auto-purge na 90 dagen
-- gebeurt later via een cleanup-cron — voor nu blijven ze gewoon staan.
--
-- Plak in Supabase → SQL Editor → New query → Run.

alter table public.board_items
  add column if not exists deleted_at timestamptz;

alter table public.board_groups
  add column if not exists deleted_at timestamptz;

-- Index zodat de '... where deleted_at is null'-filter bij pullBoard
-- snel blijft, ook bij grote boards.
create index if not exists board_items_active_idx
  on public.board_items(board_id, deleted_at);
create index if not exists board_groups_active_idx
  on public.board_groups(board_id, deleted_at);
