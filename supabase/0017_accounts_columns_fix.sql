-- Yoko Planner — corrigeer accounts-tabel schema
-- Plak in Supabase → SQL Editor → New query → Run.
--
-- Probleem: live Supabase gaf "column accounts.account does not exist
-- (42703)" terug op de /accounts pagina. De tabel bestaat dus wel, maar
-- met een andere kolom-set dan 0012_accounts.sql aangeeft. Vermoedelijk
-- bestond er een eerdere variant van de tabel, waardoor de `create table
-- if not exists` van 0012 niets deed.
--
-- Deze migratie voegt alle ontbrekende kolommen toe (idempotent) en laat
-- bestaande data ongemoeid. Daarna kun je via de Accounts-pagina gewoon
-- nieuwe rijen toevoegen (of bestaande bewerken zodra hun `account` veld
-- ingevuld is). Geen drop/recreate dus — als er al rijen in stonden met
-- een ander schema, blijven die staan.

alter table public.accounts add column if not exists account     text not null default '';
alter table public.accounts add column if not exists url         text default '';
alter table public.accounts add column if not exists username    text default '';
alter table public.accounts add column if not exists password    text default '';
alter table public.accounts add column if not exists license_by  text default '';
alter table public.accounts add column if not exists position    int  default 0;
alter table public.accounts add column if not exists updated_at  timestamptz default now();

-- RLS-policy opnieuw zetten — was al goed in 0012, maar voor de zekerheid
-- (drop & recreate is idempotent en kost niks):
alter table public.accounts enable row level security;
drop policy if exists "Accounts lezen"    on public.accounts;
drop policy if exists "Accounts bewerken" on public.accounts;
create policy "Accounts lezen"    on public.accounts for select to authenticated using (true);
create policy "Accounts bewerken" on public.accounts for all    to authenticated using (true) with check (true);

-- Inspectie-helper: gebruik deze SELECT in dezelfde SQL-editor om te
-- controleren welke kolommen er na de migratie staan.
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'accounts'
--    order by ordinal_position;
