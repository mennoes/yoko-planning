-- Use the same string IDs the client already generates, so client and
-- server share one identity space. Drops the empty uuid tables and recreates
-- with text PKs. Run AFTER 0002_collab.sql.

drop table if exists public.board_items  cascade;
drop table if exists public.board_groups cascade;

create table public.board_groups (
  id          text primary key,
  board_id    text references public.boards(id) on delete cascade,
  name        text not null,
  color       text default '#9aadbd',
  collapsed   boolean default false,
  position    integer default 0,
  created_at  timestamptz default now()
);
alter table public.board_groups enable row level security;
drop policy if exists "Groups lezen"     on public.board_groups;
drop policy if exists "Groups bewerken"  on public.board_groups;
create policy "Groups lezen"    on public.board_groups for select to authenticated using (true);
create policy "Groups bewerken" on public.board_groups for all    to authenticated using (true) with check (true);

create table public.board_items (
  id            text primary key,
  group_id      text references public.board_groups(id) on delete cascade,
  board_id      text references public.boards(id) on delete cascade,
  name          text not null default 'Naamloos',
  owner_ids     text[] not null default '{}',
  status        text,
  start_date    date,
  end_date      date,
  deadline      date,
  est_hours     numeric default 0,
  dagen         integer default 0,
  notes         text,
  contactpersoon text,
  uitzenddag    date,
  framelink     text,
  nummers       numeric,
  subitems      jsonb default '[]'::jsonb,
  journal       jsonb default '[]'::jsonb,
  extra         jsonb default '{}'::jsonb,
  position      integer default 0,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
alter table public.board_items enable row level security;
drop policy if exists "Items lezen"    on public.board_items;
drop policy if exists "Items bewerken" on public.board_items;
create policy "Items lezen"    on public.board_items for select to authenticated using (true);
create policy "Items bewerken" on public.board_items for all    to authenticated using (true) with check (true);

create index if not exists board_items_board_idx on public.board_items(board_id);
create index if not exists board_items_group_idx on public.board_items(group_id);
