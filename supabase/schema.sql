-- Plak dit in de Supabase SQL Editor van jouw project

create table if not exists public.profiles (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users(id) on delete cascade unique not null,
  member_id       text not null,
  name            text not null,
  color           text not null default '#C8A028',
  photo           text,
  weekly_capacity integer not null default 40,
  created_at      timestamptz default now()
);

-- Alleen de eigen rij lezen/schrijven
alter table public.profiles enable row level security;

create policy "Eigen profiel lezen"
  on public.profiles for select
  using (auth.uid() = user_id);

create policy "Eigen profiel aanmaken"
  on public.profiles for insert
  with check (auth.uid() = user_id);

create policy "Eigen profiel bijwerken"
  on public.profiles for update
  using (auth.uid() = user_id);
