-- Run only after reviewing and assigning accounts_admin / accounts_access
-- in auth.users.raw_app_meta_data. Missing permissions deny access.
begin;
do $$ begin
  if not exists (select 1 from auth.users where raw_app_meta_data @> '{"accounts_admin":true,"accounts_access":true}'::jsonb) then
    raise exception 'Assign a verified account administrator before enabling account access control';
  end if;
end $$;

-- Read the current server-controlled permission, not a stale JWT or an
-- editable display profile. Permission removal takes effect immediately.
create or replace function public.can_access_accounts()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from auth.users
    where id = (select auth.uid())
      and raw_app_meta_data @> '{"accounts_access":true}'::jsonb
  );
$$;
revoke all on function public.can_access_accounts() from public, anon;
grant execute on function public.can_access_accounts() to authenticated;

alter table public.accounts enable row level security;
-- Restrictive policy also applies alongside ALL legacy permissive policies.
drop policy if exists "Account access required" on public.accounts;
create policy "Account access required" on public.accounts as restrictive
for all to authenticated
using ((select public.can_access_accounts()))
with check ((select public.can_access_accounts()));
commit;
