-- 122_interview_invites.sql
-- ===========================================================================
-- ROUND-BY-ROUND INTERVIEW SCHEDULING, ACKNOWLEDGEMENT & FEEDBACK.
--
-- FOR: Nayan Ahuja. ONE NEW TABLE. SAFE TO RUN TWICE.
--
-- The hiring manager schedules each interview round (Telephonic, L1, L2, …) for
-- a candidate: picks one or more interviewers, a date/time and a meeting link,
-- and hits Send. That creates ONE ROW PER INTERVIEWER here, mails the candidate
-- and the interviewers, and drops an Acknowledge task in each interviewer's ESS
-- Tasks & Approvals. The interviewer acknowledges, then fills the 8-parameter
-- feedback form (stored in `feedback`). The hiring manager reads every
-- interviewer's feedback back in the candidate popup, and the pipeline will not
-- let a candidate move past a round until that round has feedback on record.
-- ===========================================================================

create table if not exists public.interview_invites (
  id                   uuid primary key default gen_random_uuid(),
  candidate_id         uuid not null references public.candidates(id) on delete cascade,
  mrf_id               uuid,
  company_id           uuid,
  round                text not null,               -- the pipeline stage: Telephonic | L1 | L2 | Optional Round
  -- who is interviewing
  interviewer_id       uuid not null references public.employees(id) on delete cascade,
  interviewer_emp_code text,
  interviewer_name     text,
  interviewer_email    text,
  -- the schedule (shared across a round's interviewers, denormalised per row)
  scheduled_at         timestamptz,
  meet_link            text,
  scheduled_by         uuid,                         -- employees.id of the hiring manager / HR who scheduled
  scheduled_by_name    text,
  -- candidate snapshot, so the ESS side needn't join back
  candidate_name       text,
  candidate_email      text,
  -- lifecycle: invited -> acknowledged -> submitted
  status               text not null default 'invited',
  acknowledged_at      timestamptz,
  feedback             jsonb,                        -- { params, remarks, overall, recommendation, total, pct, band }
  submitted_at         timestamptz,
  created_at           timestamptz default now()
);

create index if not exists idx_interview_invites_candidate   on public.interview_invites(candidate_id);
create index if not exists idx_interview_invites_interviewer on public.interview_invites(interviewer_id);
create index if not exists idx_interview_invites_round       on public.interview_invites(candidate_id, round);

alter table public.interview_invites enable row level security;
drop policy if exists "allow_all_interview_invites" on public.interview_invites;
create policy "allow_all_interview_invites" on public.interview_invites
  for all to anon, authenticated using (true) with check (true);

comment on table public.interview_invites is
  'One row per interviewer per interview round: the schedule (date/time, meet link), the ESS acknowledgement state, and the 8-parameter feedback. Drives the candidate popup and the round gating in Recruitment.';
