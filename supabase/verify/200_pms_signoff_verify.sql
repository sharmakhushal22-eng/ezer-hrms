-- 200_pms_signoff_verify.sql — run AFTER 200.
-- Builds a fixture and ROLLS IT BACK, so it is safe on live data.
--
-- ── IT RETURNS A TABLE, NOT NOTICES ────────────────────────────────────────
--
-- The first version reported through RAISE NOTICE inside a DO block. That
-- prints in psql and is INVISIBLE in the Supabase SQL editor, which shows the
-- result of the last statement — and the last statement here is ROLLBACK. Run
-- there it said "Success. No rows returned" and every check it had just
-- performed was lost. The 197 and 199 verify scripts have the same flaw.
--
-- So every check writes a row into a temp table and the script ends with one
-- SELECT. The ROLLBACK still discards the fixture; the result set has already
-- been returned by then.
--
-- ── WHAT IT PROVES ─────────────────────────────────────────────────────────
--
-- That the mutual sign-off MOVED rather than disappeared:
--
--   finalising needs the final-review log to EXIST        (§389)
--   publishing needs it ACKNOWLEDGED BY BOTH             (Stage 6, §230)
--
-- 188 required both acknowledgements to FINALISE, which pulled the publication
-- gate one step earlier and left a HOD waiting on an employee to acknowledge a
-- conversation about a rating that did not exist yet.
--
-- Step 2 is the one to read: the HOD finalises with the employee's half
-- missing. Step 3 is its other half: the same row cannot be published.

BEGIN;

-- Scoped to this transaction, so it goes when the rollback does.
CREATE TEMP TABLE _verify(step text, result text, detail text) ON COMMIT DROP;

INSERT INTO _verify
SELECT '0a. publish trigger exists',
       CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL — 200 not applied' END, NULL
  FROM pg_trigger WHERE tgname = 'trg_pms_publish_needs_signoff';

-- The relaxation itself, read off the deployed function: it must count
-- FINAL_REVIEW rows WITHOUT requiring the acknowledgements.
INSERT INTO _verify
SELECT '0b. finalise asks only that the log exists',
       CASE WHEN prosrc LIKE '%discussion_type=''FINAL_REVIEW'';%'
             AND prosrc NOT LIKE '%FINAL_REVIEW'' AND employee_ack AND manager_ack%'
            THEN 'PASS'
            ELSE 'FAIL — pms_finalise still demands both acknowledgements' END,
       NULL
  FROM pg_proc WHERE proname = 'pms_finalise';

DO $$
DECLARE
  v_co uuid; v_per uuid; v_emp uuid; v_l1 uuid; v_hod uuid;
  v_log uuid; v_r text; v_err text;
BEGIN
  SELECT pe.id, pe.company_id INTO v_per, v_co
    FROM pms_periods pe JOIN pms_policies p ON p.id = pe.policy_id
   WHERE p.final_review_one_to_one AND p.approval_chain = 'SELF_RM1_RM2_HOD'
   ORDER BY pe.period_start DESC LIMIT 1;
  IF v_per IS NULL THEN
    INSERT INTO _verify VALUES ('1. fixture', 'SKIP',
      'no period on a full-chain policy that requires a final review');
    RETURN;
  END IF;

  SELECT e.id INTO v_emp FROM employees e
   WHERE e.company_id = v_co
     AND NOT EXISTS (SELECT 1 FROM pms_overall_rating o
                      WHERE o.employee_id = e.id AND o.period_id = v_per)
   ORDER BY e.emp_code LIMIT 1;
  SELECT e.id INTO v_l1  FROM employees e
   WHERE e.company_id = v_co AND e.id <> v_emp ORDER BY e.emp_code LIMIT 1;
  SELECT e.id INTO v_hod FROM employees e
   WHERE e.company_id = v_co AND e.id NOT IN (v_emp, v_l1) ORDER BY e.emp_code LIMIT 1;
  IF v_hod IS NULL THEN
    INSERT INTO _verify VALUES ('1. fixture', 'SKIP',
      'need an unenrolled employee plus two others in one company');
    RETURN;
  END IF;

  -- A chain complete except for the final review. rm_l2_id NULL so 199's
  -- collapsed-line skip applies and its readiness gate is satisfied.
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

  INSERT INTO _verify VALUES ('1. fixture', 'OK',
    'chain complete, no final review logged');

  -- ── 2. no final review on record: finalise still refuses ───────────────
  v_r := pms_finalise(v_emp, v_per, v_hod, 'HOD', 4, NULL);
  INSERT INTO _verify VALUES ('2. finalise needs the log to exist',
    CASE WHEN v_r LIKE 'BLOCKED%not on record%' THEN 'PASS' ELSE 'FAIL' END, v_r);

  -- ── 3. THE REQUESTED BEHAVIOUR ─────────────────────────────────────────
  -- Logged by the HOD, acknowledged by the HOD only. The employee has not
  -- signed. Finalising must work.
  INSERT INTO pms_one_to_one (company_id, manager_id, period_id, employee_id,
                              discussion_type, discussion_date, mode,
                              discussion_points, manager_ack, manager_ack_at)
  VALUES (v_co, v_hod, v_per, v_emp, 'FINAL_REVIEW', CURRENT_DATE, 'IN_PERSON',
          'Final review held.', true, now())
  RETURNING id INTO v_log;

  v_r := pms_finalise(v_emp, v_per, v_hod, 'HOD', 4, NULL);
  INSERT INTO _verify VALUES (
    '3. HOD finalises WITHOUT the employee acknowledgement',
    CASE WHEN v_r = 'FINALISED' THEN 'PASS' ELSE 'FAIL' END, v_r);

  -- ── 4. and it still cannot be published ────────────────────────────────
  BEGIN
    UPDATE pms_overall_rating
       SET workflow_status = 'PUBLISHED', published_at = now()
     WHERE employee_id = v_emp AND period_id = v_per;
    INSERT INTO _verify VALUES ('4. unsigned publish is refused', 'FAIL',
      'the update was accepted');
  EXCEPTION WHEN others THEN
    v_err := SQLERRM;
    INSERT INTO _verify VALUES ('4. unsigned publish is refused',
      CASE WHEN v_err LIKE '%cannot be published yet%' THEN 'PASS' ELSE 'FAIL' END,
      v_err);
  END;

  -- ── 5. the employee signs; publication opens ───────────────────────────
  UPDATE pms_one_to_one SET employee_ack = true, employee_ack_at = now()
   WHERE id = v_log;
  BEGIN
    UPDATE pms_overall_rating
       SET workflow_status = 'PUBLISHED', published_at = now()
     WHERE employee_id = v_emp AND period_id = v_per;
    INSERT INTO _verify VALUES ('5. publishes once both have signed', 'PASS', NULL);
  EXCEPTION WHEN others THEN
    INSERT INTO _verify VALUES ('5. publishes once both have signed', 'FAIL', SQLERRM);
  END;

  -- ── 6. an already-published row is not re-gated ────────────────────────
  -- Otherwise the employee's own acknowledgement of the RESULT would be
  -- refused and the record stranded one step from done.
  BEGIN
    UPDATE pms_overall_rating SET workflow_status = 'ACKNOWLEDGED',
                                  employee_ack = true, employee_ack_at = now()
     WHERE employee_id = v_emp AND period_id = v_per;
    INSERT INTO _verify VALUES ('6. acknowledging a published row is allowed',
      'PASS', NULL);
  EXCEPTION WHEN others THEN
    INSERT INTO _verify VALUES ('6. acknowledging a published row is allowed',
      'FAIL', SQLERRM);
  END;

  -- ── 7. 201: a second publish cannot undo that ──────────────────────────
  UPDATE pms_overall_rating SET workflow_status = 'PUBLISHED'
   WHERE employee_id = v_emp AND period_id = v_per;
  INSERT INTO _verify
  SELECT '7. acknowledged survives a re-publish (201)',
         CASE WHEN workflow_status = 'ACKNOWLEDGED' THEN 'PASS' ELSE 'FAIL' END,
         workflow_status
    FROM pms_overall_rating
   WHERE employee_id = v_emp AND period_id = v_per;
END $$;

-- THE RESULT. Read this table; it is the whole point of the file.
SELECT step, result, detail FROM _verify ORDER BY step;

-- NOTHING IS KEPT. Every fixture row above disappears here; the result set
-- has already been returned.
ROLLBACK;
