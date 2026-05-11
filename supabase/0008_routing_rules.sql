-- Yoko Planner — slimme routing voor Google Calendar events naar boards.
-- Plak in Supabase → SQL Editor → New query → Run.

-- 1. Routing-regels tabel (team-breed)
create table if not exists public.calendar_routing_rules (
  id          uuid primary key default gen_random_uuid(),
  pattern     text not null,                                                       -- substring match, case-insensitive
  board_id    text references public.boards(id) on delete cascade not null,
  enabled     boolean default true,
  position    integer default 0,
  created_at  timestamptz default now()
);

alter table public.calendar_routing_rules enable row level security;
drop policy if exists "Routing rules lezen"    on public.calendar_routing_rules;
drop policy if exists "Routing rules bewerken" on public.calendar_routing_rules;
create policy "Routing rules lezen"
  on public.calendar_routing_rules for select
  to authenticated using (true);
create policy "Routing rules bewerken"
  on public.calendar_routing_rules for all
  to authenticated using (true) with check (true);

-- 2. Track op welke calendar een board_item vandaan komt (nodig voor cleanup
--    nu items uit dezelfde calendar over meerdere boards verspreid kunnen
--    zijn dankzij de routing-regels).
alter table public.board_items
  add column if not exists calendar_id text;
create index if not exists board_items_calendar_idx
  on public.board_items(calendar_id);

-- 3. Seed-regels — pas aan of voeg toe naar smaak via dezelfde tabel.
insert into public.calendar_routing_rules (pattern, board_id, position) values
  ('uvvl',       'vlaanderen', 0),
  ('vlaanderen', 'vlaanderen', 1),
  ('pnp',        'pnp',        2),
  ('dienjaar',   'dienjaar',   3),
  ('knrm',       'nederland',  4)
on conflict do nothing;
