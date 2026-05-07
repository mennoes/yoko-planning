-- Google Calendar integratie. Run na 0004.

-- Per user: 1 of meer Google Calendar koppelingen.
-- refresh_token blijft TEXT — RLS zorgt dat alleen de owner zijn eigen tokens
-- ziet. Bij paranoia: encrypt at rest via pgcrypto, kan later.

create table if not exists public.google_calendars (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  calendar_id     text not null,                -- 'primary' of specifieke kalender id
  calendar_name   text,
  board_id        text references public.boards(id) on delete set null,
  refresh_token   text not null,
  access_token    text,
  expires_at      timestamptz,
  last_sync_at    timestamptz,
  created_at      timestamptz default now(),
  unique(user_id, calendar_id)
);
alter table public.google_calendars enable row level security;
drop policy if exists "Eigen calendar lezen"   on public.google_calendars;
drop policy if exists "Eigen calendar bewerken" on public.google_calendars;
create policy "Eigen calendar lezen"   on public.google_calendars for select to authenticated using (auth.uid() = user_id);
create policy "Eigen calendar bewerken" on public.google_calendars for all    to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Items kunnen nu uit een externe bron komen (Google Calendar).
alter table public.board_items
  add column if not exists source              text default 'manual',
  add column if not exists external_id         text,
  add column if not exists external_link       text,
  add column if not exists external_synced_at  timestamptz,
  add column if not exists external_user_id    uuid references auth.users(id) on delete set null;

create index if not exists board_items_external_idx on public.board_items(external_id);
