-- 127_interview_meet_passcode.sql
-- ===========================================================================
-- Meeting passcode alongside the join link on an interview invite.
-- FOR: Nayan Ahuja. ONE NULLABLE COLUMN. SAFE TO RUN TWICE.
-- ===========================================================================

alter table public.interview_invites
  add column if not exists meet_passcode text;

comment on column public.interview_invites.meet_passcode is
  'Optional meeting passcode/password (Zoom/Teams) shown with the join link and sent in the invite email.';
