-- Reviewed existing logins on 2026-11-05. Preserve explicit permissions
-- on reruns; future/new logins have no permission and are denied.
begin;

-- Keep current staff access; restrict the three confirmed internship logins.
-- UUIDs are immutable login identities, not user-editable member/profile IDs.
update auth.users u
set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb) || v.permissions
from (values
 ('030a0d0c-51fa-4314-93a1-504f0f50ef8a'::uuid, '{"team_role":"team","accounts_access":true,"accounts_admin":true}'::jsonb),
 ('855fc366-e19d-4e2a-a765-f38cf247a19d'::uuid, '{"team_role":"team","accounts_access":true,"accounts_admin":true}'::jsonb),
 ('5ce62307-8f4f-490b-82b1-c88399fe0716'::uuid, '{"team_role":"team","accounts_access":true}'::jsonb),
 ('e5f3eedc-52c3-4451-8367-e977a12d2426'::uuid, '{"team_role":"team","accounts_access":true}'::jsonb),
 ('2f16eac1-9ea7-4c7c-b725-1fd8bddf94c2'::uuid, '{"team_role":"production_intern","accounts_access":false}'::jsonb),
 ('18eb262e-b3ce-4ee7-a97e-8046492c4b13'::uuid, '{"team_role":"research_intern","accounts_access":false}'::jsonb),
 ('4ba08b93-5b67-4036-acbb-cc71e0ce29c5'::uuid, '{"team_role":"research_intern","accounts_access":false}'::jsonb)
) as v(id, permissions)
where u.id = v.id and not (coalesce(u.raw_app_meta_data, '{}'::jsonb) ? 'accounts_access');

do $$ begin
  if not exists (select 1 from auth.users where raw_app_meta_data @> '{"accounts_admin":true,"accounts_access":true,"team_role":"team"}'::jsonb) then
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
      and raw_app_meta_data @> '{"accounts_access":true,"team_role":"team"}'::jsonb
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
