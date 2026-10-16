-- 143_candidate_rejection_reason.sql
-- ===========================================================================
-- WHY A CANDIDATE WAS REJECTED.
--
-- SAFE TO RUN TWICE.
--
-- Rejecting a candidate wrote one column — stage = 'Rejected' — and recorded
-- nothing about why. The hiring manager's Reject button now requires a reason
-- AND a remark, so there has to be somewhere to put them.
--
-- WHY NOT blacklist_reason
--
-- candidates.blacklist_reason already exists (migration 007) and is the obvious
-- shortcut. It means something else: the backout path sets blacklisted = true
-- ALONGSIDE it (page.tsx markBackout), so reusing it would make every rejected
-- candidate read as blacklisted — barred from future requisitions rather than
-- simply not taken forward for this one. Those are different facts about a
-- person and they are kept apart.
--
-- WHY NO CHECK CONSTRAINT ON rejection_reason
--
-- The reason list is fixed in lib/recruitment/rejection.ts and validated at the
-- single server write (/api/recruitment/interview-invite, action 'reject'). A
-- CHECK here would add a second authority that has to be migrated in lockstep
-- with the TypeScript list, and a drift between them fails as a 500 on a write
-- the user cannot fix. candidates.stage is free text for the same reason
-- (migration 018 says so outright).
--
-- rejected_by is NULLABLE on purpose: the legacy shared dashboard login has no
-- employees row, so a rejection made from it has an audit row but no employee
-- id. Recording the rejection matters more than attributing it.
-- ===========================================================================

alter table public.candidates
  add column if not exists rejection_reason text,
  add column if not exists rejection_remark text,
  add column if not exists rejected_at      timestamptz,
  add column if not exists rejected_by      uuid references public.employees(id);

comment on column public.candidates.rejection_reason is
  'Stable code from REJECTION_REASONS in lib/recruitment/rejection.ts (SKILLS, ROUND, …). Reports group on this, so codes are never renamed — only added.';
comment on column public.candidates.rejection_remark is
  'The mandatory free-text remark that accompanies the reason. Trimmed; never an empty string.';
comment on column public.candidates.rejected_by is
  'employees.id of whoever rejected. Null for the legacy dashboard login, which has no employee row.';

-- Reading back "why did we reject these candidates" is the whole point of the
-- columns, and that query filters on stage and groups by reason.
create index if not exists idx_candidates_rejection
  on public.candidates (stage, rejection_reason)
  where rejection_reason is not null;
