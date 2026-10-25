-- Rechten voor de Data API expliciet vastleggen.
--
-- Tot 30 oktober 2026 gaf Supabase elke nieuwe tabel in 'public'
-- automatisch rechten voor anon, authenticated en service_role. Daarna
-- niet meer: een nieuwe tabel is dan onzichtbaar voor supabase-js tot er
-- een GRANT bij staat.
--
-- Bestaande tabellen houden hun rechten, dus vandaag verandert er niets.
-- Waar het wél misgaat is een herbouw vanaf nul — een nieuw project,
-- een preview branch, of `supabase db reset`. Dan draaien deze
-- migraties opnieuw en krijgt geen enkele tabel nog rechten. Deze
-- migratie zet ze er daarom expliciet in, zodat de hele reeks ook na
-- die datum een werkende database oplevert.
--
-- Nieuwe tabellen: zet de drie grants in dezelfde migratie als de
-- create table. Zie AGENTS.md.

-- 1. Eerst kijken of alles achter RLS zit.
--
-- Rechten uitdelen aan anon is alleen veilig omdat row level security
-- bepaalt wat die rol daadwerkelijk ziet. Staat RLS ergens uit, dan
-- stopt deze migratie — liever een foutmelding dan stilletjes een tabel
-- openzetten.
do $$
declare
  zonder_rls text;
begin
  select string_agg(c.relname, ', ' order by c.relname)
    into zonder_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and not c.relrowsecurity;

  if zonder_rls is not null then
    raise exception
      'Deze tabellen hebben geen row level security: %. Zet die eerst aan; pas daarna horen ze rechten voor de Data API te krijgen.',
      zonder_rls;
  end if;
end $$;

-- 2. Dezelfde rechten die Supabase tot nu toe automatisch uitdeelde.
do $$
declare
  tabel record;
begin
  for tabel in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname
  loop
    execute format('grant select on public.%I to anon', tabel.relname);
    execute format('grant select, insert, update, delete on public.%I to authenticated', tabel.relname);
    execute format('grant select, insert, update, delete on public.%I to service_role', tabel.relname);
  end loop;
end $$;

-- 3. En voor de sequences die bij die tabellen horen, anders faalt een
--    insert op een tabel met een serial-kolom alsnog.
do $$
declare
  reeks record;
begin
  for reeks in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'S'
  loop
    execute format('grant usage, select on sequence public.%I to authenticated, service_role', reeks.relname);
  end loop;
end $$;
