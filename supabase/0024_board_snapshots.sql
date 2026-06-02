-- Yoko Planner — dagelijkse JSON-snapshots per bord als onafhankelijke
-- backup-laag bovenop soft-delete + PITR. Elke snapshot bevat de complete
-- boom (groepen + items + subitems) van dat bord op dat moment.
--
-- Plak in Supabase → SQL Editor → New query → Run.

create table if not exists public.board_snapshots (
  id           uuid primary key default gen_random_uuid(),
  board_id     text not null,
  snapshot_at  timestamptz default now() not null,
  trigger      text default 'auto',     -- 'auto' (cron) | 'manual' | 'restore'
  data         jsonb not null,          -- { groups: BoardGroup[] }
  size_bytes   int                      -- ruwe lengte van data voor housekeeping
);

create index if not exists board_snapshots_board_idx
  on public.board_snapshots(board_id, snapshot_at desc);

alter table public.board_snapshots enable row level security;
drop policy if exists "Snapshots lezen"    on public.board_snapshots;
drop policy if exists "Snapshots bewerken" on public.board_snapshots;
create policy "Snapshots lezen"    on public.board_snapshots for select to authenticated using (true);
create policy "Snapshots bewerken" on public.board_snapshots for all    to authenticated using (true) with check (true);
