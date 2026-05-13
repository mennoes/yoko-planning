-- Yoko Planner — feedback / ideeën / bug-meldingen (gedeeld team-breed)
-- Plak in Supabase → SQL Editor → New query → Run.

create table if not exists public.feedback_items (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('bug','idee','feedback')),
  body        text not null,
  author_id   text,
  author_name text,
  upvotes     jsonb default '[]'::jsonb,
  created_at  timestamptz default now()
);

alter table public.feedback_items enable row level security;
drop policy if exists "Feedback lezen"    on public.feedback_items;
drop policy if exists "Feedback bewerken" on public.feedback_items;
create policy "Feedback lezen"    on public.feedback_items for select to authenticated using (true);
create policy "Feedback bewerken" on public.feedback_items for all    to authenticated using (true) with check (true);

-- Realtime aanzetten — DO-blok, idempotent.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname    = 'supabase_realtime'
      and schemaname = 'public'
      and tablename  = 'feedback_items'
  ) then
    alter publication supabase_realtime add table public.feedback_items;
  end if;
end$$;
