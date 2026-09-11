-- =====================================================================
-- EZER HRMS — 076: persist the per-role scores onto pms_overall_rating
--
-- Found by running the appraisal flow end to end against the open Q2 cycle
-- on 31-Aug-2026. Everything in the workflow behaved correctly — validation,
-- both one-to-one gates, the self-before-manager guard, HOD_ONLY finalise,
-- and pms_score()'s arithmetic. What is missing sits between them.
--
-- ── THE DEFECT ─────────────────────────────────────────────────────────
-- pms_overall_rating declares self_score, rm_l1_score, rm_l2_score and
-- hod_score, and self_vs_final_gap is GENERATED from self_score. But
-- NOTHING EVER WRITES ANY OF THEM. Not 066, not 067, not the application.
-- pms_score() computes a score on demand and returns it to the caller; the
-- caller has nowhere it is expected to put it, so it is discarded.
--
-- That is not cosmetic. components/ess/Performance.tsx gates the manager's
-- rating form on the column:
--
--     const canRate = Boolean(myRole) && r.self_score != null
--                     && (myRole === 'RM_L1' || r.rm_l1_score != null)
--
-- With self_score permanently null, canRate is permanently false. Every row
-- in a manager's team queue renders the label "awaiting self rating" no
-- matter how many self ratings have actually been submitted, and the rating
-- form cannot be opened at all. The same column drives the employee's "My
-- Result" screen, which stays blank for the same reason.
--
-- Verified end to end: four KRAs, self ratings submitted, pms_score('SELF')
-- returned 4.10 correctly — and pms_overall_rating.self_score was still null.
--
-- ── THE FIX ────────────────────────────────────────────────────────────
-- A trigger on pms_reviews. Whenever a review is submitted, the score for
-- that rater's role is recomputed and written to its column.
--
-- A trigger rather than application code, deliberately: reviews are written
-- from the ESS screen today, and will be written by the bulk rating upload
-- (pms_rating_upload_log exists for it) and by HR correction tomorrow. A
-- rule that lives in one client is a rule the other clients break.
--
-- No schema change. No existing row changes meaning. The backfill at the end
-- fixes rows whose reviews were submitted before this ran.
-- =====================================================================


/** Has anyone submitted a review in this role? Kept separate so the trigger
 *  and the backfill answer the question the same way. */
CREATE OR REPLACE FUNCTION pms_has_reviews(p_employee_id uuid, p_period_id uuid, p_role text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM pms_reviews
     WHERE employee_id = p_employee_id AND period_id = p_period_id
       AND rater_role = p_role AND submitted = true
  );
$$;

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
   WHERE employee_id = v_emp AND period_id = v_period;

  RETURN NULL;   -- AFTER trigger; the return value is not used
END $$;

DROP TRIGGER IF EXISTS trg_pms_sync_role_score ON pms_reviews;
CREATE TRIGGER trg_pms_sync_role_score
AFTER INSERT OR UPDATE OR DELETE ON pms_reviews
FOR EACH ROW EXECUTE FUNCTION pms_sync_role_score();


-- ── Backfill ───────────────────────────────────────────────────────────
-- Any appraisal whose reviews were submitted before this trigger existed
-- has the same blank columns. Recompute from what is already there.
--
-- Scoped to rows that actually have submitted reviews, so this touches
-- nothing else and is safe to re-run.
UPDATE pms_overall_rating o
   SET self_score  = CASE WHEN pms_has_reviews(o.employee_id, o.period_id, 'SELF')
                          THEN pms_score(o.employee_id, o.period_id, 'SELF')  END,
       rm_l1_score = CASE WHEN pms_has_reviews(o.employee_id, o.period_id, 'RM_L1')
                          THEN pms_score(o.employee_id, o.period_id, 'RM_L1') END,
       rm_l2_score = CASE WHEN pms_has_reviews(o.employee_id, o.period_id, 'RM_L2')
                          THEN pms_score(o.employee_id, o.period_id, 'RM_L2') END,
       hod_score   = CASE WHEN pms_has_reviews(o.employee_id, o.period_id, 'HOD')
                          THEN pms_score(o.employee_id, o.period_id, 'HOD')   END,
       updated_at  = now()
 WHERE EXISTS (
   SELECT 1 FROM pms_reviews r
    WHERE r.employee_id = o.employee_id
      AND r.period_id   = o.period_id
      AND r.submitted   = true
 );


-- ── What this does NOT do ──────────────────────────────────────────────
-- final_score is left alone. It is the number HR publishes, and on this
-- schema it can come from a manual upload or an HR override as well as from
-- the workflow — rating_source records which. Deriving it here would quietly
-- overwrite a deliberate override, so it stays where it is, set by
-- pms_finalise and by the upload path.
-- =====================================================================
