-- Yoko Planner — comments cross-browser syncen.
-- De huidige public.comments tabel uit 0002_collab.sql gebruikt uuid-ids
-- en heeft een strikte context_kind constraint (alleen 'page' / 'board_item').
-- Lokale comments gebruiken client-generated string-ids (c-xxx-yyy) en
-- ook 'todo'-contexts. We droppen en hermaken text-id versie.

drop table if exists public.comments;

create table public.comments (
  id           text primary key,                              -- client-generated, c-xxx-yyy
  context_kind text not null,                                  -- 'todo' | 'page' | 'board_item'
  context_id   text not null,                                  -- raw id of the context
  quote        text not null default '',
  thread       jsonb not null default '[]'::jsonb,
  resolved     boolean default false,
  author_id    uuid references auth.users(id) on delete set null,
  created_at   timestamptz default now()
);

create index if not exists comments_context_idx on public.comments(context_kind, context_id);

alter table public.comments enable row level security;
drop policy if exists "Comments lezen"        on public.comments;
drop policy if exists "Comments toevoegen"    on public.comments;
drop policy if exists "Comments bijwerken"    on public.comments;
drop policy if exists "Comments verwijderen"  on public.comments;
create policy "Comments lezen"
  on public.comments for select to authenticated using (true);
create policy "Comments toevoegen"
  on public.comments for insert to authenticated with check (true);
create policy "Comments bijwerken"
  on public.comments for update to authenticated using (true);
create policy "Comments verwijderen"
  on public.comments for delete to authenticated using (true);

-- Zet 'comments' aan in Database → Publications → supabase_realtime
-- voor live cross-browser updates.
