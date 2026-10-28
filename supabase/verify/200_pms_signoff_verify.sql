-- 200_pms_signoff_verify.sql — run AFTER 200.
-- Builds a fixture and ROLLS IT BACK, so it is safe on live data.
--
-- Proves the sign-off moved rather than disappeared:
--   finalising needs the final-review log to EXIST       (§389)
--   publishing needs it ACKNOWLEDGED BY BOTH             (Stage 6, §230)
--
-- 188 required both acknowledgements to FINALISE, which pulled the
-- publication gate one step earlier and left a HOD waiting on an employee to
-- acknowledge a conversation about a rating that did not exist yet.

BEGIN;

SELECT CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL — 200 not applied' END
         AS publish_trigger_exists
  FROM pg_trigger WHERE tgname = 'trg_pms_publish_needs_signoff';

DO $$
DECLARE
  v_co uuid; v_per uuid; v_emp uuid; v_l1 uuid; v_hod uuid;
  v_log uuid; v_r text; v_err text;
BEGIN
  SELECT pe.id, pe.company_id INTO v_per, v_co
    FROM pms_periods pe JOIN pms_policies p ON p.id = pe.policy_id
   WHERE p.final_review_one_to_one AND p.approval_chain = 'SELF_RM1_RM2_HOD'
   ORDER BY pe.period_start DESC LIMIT 1;
  IF v_per IS NULL THEN RAISE NOTICE 'SKIP  no suitable period'; RETURN; END IF;

  SELECT e.id INTO v_emp FROM employees e
   WHERE e.company_id = v_co
     AND NOT EXISTS (SELECT 1 FROM pms_overall_rating o
                      WHERE o.employee_id = e.id AND o.period_id = v_per)
   ORDER BY e.emp_code LIMIT 1;
  SELECT e.id INTO v_l1  FROM employees e WHERE e.company_id = v_co AND e.id <> v_emp ORDER BY e.emp_code LIMIT 1;
  SELECT e.id INTO v_hod FROM employees e WHERE e.company_id = v_co AND e.id NOT IN (v_emp, v_l1) ORDER BY e.emp_code LIMIT 1;
  IF v_hod IS NULL THEN RAISE NOTICE 'SKIP  not enough employees'; RETURN; END IF;

  -- A chain that is complete except for the final review. rm_l2_id NULL so
  -- the collapsed-line skip applies and 199 is satisfied.
  INSERT INTO pms_overall_rating (company_id, period_id, employee_id,
                                  workflow_status, rm_l1_id, rm_l2_id, hod_id,
                                  self_score, rm_l1_score, chain_stage)
  VALUES (v_co, v_per, v_emp, 'RM_L1_DONE', v_l1, NULL, v_hod, 3.4, 4.0, 'HOD');
  INSERT INTO pms_one_to_one (company_id, manager_id, period_id, employee_id,
                              discussion_type, discussion_date, mode,
                              discussion_points, employee_ack, employee_ack_at,
                              manager_ack, manager_ack_at)
  VALUES (v_co, v_l1, v_per, v_emp, 'KRA_SETTING', CURRENT_DATE, 'IN_PERSON',
          'Weightages agreed.', true, now(), true, now());
  INSERT INTO pms_employee_goals (company_id, period_id, employee_id, seq_no,
                                  kra_title, weightage, status)
  VALUES (v_co, v_per, v_emp, 1, 'Fixture', 100, 'LOCKED');

  -- ── 1. no final review on record: finalise still refuses ───────────────
  v_r := pms_finalise(v_emp, v_per, v_hod, 'HOD', 4, NULL);
  IF v_r LIKE 'BLOCKED%not on record%' THEN
    RAISE NOTICE 'PASS  1. finalise needs the log to exist';
  ELSE
    RAISE NOTICE 'FAIL  1. got: %', v_r;
  END IF;

  -- ── 2. THE REQUESTED BEHAVIOUR: logged, manager only, finalise works ───
  INSERT INTO pms_one_to_one (company_id, manager_id, period_id, employee_id,
                              discussion_type, discussion_date, mode,
                              discussion_points, manager_ack, manager_ack_at)
  VALUES (v_co, v_hod, v_per, v_emp, 'FINAL_REVIEW', CURRENT_DATE, 'IN_PERSON',
          'Final review held.', true, now())
  RETURNING id INTO v_log;

  v_r := pms_finalise(v_emp, v_per, v_hod, 'HOD', 4, NULL);
  IF v_r = 'FINALISED' THEN
    RAISE NOTICE 'PASS  2. the HOD finalised WITHOUT the employee acknowledgement';
  ELSE
    RAISE NOTICE 'FAIL  2. got: %', v_r;
  END IF;

  -- ── 3. BUT IT CANNOT BE PUBLISHED YET ──────────────────────────────────
  BEGIN
    UPDATE pms_overall_rating
       SET workflow_status = 'PUBLISHED', published_at = now()
     WHERE employee_id = v_emp AND period_id = v_per;
    RAISE NOTICE 'FAIL  3. an unsigned result was published';
  EXCEPTION WHEN others THEN
    v_err := SQLERRM;
    IF v_err LIKE '%cannot be published yet%' THEN
      RAISE NOTICE 'PASS  3. publication refused: %', v_err;
    ELSE
      RAISE NOTICE 'FAIL  3. wrong refusal: %', v_err;
    END IF;
  END;

  -- ── 4. the employee acknowledges; publication opens ────────────────────
  UPDATE pms_one_to_one SET employee_ack = true, employee_ack_at = now()
   WHERE id = v_log;
  UPDATE pms_overall_rating
     SET workflow_status = 'PUBLISHED', published_at = now()
   WHERE employee_id = v_emp AND period_id = v_per;
  RAISE NOTICE 'PASS  4. published once both had signed';

  -- ── 5. an already-published row is not re-gated ────────────────────────
  -- Otherwise the employee's own acknowledgement of the RESULT would be
  -- refused and the record would be stranded one step from done.
  UPDATE pms_overall_rating SET workflow_status = 'ACKNOWLEDGED',
                                employee_ack = true, employee_ack_at = now()
   WHERE employee_id = v_emp AND period_id = v_per;
  RAISE NOTICE 'PASS  5. acknowledgement on a published row is not blocked';
END $$;

-- NOTHING IS KEPT.
ROLLBACK;
