-- Yoko Planner — collaboration schema
-- Plak dit in Supabase → SQL Editor → New query → Run
-- Veilig opnieuw te runnen (idempotent waar mogelijk).

-- ────────────────────────────────────────────────────────────────────────────
-- 0. Helpers
-- ────────────────────────────────────────────────────────────────────────────
create extension if not exists pgcrypto;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Profiles — uitgebreid + team-leesbaar
-- ────────────────────────────────────────────────────────────────────────────
-- Bestaande tabel uit schema.sql blijft. Voeg policy toe zodat het hele team
-- elkaars profiel kan zien (voor avatars / namen).

drop policy if exists "Team profiel lezen" on public.profiles;
create policy "Team profiel lezen"
  on public.profiles for select
  to authenticated
  using (true);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Boards (yoko, pnp, nederland, vlaanderen, dienjaar)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.boards (
  id          text primary key,
  name        text not null,
  emoji       text default '📋',
  color       text default '#579bfc',
  position    integer default 0,
  created_at  timestamptz default now()
);

-- Seed
insert into public.boards (id, name, color, position) values
  ('yoko',       'yoko',       '#579bfc', 0),
  ('pnp',        'PnP',        '#e2445c', 1),
  ('nederland',  'Nederland',  '#9c7ee8', 2),
  ('vlaanderen', 'Vlaanderen', '#ff7a00', 3),
  ('dienjaar',   'Dienjaar',   '#00c875', 4)
on conflict (id) do nothing;

alter table public.boards enable row level security;
drop policy if exists "Boards lezen" on public.boards;
drop policy if exists "Boards bewerken" on public.boards;
create policy "Boards lezen"   on public.boards for select to authenticated using (true);
create policy "Boards bewerken" on public.boards for all    to authenticated using (true) with check (true);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Board groups + items (planning kaarten)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.board_groups (
  id         uuid primary key default gen_random_uuid(),
  board_id   text references public.boards(id) on delete cascade,
  name       text not null,
  color      text default '#9aadbd',
  collapsed  boolean default false,
  position   integer default 0,
  created_at timestamptz default now()
);
alter table public.board_groups enable row level security;
drop policy if exists "Groups lezen" on public.board_groups;
drop policy if exists "Groups bewerken" on public.board_groups;
create policy "Groups lezen"    on public.board_groups for select to authenticated using (true);
create policy "Groups bewerken" on public.board_groups for all    to authenticated using (true) with check (true);

create table if not exists public.board_items (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid references public.board_groups(id) on delete cascade,
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
  extra         jsonb default '{}'::jsonb, -- toekomstige velden
  position      integer default 0,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
alter table public.board_items enable row level security;
drop policy if exists "Items lezen" on public.board_items;
drop policy if exists "Items bewerken" on public.board_items;
create policy "Items lezen"    on public.board_items for select to authenticated using (true);
create policy "Items bewerken" on public.board_items for all    to authenticated using (true) with check (true);

create index if not exists board_items_board_idx on public.board_items(board_id);
create index if not exists board_items_group_idx on public.board_items(group_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Pages (documenten)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.pages (
  id         uuid primary key default gen_random_uuid(),
  title      text default '',
  emoji      text default '📄',
  content    text default '',
  owner_id   uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.pages enable row level security;
drop policy if exists "Pages lezen" on public.pages;
drop policy if exists "Pages bewerken" on public.pages;
create policy "Pages lezen"    on public.pages for select to authenticated using (true);
create policy "Pages bewerken" on public.pages for all    to authenticated using (true) with check (true);

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Comments / annotaties (op pages of board_items)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.comments (
  id           uuid primary key default gen_random_uuid(),
  context_kind text not null check (context_kind in ('page','board_item')),
  context_id   text not null,
  quote        text not null,
  thread       jsonb not null default '[]'::jsonb,
  resolved     boolean default false,
  author_id    uuid references auth.users(id) on delete set null,
  created_at   timestamptz default now()
);
alter table public.comments enable row level security;
drop policy if exists "Comments lezen" on public.comments;
drop policy if exists "Comments toevoegen" on public.comments;
drop policy if exists "Comments bijwerken" on public.comments;
drop policy if exists "Comments verwijderen" on public.comments;
create policy "Comments lezen"        on public.comments for select to authenticated using (true);
create policy "Comments toevoegen"    on public.comments for insert to authenticated with check (true);
create policy "Comments bijwerken"    on public.comments for update to authenticated using (true);
create policy "Comments verwijderen"  on public.comments for delete to authenticated using (true);

create index if not exists comments_context_idx on public.comments(context_kind, context_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Time entries + active timer
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.time_entries (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete cascade,
  project_id   text not null,
  project_name text,
  start_ts     timestamptz not null,
  end_ts       timestamptz not null,
  minutes      integer not null
);
alter table public.time_entries enable row level security;
drop policy if exists "Time entries lezen team"  on public.time_entries;
drop policy if exists "Time entries eigen toev"  on public.time_entries;
drop policy if exists "Time entries eigen bw"    on public.time_entries;
drop policy if exists "Time entries eigen del"   on public.time_entries;
create policy "Time entries lezen team"  on public.time_entries for select to authenticated using (true);
create policy "Time entries eigen toev"  on public.time_entries for insert to authenticated with check (auth.uid() = user_id);
create policy "Time entries eigen bw"    on public.time_entries for update to authenticated using (auth.uid() = user_id);
create policy "Time entries eigen del"   on public.time_entries for delete to authenticated using (auth.uid() = user_id);

create index if not exists time_entries_user_idx    on public.time_entries(user_id);
create index if not exists time_entries_project_idx on public.time_entries(project_id);

create table if not exists public.active_timers (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  project_id   text not null,
  project_name text,
  start_ts     timestamptz not null default now()
);
alter table public.active_timers enable row level security;
drop policy if exists "Timers lezen team" on public.active_timers;
drop policy if exists "Eigen timer set"   on public.active_timers;
drop policy if exists "Eigen timer del"   on public.active_timers;
create policy "Timers lezen team" on public.active_timers for select to authenticated using (true);
create policy "Eigen timer set"   on public.active_timers for all    to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Todos — sections + items
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.todo_sections (
  id         text primary key, -- member_id voor persoonlijk, slug voor algemeen
  title      text not null,
  emoji      text default '📋',
  scope      text not null default 'team' check (scope in ('team','member')),
  member_id  text,
  position   integer default 0,
  created_at timestamptz default now()
);
alter table public.todo_sections enable row level security;
drop policy if exists "Todo sections lezen" on public.todo_sections;
drop policy if exists "Todo sections bewerken" on public.todo_sections;
create policy "Todo sections lezen"    on public.todo_sections for select to authenticated using (true);
create policy "Todo sections bewerken" on public.todo_sections for all    to authenticated using (true) with check (true);

create table if not exists public.todo_items (
  id          uuid primary key default gen_random_uuid(),
  section_id  text references public.todo_sections(id) on delete cascade,
  text        text not null,
  done        boolean default false,
  position    integer default 0,
  created_at  timestamptz default now(),
  done_at     timestamptz
);
alter table public.todo_items enable row level security;
drop policy if exists "Todo items lezen" on public.todo_items;
drop policy if exists "Todo items bewerken" on public.todo_items;
create policy "Todo items lezen"    on public.todo_items for select to authenticated using (true);
create policy "Todo items bewerken" on public.todo_items for all    to authenticated using (true) with check (true);

create index if not exists todo_items_section_idx on public.todo_items(section_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 8. Templates (gedeeld met team)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  items       jsonb not null default '[]'::jsonb,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz default now()
);
alter table public.templates enable row level security;
drop policy if exists "Templates lezen" on public.templates;
drop policy if exists "Templates bewerken" on public.templates;
create policy "Templates lezen"    on public.templates for select to authenticated using (true);
create policy "Templates bewerken" on public.templates for all    to authenticated using (true) with check (true);

-- ────────────────────────────────────────────────────────────────────────────
-- 9. Activity feed (team-breed, append-only)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.activity (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid references auth.users(id) on delete set null,
  action    text not null,
  target    text,
  detail    text,
  ts        timestamptz default now()
);
alter table public.activity enable row level security;
drop policy if exists "Activity lezen" on public.activity;
drop policy if exists "Activity toev"  on public.activity;
create policy "Activity lezen" on public.activity for select to authenticated using (true);
create policy "Activity toev"  on public.activity for insert to authenticated with check (auth.uid() = user_id);

create index if not exists activity_ts_idx on public.activity(ts desc);

-- ────────────────────────────────────────────────────────────────────────────
-- 10. Accounts + Kantoor info (gedeeld met team)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.accounts (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  url          text,
  username     text,
  licensed_by  text,
  position     integer default 0,
  created_at   timestamptz default now()
);
alter table public.accounts enable row level security;
drop policy if exists "Accounts lezen" on public.accounts;
drop policy if exists "Accounts bewerken" on public.accounts;
create policy "Accounts lezen"    on public.accounts for select to authenticated using (true);
create policy "Accounts bewerken" on public.accounts for all    to authenticated using (true) with check (true);

create table if not exists public.kantoor_sections (
  id         text primary key,
  title      text not null,
  emoji      text default '📍',
  blocks     jsonb not null default '[]'::jsonb,
  position   integer default 0,
  updated_at timestamptz default now()
);
alter table public.kantoor_sections enable row level security;
drop policy if exists "Kantoor lezen" on public.kantoor_sections;
drop policy if exists "Kantoor bewerken" on public.kantoor_sections;
create policy "Kantoor lezen"    on public.kantoor_sections for select to authenticated using (true);
create policy "Kantoor bewerken" on public.kantoor_sections for all    to authenticated using (true) with check (true);

-- ────────────────────────────────────────────────────────────────────────────
-- 11. Realtime publication — laat live updates door
-- ────────────────────────────────────────────────────────────────────────────
-- Schakel realtime in via Supabase UI (Database → Replication → public).
-- Vinkje aan voor: board_items, board_groups, comments, time_entries,
-- active_timers, todo_items, todo_sections, pages, activity, templates,
-- accounts, kantoor_sections, profiles.
