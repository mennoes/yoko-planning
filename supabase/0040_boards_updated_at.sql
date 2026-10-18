-- Sommige installaties hebben `boards` ooit zonder `updated_at`
-- aangemaakt. PostgREST weigert dan élke schrijfactie waarin die kolom
-- voorkomt, met:
--   Could not find the 'updated_at' column of 'boards' in the schema cache
-- Daardoor kon een agenda niet hernoemd worden: de naam sprong meteen
-- terug, zonder dat er iets in de database veranderde.
--
-- De app vangt het ontbreken sinds kort zelf op, maar met de kolom erbij
-- klopt het schema weer met de rest van de migraties (zie 0013).
alter table public.boards
  add column if not exists updated_at timestamptz default now();
