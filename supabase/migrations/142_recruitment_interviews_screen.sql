-- 142_recruitment_interviews_screen.sql
-- ===========================================================================
-- RECRUITMENT -> "Interviews Scheduled" TAB VISIBILITY.
--
-- SAFE TO RUN TWICE.
--
-- Adds one screen_key: recruitment.interviews — the scheduler's list of every
-- interview they have booked, with the joining link, the interviewer, and
-- whether that interviewer has acknowledged or submitted feedback yet.
--
-- WHY A MIGRATION IS REQUIRED FOR A NEW TAB
--
-- canSeeScreen() (lib/rms/resolve.ts) is default-VISIBLE only while a module
-- has NO screen rows for any of the viewer's roles. Migration 123 gave
-- RECRUITER ten explicit recruitment.* rows, which makes the module
-- "configured" for that role — from then on every tab inside it must be
-- granted explicitly. Shipping the tab without this row would hide it from the
-- one role it is built for, silently and with no error.
--
-- WHO IS DELIBERATELY NOT HERE
--
--   · HR Head / HR Manager / super-admin — intentionally left unconfigured by
--     migration 123, so they already see every tab. Adding rows for them would
--     CONFIGURE the module for those roles and start hiding every tab they do
--     not have a row for: a privilege REMOVAL disguised as a grant.
--   · L1_MANAGER / L2_MANAGER / HOD — they raise MRFs, and give their interview
--     feedback in ESS -> Tasks & Approvals, which already lists every interview
--     assigned to them with the join link, Acknowledge and Give feedback
--     (components/ess/RoleTabs.tsx, GET /api/ess/interview). This tab is the
--     SCHEDULER's mirror of that data, not a second copy of it.
--
-- NOTE ON SHAPE. The (role_code, screen_key) tuple form below matches migration
-- 123 on purpose: lib/rms/__tests__/recruitment-authority.test.ts parses BOTH
-- files with one regex, /\('([A-Z0-9_]+)','recruitment\.([a-z]+)'\)/, to check
-- the page, the catalogue and the seed cannot drift apart. A `where role_code =`
-- form would not match it, and the tab would read as unseeded.
-- ===========================================================================

insert into public.role_screen_access (role_id, screen_key, can_view)
select r.id, v.screen_key, true
from (values
  -- Hiring Manager / Recruiter: the scheduler's own view of what they booked.
  ('RECRUITER','recruitment.interviews')
) as v(role_code, screen_key)
join public.ess_roles r on r.role_code = v.role_code
on conflict (role_id, screen_key) do nothing;
