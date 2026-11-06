-- 206_pms_weightage_edit_reopens_the_one_to_one.sql
-- Changing a LOCKED weightage reopens the KRA set for re-agreement.
-- SAFE TO RUN TWICE. Creates one function and one trigger, both replaceable.
-- No data change, no column added, nothing dropped, no UPDATE at load time.
-- ----------------------------------------------------------------------------
-- ── THE DECISION THIS ENCODES ──────────────────────────────────────────────
--
-- Open since the start of this work: may a senior change a weightage after the
-- lock? Answered: yes, and doing so reopens the one-to-one.
--
--   RM L2 / HOD edits a locked weightage
--     -> the SET goes back to DRAFT
--     -> both KRA one-to-one acknowledgements are cleared
--     -> the employee must re-acknowledge before it can lock again
--
-- The alternative readings were "locked means locked, send it back instead"
-- and "a senior may edit freely and the lock stays". The third was rejected
-- for the reason the lock exists at all: the weightage is what the rating is
-- measured against, and a number somebody agreed to must not move without
-- them being asked again.
--
-- ── WHY THE WHOLE SET REOPENS, NOT THE ONE ROW ─────────────────────────────
--
-- Weightages must total exactly the policy's figure (100 here). Changing one
-- necessarily breaks that total until another moves, so a single reopened row
-- inside a locked set is not a state the validator will accept and not a
-- state anybody can act on. The set was agreed as a set; it reopens as one.
--
-- ── WHAT THE DATABASE DECIDES, AND WHAT IT DOES NOT ────────────────────────
--
-- This trigger enforces the CONSEQUENCE, never the permission. It cannot:
-- the row carries no actor, so SQL cannot tell an HOD's edit from an
-- employee's. WHO may edit a locked weightage is decided by the screen; WHAT
-- happens when one is edited is decided here, and cannot be bypassed by any
-- client, including a direct PostgREST call.
--
-- ── WHERE IT REFUSES OUTRIGHT ──────────────────────────────────────────────
--
-- Once the rating is FINALISED the weightage is frozen for good. Reopening
-- then would change what somebody was measured against after they were
-- measured — and if the result is published, after they have read it. There
-- is no re-agreement that repairs that; the cycle has to be reopened by HR
-- instead. 200 and 201 guard the publication end of the same principle.
--
-- ── THE DERIVED SCORES ARE CLEARED, DELIBERATELY ───────────────────────────
--
-- self_score, rm_l1_score, rm_l2_score and hod_score are weighted means OF
-- THE WEIGHTAGES. The moment one weightage moves they are arithmetic about a
-- set that no longer exists. Leaving a stale number on the record is worse
-- than leaving none: it is a specific, wrong figure that reads as current and
-- would be shown on a dashboard beside somebody's name.
--
-- The per-KRA rows in pms_reviews are NOT deleted. Those are evidence of what
-- each rater said, they are keyed per goal rather than per set, and a rater
-- returning after the re-lock overwrites their own row. Deleting somebody's
-- written judgement because a weightage moved would be the destructive
-- reading of a correction.

CREATE OR REPLACE FUNCTION pms_weightage_edit_reopens() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
  v_final  numeric;
  v_why    text;
BEGIN
  -- Only a LOCKED row whose weightage actually moves. A re-lock (status
  -- changing to LOCKED), a title edit, or a weightage rewritten to the same
  -- number are all left alone — IS DISTINCT FROM so NULLs compare sanely.
  IF OLD.status <> 'LOCKED' OR NEW.weightage IS NOT DISTINCT FROM OLD.weightage THEN
    RETURN NEW;
  END IF;

  SELECT workflow_status, final_rating INTO v_status, v_final
    FROM pms_overall_rating
   WHERE employee_id = NEW.employee_id AND period_id = NEW.period_id;

  -- Settled is settled. RAISE's format has to be a literal, so the sentence
  -- is built first — the trap 193 and 194 fell into.
  IF v_final IS NOT NULL
     OR v_status IN ('FINALISED', 'PUBLISHED', 'ACKNOWLEDGED') THEN
    v_why := 'The rating is already settled, so the weightage cannot change. '
          || 'Changing it now would move what this person was measured '
          || 'against after they were measured. Ask HR to reopen the cycle.';
    RAISE EXCEPTION '%', v_why;
  END IF;

  -- Reopen THIS row. The rest of the set follows in the AFTER trigger, which
  -- can touch other rows without recursing into this one.
  NEW.status    := 'DRAFT';
  NEW.locked_at := NULL;
  NEW.locked_by := NULL;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION pms_weightage_edit_reopens() IS
  'BEFORE UPDATE on pms_employee_goals: a changed weightage on a LOCKED row '
  'unlocks that row, and refuses outright once the rating is finalised.';

DROP TRIGGER IF EXISTS trg_pms_weightage_edit_reopens ON pms_employee_goals;
CREATE TRIGGER trg_pms_weightage_edit_reopens
  BEFORE UPDATE ON pms_employee_goals
  FOR EACH ROW EXECUTE FUNCTION pms_weightage_edit_reopens();

-- ── the rest of the set, and the acknowledgements ──────────────────────────

CREATE OR REPLACE FUNCTION pms_weightage_edit_reopens_set() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Same gate as the BEFORE trigger, read off what actually happened: the row
  -- went from LOCKED to DRAFT because its weightage moved.
  IF NOT (OLD.status = 'LOCKED' AND NEW.status = 'DRAFT'
          AND NEW.weightage IS DISTINCT FROM OLD.weightage) THEN
    RETURN NULL;
  END IF;

  -- The whole set. The guard on status keeps this from recursing: the sibling
  -- rows are LOCKED with unchanged weightages, so the BEFORE trigger returns
  -- them untouched, and SENT_BACK rows are left as pms_lock_kras leaves them.
  UPDATE pms_employee_goals
     SET status = 'DRAFT', locked_at = NULL, locked_by = NULL, updated_at = now()
   WHERE employee_id = NEW.employee_id
     AND period_id   = NEW.period_id
     AND id <> NEW.id
     AND status = 'LOCKED';

  -- BOTH SIDES AGREE AGAIN, OR IT DOES NOT RE-LOCK. pms_lock_kras counts a
  -- KRA_SETTING row carrying both acknowledgements, so clearing them is
  -- exactly what forces the conversation to happen a second time. The row
  -- itself is kept: it is the record that the first conversation happened.
  UPDATE pms_one_to_one
     SET employee_ack = false, employee_ack_at = NULL,
         manager_ack  = false, manager_ack_at  = NULL
   WHERE employee_id = NEW.employee_id
     AND period_id   = NEW.period_id
     AND discussion_type = 'KRA_SETTING'
     AND (employee_ack OR manager_ack);

  -- Back to the employee, and the weighted scores go with it. See the header
  -- on why these are cleared rather than left or recomputed.
  UPDATE pms_overall_rating
     SET workflow_status = 'KRA_DRAFT',
         chain_stage     = NULL,
         self_score      = NULL,
         rm_l1_score     = NULL,
         rm_l2_score     = NULL,
         hod_score       = NULL,
         updated_at      = now()
   WHERE employee_id = NEW.employee_id
     AND period_id   = NEW.period_id
     AND workflow_status NOT IN ('FINALISED', 'PUBLISHED', 'ACKNOWLEDGED');

  RETURN NULL;
END $$;

COMMENT ON FUNCTION pms_weightage_edit_reopens_set() IS
  'AFTER UPDATE on pms_employee_goals: when a locked weightage was changed, '
  'unlocks the rest of the set, clears both KRA one-to-one acknowledgements '
  'and sends the appraisal back to the employee.';

DROP TRIGGER IF EXISTS trg_pms_weightage_edit_reopens_set ON pms_employee_goals;
CREATE TRIGGER trg_pms_weightage_edit_reopens_set
  AFTER UPDATE ON pms_employee_goals
  FOR EACH ROW EXECUTE FUNCTION pms_weightage_edit_reopens_set();

NOTIFY pgrst, 'reload schema';
