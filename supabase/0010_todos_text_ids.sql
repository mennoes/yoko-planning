-- Yoko Planner — herschrijf todo_items met text-ids + project_ref.
-- De oorspronkelijke schema had UUID-ids; lokaal genereren we nu strings
-- (Date.now().toString()) en willen we project-referenties bewaren. Drop
-- en recreate; bestaande remote-rows waren nog niet gevuld (todos zaten
-- alleen in localStorage).

drop table if exists public.todo_items;
drop table if exists public.todo_sections;

create table public.todo_sections (
  id         text primary key,            -- member_id voor persoonlijke, slug voor algemene
  title      text not null,
  emoji      text default '📋',
  position   integer default 0,
  created_at timestamptz default now()
);

create table public.todo_items (
  id          text primary key,           -- client-generated (Date.now().toString())
  section_id  text references public.todo_sections(id) on delete cascade,
  text        text not null default '',
  done        boolean default false,
  position    integer default 0,
  project_ref jsonb,                       -- { board, itemId, name } | null
  created_at  timestamptz default now(),
  done_at     timestamptz
);

create index if not exists todo_items_section_idx on public.todo_items(section_id);

alter table public.todo_sections enable row level security;
alter table public.todo_items    enable row level security;

drop policy if exists "Todo sections lezen"    on public.todo_sections;
drop policy if exists "Todo sections bewerken" on public.todo_sections;
create policy "Todo sections lezen"
  on public.todo_sections for select to authenticated using (true);
create policy "Todo sections bewerken"
  on public.todo_sections for all    to authenticated using (true) with check (true);

drop policy if exists "Todo items lezen"    on public.todo_items;
drop policy if exists "Todo items bewerken" on public.todo_items;
create policy "Todo items lezen"
  on public.todo_items for select to authenticated using (true);
create policy "Todo items bewerken"
  on public.todo_items for all    to authenticated using (true) with check (true);

-- Vergeet niet: Database → Publications → supabase_realtime → vinkjes
-- aan voor todo_items en todo_sections voor live cross-browser updates.
