-- Add vacation_from to profiles so vacations can be a date range. Run after 0005.
alter table public.profiles
  add column if not exists vacation_from date;
