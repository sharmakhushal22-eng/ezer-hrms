-- 198_pms_finalise_hands_over_to_hr.sql — a finalised rating is waiting for
-- HR, and now says so.
-- SAFE TO RUN TWICE. Replaces one function. No schema change, no data change,
-- no column or constraint touched.
-- ----------------------------------------------------------------------------
-- ── THE GAP ────────────────────────────────────────────────────────────────
--
-- 197 added chain_stage and pms_chain_approve moves it: the last reviewer's
-- approval calls pms_finalise and then sets the stage to HR, so HR's Publish
-- Results queue — which reads chain_stage IN ('HR','DONE') — picks it up.
--
-- But pms_chain_approve is not the only way an appraisal gets finalised, and
-- the others leave the stage where it was:
--
--   * the HOD's own Review & Finalise tab calls pms_finalise directly;
--   * pms_commit_rating_upload (192) calls it for every row of a bulk
--     calibration upload;
--   * HR's own override path calls it.
--
-- OBSERVED, not theorised. Anil Verma (STC9030) was finalised by his HOD at
-- rating 4 through the Finalise tab, and came out:
--
--   workflow_status  FINALISED
--   chain_stage      HOD          <-- still with the HOD
--   final_rating     4
--
-- A settled rating, sitting at a rung whose work is done, invisible to the
-- only screen that can publish it. The employee would never have seen their
-- result and nobody would have known why.
--
-- ── THE FIX, AND WHY IT BELONGS HERE RATHER THAN IN THE SCREENS ────────────
--
-- pms_finalise is the one place every path passes through — that is the whole
-- reason 188 put the guards there instead of in the callers. The handover is
-- the same kind of fact: finalising IS the handover to HR, so it should not be
-- possible to finalise and forget to say so. Patching the three call sites
-- would leave the fourth one somebody adds next year broken.
--
-- Everything else is 188's body VERBATIM — extracted, patched at two asserted
-- unique anchors, and diffed to prove nothing else moved. Two changes, both
-- deliberate: the chain_stage line marked 198 in the UPDATE, and the
-- final-review refusal message, which used to read "final review one-to-one
-- not logged" and told a blocked HOD nothing about where the fix lived.
--
-- (The first attempt at this file was retyped rather than extracted, and the
-- diff caught it silently re-indenting the HOD gate and DELETING two comment
-- paragraphs — including the one explaining why the RM identity check exists.
-- Hence the extract-patch-diff method, not transcription.)
--
-- ── WHY 'HR' AND NOT 'DONE' ────────────────────────────────────────────────
--
-- DONE means published. Finalising settles the number; releasing it to the
-- employee is a separate, deliberate act by HR, and §8 keeps them separate so
-- nothing reaches an employee before HR says so. A finalise that jumped to
-- DONE would publish by accident.
--
-- An ALREADY published record is left alone: a re-finalise (an HR correction
-- on a published rating) must not drag it back into the publish queue as
-- though it had never been released.
--
-- trg_pms_readonly permits this. 197 added chain_stage to the allowed
-- delivery columns and constrains it to move only onward to HR or DONE, which
-- is exactly what this does — so it works for an EXITED employee too, whose
-- row pms_finalise locks in this very statement.

CREATE OR REPLACE FUNCTION pms_finalise(p_employee_id uuid, p_period_id uuid,
                                        p_actor_id uuid, p_actor_role text,
                                        p_rating numeric, p_reason text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE pol pms_policies%ROWTYPE; v_allowed text[]; v_code text; v_121 int; v_hod uuid;
        v_rm uuid; v_flag text;
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
