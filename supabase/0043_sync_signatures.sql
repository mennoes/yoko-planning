-- Read-only fingerprints. RLS filters the rows for the requesting user.
create or replace function public.planning_sync_signature(board_name text)
returns text language sql stable security invoker set search_path = '' as $$
  select md5(coalesce(string_agg(kind || ':' || id || ':' || version, ',' order by kind, id), ''))
  from (
    select 'i' as kind, id, xmin::text as version from public.board_items
    where board_id = board_name and deleted_at is null
    union all
    select 'g', id, xmin::text from public.board_groups
    where board_id = board_name and deleted_at is null
  ) visible_rows
$$;
revoke all on function public.planning_sync_signature(text) from public, anon;
grant execute on function public.planning_sync_signature(text) to authenticated;
