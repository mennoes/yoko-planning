-- `dagen` wordt in de app berekend als uren ÷ 8 en is daardoor vaak
-- gebroken: 60 uur = 7.5 dagen. De kolom stond nog op `integer`, dus
-- Postgres weigerde zo'n save met
--   invalid input syntax for type integer: "7.5"
-- en daarmee sneuvelde de hele bord-save: één item met halve dagen
-- blokkeerde álle andere wijzigingen op dat bord.
--
-- `est_hours` staat al op numeric; dit trekt `dagen` daarmee gelijk.
-- Bestaande waarden blijven staan (integer past probleemloos in numeric).
alter table public.board_items
  alter column dagen type numeric using dagen::numeric;

alter table public.board_items
  alter column dagen set default 0;
