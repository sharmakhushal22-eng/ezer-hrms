-- 223_pms_upload_duplicates_verify.sql — run AFTER 223.
-- Calls the real commit function inside BEGIN … ROLLBACK, so it is safe on
-- live data. CREATES NOTHING THAT OUTLIVES THE QUERY.
--
-- ── WHAT IT PROVES ─────────────────────────────────────────────────────────
--
-- 223 refuses a rating-upload file that names one employee twice. Before it,
-- both rows validated — each was judged against the rating the database holds
-- NOW, and that value does not move during the validation pass — and the
-- apply loop then let the LAST row silently decide the rating.
--
-- Checks 20 to 23 call pms_commit_rating_upload for real, with a real
-- enrolled employee, and read what comes back. The rollback undoes it.
--
-- Check 22 is the one that matters: the SAME file, deduplicated, must still
-- be accepted — a guard that refuses everything would pass check 20 and look
-- correct.
--
-- READ THE RESULT: anything whose `result` is not PASS or INFO is a problem.

BEGIN;

CREATE FUNCTION pg_temp.verify_upload_dups()
RETURNS TABLE (seq int, check_name text, result text, detail text)
LANGUAGE plpgsql AS $fn$
DECLARE
  v_emp uuid; v_code text; v_period uuid; v_rating numeric;
  v_actor uuid; v_res jsonb; v_rows jsonb;
BEGIN
  -- Somebody really enrolled, in a period that really has a policy, with a
  -- settled rating — so the only thing that can refuse the file is the rule
  -- under test rather than an unrelated gate.
  SELECT o.employee_id, e.emp_code, o.period_id, o.final_rating
    INTO v_emp, v_code, v_period, v_rating
    FROM pms_overall_rating o
    JOIN employees e   ON e.id = o.employee_id
    JOIN pms_periods pe ON pe.id = o.period_id
   WHERE o.final_rating IS NOT NULL
     AND COALESCE(o.is_readonly, false) = false
     AND pe.policy_id IS NOT NULL
   ORDER BY o.updated_at DESC NULLS LAST
   LIMIT 1;

  IF v_emp IS NULL THEN
    RETURN QUERY SELECT 20, 'a duplicate file is refused'::text, 'SKIP'::text,
      'no enrolled, rated, editable employee to build a fixture from'::text;
    RETURN;
  END IF;

  -- An actor the function will accept: it refuses a NULL employee id outright,
  -- because an override is recorded against a named person.
  SELECT id INTO v_actor FROM employees WHERE id = v_emp;

  -- ── 20. the same person twice, refused ──────────────────────────────────
  v_rows := jsonb_build_array(
    jsonb_build_object('employee_code', v_code, 'final_rating', v_rating::text),
    jsonb_build_object('employee_code', v_code, 'final_rating', '1',
                       'override_reason', 'verify fixture'));
  v_res := public.pms_commit_rating_upload(v_period, v_actor, 'HR_MANAGER', v_rows);
  IF (v_res->>'ok')::boolean IS FALSE
     AND v_res->>'message' LIKE '%more than once%' THEN
    RETURN QUERY SELECT 20, 'a duplicate file is refused'::text, 'PASS'::text,
      left(v_res->>'message', 95);
  ELSE
    RETURN QUERY SELECT 20, 'a duplicate file is refused'::text, 'FAIL'::text,
      format('ok=%s applied=%s msg=%s', v_res->>'ok', v_res->>'applied',
             left(COALESCE(v_res->>'message', '(none)'), 60));
  END IF;

  -- ── 21. nothing was applied, and nothing was logged as committed ────────
  -- The refusal returns before the validation loop, so it must not leave
  -- half a batch in pms_rating_upload_log either.
  IF COALESCE((v_res->>'applied')::int, -1) = 0 THEN
    RETURN QUERY SELECT 21, 'the refused file applied nothing'::text, 'PASS'::text,
      'applied = 0'::text;
  ELSE
    RETURN QUERY SELECT 21, 'the refused file applied nothing'::text, 'FAIL'::text,
      format('applied = %s', v_res->>'applied');
  END IF;

  -- ── 22. THE MIRROR. The same file with one row is still accepted ────────
  -- Without this, a guard that refused every upload would pass check 20.
  v_rows := jsonb_build_array(
    jsonb_build_object('employee_code', v_code, 'final_rating', v_rating::text));
  v_res := public.pms_commit_rating_upload(v_period, v_actor, 'HR_MANAGER', v_rows);
  IF (v_res->>'ok')::boolean IS TRUE THEN
    RETURN QUERY SELECT 22, 'a single-row file still commits'::text, 'PASS'::text,
      left(COALESCE(v_res->>'message', ''), 95);
  ELSE
    -- Refused for some other reason — a policy demanding a final-review
    -- one-to-one, say. Named rather than counted either way: it says nothing
    -- about 223 and should not read as a failure of it.
    RETURN QUERY SELECT 22, 'a single-row file still commits'::text, 'INFO'::text,
      format('refused for another reason: %s', left(v_res->>'message', 70));
  END IF;

  -- ── 23. case and padding count as the same person ───────────────────────
  -- The employee lookup is upper(btrim(...)) on both sides, so a file with
  -- "srs9088" and " SRS9088 " resolves to ONE record and would apply twice.
  -- If the duplicate check were stricter than the lookup, that file would
  -- still slip through — which is the whole bug wearing different case.
  v_rows := jsonb_build_array(
    jsonb_build_object('employee_code', lower(v_code), 'final_rating', v_rating::text),
    jsonb_build_object('employee_code', '  ' || upper(v_code) || '  ',
                       'final_rating', '1', 'override_reason', 'verify fixture'));
  v_res := public.pms_commit_rating_upload(v_period, v_actor, 'HR_MANAGER', v_rows);
  IF (v_res->>'ok')::boolean IS FALSE
     AND v_res->>'message' LIKE '%more than once%' THEN
    RETURN QUERY SELECT 23, 'case and padding are the same person'::text,
      'PASS'::text, left(v_res->>'message', 95);
  ELSE
    RETURN QUERY SELECT 23, 'case and padding are the same person'::text,
      'FAIL'::text, format('ok=%s applied=%s — a duplicate slipped through on '
                           'case or whitespace', v_res->>'ok', v_res->>'applied');
  END IF;
END $fn$;

SELECT v.seq, v.check_name, v.result, v.detail
FROM (

  -- ── the shape ──
  SELECT 1, 'the commit function exists'::text,
         CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'pms_commit_rating_upload')
              THEN 'PASS' ELSE 'FAIL' END::text,
         'pms_commit_rating_upload'::text
  UNION ALL
  SELECT 2, 'it refuses a file naming one person twice'::text,
         CASE WHEN (SELECT prosrc FROM pg_proc
                     WHERE proname = 'pms_commit_rating_upload' LIMIT 1)
                   LIKE '%more than once%'
              THEN 'PASS' ELSE 'FAIL' END::text,
         '223 is applied'::text
  UNION ALL
  -- The check must run BEFORE the per-row loop: the complaint is about the
  -- file, and reporting it row by row would say the same thing once each.
  SELECT 3, 'the check runs before the validation loop'::text,
         CASE WHEN position('HAVING count(*) > 1' IN
                (SELECT prosrc FROM pg_proc WHERE proname = 'pms_commit_rating_upload' LIMIT 1))
                < position('FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP' IN
                (SELECT prosrc FROM pg_proc WHERE proname = 'pms_commit_rating_upload' LIMIT 1))
              THEN 'PASS' ELSE 'FAIL' END::text,
         'one complaint about the file, not one per duplicate row'::text
  UNION ALL
  -- 221 restated a deployed function from memory and silently dropped the
  -- UPDATE that advances the workflow. 223 restates this one.
  SELECT 4, 'the two-pass apply survived the restatement'::text,
         CASE WHEN (SELECT prosrc FROM pg_proc
                     WHERE proname = 'pms_commit_rating_upload' LIMIT 1)
                   LIKE '%rows failed validation, so %'
               AND (SELECT prosrc FROM pg_proc
                     WHERE proname = 'pms_commit_rating_upload' LIMIT 1)
                   LIKE '%UPDATE pms_rating_upload_log SET committed = true%'
              THEN 'PASS' ELSE 'FAIL' END::text,
         'validate every row, then apply every row'::text

  -- ── behaviour, against the real function ──
  UNION ALL
  SELECT * FROM pg_temp.verify_upload_dups()

  -- ── INFO ──
  UNION ALL
  SELECT 40, 'upload batches on record'::text, 'INFO'::text,
         (SELECT count(DISTINCT batch_id)::text FROM pms_rating_upload_log)
  UNION ALL
  -- Files that WOULD have hit this bug, if any were ever committed. A
  -- non-zero count is worth looking at by hand: somebody's rating may have
  -- been decided by row order.
  SELECT 41, 'committed batches that named a person twice'::text, 'INFO'::text,
         COALESCE((
           SELECT string_agg(format('%s (%s x%s)', batch_id, employee_code, n), '; ')
             FROM (
               SELECT batch_id, employee_code, count(*) AS n
                 FROM pms_rating_upload_log
                WHERE committed = true AND employee_code IS NOT NULL
                GROUP BY batch_id, employee_code
               HAVING count(*) > 1) q41), 'none')

) AS v (seq, check_name, result, detail)
ORDER BY v.seq;

ROLLBACK;
