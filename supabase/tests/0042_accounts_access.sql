-- Runs against the actual RLS policies, without reading any credentials.
-- All temporary changes and attempted writes are rolled back.
begin;
create temporary table access_verification (person text, allowed boolean, visible_accounts integer, write_check text);
do $$
declare
  sample record;
  visible integer;
  allowed boolean;
  changed integer;
  baseline integer;
  write_result text;
begin
  select count(*) into baseline from public.accounts;
  for sample in select * from (values
    ('Menno','030a0d0c-51fa-4314-93a1-504f0f50ef8a',true),
    ('Vincent','855fc366-e19d-4e2a-a765-f38cf247a19d',true),
    ('Anne-Fleur','5ce62307-8f4f-490b-82b1-c88399fe0716',true),
    ('Odette','e5f3eedc-52c3-4451-8367-e977a12d2426',true),
    ('Loeta','2f16eac1-9ea7-4c7c-b725-1fd8bddf94c2',false),
    ('Job','18eb262e-b3ce-4ee7-a97e-8046492c4b13',false),
    ('Ilse','4ba08b93-5b67-4036-acbb-cc71e0ce29c5',false),
    ('Nieuwe login zonder rechten','00000000-0000-0000-0000-000000000001',false)
  ) as cases(person,uid,expected) loop
    perform set_config('request.jwt.claim.sub',sample.uid,true);
    perform set_config('request.jwt.claims',json_build_object('sub',sample.uid,'role','authenticated','app_metadata',json_build_object('accounts_access',true,'team_role','team'))::text,true);
    execute 'set local role authenticated';
    select public.can_access_accounts(), count(*) into allowed,visible from public.accounts;
    if allowed is distinct from sample.expected or (sample.expected and visible <> baseline) or (not sample.expected and visible <> 0) then
      raise exception 'Access check failed for %',sample.person;
    end if;
    write_result := 'not changed';
    if not sample.expected then
      update public.accounts set account=account;
      get diagnostics changed = row_count;
      if changed<>0 then raise exception 'Update was allowed for %',sample.person; end if;
      begin
        insert into public.accounts(id,account) values('__account_access_verification__','Permission check');
        raise exception 'Insert was allowed for %',sample.person;
      exception when insufficient_privilege then
        write_result := 'insert/update blocked';
      end;
    end if;
    execute 'reset role';
    insert into access_verification values(sample.person,allowed,visible,write_result);
  end loop;
  -- Even an old allow flag cannot override either internship role.
  update auth.users set raw_app_meta_data=raw_app_meta_data||'{"accounts_access":true}'::jsonb
  where id in ('2f16eac1-9ea7-4c7c-b725-1fd8bddf94c2','18eb262e-b3ce-4ee7-a97e-8046492c4b13');
  for sample in select * from (values
    ('Productiestage met oud toegangsrecht','2f16eac1-9ea7-4c7c-b725-1fd8bddf94c2'),
    ('Onderzoeksstage met oud toegangsrecht','18eb262e-b3ce-4ee7-a97e-8046492c4b13')
  ) as cases(person,uid) loop
    perform set_config('request.jwt.claim.sub',sample.uid,true);
    perform set_config('request.jwt.claims',json_build_object('sub',sample.uid,'role','authenticated')::text,true);
    execute 'set local role authenticated';
    select public.can_access_accounts(),count(*) into allowed,visible from public.accounts;
    if allowed or visible<>0 then raise exception 'Internship exclusion failed'; end if;
    execute 'reset role';
    insert into access_verification values(sample.person,allowed,visible,'blocked despite allow flag');
  end loop;
end $$;
select * from access_verification;
rollback;
