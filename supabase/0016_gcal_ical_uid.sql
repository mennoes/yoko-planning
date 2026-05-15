-- Yoko Planner — dedup Google Calendar items via iCalUID
-- Plak in Supabase → SQL Editor → New query → Run.
--
-- Probleem: als meerdere teamleden hun Google Agenda koppelen, krijgt elk
-- hetzelfde gedeelde event (Weekstart, Teamdag, etc.) een eigen board_items
-- rij. Reden: de oude item-id was `it_g_{ev.id}_{user_prefix}` en Google's
-- ev.id verschilt per kalender-eigenaar.
--
-- Oplossing: iCalUID is stabiel over alle kalenders heen voor één event.
-- Vanaf deze migratie schrijft de sync iCalUID per rij; de sync-code merge't
-- vervolgens duplicaten naar één canonical rij.

alter table public.board_items
  add column if not exists ical_uid text;

create index if not exists board_items_ical_uid_idx
  on public.board_items(ical_uid);
