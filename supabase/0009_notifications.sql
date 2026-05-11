-- Yoko Planner — notifications (mentions, toewijzingen, etc.)
-- Plak in Supabase → SQL Editor → New query → Run.

create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id text not null,                                -- member_id van de ontvanger
  actor_id     text,                                          -- member_id van wie het triggerde
  kind         text not null,                                 -- 'mention' | 'assigned' | 'comment'
  context_kind text,                                          -- 'todo' | 'page' | 'board_item'
  context_id   text,
  href         text,                                          -- waar de klik op moet landen
  body         text,                                          -- preview-tekst
  read         boolean default false,
  created_at   timestamptz default now()
);

create index if not exists notifications_recipient_idx
  on public.notifications(recipient_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications(recipient_id) where read = false;

alter table public.notifications enable row level security;

drop policy if exists "Notifications lezen"  on public.notifications;
drop policy if exists "Notifications insert" on public.notifications;
drop policy if exists "Notifications update" on public.notifications;
drop policy if exists "Notifications delete" on public.notifications;

-- Iedereen kan notificaties LEZEN voor henzelf én voor het team —
-- ze zijn niet privé en het scheelt extra koppelingen.
create policy "Notifications lezen"
  on public.notifications for select
  to authenticated using (true);

-- Iedereen mag notificaties AANMAKEN (insert) — gebeurt vanuit
-- comment-flows in de browser zodra een mention wordt geplaatst.
create policy "Notifications insert"
  on public.notifications for insert
  to authenticated with check (true);

-- Update / delete: alleen je eigen meldingen markeren als gelezen of
-- weggooien (gematcht via je profiel.member_id).
create policy "Notifications update"
  on public.notifications for update
  to authenticated using (
    recipient_id in (select member_id from public.profiles where user_id = auth.uid())
  );
create policy "Notifications delete"
  on public.notifications for delete
  to authenticated using (
    recipient_id in (select member_id from public.profiles where user_id = auth.uid())
  );

-- Vergeet niet realtime aan te zetten via Database → Publications →
-- supabase_realtime → vinkje voor 'notifications' (live unread-badge).
