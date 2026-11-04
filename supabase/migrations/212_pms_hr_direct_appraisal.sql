-- 212_pms_hr_direct_appraisal.sql
-- The HR Head building an appraisal outside the chain, for the cases the
-- chain never picked up.
-- SAFE TO RUN TWICE. Adds four columns, one guard, and one waiver inside an
-- existing trigger. No data is rewritten.
-- ----------------------------------------------------------------------------
-- ── WHY ────────────────────────────────────────────────────────────────────
--
-- Requested: "HR head can give and set final rating of any employee even if
-- he do not undergo the complete pms chain, hr head can directly set any
-- employee kras rate them and set the final rating and publish them. this is
-- a special case feature."
--
-- ── THE CONTROL THIS DELIBERATELY WAIVES ───────────────────────────────────
--
-- 200 and 207 refuse to publish a result unless a FINAL_REVIEW one-to-one is
-- on record with the manager's acknowledgement. That rule exists because the
-- conversation has to have happened before the rating reaches the employee.
--
-- An appraisal the chain never touched has no manager to have had it. So for
-- these records, and ONLY these, the rule is waived — openly, with the HR
-- Head's name and a required reason on the row, rather than by someone
-- logging a one-to-one that did not take place. A faked conversation record
-- would satisfy every check and be worth less than nothing in the audit this
-- whole module exists to produce. The owner chose the open waiver over both
-- alternatives offered.
--
-- Every other gate still applies. 211's HR Head settlement is not waived —
-- the HR Head is the one acting, so they settle it like any other. The KRA
-- content rules are not waived either: the application runs the same
-- checkKras over a direct appraisal as over one the employee wrote.
--
-- ── NEVER-STARTED ONLY, AND THE DATABASE CHECKS IT ─────────────────────────
--
-- The owner chose this over "anyone at any stage". It means the feature
-- cannot be used to cut short a review that managers are actively working
-- on, which is the way a convenience becomes a way around the chain.
--
-- The guard below refuses the stamp on a row that shows ANY chain activity:
-- a rating already settled, a workflow that has moved, a submitted review,
-- or a KRA set that exists. Checked at the moment of stamping, when the row
-- is still clean — everything the HR Head writes afterwards is theirs.
--
-- ── NOT SHOWN TO THE EMPLOYEE ──────────────────────────────────────────────
--
-- Also the owner's decision. The stamp, the name and the reason are for HR
-- and for audit; the employee reads a normal result. Nothing in this
-- migration puts hr_direct anywhere the employee's own screens read from.

ALTER TABLE pms_overall_rating
  ADD COLUMN IF NOT EXISTS hr_direct        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hr_direct_by     uuid REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS hr_direct_at     timestamptz,
  ADD COLUMN IF NOT EXISTS hr_direct_reason text;

COMMENT ON COLUMN pms_overall_rating.hr_direct IS
  'This appraisal was built by the HR Head outside the chain. It waives the '
  'final-review sign-off rule (200/207) because there is no manager to have '
  'had that conversation, and nothing else. Set only on a row with no chain '
  'activity; see the guard in 212.';
COMMENT ON COLUMN pms_overall_rating.hr_direct_reason IS
  'Why this appraisal was taken outside the chain. Required: it is the only '
  'account of an exception, and the first thing an audit will ask for.';

CREATE INDEX IF NOT EXISTS idx_pms_overall_hr_direct
  ON pms_overall_rating (hr_direct) WHERE hr_direct;

-- ── the guard on the stamp ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pms_guard_hr_direct() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_n int; v_why text;
BEGIN
  -- Only the moment it is switched ON. Turning it off, or any other update
  -- to a row that already carries it, is not this trigger's business.
  IF COALESCE(NEW.hr_direct, false) = false
     OR COALESCE(OLD.hr_direct, false) = true THEN
    RETURN NEW;
  END IF;

  IF NEW.hr_direct_by IS NULL
     OR COALESCE(btrim(NEW.hr_direct_reason), '') = '' THEN
    v_why := 'A direct appraisal has to record who took it outside the '
          || 'chain and why. Both are required.';
    RAISE EXCEPTION '%', v_why;
  END IF;

  -- CHECKED ON THE **OLD** ROW. The same statement that sets the stamp may
  -- also be writing the HR Head's own rating, and judging the new values
  -- would refuse the very thing this exists to allow.
  IF OLD.final_rating IS NOT NULL
     OR COALESCE(OLD.workflow_status, 'NOT_STARTED') <> 'NOT_STARTED' THEN
    v_why := 'This appraisal has already started in the chain, so it cannot '
          || 'be taken outside it. A direct appraisal is only for a cycle '
          || 'that never picked the person up.';
    RAISE EXCEPTION '%', v_why;
  END IF;

  SELECT COUNT(*) INTO v_n FROM pms_reviews
   WHERE employee_id = NEW.employee_id AND period_id = NEW.period_id
     AND submitted;
  IF v_n > 0 THEN
    v_why := 'Somebody in the chain has already submitted a rating for this '
          || 'person. A direct appraisal cannot replace work that is under '
          || 'way.';
    RAISE EXCEPTION '%', v_why;
  END IF;

  SELECT COUNT(*) INTO v_n FROM pms_employee_goals
   WHERE employee_id = NEW.employee_id AND period_id = NEW.period_id;
  IF v_n > 0 THEN
    v_why := 'This person already has KRAs for this period. A direct '
          || 'appraisal starts from nothing; edit the existing set instead.';
    RAISE EXCEPTION '%', v_why;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pms_guard_hr_direct ON pms_overall_rating;
CREATE TRIGGER trg_pms_guard_hr_direct
BEFORE UPDATE ON pms_overall_rating
FOR EACH ROW EXECUTE FUNCTION pms_guard_hr_direct();

-- ── the waiver ─────────────────────────────────────────────────────────────
--
-- 207's function, extracted VERBATIM and patched at one anchor: a single
-- early return for stamped rows, placed after the "not a publish" guard and
-- before the policy is read. Everything else below is byte-for-byte 207, so
-- a diff of the two shows exactly four added lines and nothing else.
CREATE OR REPLACE FUNCTION pms_block_unsigned_publish() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_req boolean; v_n int; v_why text;
BEGIN
  -- Not a publish: nothing to police.
  IF NEW.workflow_status IS NOT DISTINCT FROM OLD.workflow_status
     OR NEW.workflow_status <> 'PUBLISHED'
     OR OLD.workflow_status IN ('PUBLISHED','ACKNOWLEDGED') THEN
    RETURN NEW;
  END IF;

  -- 212: an appraisal built outside the chain has no manager, so there is
  -- nobody who could have acknowledged the final review. Waived here, and
  -- only for rows the guard above allowed to be stamped.
  IF COALESCE(NEW.hr_direct, false) THEN RETURN NEW; END IF;

  SELECT p.final_review_one_to_one INTO v_req
    FROM pms_policies p
    JOIN pms_periods pe ON pe.policy_id = p.id
   WHERE pe.id = NEW.period_id;
  IF NOT COALESCE(v_req, false) THEN RETURN NEW; END IF;

  SELECT COUNT(*) INTO v_n FROM pms_one_to_one
   WHERE employee_id = NEW.employee_id AND period_id = NEW.period_id
     AND discussion_type = 'FINAL_REVIEW' AND manager_ack;

  IF v_n = 0 THEN
    -- RAISE's format must be a string literal, so the sentence is built here.
    v_why := 'This result cannot be published yet: the final review one-to-one '
          || 'is not on record with the manager''s acknowledgement. The '
          || 'conversation has to have happened before the rating reaches '
          || 'them.';
    RAISE EXCEPTION '%', v_why;
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION pms_block_unsigned_publish() IS
  'Publication needs the final-review one-to-one on record with the '
  'manager''s acknowledgement. 207 removed the employee''s. 212 waives the '
  'rule entirely for an appraisal the HR Head built outside the chain, '
  'which has no manager to have had the conversation.';

NOTIFY pgrst, 'reload schema';
