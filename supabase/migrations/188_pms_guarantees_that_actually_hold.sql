-- 188_pms_guarantees_that_actually_hold.sql — four rules the spec says are
-- enforced in the database, and were not.
-- SAFE TO RUN TWICE. Replaces two functions; changes no data and adds no column.
-- ----------------------------------------------------------------------------
-- Found by auditing the module against EZER-PMS-MODULE-SPEC-v2 on 28 October
-- 2026, then reading the live definitions rather than the spec's promises.
-- Each of these is a thing the spec presents as a DB-level guarantee, which
-- somebody reading §10 or §11 would reasonably believe.
--
-- 1. RULE 12 — "Exited + finalised = read-only, DB level, not just UI" — COULD
--    NEVER FIRE, for two independent reasons.
--
--    pms_overall_rating.employment_flag is never written by any migration or
--    by the application. It stays at its default 'ACTIVE', so pms_finalise's
--    `is_readonly = (employment_flag = 'EXITED')` was always false, so
--    trg_pms_readonly had nothing to act on. The real flag only ever existed
--    in vw_pms_employment_flag, computed from employees.
--
--    And the guard itself unlocks: `IF OLD.is_readonly AND NEW.is_readonly`
--    lets `UPDATE ... SET is_readonly = false` through, because NEW is then
--    false. A lock you can clear by clearing it is not a lock.
--
-- 2. §11 RULE 8 AND 9 WERE SKIPPABLE. pms_finalise reads its policy with
--    SELECT ... INTO and never checks FOUND. 074 added exactly that guard to
--    pms_validate_kras and pms_lock_kras and did not add it here. With no
--    policy row, `pol` is NULL: the mandatory final-review one-to-one check is
--    skipped entirely, and the who_can_finalise CASE falls through its ELSE to
--    the widest set. A missing policy made finalising EASIER than a present
--    one.
--
-- 3. ONLY THE HOD'S IDENTITY WAS CHECKED. p_actor_role is a string the caller
--    asserts. The HOD branch verifies it against the frozen chain; RM_L1 and
--    RM_L2 were taken on trust, so any manager could finalise any appraisal by
--    naming the role. The chain is snapshotted for precisely this.
--
-- 4. final_score WAS NEVER WRITTEN. self_vs_final_gap is a GENERATED column
--    over it, so it was NULL for every row ever, which empties
--    vw_pms_gap_analysis and with it report #4 (Self vs Manager Gap) and the
--    employee's own gap widget. Both are in the spec; neither could ever have
--    shown a number.
--
-- WHAT THIS DOES NOT DO. It does not touch rules 10 and 11
-- (improvement_feedback_mandatory, min_comment_chars). Those columns exist and
-- no SQL reads them; they are now read by the application instead, which is a
-- change in code rather than schema. Making them a database refusal would mean
-- pms_finalise rejecting a finalise for a short comment, and that is a product
-- decision rather than a repair.
--
-- DERIVED FROM 066, which holds the live definition of both functions: taken
-- verbatim, patched against asserted anchors, and diffed to prove only the
-- intended lines moved.
-- ============================================================================

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
    IF v_121 = 0 THEN RETURN 'BLOCKED: final review one-to-one not logged'; END IF;
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


-- ── the lock that can be unlocked ──────────────────────────────────────────
-- Once a record is read-only it stays read-only: the condition now asks only
-- about OLD. §8 says "finalise ke baad permanently read-only", and permanently
-- is what that means. An UPDATE that merely clears the flag no longer slips
-- past by making NEW false.
CREATE OR REPLACE FUNCTION pms_block_readonly() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.is_readonly THEN
    RAISE EXCEPTION 'Record is read-only (employee exited and rating finalised)';
  END IF;
  RETURN NEW;
END $$;

NOTIFY pgrst, 'reload schema';
