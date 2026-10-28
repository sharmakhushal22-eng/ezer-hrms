-- 190_pms_workflow_status_advances.sql — the status column stops lying, so
-- HR's fill-status roll-up stops reading NOT_STARTED for everybody.
-- SAFE TO RUN TWICE. Adds two functions and one trigger, replaces one
-- function, and backfills workflow_status. No schema change, no column added
-- or dropped, no constraint altered.
-- ----------------------------------------------------------------------------
-- ── THE DEFECT ─────────────────────────────────────────────────────────────
--
-- pms_overall_rating.workflow_status has a ten-value CHECK:
--
--   NOT_STARTED, KRA_DRAFT, KRA_LOCKED, SELF_DRAFT, SELF_SUBMITTED,
--   RM_L1_DONE, RM_L2_DONE, FINALISED, PUBLISHED, ACKNOWLEDGED
--
-- Exactly two of them were ever written. pms_lock_kras sets KRA_LOCKED (066
-- line 614) and pms_finalise sets FINALISED (066 line 705). Nothing anywhere
-- — no trigger, no function, no migration, no client — ever wrote KRA_DRAFT,
-- SELF_DRAFT, SELF_SUBMITTED, RM_L1_DONE or RM_L2_DONE.
--
-- vw_pms_fill_status then keys five of its six branches on those five values:
--
--   WHEN o.workflow_status IN ('KRA_DRAFT','SELF_DRAFT')   THEN 'DRAFT_SAVED'
--   WHEN o.workflow_status = 'SELF_SUBMITTED'              THEN 'SUBMITTED'
--   WHEN o.workflow_status IN ('RM_L1_DONE','RM_L2_DONE')  THEN 'IN_REVIEW'
--
-- None can match, and KRA_LOCKED matches no branch at all, so a locked row
-- falls through to ELSE 'NOT_STARTED'. DRAFT_SAVED, SUBMITTED and IN_REVIEW
-- are not rare in this view; they are unreachable.
--
-- OBSERVED on the live database on 28-Oct-2026: Ishaan Shah (SRS9006) read
-- fill_status NOT_STARTED while carrying four LOCKED KRAs at 100%, a
-- submitted self rating, an RM L1 rating AND an RM L2 rating. There is no
-- state he could have been in that the view would have reported correctly
-- short of finalisation.
--
-- BE PRECISE ABOUT THE BLAST RADIUS, because the raw numbers flatter the bug.
-- The same query returned NOT_STARTED 394, FINALISED 1 across all 395 rows —
-- but only 2 of those rows have a single KRA written against them at all, so
-- 393 of the 394 are reading NOT_STARTED entirely correctly: nobody has
-- started. This migration's backfill therefore changes NO rows today, and
-- saying otherwise would be inventing a repair.
--
-- The defect is structural rather than a count of bad rows: DRAFT_SAVED,
-- SUBMITTED and IN_REVIEW cannot be produced for ANY employee, ever, by any
-- code path. §6's fill-status tracking — the screen an HR admin uses to chase
-- a cycle — can only ever say "not started" or "finalised". It bites the
-- moment a real cycle has people partway through it, which is exactly when
-- somebody would rely on it, and the only reason it has not bitten yet is
-- that this database has never had more than two employees in flight.
--
-- The ESS screens survived this because they test the score columns rather
-- than the status, which is defensive code that was quietly masking the
-- defect rather than depending on it.
--
-- ── WHY DERIVED AND NOT INCREMENTED ────────────────────────────────────────
--
-- The status is recomputed from the state, not nudged one rung forward per
-- event. 076 chose the same shape for the scores and said why: "A retracted
-- rating has to move the score back down, not leave the old one standing."
-- A deleted review moves the score back to null, so the status must be free
-- to come back down with it, or the two disagree. Deriving also makes this
-- self-healing: the backfill at the end is the same expression as the
-- trigger, so a row repaired by hand converges instead of drifting.
--
-- ── WHAT IT WILL NOT DO ────────────────────────────────────────────────────
--
-- FINALISED, PUBLISHED and ACKNOWLEDGED are terminal here and are returned
-- unchanged. Without that, an RM re-submitting a review after publication
-- would knock the status back to RM_L2_DONE — which, because the employee's
-- result screen reads `reached(status, 'PUBLISHED')`, would UN-PUBLISH a
-- result somebody had already been shown. The client now refuses that
-- re-submission, but the guard belongs here too: the rule must not depend on
-- which client is writing.
--
-- SELF_DRAFT stays unwritten, deliberately. It means "started rating, nothing
-- submitted", and the module has no draft-save for self ratings — the screen
-- submits. Writing it would be inventing a state the product does not have.
-- KRA_DRAFT, by contrast, is real: KRAs exist and are not yet locked.

-- ── the derivation, in one place ───────────────────────────────────────────
/**
 * The status this row's own data implies.
 *
 * hod_score lands on RM_L2_DONE because the ladder has no HOD_DONE rung and
 * a per-goal HOD score is still pre-finalise. Both map to IN_REVIEW in
 * vw_pms_fill_status, so the roll-up reads correctly either way; naming the
 * nearer rung keeps it from claiming the chain got further than it did.
 */
CREATE OR REPLACE FUNCTION pms_workflow_derived(
  p_status text, p_self numeric, p_l1 numeric, p_l2 numeric, p_hod numeric,
  p_has_goals boolean, p_locked boolean)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    -- Settled is settled. See "WHAT IT WILL NOT DO" above.
    WHEN p_status IN ('FINALISED','PUBLISHED','ACKNOWLEDGED') THEN p_status
    WHEN p_l2 IS NOT NULL OR p_hod IS NOT NULL THEN 'RM_L2_DONE'
    WHEN p_l1 IS NOT NULL                      THEN 'RM_L1_DONE'
    WHEN p_self IS NOT NULL                    THEN 'SELF_SUBMITTED'
    -- Locked beats drafted, and must never be walked back to it: the lock is
    -- the promise that the weightages cannot change any more.
    WHEN p_locked OR p_status = 'KRA_LOCKED'   THEN 'KRA_LOCKED'
    WHEN p_has_goals                           THEN 'KRA_DRAFT'
    ELSE 'NOT_STARTED'
  END;
$$;

/**
 * Recompute one row's status. Called by both triggers below so a goal change
 * and a review change cannot reach different conclusions.
 *
 * SKIPS READ-ONLY ROWS, and that guard is load-bearing beyond this migration.
 * trg_pms_readonly is BEFORE UPDATE on pms_overall_rating and 188 made
 * is_readonly actually reachable (EXITED and finalised). 076's score sync
 * updates that same table on every single review write, so from 188 onward a
 * review written against an exited, finalised employee RAISES and the write
 * fails. No such row exists in the database yet, so this is reasoned from the
 * trigger definitions rather than observed — but it is why both the score
 * update and this one now exclude locked rows instead of discovering the lock
 * by crashing into it.
 */
CREATE OR REPLACE FUNCTION pms_refresh_workflow(p_employee_id uuid, p_period_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_status text; v_self numeric; v_l1 numeric; v_l2 numeric; v_hod numeric;
        v_ro boolean; v_goals boolean; v_locked boolean; v_new text;
BEGIN
  SELECT workflow_status, self_score, rm_l1_score, rm_l2_score, hod_score, is_readonly
    INTO v_status, v_self, v_l1, v_l2, v_hod, v_ro
    FROM pms_overall_rating
   WHERE employee_id = p_employee_id AND period_id = p_period_id;
  IF NOT FOUND OR v_ro THEN RETURN; END IF;

  SELECT EXISTS (SELECT 1 FROM pms_employee_goals
                  WHERE employee_id = p_employee_id AND period_id = p_period_id),
         EXISTS (SELECT 1 FROM pms_employee_goals
                  WHERE employee_id = p_employee_id AND period_id = p_period_id
                    AND status = 'LOCKED')
    INTO v_goals, v_locked;

  v_new := pms_workflow_derived(v_status, v_self, v_l1, v_l2, v_hod, v_goals, v_locked);

  -- Only when it actually moves: an unconditional UPDATE would bump
  -- updated_at on every review write and make last_action_at meaningless.
  IF v_new IS DISTINCT FROM v_status THEN
    UPDATE pms_overall_rating
       SET workflow_status = v_new, updated_at = now()
     WHERE employee_id = p_employee_id AND period_id = p_period_id;
  END IF;
END $$;


-- ── 076's trigger, extended ────────────────────────────────────────────────
-- Body is 076's verbatim, with two changes, both marked 190 below: the score
-- UPDATE now skips read-only rows, and the status is refreshed afterwards.
CREATE OR REPLACE FUNCTION pms_sync_role_score() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_emp    uuid;
  v_period uuid;
  v_role   text;
  v_score  numeric;
BEGIN
  -- On DELETE the row is gone from NEW, so read whichever side exists. A
  -- retracted rating has to move the score back down, not leave the old one
  -- standing.
  IF TG_OP = 'DELETE' THEN
    v_emp := OLD.employee_id; v_period := OLD.period_id; v_role := OLD.rater_role;
  ELSE
    v_emp := NEW.employee_id; v_period := NEW.period_id; v_role := NEW.rater_role;
  END IF;

  -- pms_score already applies the documented formula,
  -- SUM(rating * weightage) / SUM(weightage), over submitted reviews only.
  -- Calling it rather than restating it keeps one definition of the score.
  --
  -- It returns 0 both when nobody has rated and when everybody rated zero.
  -- NULLIF cannot tell those apart, and pms_reviews.rating is numeric(4,2)
  -- with NO check constraint, so a 0 rating is insertable even though the
  -- rating scale starts at 1. Ask whether a submitted review exists instead:
  -- null then means "not rated", which is what the UI is testing for.
  IF pms_has_reviews(v_emp, v_period, v_role) THEN
    SELECT pms_score(v_emp, v_period, v_role) INTO v_score;
  ELSE
    v_score := NULL;
  END IF;
  UPDATE pms_overall_rating
     SET self_score  = CASE WHEN v_role = 'SELF'  THEN v_score ELSE self_score  END,
         rm_l1_score = CASE WHEN v_role = 'RM_L1' THEN v_score ELSE rm_l1_score END,
         rm_l2_score = CASE WHEN v_role = 'RM_L2' THEN v_score ELSE rm_l2_score END,
         hod_score   = CASE WHEN v_role = 'HOD'   THEN v_score ELSE hod_score   END,
         updated_at  = now()
   WHERE employee_id = v_emp AND period_id = v_period
     AND NOT is_readonly;   -- 190: see pms_refresh_workflow's note

  PERFORM pms_refresh_workflow(v_emp, v_period);   -- 190

  RETURN NULL;   -- AFTER trigger; the return value is not used
END $$;

DROP TRIGGER IF EXISTS trg_pms_sync_role_score ON pms_reviews;
CREATE TRIGGER trg_pms_sync_role_score
AFTER INSERT OR UPDATE OR DELETE ON pms_reviews
FOR EACH ROW EXECUTE FUNCTION pms_sync_role_score();


-- ── and the same question when the KRAs change ─────────────────────────────
-- Needed for KRA_DRAFT, which no review can produce: the status has to move
-- off NOT_STARTED when the first KRA appears, before anybody has rated.
CREATE OR REPLACE FUNCTION pms_sync_goal_workflow() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM pms_refresh_workflow(OLD.employee_id, OLD.period_id);
  ELSE
    PERFORM pms_refresh_workflow(NEW.employee_id, NEW.period_id);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_pms_sync_goal_workflow ON pms_employee_goals;
CREATE TRIGGER trg_pms_sync_goal_workflow
AFTER INSERT OR UPDATE OR DELETE ON pms_employee_goals
FOR EACH ROW EXECUTE FUNCTION pms_sync_goal_workflow();


-- ── backfill ───────────────────────────────────────────────────────────────
-- Every row that predates this migration, using the same expression the
-- trigger uses. Read-only rows are left alone, and the terminal states are
-- returned unchanged by pms_workflow_derived, so finalised, published and
-- acknowledged records cannot be disturbed.
UPDATE pms_overall_rating o
   SET workflow_status = d.derived,
       updated_at      = now()
  FROM (
    SELECT o2.employee_id, o2.period_id,
           pms_workflow_derived(
             o2.workflow_status, o2.self_score, o2.rm_l1_score, o2.rm_l2_score,
             o2.hod_score,
             EXISTS (SELECT 1 FROM pms_employee_goals g
                      WHERE g.employee_id = o2.employee_id
                        AND g.period_id = o2.period_id),
             EXISTS (SELECT 1 FROM pms_employee_goals g
                      WHERE g.employee_id = o2.employee_id
                        AND g.period_id = o2.period_id
                        AND g.status = 'LOCKED')
           ) AS derived
      FROM pms_overall_rating o2
     WHERE NOT o2.is_readonly
  ) d
 WHERE o.employee_id = d.employee_id
   AND o.period_id   = d.period_id
   AND o.workflow_status IS DISTINCT FROM d.derived;

NOTIFY pgrst, 'reload schema';
