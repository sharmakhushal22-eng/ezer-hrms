-- 193_pms_readonly_verify.sql — run AFTER 193.
--
-- This one BUILDS AND TEARS DOWN a fixture, inside a transaction that is
-- rolled back, so it leaves nothing behind and is safe on live data. It has
-- to: the only way to test a lock is to lock something.
--
-- Every row should report PASS. The whole thing ends in ROLLBACK.

BEGIN;

-- THE FIXTURE. employment_flag on the row is irrelevant: the trigger keys on
-- is_readonly, which pms_finalise derives from vw_pms_employment_flag, so a
-- hand-set is_readonly tests exactly what an exited employee would hit.
--
-- The subject must be an employee NOT already enrolled in that period, because
-- pms_overall_rating is UNIQUE (period_id, employee_id) and a collision here
-- would read as a trigger failure.
CREATE TEMP TABLE _fx AS
SELECT pe.id AS period_id, pe.company_id,
       (SELECT e.id FROM employees e
         WHERE NOT EXISTS (SELECT 1 FROM pms_overall_rating o
                            WHERE o.employee_id = e.id AND o.period_id = pe.id)
         ORDER BY e.emp_code LIMIT 1) AS employee_id
  FROM pms_periods pe
 ORDER BY pe.period_start DESC LIMIT 1;

SELECT CASE WHEN employee_id IS NULL
            THEN 'FAIL — no unenrolled employee to use as a fixture'
            ELSE 'PASS — fixture subject found' END AS fixture FROM _fx;

INSERT INTO pms_overall_rating
  (company_id, period_id, employee_id, workflow_status, final_rating,
   final_score, self_score, is_readonly)
SELECT company_id, period_id, employee_id, 'FINALISED', 3, 3.2, 3.5, true
  FROM _fx;

-- 1. THE RATING IS FROZEN. Each of these must raise.
DO $$
DECLARE v_id uuid; v_fails text := '';
BEGIN
  SELECT o.id INTO v_id FROM pms_overall_rating o JOIN _fx f
    ON f.employee_id = o.employee_id AND f.period_id = o.period_id;

  BEGIN UPDATE pms_overall_rating SET final_rating = 5 WHERE id = v_id;
        v_fails := v_fails || 'final_rating ';
  EXCEPTION WHEN others THEN NULL; END;

  BEGIN UPDATE pms_overall_rating SET self_score = 1 WHERE id = v_id;
        v_fails := v_fails || 'self_score ';
  EXCEPTION WHEN others THEN NULL; END;

  BEGIN UPDATE pms_overall_rating SET override_reason = 'nope' WHERE id = v_id;
        v_fails := v_fails || 'override_reason ';
  EXCEPTION WHEN others THEN NULL; END;

  BEGIN UPDATE pms_overall_rating SET rating_source = 'HR_OVERRIDE' WHERE id = v_id;
        v_fails := v_fails || 'rating_source ';
  EXCEPTION WHEN others THEN NULL; END;

  -- 188's fix: the lock cannot be cleared by clearing it.
  BEGIN UPDATE pms_overall_rating SET is_readonly = false WHERE id = v_id;
        v_fails := v_fails || 'is_readonly ';
  EXCEPTION WHEN others THEN NULL; END;

  -- and the status cannot be walked BACK to reopen the record
  BEGIN UPDATE pms_overall_rating SET workflow_status = 'SELF_DRAFT' WHERE id = v_id;
        v_fails := v_fails || 'status-backwards ';
  EXCEPTION WHEN others THEN NULL; END;

  IF v_fails = '' THEN RAISE NOTICE 'PASS  frozen columns all refused';
  ELSE RAISE NOTICE 'FAIL  these were ALLOWED on a locked row: %', v_fails;
  END IF;
END $$;

-- 2. DELIVERY IS STILL ALLOWED — the point of 193.
DO $$
DECLARE v_id uuid; v_ok text := ''; v_bad text := '';
BEGIN
  SELECT o.id INTO v_id FROM pms_overall_rating o JOIN _fx f
    ON f.employee_id = o.employee_id AND f.period_id = o.period_id;

  BEGIN UPDATE pms_overall_rating
           SET workflow_status = 'PUBLISHED', published_at = now()
         WHERE id = v_id;
        v_ok := v_ok || 'publish ';
  EXCEPTION WHEN others THEN v_bad := v_bad || 'publish(' || SQLERRM || ') '; END;

  BEGIN UPDATE pms_overall_rating
           SET workflow_status = 'ACKNOWLEDGED', employee_ack = true,
               employee_ack_at = now()
         WHERE id = v_id;
        v_ok := v_ok || 'acknowledge ';
  EXCEPTION WHEN others THEN v_bad := v_bad || 'acknowledge(' || SQLERRM || ') '; END;

  IF v_bad = '' THEN RAISE NOTICE 'PASS  delivery allowed: %', v_ok;
  ELSE RAISE NOTICE 'FAIL  delivery was refused: %', v_bad;
  END IF;
END $$;

-- 3. The row ended up published AND acknowledged, with the rating untouched.
SELECT CASE WHEN workflow_status = 'ACKNOWLEDGED' AND employee_ack
                 AND final_rating = 3 AND self_score = 3.5
                 AND published_at IS NOT NULL AND is_readonly
            THEN 'PASS' ELSE 'FAIL' END AS end_state,
       workflow_status, employee_ack, final_rating, self_score, is_readonly
  FROM pms_overall_rating o JOIN _fx f
    ON f.employee_id = o.employee_id AND f.period_id = o.period_id;

-- 4. AN UNLOCKED ROW IS NOT POLICED. 193 must not restrict the ordinary path,
--    so a second fixture that was never locked takes a rating change freely.
--    A separate row is needed because the locked one cannot be unlocked.
DO $$
DECLARE v_id uuid; v_emp uuid; v_per uuid; v_co uuid;
BEGIN
  SELECT period_id, company_id INTO v_per, v_co FROM _fx;
  SELECT e.id INTO v_emp FROM employees e
   WHERE NOT EXISTS (SELECT 1 FROM pms_overall_rating o
                      WHERE o.employee_id = e.id AND o.period_id = v_per)
   ORDER BY e.emp_code LIMIT 1;
  IF v_emp IS NULL THEN
    RAISE NOTICE 'SKIP  no second unenrolled employee available';
    RETURN;
  END IF;
  INSERT INTO pms_overall_rating (company_id, period_id, employee_id,
                                  workflow_status, final_rating, is_readonly)
  VALUES (v_co, v_per, v_emp, 'FINALISED', 3, false)
  RETURNING id INTO v_id;
  BEGIN
    UPDATE pms_overall_rating SET final_rating = 5, self_score = 2 WHERE id = v_id;
    RAISE NOTICE 'PASS  an unlocked row still takes a rating change';
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'FAIL  193 is policing an UNLOCKED row: %', SQLERRM;
  END;
END $$;

ROLLBACK;

-- Nothing above survives. This also catches a client that does NOT honour the
-- BEGIN/ROLLBACK as one transaction — in which case the fixtures would still
-- be there and this reports FAIL rather than leaving them unnoticed.
-- Covers BOTH fixtures: the locked one and section 4's unlocked one.
SELECT CASE WHEN count(*) = 0 THEN 'PASS — both fixtures rolled back'
            ELSE 'FAIL — ' || count(*) || ' fixture row(s) survived; delete them' END AS cleanup
  FROM pms_overall_rating
 WHERE (final_score = 3.2 AND self_score = 3.5)
    OR (self_score = 2 AND final_rating = 5 AND final_score IS NULL);
