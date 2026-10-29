-- 199_pms_no_jumping_the_chain.sql — nobody finalises, and no final review is
-- logged, until everyone before them in the chain has finished.
-- SAFE TO RUN TWICE. Adds one function, replaces one function, adds one
-- trigger. No schema change, no data change, no column or constraint altered.
-- ----------------------------------------------------------------------------
-- ── THE HOLE ───────────────────────────────────────────────────────────────
--
-- pms_finalise checks the policy, the actor's role, the actor's identity
-- against the frozen chain, and the final-review one-to-one. It checks
-- NOTHING about whether the ratings that are supposed to come first exist.
--
-- So a HOD could settle a rating with no self rating, no locked weightages, no
-- RM L1 score and no RM L2 score. Every number the appraisal is supposed to be
-- built from could be missing and the final rating would still be written.
--
-- MEASURED on the live database, not reasoned: of 390 unfinalised appraisals
-- that have a HOD,
--
--     389  have no self rating
--     390  have no acknowledged KRA one-to-one
--     390  have unlocked weightages
--     390  have no RM L1 score
--     201  have an RM L2 in the chain who has not scored
--       0  are genuinely ready
--
-- all 390 were exposed to a premature finalise.
--
-- WORSE, 198 WIDENED IT. The final-review one-to-one was the only thing
-- standing in the way, and until 198 only the employee could create that row —
-- which made the hole hard to reach by accident. 198 gave the HOD a "Log final
-- review" button, for good reasons, and in doing so turned a two-step accident
-- into a one-step one: log the review, have it acknowledged, finalise. The fix
-- for one gap opened another, which is exactly why this one is enforced in the
-- database rather than in the screen that happens to be in front of somebody.
--
-- lib/pms/team.ts has long refused to OFFER a finalise button while RM L2 is
-- pending (rule 7). That is a screen declining to show a control; it is not a
-- rule. The database never asked.
--
-- ── WHAT "PRECEDING" MEANS, AND WHY IT IS PER ACTOR ────────────────────────
--
-- Not "all rungs" — the rungs BEFORE THE ACTOR'S OWN, computed from the
-- policy's chain. A HOD waits for RM L1 and RM L2. An RM L2 finalising under
-- an RM2_HOD policy waits for RM L1 only. An RM L1 finalising under
-- RM1_RM2_HOD waits for nobody but the employee. Requiring every rung
-- regardless of who is acting would deadlock the shorter chains §6.1 runs.
--
-- AND ONLY RUNGS SOMEBODY OCCUPIES. pms_resolve_chain drops RM L2 when it
-- resolves to the same person as RM L1, so 190 of 395 enrolments have a chain
-- naming RM L2 and a snapshot with rm_l2_id NULL. Demanding a score from an
-- empty rung would block half the company for ever — the same deadlock 197
-- shipped and had to fix, and the reason this checks holders and not names.
--
-- ── WHY HR IS EXEMPT ───────────────────────────────────────────────────────
--
-- HR_MANAGER / HR_HEAD / ADMIN skip this, as they skip 188's identity checks.
-- HR Admin runs the cycle and is the escalation path for a stuck record, and
-- pms_commit_rating_upload (192) finalises AS HR for every row of an offline
-- calibration — a calibration whose whole purpose is to override what the
-- chain produced. Blocking HR here would break bulk upload outright and leave
-- no way to rescue a genuinely stuck appraisal. Their finalise still records
-- their own role, so an HR override stays distinguishable from a line sign-off.

/**
 * Why this actor may not settle this appraisal yet, or NULL if they may.
 *
 * Returns a SENTENCE, not a boolean, because every caller needs to say what
 * is outstanding — a refusal that only says "not yet" sends somebody hunting
 * through four screens.
 *
 * STABLE and read-only: it is called from a trigger, and 066 learned the hard
 * way that a STABLE function cannot create temp tables.
 */
CREATE OR REPLACE FUNCTION pms_chain_ready_before(
  p_employee_id uuid, p_period_id uuid, p_rung text)
RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE
  pol pms_policies%ROWTYPE;
  o pms_overall_rating%ROWTYPE;
  v_rungs text[]; v_idx int; v_upto int; v_i int; v_rung text;
  v_holder uuid; v_score numeric; v_121 int; v_locked int;
BEGIN
  -- HR and Admin are the escalation path — see the header.
  IF p_rung IS NULL OR p_rung IN ('HR_MANAGER','HR_HEAD','ADMIN','HR') THEN
    RETURN NULL;
  END IF;

  SELECT p.* INTO pol FROM pms_policies p
    JOIN pms_periods pe ON pe.policy_id = p.id WHERE pe.id = p_period_id;
  IF NOT FOUND THEN
    RETURN 'this period has no policy, so there are no rules to check against';
  END IF;

  SELECT * INTO o FROM pms_overall_rating
   WHERE employee_id = p_employee_id AND period_id = p_period_id;
  IF NOT FOUND THEN
    RETURN 'they are not enrolled in this period';
  END IF;

  -- 1. THE EMPLOYEE'S OWN RATING. First because it is first in the cycle, and
  -- because team.ts reports the blockers in this order — the screen and the
  -- database must name the same cause for the same stuck row.
  IF pol.self_rating_mandatory AND o.self_score IS NULL THEN
    RETURN 'their self rating is not in yet';
  END IF;

  -- 2. THE KRA ONE-TO-ONE. The conversation that settles the weightages.
  IF pol.one_to_one_mandatory THEN
    SELECT COUNT(*) INTO v_121 FROM pms_one_to_one
     WHERE employee_id = p_employee_id AND period_id = p_period_id
       AND discussion_type = 'KRA_SETTING' AND employee_ack AND manager_ack;
    IF v_121 = 0 THEN
      RETURN 'the KRA one-to-one has not been acknowledged by both of them';
    END IF;
  END IF;

  -- 3. THE WEIGHTAGES. A rating computed against weightages that can still
  -- move is a rating of nothing.
  SELECT COUNT(*) INTO v_locked FROM pms_employee_goals
   WHERE employee_id = p_employee_id AND period_id = p_period_id
     AND status = 'LOCKED';
  IF v_locked = 0 THEN
    RETURN 'their weightages are not locked yet';
  END IF;

  -- 4. EVERY RUNG BEFORE THIS ONE THAT SOMEBODY OCCUPIES.
  v_rungs := pms_chain_rungs(pol.approval_chain);
  v_idx := array_position(v_rungs, p_rung);
  -- An actor whose rung is not in this policy's chain — a HOD finalising under
  -- a Self → RM L1 policy, which who_can_finalise permits — waits for every
  -- held rung. The strict reading, because there is no position to measure
  -- "before" against and letting them through would skip the whole line.
  v_upto := COALESCE(v_idx - 1, array_length(v_rungs, 1));

  v_i := 1;
  WHILE v_i <= COALESCE(v_upto, 0) LOOP
    v_rung := v_rungs[v_i];
    IF v_rung <> 'HR' THEN
      v_holder := CASE v_rung
                    WHEN 'RM_L1' THEN o.rm_l1_id
                    WHEN 'RM_L2' THEN o.rm_l2_id
                    WHEN 'HOD'   THEN o.hod_id
                  END;
      v_score  := CASE v_rung
                    WHEN 'RM_L1' THEN o.rm_l1_score
                    WHEN 'RM_L2' THEN o.rm_l2_score
                    WHEN 'HOD'   THEN o.hod_score
                  END;
      -- An EMPTY rung is skipped, not waited for. See the header: 190 of 395
      -- enrolments have an RM L2 in the chain and nobody in the seat.
      IF v_holder IS NOT NULL AND v_score IS NULL THEN
        RETURN replace(v_rung, '_', ' ') || ' has not submitted their rating yet';
      END IF;
    END IF;
    v_i := v_i + 1;
  END LOOP;

  RETURN NULL;
END $$;

COMMENT ON FUNCTION pms_chain_ready_before(uuid, uuid, text) IS
  'Why this rung may not settle this appraisal yet, or NULL if it may. '
  'Checks the employee''s self rating, the KRA one-to-one, the weightage lock, '
  'and every OCCUPIED rung before the actor''s own. HR is exempt.';


-- ── the final review cannot be logged early either ─────────────────────────
-- The requirement covers both acts, and they need separate enforcement: the
-- final rating goes through pms_finalise, but the final-review one-to-one is a
-- plain INSERT from the client. anon holds FOR ALL on this table, so a rule
-- living only in pms_finalise would leave the log wide open — and the log is
-- the gate pms_finalise itself depends on.
--
-- Checked against the rung of whoever is LOGGING it, read from manager_id on
-- the row, which is exactly "the preceding members of the chain" relative to
-- the person holding the conversation. A log by somebody outside the chain
-- (HR, or the employee logging their own) is left to the other guards: the
-- employee cannot acknowledge their way past pms_finalise's own readiness
-- check, which 199 adds below.
CREATE OR REPLACE FUNCTION pms_block_early_final_review() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_rung text; v_why text; o pms_overall_rating%ROWTYPE;
BEGIN
  IF NEW.discussion_type <> 'FINAL_REVIEW' THEN RETURN NEW; END IF;

  SELECT * INTO o FROM pms_overall_rating
   WHERE employee_id = NEW.employee_id AND period_id = NEW.period_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- Which rung the logger occupies. The employee logging their own review is
  -- not a chain rung and is not blocked here.
  v_rung := CASE
              WHEN NEW.manager_id IS NULL             THEN NULL
              WHEN NEW.manager_id = o.rm_l1_id        THEN 'RM_L1'
              WHEN NEW.manager_id = o.rm_l2_id        THEN 'RM_L2'
              WHEN NEW.manager_id = o.hod_id          THEN 'HOD'
              ELSE NULL
            END;
  IF v_rung IS NULL THEN RETURN NEW; END IF;

  v_why := pms_chain_ready_before(NEW.employee_id, NEW.period_id, v_rung);
  IF v_why IS NOT NULL THEN
    -- RAISE's format must be a STRING LITERAL — a message built with || is a
    -- syntax error there, not a runtime one. Hence v_why and a single '%'.
    v_why := 'The final review cannot be logged yet: ' || v_why || '.';
    RAISE EXCEPTION '%', v_why;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pms_no_early_final_review ON pms_one_to_one;
CREATE TRIGGER trg_pms_no_early_final_review
BEFORE INSERT OR UPDATE ON pms_one_to_one
FOR EACH ROW EXECUTE FUNCTION pms_block_early_final_review();


-- ── and the final rating itself ────────────────────────────────────────────
-- 198's body VERBATIM, patched at one asserted anchor and diffed. The only
-- change is the 199 block before the final-review gate.
CREATE OR REPLACE FUNCTION pms_finalise(p_employee_id uuid, p_period_id uuid,
                                        p_actor_id uuid, p_actor_role text,
                                        p_rating numeric, p_reason text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE pol pms_policies%ROWTYPE; v_allowed text[]; v_code text; v_121 int; v_hod uuid;
        v_rm uuid; v_flag text; v_why text;
BEGIN
  SELECT p.* INTO pol FROM pms_policies p
    JOIN pms_periods pe ON pe.policy_id = p.id WHERE pe.id = p_period_id;
  -- 074 gave validate_kras and lock_kras this guard and missed finalise. With
  -- no policy row `pol` is NULL, so `pol.final_review_one_to_one` is NULL, the
  -- mandatory one-to-one check below is SKIPPED, and the CASE falls to its ELSE
  -- and hands back the widest finaliser set. A missing policy made finalise
  -- EASIER instead of refusing.
  IF NOT FOUND THEN
    RETURN 'BLOCKED: this period has no policy, so there are no rules to '
        || 'finalise against. Fix the period before finalising.';
  END IF;

  v_allowed := CASE pol.who_can_finalise
                 WHEN 'HOD_ONLY'    THEN ARRAY['HOD']
                 WHEN 'RM2_HOD'     THEN ARRAY['RM_L2','HOD']
                 ELSE ARRAY['RM_L1','RM_L2','HOD'] END;
  v_allowed := v_allowed || ARRAY['HR_MANAGER','HR_HEAD','ADMIN'];

  IF NOT (p_actor_role = ANY(v_allowed)) THEN
    RETURN 'BLOCKED: role ' || p_actor_role || ' cannot finalise under this policy';
  END IF;

      -- HOD GATE — reads the FROZEN chain, not a live lookup.
      --
      -- 056 resolves the chain once at period open and snapshots it into
      -- pms_overall_rating. Re-resolving here would defeat that: somebody who
      -- moved department in week six would acquire a different finaliser
      -- mid-cycle, which is the exact failure the snapshot exists to prevent.
      -- So this checks what was frozen at the start.
      --
      -- Whoever presents as HOD must BE the HOD recorded for THIS employee and
      -- period. Without that the role string is self-asserted and any HOD could
      -- finalise anyone's appraisal.
      --
      -- HR_MANAGER / HR_HEAD / ADMIN stay exempt: HR Admin runs the cycle and is
      -- the escalation path. Their finalise records their own role, so an HR
      -- override remains distinguishable from an HOD sign-off.
      -- THE SAME QUESTION FOR AN RM. Only HOD was ever checked, so RM_L1 and
      -- RM_L2 were self-asserted strings: any manager could finalise anybody's
      -- appraisal by claiming the role. The chain is frozen for exactly this.
      IF p_actor_role IN ('RM_L1','RM_L2') THEN
        SELECT CASE WHEN p_actor_role = 'RM_L1' THEN o.rm_l1_id ELSE o.rm_l2_id END
          INTO v_rm
          FROM pms_overall_rating o
         WHERE o.employee_id = p_employee_id AND o.period_id = p_period_id;

        IF v_rm IS NULL THEN
          RETURN 'BLOCKED: no ' || p_actor_role || ' in this period''s frozen '
              || 'chain. The period should not have opened — see '
              || 'vw_pms_org_readiness.';
        END IF;

        IF v_rm <> p_actor_id THEN
          RETURN 'BLOCKED: you are not the ' || p_actor_role || ' recorded for '
              || 'this employee in this period.';
        END IF;
      END IF;

      IF p_actor_role = 'HOD' THEN
        SELECT o.hod_id INTO v_hod
          FROM pms_overall_rating o
         WHERE o.employee_id = p_employee_id AND o.period_id = p_period_id;

        IF v_hod IS NULL THEN
          RETURN 'BLOCKED: no HOD in this period''s frozen chain. The period '
              || 'should not have opened — see vw_pms_org_readiness.';
        END IF;

        IF v_hod <> p_actor_id THEN
          RETURN 'BLOCKED: you are not the HOD recorded for this employee in '
              || 'this period.';
        END IF;
      END IF;

  -- 199: NOBODY JUMPS THE CHAIN.
  --
  -- Everything above establishes WHO is acting. Nothing established whether
  -- the work that comes BEFORE them was done — so a HOD could settle a rating
  -- with no self rating, unlocked weightages, and neither RM having scored.
  -- All 390 unfinalised appraisals in the database were exposed to that.
  --
  -- Before the final-review gate, deliberately: a final review is the
  -- conversation about the ratings, so it cannot sensibly precede them, and
  -- team.ts reports its blockers in this same order. The screen and the
  -- function must name the same cause for the same stuck row or they send
  -- somebody to the wrong place.
  --
  -- HR is exempt inside pms_chain_ready_before — 192's bulk calibration
  -- finalises as HR precisely to override what the chain produced.
  v_why := pms_chain_ready_before(p_employee_id, p_period_id, p_actor_role);
  IF v_why IS NOT NULL THEN
    RETURN 'BLOCKED: ' || v_why || '. Everyone before you in the chain has to '
        || 'finish before the rating can be settled.';
  END IF;

  IF pol.final_review_one_to_one THEN
    SELECT COUNT(*) INTO v_121 FROM pms_one_to_one
    WHERE employee_id=p_employee_id AND period_id=p_period_id
      AND discussion_type='FINAL_REVIEW' AND employee_ack AND manager_ack;
    -- The message now says what to DO. It read "final review one-to-one not
    -- logged", which is accurate and useless: for a long time NOTHING in the
    -- product could create that row except the employee's own one-to-one
    -- form, so a HOD reading this had no idea the fix was on somebody else's
    -- screen. Both sides can log it now, and the sentence says so.
    IF v_121 = 0 THEN
      RETURN 'BLOCKED: the final review one-to-one needs to be logged and '
          || 'acknowledged by BOTH of you. Either of you can log it — the '
          || 'manager from Review & Finalise, the employee from their '
          || 'One-to-One Log — and then the other acknowledges it.';
    END IF;
  END IF;

  SELECT code INTO v_code FROM pms_rating_from_score(pol.id, p_rating);

  SELECT f.employment_flag INTO v_flag
    FROM vw_pms_employment_flag f WHERE f.employee_id = p_employee_id;

  UPDATE pms_overall_rating
     SET final_rating      = p_rating,
         final_rating_code = COALESCE(v_code, final_rating_code),
         finalised_by      = p_actor_id,
         finalised_by_role = p_actor_role,
         finalised_at      = now(),
         override_reason   = p_reason,
         workflow_status   = 'FINALISED',
         -- 198: FINALISING IS THE HANDOVER TO HR, so record it here rather
         -- than in whichever screen happened to call. Without this a HOD
         -- finalising from their own tab, or a bulk calibration upload, left
         -- the stage on the rung that had just finished and the appraisal
         -- never appeared in HR's publish queue. 'HR' and not 'DONE' because
         -- publishing is HR's separate, deliberate act; and an already
         -- published record is left alone so an HR correction does not drag
         -- it back into the queue.
         chain_stage       = CASE WHEN chain_stage = 'DONE' THEN chain_stage
                                  ELSE 'HR' END,
         -- final_score WAS NEVER WRITTEN BY ANYTHING. self_vs_final_gap is a
         -- GENERATED column over it, so it stayed NULL forever, which emptied
         -- vw_pms_gap_analysis and with it the Self-vs-Manager Gap report and
         -- the employee's gap widget. The weighted score behind the final
         -- rating is the one already synced per role by trg_pms_sync_role_score.
         final_score       = COALESCE(hod_score, rm_l2_score, rm_l1_score, final_score),
         -- employment_flag IS NEVER WRITTEN EITHER, so this read 'ACTIVE' for
         -- everybody and is_readonly was false forever -- which is why
         -- trg_pms_readonly could never fire and rule 12 was inert. The live
         -- answer lives in the view, computed from employees.
         is_readonly       = (v_flag = 'EXITED'),
         employment_flag   = COALESCE(v_flag, employment_flag),
         updated_at        = now()
   WHERE employee_id = p_employee_id AND period_id = p_period_id;

  RETURN 'FINALISED';
END $$;

NOTIFY pgrst, 'reload schema';
