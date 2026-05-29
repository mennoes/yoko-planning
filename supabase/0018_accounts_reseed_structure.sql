-- Yoko Planner — herstel de account-structuur (zonder passwords)
-- Plak in Supabase → SQL Editor → New query → Run.
--
-- De originele seed in 0012_accounts.sql kon niet ingeladen worden omdat
-- de tabel toen al een ander schema had. Na migratie 0017 staat 't schema
-- goed, maar de tabel is leeg. Deze migratie zet de account-namen,
-- URLs, usernames en license-info terug zoals ze in data/accounts.json
-- stonden. Passwords blijven leeg — die vul je daarna handmatig in via
-- de Accounts-pagina (klik op cel → typen → Enter).
--
-- on conflict (id) do nothing: als je tussentijds een account met
-- hetzelfde id had toegevoegd, blijft die staan.

insert into public.accounts (id, account, url, username, password, license_by, position) values
  ('1',  'Dropbox',                                       '',                                  'info@studioyoko.nl',                 '', 'yoko',          0),
  ('2',  'Frame.io',                                      '',                                  'info@studioyoko.nl',                 '', 'yoko',          1),
  ('3',  'Replay.dropbox',                                '',                                  'editor@universiteitvannederland.nl', '', 'UvNL',          2),
  ('4',  'Epidemic sound',                                '',                                  'info@pnpmedia.nl',                   '', 'PnP',           3),
  ('5',  'artlist.io',                                    'https://artlist.io/',               'ekin.ciftci@zerodensity.io',         '', 'Zero Density',  4),
  ('6',  'elements.envato.com',                           'https://elements.envato.com/',      'zerodensitysocial@gmail.com',        '', 'Zero D',        5),
  ('7',  'Midjourney',                                    '',                                  'info@studioyoko.nl',                 '', 'yoko',          6),
  ('8',  'Freepik',                                       '',                                  'info@studioyoko.nl',                 '', 'yoko',          7),
  ('9',  'Figma',                                         '',                                  'info@studioyoko.nl',                 '', 'yoko',          8),
  ('10', 'Adobe Cloud',                                   '',                                  'odette@studioyoko.nl',               '', 'yoko',          9),
  ('11', 'Webflow – Website yoko',                        '',                                  'clemens@studioyoko.nl',              '', 'yoko',          10),
  ('12', 'Instagram',                                     '',                                  'info@studioyoko.nl',                 '', 'yoko',          11),
  ('13', 'Vimeo',                                         '',                                  'info@studioyoko.nl',                 '', 'yoko',          12),
  ('14', 'Google Vincent (voor remote desktop MENNO)',    '',                                  'vincent@studioyoko.nl',              '', '',              13),
  ('15', 'Desktop Menno voor Remote acces (Vitens)',      '',                                  'Via bovenstaand mailadres',          '', '',              14),
  ('16', 'mijnwt.nl',                                     'https://www.mijnwt.nl/',            'vincent@studioyoko.nl',              '', 'yoko',          15),
  ('17', 'Mapbox',                                        '',                                  'info@studioyoko.nl',                 '', 'yoko',          16),
  ('18', 'WIFI yoko',                                     '',                                  'WiFi_Animatietuin1',                 '', 'Hooghiemstra',  17),
  ('19', 'Wifi Hooghiemstra',                             '',                                  '',                                   '', '',              18),
  ('20', 'ChatGPT',                                       '',                                  'menno@studioyoko.nl',                '', 'yoko',          19)
on conflict (id) do nothing;
