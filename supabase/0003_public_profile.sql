-- Extra publieke velden voor profielen + lookup zonder auth.uid().

alter table public.profiles
  add column if not exists email             text,
  add column if not exists phone             text,
  add column if not exists emergency_contact text,
  add column if not exists emergency_phone   text,
  add column if not exists role              text,        -- functietitel
  add column if not exists office            text,        -- amsterdam / utrecht / remote / ...
  add column if not exists birthday          date,
  add column if not exists pronouns          text,
  add column if not exists languages         text,
  add column if not exists slack_handle      text,
  add column if not exists linkedin          text,
  add column if not exists days_off          text[]   default '{}',  -- 'mon','tue','wed','thu','fri','sat','sun'
  add column if not exists vacation_until    date,
  add column if not exists fun_fact          text,
  add column if not exists bio               text;

-- Eigen rij bewerken (al aanwezig via 'Eigen profiel bijwerken'). We voegen
-- geen nieuwe policy toe — bestaande UPDATE policy werkt op alle kolommen.
