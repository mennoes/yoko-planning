<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Een nieuwe tabel krijgt zijn eigen rechten

Supabase deelt sinds 30 oktober 2026 geen Data API-rechten meer uit aan
nieuwe tabellen in `public`. Zet ze daarom in dezelfde migratie als de
`create table`, direct onder `enable row level security`:

```sql
grant select on public.jouw_tabel to anon;
grant select, insert, update, delete on public.jouw_tabel to authenticated;
grant select, insert, update, delete on public.jouw_tabel to service_role;
```

Zonder die regels geeft supabase-js `permission denied` op die ene
tabel — niet bij het draaien van de migratie, maar pas in de app.

RLS blijft wat bepaalt wie wat ziet; de grants openen alleen de deur
naar de API. Een tabel zonder RLS hoort dus ook geen `anon`-grant te
krijgen. `supabase/0041_data_api_grants.sql` zet de rechten voor alle
tabellen die er op dat moment waren, en weigert te draaien als ergens
RLS uitstaat.
