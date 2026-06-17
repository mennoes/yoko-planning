-- Yoko Planner — maintenance helpers voor automatische cleanup.
-- Plak in Supabase → SQL Editor → New query → Run.
--
-- Bevat één RPC die de retention-jobs in 1 keer uitvoert. Aangeroepen
-- door /api/maintenance/prune (Vercel cron). Geen pg_cron nodig.

create or replace function public.run_maintenance_prune()
returns table(
  snapshots_pruned int,
  activity_pruned  int,
  items_purged     int,
  groups_purged    int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_snapshots int := 0;
  v_activity  int := 0;
  v_items     int := 0;
  v_groups    int := 0;
begin
  -- 1. Snapshots > 30 dagen → max 1 per kalenderweek per bord.
  with del as (
    delete from public.board_snapshots
    where snapshot_at < now() - interval '30 days'
      and id not in (
        select distinct on (board_id, date_trunc('week', snapshot_at)) id
        from public.board_snapshots
        where snapshot_at < now() - interval '30 days'
        order by board_id, date_trunc('week', snapshot_at), snapshot_at
      )
    returning 1
  )
  select count(*) into v_snapshots from del;

  -- 2. Snapshots > 180 dagen → max 1 per maand per bord (na week-prune).
  with del2 as (
    delete from public.board_snapshots
    where snapshot_at < now() - interval '180 days'
      and id not in (
        select distinct on (board_id, date_trunc('month', snapshot_at)) id
        from public.board_snapshots
        where snapshot_at < now() - interval '180 days'
        order by board_id, date_trunc('month', snapshot_at), snapshot_at
      )
    returning 1
  )
  select v_snapshots + count(*) into v_snapshots from del2;

  -- 3. Activity-log > 90 dagen → weg. Voor de Geschiedenis-drawer kijken
  --    we sowieso slechts ~300 entries terug, dus oudere zijn dood gewicht.
  with del3 as (
    delete from public.activity
    where ts < now() - interval '90 days'
    returning 1
  )
  select count(*) into v_activity from del3;

  -- 4. Soft-deleted board_items > 60 dagen → hard delete. De Trash-drawer
  --    toont ze nog steeds tot dat moment.
  with del4 as (
    delete from public.board_items
    where deleted_at is not null
      and deleted_at < now() - interval '60 days'
    returning 1
  )
  select count(*) into v_items from del4;

  -- 5. Soft-deleted board_groups > 60 dagen → hard delete.
  with del5 as (
    delete from public.board_groups
    where deleted_at is not null
      and deleted_at < now() - interval '60 days'
    returning 1
  )
  select count(*) into v_groups from del5;

  return query select v_snapshots, v_activity, v_items, v_groups;
end;
$$;

-- Service-role mag deze functie aanroepen vanuit /api/maintenance/prune.
revoke all on function public.run_maintenance_prune() from public;
grant execute on function public.run_maintenance_prune() to service_role;
