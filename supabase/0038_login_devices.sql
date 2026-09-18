-- Bekende browsers per auth-gebruiker voor meldingen bij een nieuwe login.
-- Device-id en IP worden nooit onversleuteld opgeslagen. Alleen de
-- server/service-role gebruikt deze tabel.
create table if not exists public.login_devices (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete cascade not null,
  device_hash   text not null,
  label         text not null default '',
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (user_id, device_hash)
);

create index if not exists login_devices_user_created_idx
  on public.login_devices (user_id, created_at desc);

alter table public.login_devices enable row level security;
