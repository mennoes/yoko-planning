create table if not exists public.ideas (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  body text not null default '',
  category text not null default 'inspiratie'
    check (category in ('inspiratie', 'tussendoor', 'experiment', 'verbetering')),
  color text not null default '#fff0a8',
  status text not null default 'open'
    check (status in ('open', 'doing', 'done')),
  author_id text,
  author_name text,
  claimed_by text,
  claimed_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ideas enable row level security;

grant select on public.ideas to anon;
grant select, insert, update, delete on public.ideas to authenticated;
grant select, insert, update, delete on public.ideas to service_role;

create policy "ideas_select_authenticated"
  on public.ideas for select to authenticated using (true);
create policy "ideas_insert_authenticated"
  on public.ideas for insert to authenticated with check (true);
create policy "ideas_update_authenticated"
  on public.ideas for update to authenticated using (true) with check (true);
create policy "ideas_delete_authenticated"
  on public.ideas for delete to authenticated using (true);

alter publication supabase_realtime add table public.ideas;
