-- 226_pms_readonly_guard_verify.sql — run AFTER 226.
-- Freezes a row, exercises the real trigger, and ROLLS BACK.
-- Safe on live data: nothing here survives the transaction.
--
-- ── WHAT 226 PUT BACK ──────────────────────────────────────────────────────
--
-- 225 rebuilt pms_block_readonly from 193, three versions stale, deleting:
--
--   195  generated columns excluded from the comparison
--   197  chain_stage allowed onward to HR *or* DONE
--
-- 226 restores 197 byte-for-byte. These checks are what would have caught
-- 225 the moment it was applied.
--
-- ── FREEZING IS ONE-WAY, AND THIS SCRIPT GOT IT WRONG TWICE ────────────────
--
-- is_readonly is NOT in the allowlist, so a frozen row cannot be thawed
-- through this table. Both earlier drafts of this script set
-- is_readonly = false as setup and were refused by the rule they were
-- written to test — the second time even after check 24 had been added
-- stating the fact. Knowing something and propagating it are different acts.
--
-- So the fixture now STARTS unfrozen: the row is selected on
-- is_readonly = false, moved and frozen in one statement while the guard is
-- still returning early, and never thawed again. Every check after that is a
-- frozen-row check, which is the point.
--
-- ── HOW IT ISOLATES THE GUARD ──────────────────────────────────────────────
--
-- Four triggers watch an UPDATE of pms_overall_rating and fire in NAME order,
-- so trg_pms_publish_needs_hr_final speaks before trg_pms_readonly. A full
-- publish on an unsettled row is refused by the HR Head rule and never
-- reaches the rule under test. Both publish triggers return early unless
-- workflow_status actually TRANSITIONS, so every check below moves
-- chain_stage alone and nothing else runs.
--
-- READ THE RESULT: anything whose `result` is not PASS or INFO is a problem.

BEGIN;

CREATE FUNCTION pg_temp.verify_readonly_guard()
RETURNS TABLE (seq int, check_name text, result text, detail text)
LANGUAGE plpgsql AS $fn$
DECLARE v_emp uuid; v_per uuid; v_code text; v_msg text; v_gap numeric;
BEGIN
  -- NOT ALREADY FROZEN, because freezing is one-way and the setup has to be
  -- allowed. And BOTH SCORES populated, because self_vs_final_gap is
  -- GENERATED from them and 195's bug only shows when it has a value — a
  -- fixture that left them null had the column null on both sides and
  -- reported ALLOWED six times running. 195's own header records that.
  SELECT o.employee_id, o.period_id, e.emp_code, o.self_vs_final_gap
    INTO v_emp, v_per, v_code, v_gap
    FROM pms_overall_rating o
    JOIN employees e ON e.id = o.employee_id
   WHERE COALESCE(o.is_readonly, false) = false
     AND o.final_rating IS NOT NULL
     AND o.self_score  IS NOT NULL
     AND o.final_score IS NOT NULL
   ORDER BY o.updated_at DESC NULLS LAST
   LIMIT 1;

  IF v_emp IS NULL THEN
    RETURN QUERY SELECT 20, 'a frozen record still lets the result out'::text,
      'SKIP'::text, 'no unfrozen, settled row with both scores to freeze — '
                 || 'without both, the generated column is null on each side '
                 || 'and the check would pass vacuously'::text;
    RETURN;
  END IF;

  -- Park the stage somewhere publication would have to move it FROM, and
  -- freeze — one statement, while OLD.is_readonly is still false and the
  -- guard returns early. Nothing below ever thaws it.
  UPDATE pms_overall_rating
     SET chain_stage = 'RM_L2', is_readonly = true
   WHERE employee_id = v_emp AND period_id = v_per;

  -- ── 20. the write publishing makes, on a frozen row ─────────────────────
  -- Under 225 this failed with "Cannot change: self_vs_final_gap" — the
  -- generated column, which Postgres fills AFTER every BEFORE trigger, so
  -- NEW held null while OLD held the stored value.
  BEGIN
    UPDATE pms_overall_rating SET chain_stage = 'DONE'
     WHERE employee_id = v_emp AND period_id = v_per;
    RETURN QUERY SELECT 20, 'a frozen record still lets the result out'::text,
      'PASS'::text, format('%s: chain_stage -> DONE while read-only (gap %s)',
                           v_code, COALESCE(v_gap::text, 'null'));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    RETURN QUERY SELECT 20, 'a frozen record still lets the result out'::text,
      'FAIL'::text, left(v_msg, 95);
  END;

  -- ── 21. and onward to HR, which 225 had narrowed away ───────────────────
  -- The chain hands a settled record to HR before publication moves it to
  -- DONE. 197 allows both; 225 allowed only DONE.
  BEGIN
    UPDATE pms_overall_rating SET chain_stage = 'HR'
     WHERE employee_id = v_emp AND period_id = v_per;
    RETURN QUERY SELECT 21, 'a frozen record can still be handed to HR'::text,
      'PASS'::text, 'chain_stage -> HR while read-only'::text;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    RETURN QUERY SELECT 21, 'a frozen record can still be handed to HR'::text,
      'FAIL'::text, left(v_msg, 95);
  END;

  -- ── 22. but not backwards ───────────────────────────────────────────────
  -- THE MIRROR. Without it, a guard allowing chain_stage unconditionally
  -- passes 20 and 21 and looks correct while letting a frozen record be
  -- reopened for somebody who has left.
  BEGIN
    UPDATE pms_overall_rating SET chain_stage = 'RM_L1'
     WHERE employee_id = v_emp AND period_id = v_per;
    RETURN QUERY SELECT 22, 'a frozen record cannot be reopened'::text,
      'FAIL'::text, 'chain_stage moved back to RM_L1 on a read-only row'::text;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    RETURN QUERY SELECT 22, 'a frozen record cannot be reopened'::text,
      CASE WHEN v_msg LIKE '%HR or DONE%' THEN 'PASS' ELSE 'INFO' END::text,
      left(v_msg, 95);
  END;

  -- ── 23. the lock still locks everything else ────────────────────────────
  -- 226 restores an allowlist. If it restored one that is too wide, the
  -- record is not read-only at all and 193's whole purpose is gone.
  BEGIN
    UPDATE pms_overall_rating SET final_rating = 1
     WHERE employee_id = v_emp AND period_id = v_per;
    RETURN QUERY SELECT 23, 'the lock still locks everything else'::text,
      'FAIL'::text, 'final_rating was changed on a read-only row'::text;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    RETURN QUERY SELECT 23, 'the lock still locks everything else'::text,
      'PASS'::text, left(v_msg, 95);
  END;

  -- ── 24. and freezing is one-way ─────────────────────────────────────────
  -- is_readonly is deliberately not in the allowlist. This is the rule both
  -- earlier drafts of this script tripped over in their own setup.
  BEGIN
    UPDATE pms_overall_rating SET is_readonly = false
     WHERE employee_id = v_emp AND period_id = v_per;
    RETURN QUERY SELECT 24, 'a frozen record cannot be thawed here'::text,
      'FAIL'::text, 'is_readonly was cleared through an ordinary update'::text;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    RETURN QUERY SELECT 24, 'a frozen record cannot be thawed here'::text,
      'PASS'::text, left(v_msg, 95);
  END;
END $fn$;

SELECT v.seq, v.check_name, v.result, v.detail
FROM (

  SELECT 1, 'the read-only guard exists'::text,
         CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'pms_block_readonly')
              THEN 'PASS' ELSE 'FAIL' END::text, 'pms_block_readonly'::text
  UNION ALL
  -- 195. The line 225 deleted.
  SELECT 2, 'generated columns are excluded from the comparison'::text,
         CASE WHEN (SELECT prosrc FROM pg_proc WHERE proname = 'pms_block_readonly' LIMIT 1)
                   LIKE '%is_generated = ''ALWAYS''%'
              THEN 'PASS' ELSE 'FAIL' END::text,
         'without this every publish of a locked record is refused naming '
      || 'self_vs_final_gap'::text
  UNION ALL
  SELECT 3, 'they are subtracted from BOTH sides'::text,
         CASE WHEN (SELECT prosrc FROM pg_proc WHERE proname = 'pms_block_readonly' LIMIT 1)
                   LIKE '%to_jsonb(OLD) - v_allowed - v_generated%'
              AND (SELECT prosrc FROM pg_proc WHERE proname = 'pms_block_readonly' LIMIT 1)
                   LIKE '%to_jsonb(NEW) - v_allowed - v_generated%'
              THEN 'PASS' ELSE 'FAIL' END::text,
         'subtracting from one side only would invert the bug'::text
  UNION ALL
  -- 197. The rule 225 narrowed.
  SELECT 4, 'chain_stage may move onward to HR or DONE'::text,
         CASE WHEN (SELECT prosrc FROM pg_proc WHERE proname = 'pms_block_readonly' LIMIT 1)
                   LIKE '%NOT IN (''HR'',''DONE'')%'
              THEN 'PASS' ELSE 'FAIL' END::text,
         'DONE alone breaks the chain''s handover to HR'::text
  UNION ALL
  SELECT 5, 'the workflow_status rule 193 wrote survived'::text,
         CASE WHEN (SELECT prosrc FROM pg_proc WHERE proname = 'pms_block_readonly' LIMIT 1)
                   LIKE '%PUBLISHED%ACKNOWLEDGED%'
              THEN 'PASS' ELSE 'FAIL' END::text,
         'every restatement has to keep what the last one did'::text
  UNION ALL
  SELECT 6, 'is_readonly is NOT in the allowlist'::text,
         CASE WHEN (SELECT prosrc FROM pg_proc WHERE proname = 'pms_block_readonly' LIMIT 1)
                   NOT LIKE '%''is_readonly''%'
              THEN 'PASS' ELSE 'FAIL' END::text,
         'freezing is one-way by design'::text

  UNION ALL
  SELECT * FROM pg_temp.verify_readonly_guard()

  -- ── INFO ──
  UNION ALL
  SELECT 40, 'read-only appraisals with a settled rating'::text, 'INFO'::text,
         COALESCE((
           SELECT string_agg(format('%s (%s)', e.emp_code,
                                    COALESCE(o.workflow_status, 'no status')), '; ')
             FROM pms_overall_rating o
             JOIN employees e ON e.id = o.employee_id
            WHERE COALESCE(o.is_readonly, false)
              AND o.final_rating IS NOT NULL), 'none')

) AS v (seq, check_name, result, detail)
ORDER BY v.seq;

ROLLBACK;
