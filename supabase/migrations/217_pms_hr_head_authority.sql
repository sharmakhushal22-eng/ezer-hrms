-- 217_pms_hr_head_authority.sql
-- What the HR Head may do, as configuration rather than as code.
-- SAFE TO RUN TWICE. Adds three policy columns. No data change.
-- ----------------------------------------------------------------------------
-- ── WHY ────────────────────────────────────────────────────────────────────
--
-- Requested: whether the HR Head can finalise a rating, override the HOD's,
-- and the rest of what they are authorised to do, should all be flexible and
-- changeable from admin configuration.
--
-- Some of it already was. who_can_finalise, post_final_owner, publish_scope,
-- hr_head_final_rating and hr_head_id are all policy columns today — scattered
-- across two tabs, which is most of why it did not feel configurable. The new
-- tab gathers them; this migration adds only what was genuinely hardcoded.
--
-- ── WHAT WAS HARDCODED ─────────────────────────────────────────────────────
--
--   Overriding the chain's number. canSettleFinal let the HR Head keep or
--   replace the rating with no way to allow one and not the other, which is
--   exactly the distinction the request drew.
--
--   Building an appraisal outside the chain (212). Always available to an
--   HR Head, with no switch at all.
--
--   Who may commit a rating upload. isHrRole in the API — HR Manager, HR
--   Head and Admin — with no way to narrow it to the HR Head or close it.
--
-- ── WHAT IS DELIBERATELY NOT ADDED ─────────────────────────────────────────
--
-- A second switch for "may the HR Head settle at all". hr_head_final_rating
-- already decides whether a settlement is required before publishing, and a
-- separate "allowed but not required" would be a third state nobody asked
-- for and two columns that can contradict each other. The new tab surfaces
-- the existing one.
--
-- ── DEFAULTS KEEP TODAY'S BEHAVIOUR ────────────────────────────────────────
--
-- All three default to what the code does now, so applying this changes
-- nothing until somebody decides it should. A permissions migration that
-- silently removes a power on deploy is how a cycle stops mid-flight.
--
-- Switching a power off prevents NEW use and nothing else: ratings already
-- settled stay settled, appraisals already built stay built. The audit trail
-- has to keep saying what actually happened.

ALTER TABLE pms_policies
  ADD COLUMN IF NOT EXISTS hr_head_can_override boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS hr_head_can_direct   boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS rating_upload_by     text NOT NULL DEFAULT 'HR_ANY'
    CHECK (rating_upload_by IN ('HR_HEAD','HR_ANY','NOBODY'));

COMMENT ON COLUMN pms_policies.hr_head_can_override IS
  'Whether the HR Head settling a final rating may REPLACE the number the '
  'chain settled, or only keep it. False still lets them settle and attest; '
  'it takes away the override, not the step.';
COMMENT ON COLUMN pms_policies.hr_head_can_direct IS
  'Whether the HR Head may build an appraisal outside the chain (212) for '
  'somebody the cycle never picked up. False hides the form and refuses the '
  'write; appraisals already built that way are untouched.';
COMMENT ON COLUMN pms_policies.rating_upload_by IS
  'Who may commit a bulk or single rating upload. HR_ANY is the behaviour '
  'before 217 — HR Manager, HR Head or Admin. HR_HEAD narrows it to the HR '
  'Head alone. NOBODY closes the route entirely, leaving the chain as the '
  'only way a rating is set.';

NOTIFY pgrst, 'reload schema';
