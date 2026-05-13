-- Yoko Planner — accounts tabel met wachtwoorden, alleen leesbaar voor
-- ingelogde gebruikers (Auth + RLS). Vervangt data/accounts.json als
-- bron-van-waarheid voor de Accounts-pagina.
--
-- Plak in Supabase → SQL Editor → New query → Run.

create table if not exists public.accounts (
  id          text primary key,
  account     text not null,
  url         text default '',
  username    text default '',
  password    text default '',
  license_by  text default '',
  position    int  default 0,
  updated_at  timestamptz default now()
);

alter table public.accounts enable row level security;
drop policy if exists "Accounts lezen"    on public.accounts;
drop policy if exists "Accounts bewerken" on public.accounts;
-- Alleen ingelogde gebruikers — anon krijgt niks te zien.
create policy "Accounts lezen"    on public.accounts for select to authenticated using (true);
create policy "Accounts bewerken" on public.accounts for all    to authenticated using (true) with check (true);

-- Realtime aanzetten via Database → Replication → public → vinkje voor
-- accounts, zodat wijzigingen meteen cross-device propageren.

-- Eenmalige seed van de huidige inhoud (de wachtwoorden die op dat moment
-- in data/accounts.json stonden). NA het draaien van deze migratie kun je
-- accounts.json zonder wachtwoorden in git houden — Supabase is daarna
-- de bron-van-waarheid. Eerstvolgende keer dat je iets wijzigt schrijft
-- de page rechtstreeks naar Supabase, niet meer naar JSON.
insert into public.accounts (id, account, url, username, password, license_by, position) values
  ('1',  'Dropbox',                                       '',                              'info@studioyoko.nl',                'REDACTED',     'yoko',         0),
  ('2',  'Frame.io',                                      '',                              'info@studioyoko.nl',                'REDACTED',                       'yoko',         1),
  ('3',  'Replay.dropbox',                                '',                              'editor@universiteitvannederland.nl','REDACTED',                   'UvNL',         2),
  ('4',  'Epidemic sound',                                '',                              'info@pnpmedia.nl',                  'REDACTED',                 'PnP',          3),
  ('5',  'artlist.io',                                    'https://artlist.io/',           'ekin.ciftci@zerodensity.io',        'REDACTED',                        'Zero Density', 4),
  ('6',  'elements.envato.com',                           'https://elements.envato.com/',  'zerodensitysocial@gmail.com',       'REDACTED',                       'Zero D',       5),
  ('7',  'Midjourney',                                    '',                              'info@studioyoko.nl',                'REDACTED',                  'yoko',         6),
  ('8',  'Freepik',                                       '',                              'info@studioyoko.nl',                'REDACTED',                     'yoko',         7),
  ('9',  'Figma',                                         '',                              'info@studioyoko.nl',                'REDACTED',         'yoko',         8),
  ('10', 'Adobe Cloud',                                   '',                              'odette@studioyoko.nl',              'REDACTED',                'yoko',         9),
  ('11', 'Webflow – Website yoko',                        '',                              'clemens@studioyoko.nl',             'REDACTED',      'yoko',         10),
  ('12', 'Instagram',                                     '',                              'info@studioyoko.nl',                'REDACTED',                'yoko',         11),
  ('13', 'Vimeo',                                         '',                              'info@studioyoko.nl',                'REDACTED',                 'yoko',         12),
  ('14', 'Google Vincent (voor remote desktop MENNO)',    '',                              'vincent@studioyoko.nl',             'REDACTED',                          '',             13),
  ('15', 'Desktop Menno voor Remote acces (Vitens)',      '',                              'Via bovenstaand mailadres',         'REDACTED',                              '',             14),
  ('16', 'mijnwt.nl',                                     'https://www.mijnwt.nl/',        'vincent@studioyoko.nl',             'REDACTED',                         'yoko',         15),
  ('17', 'Mapbox',                                        '',                              'info@studioyoko.nl',                'REDACTED',                      'yoko',         16),
  ('18', 'WIFI yoko',                                     '',                              'WiFi_Animatietuin1',                'REDACTED',                            'Hooghiemstra', 17),
  ('19', 'Wifi Hooghiemstra',                             '',                              '',                                  '',                                    '',             18),
  ('20', 'ChatGPT',                                       '',                              'menno@studioyoko.nl',               '',                                    'yoko',         19)
on conflict (id) do nothing;
