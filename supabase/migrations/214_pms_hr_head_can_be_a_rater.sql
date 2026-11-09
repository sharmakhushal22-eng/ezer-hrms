-- 214_pms_hr_head_can_be_a_rater.sql
-- The HR Head is a rater on a direct appraisal, so the column has to say so.
-- SAFE TO RUN TWICE. Widens one CHECK constraint. No data change.
-- ----------------------------------------------------------------------------
-- ── WHY ────────────────────────────────────────────────────────────────────
--
-- 066 wrote pms_reviews.rater_role as a closed list of the people who rate
-- inside the chain: SELF, RM_L1, RM_L2, HOD, MD. That was complete, because
-- until 212 nobody outside the chain could rate anything.
--
-- On a direct appraisal the HR Head writes the per-KRA ratings themselves.
-- There is no RM and no HOD. The constraint refuses the insert:
--
--   new row for relation "pms_reviews" violates check constraint
--   "pms_reviews_rater_role_check"
--
-- MEASURED, not predicted: found by running the four-step write against the
-- live database after 213 was applied. It failed at step 3, after the stamp
-- and the four KRAs had been written. The partial record was reverted.
--
-- ── WHY NOT JUST FILE IT UNDER 'HOD' ───────────────────────────────────────
--
-- Because it would be a lie, and a durable one. Every report that groups by
-- rater_role, the rating comparison panel, and anybody reading the row in a
-- year's time would be told a Head of Department rated this person when no
-- Head of Department was involved. It is the same objection that ruled out
-- the fake one-to-one in 212 and the fake self rating in 213: satisfying a
-- constraint by misattributing a human act is worse than widening the
-- constraint to admit the act that actually happened.
--
-- ── WHAT THIS DOES NOT CHANGE ──────────────────────────────────────────────
--
-- Nothing reads rater_role expecting the old list to be exhaustive in a way
-- that a new value breaks: the scoring function takes the role as a
-- parameter, and the per-role score columns on pms_overall_rating are
-- populated by matching specific roles, so an HR_HEAD review simply does not
-- land in rm_l1_score or hod_score — which is correct, because it is not one.
--
-- Widening a CHECK can never fail on existing rows: every value that
-- satisfied the old list satisfies the new one.

ALTER TABLE pms_reviews
  DROP CONSTRAINT IF EXISTS pms_reviews_rater_role_check;
ALTER TABLE pms_reviews
  DROP CONSTRAINT IF EXISTS pms_reviews_rater_role_allowed;
ALTER TABLE pms_reviews
  ADD CONSTRAINT pms_reviews_rater_role_allowed
  CHECK (rater_role IN ('SELF','RM_L1','RM_L2','HOD','MD','HR_HEAD'));

COMMENT ON COLUMN pms_reviews.rater_role IS
  'Who gave this rating, in the role they held for this period. HR_HEAD '
  'appears only on a direct appraisal (212), where there is no chain and '
  'the HR Head rates each KRA themselves.';

NOTIFY pgrst, 'reload schema';
