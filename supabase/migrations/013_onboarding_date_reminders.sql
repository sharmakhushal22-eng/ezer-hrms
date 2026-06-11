-- ============================================================
-- 013_onboarding_date_reminders.sql
-- Onboarding date (HR fills in pre-onboarding) + reminder tracking.
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
-- ============================================================
alter table public.candidates
  add column if not exists onboarding_date         date,
  add column if not exists onboarding_tasks_emailed boolean default false,
  add column if not exists last_touch_reminder_at  timestamptz;
