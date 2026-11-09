-- 225_pms_readonly_publish_verify.sql — run AFTER 225.
-- Manufactures a read-only row, exercises the real trigger, and ROLLS BACK.
-- Safe on live data: nothing here survives the transaction.
--
-- ── WHY THIS EXISTS AFTER I SAID IT COULD NOT ──────────────────────────────
--
-- I shipped 225 saying there was no way to verify it, because the guard only
-- bites on a read-only row and making one means marking somebody exited.
-- That was wrong. Every other script in this folder manufactures the state it
-- needs inside BEGIN … ROLLBACK, and so can this one.
--
-- ── HOW IT ISOLATES THE GUARD ──────────────────────────────────────────────
--
-- Four triggers watch an UPDATE of pms_overall_rating, and they fire in name
-- order, so trg_pms_publish_needs_hr_final speaks before trg_pms_readonly. A
-- full publish on an unsettled row would be refused by the HR Head rule first
-- and never reach the rule under test.
--
-- But both publish triggers return early unless workflow_status actually
-- TRANSITIONS into PUBLISHED. So the checks below update chain_stage ALONE.
-- That is the exact column 225 is about, and nothing else runs.
--
-- READ THE RESULT: anything whose `result` is not PASS or INFO is a problem.

BEGIN;

CREATE FUNCTION pg_temp.verify_readonly_publish()
RETURNS TABLE (seq int, check_name text, result text, detail text)
LANGUAGE plpgsql AS $fn$
DECLARE v_emp uuid; v_per uuid; v_code text; v_msg text; v_stage text;
BEGIN
  -- Somebody the chain has settled, so the row looks like the one this bug
  -- is about. Not already acknowledged: 201 rewrites PUBLISHED back to
  -- ACKNOWLEDGED on those and would confuse the reading.
  SELECT o.employee_id, o.period_id, e.emp_code, o.chain_stage
    INTO v_emp, v_per, v_code, v_stage
    FROM pms_overall_rating o
    JOIN employees e ON e.id = o.employee_id
   WHERE o.final_rating IS NOT NULL
     AND COALESCE(o.workflow_status, '') <> 'ACKNOWLEDGED'
   ORDER BY o.updated_at DESC NULLS LAST
   LIMIT 1;

  IF v_emp IS NULL THEN
    RETURN QUERY SELECT 20, 'a frozen record still lets the result out'::text,
      'SKIP'::text, 'no settled, unacknowledged appraisal to build on'::text;
    RETURN;
  END IF;

  -- Freeze it, and park the stage somewhere publishing would have to move it
  -- FROM. Done while the row is still writable, or the guard would refuse the
  -- setup itself.
  UPDATE pms_overall_rating
     SET is_readonly = false, chain_stage = 'HR'
   WHERE employee_id = v_emp AND period_id = v_per;
  UPDATE pms_overall_rating
     SET is_readonly = true
   WHERE employee_id = v_emp AND period_id = v_per;

  -- ── 20. the write publishing actually makes, on a frozen row ────────────
  -- Before 225 this was refused with "Cannot change: chain_stage", naming a
  -- column the administrator never typed, on a screen that was only trying
  -- to release a result.
  BEGIN
    UPDATE pms_overall_rating SET chain_stage = 'DONE'
     WHERE employee_id = v_emp AND period_id = v_per;
    RETURN QUERY SELECT 20, 'a frozen record still lets the result out'::text,
      'PASS'::text, format('%s: chain_stage moved to DONE while read-only', v_code);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    RETURN QUERY SELECT 20, 'a frozen record still lets the result out'::text,
      'FAIL'::text, left(v_msg, 95);
  END;

  -- ── 21. and only to DONE ────────────────────────────────────────────────
  -- THE MIRROR. Allowing the column outright would let a frozen record be
  -- walked back to RM_L1 — reopening an appraisal for somebody who has left,
  -- not delivering one. Without this check, a guard that allowed chain_stage
  -- unconditionally would pass check 20 and look correct.
  BEGIN
    UPDATE pms_overall_rating SET chain_stage = 'RM_L1'
     WHERE employee_id = v_emp AND period_id = v_per;
    RETURN QUERY SELECT 21, 'a frozen record cannot be reopened'::text,
      'FAIL'::text, 'chain_stage was moved back to RM_L1 on a read-only row'::text;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg LIKE '%can only move on to DONE%' THEN
      RETURN QUERY SELECT 21, 'a frozen record cannot be reopened'::text,
        'PASS'::text, left(v_msg, 95);
    ELSE
      RETURN QUERY SELECT 21, 'a frozen record cannot be reopened'::text,
        'INFO'::text, format('refused, but not by the stage rule: %s', left(v_msg, 60));
    END IF;
  END;

  -- ── 22. the lock still locks ────────────────────────────────────────────
  -- 225 widened an allowlist. If it widened it too far, the record is no
  -- longer read-only at all and 193's whole purpose is gone.
  BEGIN
    UPDATE pms_overall_rating SET final_rating = 1
     WHERE employee_id = v_emp AND period_id = v_per;
    RETURN QUERY SELECT 22, 'the lock still locks everything else'::text,
      'FAIL'::text, 'final_rating was changed on a read-only row'::text;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    RETURN QUERY SELECT 22, 'the lock still locks everything else'::text,
      'PASS'::text, left(v_msg, 95);
  END;

  -- ── 23. an unfrozen row is untouched by any of this ─────────────────────
  UPDATE pms_overall_rating SET is_readonly = false
   WHERE employee_id = v_emp AND period_id = v_per;
  BEGIN
    UPDATE pms_overall_rating SET chain_stage = 'RM_L2'
     WHERE employee_id = v_emp AND period_id = v_per;
    RETURN QUERY SELECT 23, 'an ordinary row is not policed by this rule'::text,
      'PASS'::text, 'chain_stage moved freely while not read-only'::text;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    RETURN QUERY SELECT 23, 'an ordinary row is not policed by this rule'::text,
      'FAIL'::text, left(v_msg, 95);
  END;
END $fn$;

SELECT v.seq, v.check_name, v.result, v.detail
FROM (

  SELECT 1, 'the read-only guard exists'::text,
         CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'pms_block_readonly')
              THEN 'PASS' ELSE 'FAIL' END::text, 'pms_block_readonly'::text
  UNION ALL
  SELECT 2, 'chain_stage is in the delivery allowlist'::text,
         CASE WHEN (SELECT prosrc FROM pg_proc WHERE proname = 'pms_block_readonly' LIMIT 1)
                   LIKE '%''chain_stage''%'
              THEN 'PASS' ELSE 'FAIL' END::text, '225 is applied'::text
  UNION ALL
  SELECT 3, 'it is allowed onward to DONE only'::text,
         CASE WHEN (SELECT prosrc FROM pg_proc WHERE proname = 'pms_block_readonly' LIMIT 1)
                   LIKE '%can only move on to DONE%'
              THEN 'PASS' ELSE 'FAIL' END::text,
         'an unconditional allowance would let a frozen record be reopened'::text
  UNION ALL
  SELECT 4, 'the workflow_status rule 193 wrote survived'::text,
         CASE WHEN (SELECT prosrc FROM pg_proc WHERE proname = 'pms_block_readonly' LIMIT 1)
                   LIKE '%PUBLISHED%ACKNOWLEDGED%'
              THEN 'PASS' ELSE 'FAIL' END::text,
         '225 restates 193 and must not drop what it did'::text

  UNION ALL
  SELECT * FROM pg_temp.verify_readonly_publish()

  -- ── INFO ──
  UNION ALL
  -- WHO THIS WAS BLOCKING. Each of these is a settled rating that could not
  -- be released before 225.
  SELECT 40, 'read-only appraisals with a settled rating'::text, 'INFO'::text,
         COALESCE((
           SELECT string_agg(format('%s (%s)', e.emp_code,
                                    COALESCE(o.workflow_status, 'no status')), '; ')
             FROM pms_overall_rating o
             JOIN employees e ON e.id = o.employee_id
            WHERE COALESCE(o.is_readonly, false)
              AND o.final_rating IS NOT NULL), 'none')
  UNION ALL
  SELECT 41, 'of those, still unpublished'::text, 'INFO'::text,
         (SELECT count(*)::text FROM pms_overall_rating o
           WHERE COALESCE(o.is_readonly, false)
             AND o.final_rating IS NOT NULL
             AND COALESCE(o.workflow_status, '') NOT IN ('PUBLISHED','ACKNOWLEDGED'))

) AS v (seq, check_name, result, detail)
ORDER BY v.seq;

ROLLBACK;
