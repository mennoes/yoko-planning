-- Status-veld voor feedback_items: maakt voortgang zichtbaar
-- (open → planned → done, of rejected). Default 'open'.

alter table public.feedback_items
  add column if not exists status text not null default 'open';

-- Zacht-beperk de waardes; je kunt 't ook een echte enum maken, maar een
-- check-constraint geeft dezelfde garanties zonder migratie-gedoe.
alter table public.feedback_items
  drop constraint if exists feedback_items_status_check;
alter table public.feedback_items
  add constraint feedback_items_status_check
  check (status in ('open', 'planned', 'done', 'rejected'));

-- Bestaande rijen krijgen 'open' van de default; expliciet voor de zekerheid.
update public.feedback_items set status = 'open' where status is null;
