-- 155_hm_joining_followup.sql
-- The hiring manager's "connect with your candidate" reminder (cron: /api/cron/offer-followup).
-- Between the offer and the joining date the MRF's hiring manager(s) are mailed every 4 days,
-- every 2 days once joining is within 6 days. These two columns are the cron's memory of
-- the last reminder, so the cadence is measured from it. Rule: lib/recruitment/joining-followup.ts

alter table public.candidates
  add column if not exists hm_followup_at    timestamptz,
  add column if not exists hm_followup_count integer not null default 0;

comment on column public.candidates.hm_followup_at    is 'When the hiring manager was last reminded to connect with this candidate before joining (cron offer-followup).';
comment on column public.candidates.hm_followup_count is 'How many such reminders have gone out.';

notify pgrst, 'reload schema';
