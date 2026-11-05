-- 218_pms_custom_chains.sql
-- Approval chains an administrator composes, instead of three fixed presets.
-- SAFE TO RUN TWICE. One table, one column, two widened CHECKs. No data change.
-- ----------------------------------------------------------------------------
-- ── WHY ────────────────────────────────────────────────────────────────────
--
-- Requested: the chain should be fully customisable and editable — change
-- the KRA and approval chains, build a completely new one, all from the
-- admin side.
--
-- Until now approval_chain was one of three strings: SELF_RM1_RM2_HOD,
-- SELF_RM1_HOD, SELF_RM1. Anything else meant a deploy.
--
-- ── WHAT A RUNG CAN BE, AND WHY NOT ANYTHING ───────────────────────────────
--
-- A rung is only usable if the database can say WHO sits in it for a given
-- employee. That comes from the relationship columns on employees, so the
-- list below is exactly those — measured, not assumed:
--
--   hod_id            401 of 401 employees
--   site_hr_id        397 of 401
--   rm_l1_id, rm_l2_id  in use; RM L2 is deliberately absent for about half
--                       the company, where L1 and L2 resolve to one person
--   regional_head_id  0 of 401 — the column exists and nobody populates it
--
-- REGIONAL_HEAD is offered anyway, and that is safe rather than careless:
-- chain.ts already skips a rung nobody occupies, which is how RM L2 works
-- for 190 of 395 enrolments today. A chain naming it simply steps over it
-- until somebody fills the column. The builder shows the coverage so the
-- choice is made with the number in view.
--
-- ── THE ORDER IS DATA, THE SKIPPING IS NOT ─────────────────────────────────
--
-- rungs[] is the order an administrator chose. Whether a given employee
-- actually has somebody at each rung is answered per appraisal by heldBy(),
-- exactly as it is now. Those are different questions and conflating them
-- is what would strand an appraisal on a rung with nobody on it.
--
-- ── EXISTING APPRAISALS DO NOT MOVE ────────────────────────────────────────
--
-- pms_overall_rating.chain_shape and chain_snapshot_at already freeze the
-- chain per appraisal, so editing a chain applies to appraisals that start
-- afterwards. Nobody mid-review finds a rung has appeared or vanished
-- beneath them. Nothing in this migration touches a frozen row.

CREATE TABLE IF NOT EXISTS pms_chain (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL means the whole group, like the training catalogue.
  company_id  uuid,
  name        text NOT NULL,
  /**
   * THE ORDERED RUNGS. An array rather than a join table: a chain is read
   * whole, every time, and its order IS the data — a join table would need
   * a position column and an ORDER BY to say the same thing less clearly.
   */
  rungs       text[] NOT NULL,
  notes       text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name),

  -- A chain with no rungs is not a chain. Checked here because an empty
  -- array would leave an appraisal with nowhere to go on submission.
  CONSTRAINT pms_chain_has_rungs CHECK (array_length(rungs, 1) >= 1),

  -- Every rung has to be one the application can resolve to a person.
  CONSTRAINT pms_chain_known_rungs CHECK (
    rungs <@ ARRAY['EMPLOYEE','RM_L1','RM_L2','HOD','SITE_HR',
                   'REGIONAL_HEAD','HR']::text[]
  )
);

COMMENT ON TABLE pms_chain IS
  'A named approval chain an administrator composed. Policies point at one, '
  'so a chain is built once and shared. The order in rungs[] is the order '
  'an appraisal travels; who actually occupies each rung is resolved per '
  'employee, and an empty rung is stepped over rather than blocking.';
COMMENT ON COLUMN pms_chain.rungs IS
  'Ordered. Each entry must resolve to a person through a column on '
  'employees: RM_L1 rm_l1_id, RM_L2 rm_l2_id, HOD hod_id, SITE_HR '
  'site_hr_id, REGIONAL_HEAD regional_head_id. EMPLOYEE is the self '
  'rating and HR is the publish step, which is a role rather than a '
  'named person.';

CREATE INDEX IF NOT EXISTS idx_pms_chain_active
  ON pms_chain (is_active) WHERE is_active;

-- ── policies point at one ──────────────────────────────────────────────────
--
-- NULLABLE, and null keeps the old behaviour: approval_chain's three presets
-- still work and still decide, so applying this changes nothing until a
-- chain is built and chosen. A migration that repointed every policy at a
-- new table on deploy would change how the whole company is appraised
-- without anybody asking for it.
ALTER TABLE pms_policies
  ADD COLUMN IF NOT EXISTS chain_id uuid REFERENCES pms_chain(id) ON DELETE SET NULL;

COMMENT ON COLUMN pms_policies.chain_id IS
  'The custom chain this policy uses. NULL falls back to approval_chain, '
  'which is the behaviour before 218.';

-- ── the two CHECKs that would refuse a custom chain ────────────────────────
--
-- Both are widened by exactly the two rungs 218 adds. Dropped by name and
-- recreated so a second run is a no-op; widening can never fail on existing
-- rows, because every value that satisfied the old list satisfies the new.
ALTER TABLE pms_overall_rating
  DROP CONSTRAINT IF EXISTS pms_overall_rating_chain_stage_check;
ALTER TABLE pms_overall_rating
  DROP CONSTRAINT IF EXISTS pms_overall_rating_chain_stage_allowed;
ALTER TABLE pms_overall_rating
  ADD CONSTRAINT pms_overall_rating_chain_stage_allowed
  CHECK (chain_stage IS NULL OR chain_stage IN
    ('EMPLOYEE','RM_L1','RM_L2','HOD','SITE_HR','REGIONAL_HEAD','HR','DONE'));

ALTER TABLE pms_reviews
  DROP CONSTRAINT IF EXISTS pms_reviews_rater_role_allowed;
ALTER TABLE pms_reviews
  ADD CONSTRAINT pms_reviews_rater_role_allowed
  CHECK (rater_role IN ('SELF','RM_L1','RM_L2','HOD','MD','HR_HEAD',
                        'SITE_HR','REGIONAL_HEAD'));

ALTER TABLE pms_chain ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_pms_chain" ON pms_chain;
CREATE POLICY "allow_all_pms_chain" ON pms_chain
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
