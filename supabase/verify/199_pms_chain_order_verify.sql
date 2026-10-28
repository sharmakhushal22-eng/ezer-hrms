-- 199_pms_chain_order_verify.sql — run AFTER 199.
-- Builds a fixture and ROLLS IT BACK, so it is safe on live data.
--
-- Covers 199's preceding-rung gate AND 198's handover to HR, because the
-- second was proved last time by mutating a real published appraisal — Anil
-- Verma was walked backwards, finalised, and restored. That worked and the
-- restore was verified column by column, but for a few seconds a completed
-- appraisal read as unfinalised, and anyone looking at his screen would have
-- seen it. This file is how that proof should have been done: a fixture
-- nobody can see, inside a transaction that never commits.
--
-- WHAT IT IS REALLY TESTING. pms_finalise checked WHO was acting and nothing
-- about whether the work before them existed, so a HOD could settle a rating
-- with no self rating, unlocked weightages and neither RM having scored. All
-- 390 unfinalised appraisals in the database were in exactly that state.
-- Tests 2 to 6 walk the gate open one condition at a time, which is the only
-- way to show each condition is load-bearing rather than one of them masking
-- the rest.

BEGIN;

-- ── 0. the pieces exist ──────────────────────────────────────────────────
SELECT CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL — 199 not applied' END
         AS readiness_function_exists
  FROM pg_proc WHERE proname = 'pms_chain_ready_before';

SELECT CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL — trigger missing' END
         AS early_final_review_trigger_exists
  FROM pg_trigger WHERE tgname = 'trg_pms_no_early_final_review';

SELECT CASE WHEN prosrc LIKE '%pms_chain_ready_before%' THEN 'PASS'
            ELSE 'FAIL — pms_finalise does not call the readiness check' END
         AS finalise_calls_the_check
  FROM pg_proc WHERE proname = 'pms_finalise';

DO $$
DECLARE
  v_co uuid; v_per uuid; v_pol uuid; v_emp uuid; v_l1 uuid; v_l2 uuid; v_hod uuid;
  v_g1 uuid; v_g2 uuid; v_why text; v_r text; v_stage text; v_err text;
BEGIN
  SELECT pe.id, pe.company_id, p.id INTO v_per, v_co, v_pol
    FROM pms_periods pe JOIN pms_policies p ON p.id = pe.policy_id
   WHERE p.approval_chain = 'SELF_RM1_RM2_HOD'
     AND p.one_to_one_mandatory AND p.final_review_one_to_one
   ORDER BY pe.period_start DESC LIMIT 1;
  IF v_per IS NULL THEN
    RAISE NOTICE 'SKIP  no period on a full-chain policy with both one-to-ones required';
    RETURN;
  END IF;

  SELECT e.id INTO v_emp FROM employees e
   WHERE e.company_id = v_co
     AND NOT EXISTS (SELECT 1 FROM pms_overall_rating o
                      WHERE o.employee_id = e.id AND o.period_id = v_per)
   ORDER BY e.emp_code LIMIT 1;
  SELECT e.id INTO v_l1  FROM employees e WHERE e.company_id = v_co AND e.id <> v_emp ORDER BY e.emp_code LIMIT 1;
  SELECT e.id INTO v_l2  FROM employees e WHERE e.company_id = v_co AND e.id NOT IN (v_emp, v_l1) ORDER BY e.emp_code LIMIT 1;
  SELECT e.id INTO v_hod FROM employees e WHERE e.company_id = v_co AND e.id NOT IN (v_emp, v_l1, v_l2) ORDER BY e.emp_code LIMIT 1;
  IF v_hod IS NULL THEN
    RAISE NOTICE 'SKIP  need an unenrolled employee plus three others in one company';
    RETURN;
  END IF;

  -- A bare enrolment: nothing done at all.
  INSERT INTO pms_overall_rating (company_id, period_id, employee_id,
                                  workflow_status, rm_l1_id, rm_l2_id, hod_id)
  VALUES (v_co, v_per, v_emp, 'NOT_STARTED', v_l1, v_l2, v_hod);

  -- ── 1. the HOD is refused, and told it is the self rating ──────────────
  v_why := pms_chain_ready_before(v_emp, v_per, 'HOD');
  IF v_why LIKE '%self rating%' THEN
    RAISE NOTICE 'PASS  1. blocked on the self rating: %', v_why;
  ELSE
    RAISE NOTICE 'FAIL  1. expected a self-rating block, got: %', COALESCE(v_why, '(ready!)');
  END IF;

  -- And pms_finalise must refuse for the SAME reason, not a different one.
  v_r := pms_finalise(v_emp, v_per, v_hod, 'HOD', 4, NULL);
  IF v_r LIKE 'BLOCKED%self rating%' THEN
    RAISE NOTICE 'PASS  1b. pms_finalise refuses with the same cause';
  ELSE
    RAISE NOTICE 'FAIL  1b. pms_finalise said: %', v_r;
  END IF;

  -- ── 2. self rating in; now the one-to-one is the blocker ───────────────
  UPDATE pms_overall_rating SET self_score = 3.4
   WHERE employee_id = v_emp AND period_id = v_per;
  v_why := pms_chain_ready_before(v_emp, v_per, 'HOD');
  IF v_why LIKE '%KRA one-to-one%' THEN
    RAISE NOTICE 'PASS  2. blocked on the KRA one-to-one';
  ELSE
    RAISE NOTICE 'FAIL  2. got: %', COALESCE(v_why, '(ready!)');
  END IF;

  -- ── 3. THE FINAL REVIEW CANNOT BE LOGGED THIS EARLY ────────────────────
  -- The trigger, not pms_finalise. anon holds FOR ALL on pms_one_to_one, so a
  -- rule living only in the function would leave the log — the very gate
  -- pms_finalise depends on — wide open.
  BEGIN
    INSERT INTO pms_one_to_one (company_id, manager_id, period_id, employee_id,
                                discussion_type, discussion_date, mode,
                                discussion_points, manager_ack, manager_ack_at)
    VALUES (v_co, v_hod, v_per, v_emp, 'FINAL_REVIEW', CURRENT_DATE, 'IN_PERSON',
            'Jumping the queue.', true, now());
    RAISE NOTICE 'FAIL  3. an early final review was accepted';
  EXCEPTION WHEN others THEN
    v_err := SQLERRM;
    IF v_err LIKE '%final review cannot be logged yet%' THEN
      RAISE NOTICE 'PASS  3. early final review refused: %', v_err;
    ELSE
      RAISE NOTICE 'FAIL  3. refused for the wrong reason: %', v_err;
    END IF;
  END;

  -- ── 4. one-to-one acknowledged; now the lock is the blocker ────────────
  INSERT INTO pms_one_to_one (company_id, manager_id, period_id, employee_id,
                              discussion_type, discussion_date, mode,
                              discussion_points, employee_ack, employee_ack_at,
                              manager_ack, manager_ack_at)
  VALUES (v_co, v_l1, v_per, v_emp, 'KRA_SETTING', CURRENT_DATE, 'IN_PERSON',
          'Weightages agreed.', true, now(), true, now());
  v_why := pms_chain_ready_before(v_emp, v_per, 'HOD');
  IF v_why LIKE '%weightages are not locked%' THEN
    RAISE NOTICE 'PASS  4. blocked on the weightage lock';
  ELSE
    RAISE NOTICE 'FAIL  4. got: %', COALESCE(v_why, '(ready!)');
  END IF;

  -- ── 5. locked; now RM L1 is the blocker ────────────────────────────────
  INSERT INTO pms_employee_goals (company_id, period_id, employee_id, seq_no,
                                  kra_title, weightage, status)
  VALUES (v_co, v_per, v_emp, 1, 'Fixture A', 60, 'LOCKED') RETURNING id INTO v_g1;
  INSERT INTO pms_employee_goals (company_id, period_id, employee_id, seq_no,
                                  kra_title, weightage, status)
  VALUES (v_co, v_per, v_emp, 2, 'Fixture B', 40, 'LOCKED') RETURNING id INTO v_g2;

  v_why := pms_chain_ready_before(v_emp, v_per, 'HOD');
  IF v_why LIKE '%RM L1 has not submitted%' THEN
    RAISE NOTICE 'PASS  5. blocked on RM L1 — the rung nothing used to check';
  ELSE
    RAISE NOTICE 'FAIL  5. got: %', COALESCE(v_why, '(ready!)');
  END IF;

  -- ── 6. RM L1 in; now RM L2 is the blocker ──────────────────────────────
  UPDATE pms_overall_rating SET rm_l1_score = 4.0
   WHERE employee_id = v_emp AND period_id = v_per;
  v_why := pms_chain_ready_before(v_emp, v_per, 'HOD');
  IF v_why LIKE '%RM L2 has not submitted%' THEN
    RAISE NOTICE 'PASS  6. blocked on RM L2';
  ELSE
    RAISE NOTICE 'FAIL  6. got: %', COALESCE(v_why, '(ready!)');
  END IF;

  -- ── 7. AN EMPTY RUNG IS SKIPPED, NOT WAITED FOR ────────────────────────
  -- 190 of 395 real enrolments name RM L2 in the chain and have rm_l2_id
  -- NULL, because pms_resolve_chain drops L2 when it equals L1. Waiting on
  -- that rung is the deadlock 197 shipped once already.
  UPDATE pms_overall_rating SET rm_l2_id = NULL
   WHERE employee_id = v_emp AND period_id = v_per;
  v_why := pms_chain_ready_before(v_emp, v_per, 'HOD');
  IF v_why IS NULL THEN
    RAISE NOTICE 'PASS  7. an unoccupied RM L2 is skipped — the chain is ready';
  ELSE
    RAISE NOTICE 'FAIL  7. still blocked on an empty rung: %', v_why;
  END IF;

  -- ── 8. HR IS EXEMPT, or 192's bulk calibration breaks ──────────────────
  UPDATE pms_overall_rating SET self_score = NULL
   WHERE employee_id = v_emp AND period_id = v_per;
  v_why := pms_chain_ready_before(v_emp, v_per, 'HR_MANAGER');
  IF v_why IS NULL THEN
    RAISE NOTICE 'PASS  8. HR is exempt even with nothing done';
  ELSE
    RAISE NOTICE 'FAIL  8. HR was blocked: %', v_why;
  END IF;
  UPDATE pms_overall_rating SET self_score = 3.4
   WHERE employee_id = v_emp AND period_id = v_per;

  -- ── 9. the final review logs NOW, and finalise hands over to HR ────────
  INSERT INTO pms_one_to_one (company_id, manager_id, period_id, employee_id,
                              discussion_type, discussion_date, mode,
                              discussion_points, employee_ack, employee_ack_at,
                              manager_ack, manager_ack_at)
  VALUES (v_co, v_hod, v_per, v_emp, 'FINAL_REVIEW', CURRENT_DATE, 'IN_PERSON',
          'Final review held.', true, now(), true, now());
  RAISE NOTICE 'PASS  9. the final review logs once the chain has caught up';

  UPDATE pms_overall_rating SET chain_stage = 'HOD'
   WHERE employee_id = v_emp AND period_id = v_per;
  v_r := pms_finalise(v_emp, v_per, v_hod, 'HOD', 4, NULL);
  SELECT chain_stage INTO v_stage FROM pms_overall_rating
   WHERE employee_id = v_emp AND period_id = v_per;
  IF v_r = 'FINALISED' AND v_stage = 'HR' THEN
    RAISE NOTICE 'PASS  10. finalised, and handed over to HR (198)';
  ELSE
    RAISE NOTICE 'FAIL  10. finalise said % and the stage is %', v_r, v_stage;
  END IF;

  -- ── 11. a published row is not dragged back into HR's queue ────────────
  UPDATE pms_overall_rating SET chain_stage = 'DONE'
   WHERE employee_id = v_emp AND period_id = v_per;
  v_r := pms_finalise(v_emp, v_per, v_hod, 'HOD', 4, NULL);
  SELECT chain_stage INTO v_stage FROM pms_overall_rating
   WHERE employee_id = v_emp AND period_id = v_per;
  IF v_stage = 'DONE' THEN
    RAISE NOTICE 'PASS  11. DONE is preserved on a re-finalise';
  ELSE
    RAISE NOTICE 'FAIL  11. stage became %', v_stage;
  END IF;
END $$;

-- NOTHING IS KEPT. Every row above disappears here.
ROLLBACK;
