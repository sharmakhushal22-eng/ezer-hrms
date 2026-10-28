-- 200_pms_signoff_gates_publication_not_finalisation.sql — the mutual
-- sign-off moves to where the spec puts it.
-- SAFE TO RUN TWICE. Replaces one function, adds one function and one
-- trigger. No schema change, no data change, no column or constraint altered.
-- ----------------------------------------------------------------------------
-- ── I HAD THIS ON THE WRONG STEP ───────────────────────────────────────────
--
-- Reported: the HOD should be able to give a final rating and finalise WITHOUT
-- the employee's acknowledgement. That is not a relaxation of the spec, it IS
-- the spec, and 188 has had it wrong since it was written:
--
--   Stage 6  "The designated finaliser conducts a comprehensive wrap-up 1-on-1
--             with the employee. The finaliser submits: (a) Final Rating ...
--             Result PUBLICATION is blocked until the final 1-on-1 log is
--             mutually signed off."
--   §230     "Final Review 1-on-1: ... The system strictly halts score
--             PUBLICATION until this dialogue is officially logged and
--             acknowledged by both parties."
--   §389     "pms_finalise(...): Executes final evaluation sign-off; strictly
--             aborts if final review 1-on-1 dialogue LOGS ARE MISSING."
--   §421     "Final review 1-on-1 dialogue mandatory prior to finalisation"
--
-- Finalising needs the conversation ON RECORD. Publishing needs it SIGNED BY
-- BOTH. 188 required both acknowledgements to finalise, which pulled the
-- publication gate one step earlier and produced the exact deadlock reported
-- earlier in this work: a HOD waiting on an employee to acknowledge a
-- conversation about a rating that did not exist yet, because the HOD could
-- not create it.
--
-- WHY THIS IS NOT A WEAKENING. The employee's acknowledgement still blocks the
-- thing it is there to block. §8's whole concern is that "a rating that reaches
-- somebody before the conversation does is how an appraisal turns into a
-- grievance" — and that is about the rating REACHING them, which is
-- publication. Moving the gate protects the same person at the same point and
-- stops holding up a step they are not party to.
--
-- ── AND THE PUBLICATION GATE WAS ONLY IN THE SCREEN ────────────────────────
--
-- lib/pms/oneToOne.ts canPublishResult has long implemented rule 8 correctly
-- and FeedbackTab uses it, so the HOD's publish button was gated. HR's Publish
-- Results tab — which I added two commits ago — does not check it at all, and
-- publishing is a plain UPDATE that anon may make directly. So relaxing
-- pms_finalise without this trigger really would have weakened the rule.
--
-- The trigger is also the only version of this that holds for every path:
-- the HOD's publish, HR's publish, and anything added later.

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
    -- 200: THE LOG MUST EXIST. The MUTUAL SIGN-OFF IS NOT CHECKED HERE.
    --
    -- The spec separates the two and 188 conflated them:
    --
    --   Stage 6  "Result PUBLICATION is blocked until the final 1-on-1 log is
    --             mutually signed off."
    --   §230     "strictly halts score PUBLICATION until this dialogue is
    --             logged and acknowledged by both parties."
    --   §389     "pms_finalise ... strictly aborts if final review 1-on-1
    --             dialogue LOGS ARE MISSING."
    --
    -- So finalising needs the conversation to be ON RECORD; publishing needs
    -- it signed by both. 188 demanded both acknowledgements to finalise,
    -- which moved the publication gate one step earlier and left a finaliser
    -- waiting on an employee who had nothing to react to yet — the rating did
    -- not exist. trg_pms_publish_needs_signoff below puts that gate back where
    -- the spec has it, so nothing is lost by relaxing it here: the employee
    -- still cannot be shown a result they have not acknowledged discussing.
    SELECT COUNT(*) INTO v_121 FROM pms_one_to_one
    WHERE employee_id=p_employee_id AND period_id=p_period_id
      AND discussion_type='FINAL_REVIEW';
    IF v_121 = 0 THEN
      RETURN 'BLOCKED: the final review one-to-one is not on record yet. '
          || 'Either of you can log it — the manager from Review & Finalise, '
          || 'the employee from their One-to-One Log. Their acknowledgement '
          || 'is needed to PUBLISH the result, not to settle the rating.';
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


-- ── the gate, where the spec puts it ───────────────────────────────────────
/**
 * Publication is halted until the final-review one-to-one is signed by both.
 *
 * Only when the policy asks for a final review at all — final_review_one_to_one
 * is configurable, and a cycle that does not require the conversation cannot
 * require its signatures.
 *
 * Fires only on the transition INTO published. An already published row being
 * touched again (an acknowledgement, a correction) is not re-gated: the result
 * has already reached the employee, and blocking the follow-up writes would
 * strand it.
 */
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

  SELECT p.final_review_one_to_one INTO v_req
    FROM pms_policies p
    JOIN pms_periods pe ON pe.policy_id = p.id
   WHERE pe.id = NEW.period_id;
  IF NOT COALESCE(v_req, false) THEN RETURN NEW; END IF;

  SELECT COUNT(*) INTO v_n FROM pms_one_to_one
   WHERE employee_id = NEW.employee_id AND period_id = NEW.period_id
     AND discussion_type = 'FINAL_REVIEW' AND employee_ack AND manager_ack;

  IF v_n = 0 THEN
    -- RAISE's format must be a string literal, so the sentence is built here.
    v_why := 'This result cannot be published yet: the final review one-to-one '
          || 'has not been acknowledged by both of them. The rating is settled; '
          || 'it is the employee seeing it that waits on their acknowledgement.';
    RAISE EXCEPTION '%', v_why;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pms_publish_needs_signoff ON pms_overall_rating;
CREATE TRIGGER trg_pms_publish_needs_signoff
BEFORE UPDATE ON pms_overall_rating
FOR EACH ROW EXECUTE FUNCTION pms_block_unsigned_publish();

NOTIFY pgrst, 'reload schema';
