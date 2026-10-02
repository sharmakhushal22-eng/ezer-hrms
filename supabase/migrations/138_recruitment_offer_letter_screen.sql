-- 138_recruitment_offer_letter_screen.sql
-- ===========================================================================
-- Three rows. Grants only — nothing is removed from any role.
--
--   HR_MANAGER + recruitment.offerletter     the new Offer Letter tab, theirs alone
--   HR_MANAGER + recruitment.offerapproval   so they can see the approval that
--                                            authorised the offer they issue
--   HR_HEAD    + recruitment.negotiation     so they can see the salary break-up
--                                            they are approving
--
-- WHY SO FEW ROWS — READ BEFORE ADDING MORE
--
-- canSeeScreen (lib/rms/resolve.ts) is default-VISIBLE: a role with NO rows for
-- a module sees every tab in it; the first row flips it to "only what is listed".
--
-- 123's comment says HR_HEAD and HR_MANAGER were "intentionally left
-- unconfigured", and an earlier draft of this migration believed it and
-- re-granted all eleven tabs to both. That comment is now stale — both roles
-- were configured after 123 shipped, and checking the live table showed:
--
--   HR_HEAD     5 tabs  dashboard, mrf, offerapproval, hrhead, jobstatus
--   HR_MANAGER  6 tabs  dashboard, mrf, sendoffer, offers, preonboarding, jobstatus
--
-- So the eleven-row version would have handed HR_HEAD six tabs and HR_MANAGER
-- four that they deliberately do not have. Everything already granted stays
-- untouched; these three rows are the only change.
--
-- recruitment.offerletter is seeded before the tab exists. A row for an
-- unknown key is inert (canSeeScreen only ever reads it when the tab renders),
-- whereas registering the key in lib/rms/screens.ts before building the tab
-- would put a dead entry in the Screen Access admin screen. Registry entry and
-- tab ship together, after this.
--
-- enforce_module_access is ON and both roles hold Recruitment (HR_HEAD VIEW,
-- HR_MANAGER FULL), so these restrictions are live, not dormant.
--
-- Idempotent. Safe to run twice.
-- ===========================================================================

insert into public.role_screen_access (role_id, screen_key, can_view)
select r.id, v.screen_key, true
from (values
  -- The Offer Letter screen. HR_MANAGER is already configured for recruitment,
  -- so without this row the tab is invisible to them too.
  ('HR_MANAGER','recruitment.offerletter'),
  -- Step 11 of the flow hands the offer to the HR Manager after the HR Head
  -- approves it. Without this they cannot open the approval that authorised it.
  ('HR_MANAGER','recruitment.offerapproval'),
  -- Step 10 has the HR Head approving the offer, which is a decision about the
  -- negotiated break-up. Without this they approve it without being able to open
  -- the negotiation it came from.
  ('HR_HEAD','recruitment.negotiation')
) as v(role_code, screen_key)
join public.ess_roles r on r.role_code = v.role_code
on conflict (role_id, screen_key) do nothing;

notify pgrst, 'reload schema';
