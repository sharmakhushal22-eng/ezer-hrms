-- 131_interview_roles_decisions.sql
-- ===========================================================================
-- INTERVIEW FLOW v2: main interviewer vs panelists, and a decision per round.
--
-- SAFE TO RUN TWICE.
--
--   role            MAIN | PANELIST. Every invitee sees the interview details in
--                   ESS → Tasks & Approvals; only the MAIN interviewer gets the
--                   "Give feedback" button, and only their feedback counts.
--   decision        HOLD | REJECT | SHORTLIST — what the main interviewer chose at
--                   the end of the feedback form. REJECT moves the candidate to
--                   Rejected; HOLD parks them on the new "Hold" pipeline stage;
--                   SHORTLIST clears the round so the hiring manager can add the
--                   next one. After three decided rounds a "Shortlist" button
--                   appears on the candidate popup.
--   decision_remark The remark that Reject / Hold require.
--   interviewer_id  Now nullable: the Telephonic round needs no scheduling — the
--                   recruiter records feedback directly, and a dashboard user may
--                   not be linked to an employee row.
-- ===========================================================================

alter table public.interview_invites
  add column if not exists role            text not null default 'MAIN',
  add column if not exists decision        text,
  add column if not exists decision_remark text;

alter table public.interview_invites alter column interviewer_id drop not null;

do $$ begin
  alter table public.interview_invites drop constraint if exists interview_invites_role_check;
  alter table public.interview_invites add constraint interview_invites_role_check
    check (role in ('MAIN','PANELIST'));
  alter table public.interview_invites drop constraint if exists interview_invites_decision_check;
  alter table public.interview_invites add constraint interview_invites_decision_check
    check (decision is null or decision in ('HOLD','REJECT','SHORTLIST'));
end $$;

create index if not exists idx_interview_invites_round_role on public.interview_invites(candidate_id, round, role);

comment on column public.interview_invites.role     is 'MAIN (gives feedback) or PANELIST (sees details, acknowledges, no feedback).';
comment on column public.interview_invites.decision is 'Main interviewer''s call at the end of feedback: HOLD | REJECT | SHORTLIST.';
