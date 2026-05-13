-- Yoko Planner — boards metadata. Vervangt de hardcoded BOARD_CONFIGS in
-- lib/boards.ts zodat je via de + in de sidebar nieuwe agenda's kunt
-- aanmaken zonder code-wijziging.
--
-- Plak in Supabase → SQL Editor → New query → Run.

create table if not exists public.boards (
  id          text primary key,        -- slug, gebruikt in URL en als boardName
  name        text not null,           -- weergavenaam
  emoji       text default '📋',
  color       text default '#579bfc',
  columns     jsonb not null,          -- array van ColumnDef objecten
  position    int  default 0,
  updated_at  timestamptz default now()
);

alter table public.boards enable row level security;
drop policy if exists "Boards lezen"    on public.boards;
drop policy if exists "Boards bewerken" on public.boards;
create policy "Boards lezen"    on public.boards for select to authenticated using (true);
create policy "Boards bewerken" on public.boards for all    to authenticated using (true) with check (true);

-- Seed met de 5 bestaande borden zodat de planner niet leeg start.
insert into public.boards (id, name, emoji, color, columns, position) values
  ('yoko', 'yoko', '📋', '#579bfc', '[
    {"key":"ownerIds","label":"Owner","type":"owners","width":90},
    {"key":"status","label":"Status","type":"status","width":145},
    {"key":"timeline","label":"Timeline","type":"daterange","width":175},
    {"key":"deadline","label":"Deadline","type":"date","width":105},
    {"key":"estHours","label":"Est Time","type":"number","width":85},
    {"key":"dagen","label":"Dagen","type":"number","width":70},
    {"key":"notes","label":"Notes","type":"text","width":160}
  ]'::jsonb, 0),
  ('pnp', 'PnP', '📋', '#e2445c', '[
    {"key":"ownerIds","label":"Persoon","type":"owners","width":90},
    {"key":"status","label":"Status","type":"status","width":145},
    {"key":"timeline","label":"Tijdlijn","type":"daterange","width":175},
    {"key":"deadline","label":"Deadline","type":"date","width":105},
    {"key":"estHours","label":"Est Time","type":"number","width":85},
    {"key":"contactpersoon","label":"Contactpersoon","type":"text","width":160},
    {"key":"dagen","label":"Dagen","type":"number","width":70}
  ]'::jsonb, 1),
  ('nederland', 'Nederland', '📋', '#9c7ee8', '[
    {"key":"status","label":"Status","type":"status","width":145},
    {"key":"ownerIds","label":"Owner","type":"owners","width":90},
    {"key":"timeline","label":"Timeline","type":"daterange","width":175},
    {"key":"contactpersoon","label":"Contactpersoon","type":"text","width":175},
    {"key":"estHours","label":"Est Time","type":"number","width":85},
    {"key":"uitzenddag","label":"Uitzenddag","type":"date","width":105},
    {"key":"dagen","label":"Dagen","type":"number","width":70}
  ]'::jsonb, 2),
  ('vlaanderen', 'Vlaanderen', '📋', '#ff7a00', '[
    {"key":"ownerIds","label":"Owner","type":"owners","width":90},
    {"key":"status","label":"Status","type":"status","width":145},
    {"key":"timeline","label":"Timeline","type":"daterange","width":175},
    {"key":"deadline","label":"Deadline","type":"date","width":105},
    {"key":"contactpersoon","label":"Contactpersoon","type":"text","width":160},
    {"key":"estHours","label":"Est Time","type":"number","width":85},
    {"key":"dagen","label":"Dagen","type":"number","width":70},
    {"key":"framelink","label":"Frame link","type":"url","width":110}
  ]'::jsonb, 3),
  ('dienjaar', 'Dienjaar', '📋', '#00c875', '[
    {"key":"ownerIds","label":"Owner","type":"owners","width":90},
    {"key":"timeline","label":"Tijdlijn","type":"daterange","width":175},
    {"key":"status","label":"Status","type":"status","width":145},
    {"key":"estHours","label":"Uren","type":"number","width":80},
    {"key":"dagen","label":"Dagen","type":"number","width":70},
    {"key":"deadline","label":"Deadline","type":"date","width":105},
    {"key":"nummers","label":"Nummers","type":"currency","width":110}
  ]'::jsonb, 4)
on conflict (id) do nothing;
