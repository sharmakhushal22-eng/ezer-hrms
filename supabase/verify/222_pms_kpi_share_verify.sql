-- 222_pms_kpi_share_verify.sql — run AFTER 222.
-- Builds fixtures and ROLLS THEM BACK, so it is safe on live data.
-- CREATES NOTHING THAT OUTLIVES THE QUERY. One result set, no table.
--
-- ── THE CHECK THAT MATTERS IS 30 ───────────────────────────────────────────
--
-- 222 changes what a KPI weighs: from a stored number to its KRA's weightage
-- divided by how many KPIs that KRA has. For a KRA with ONE KPI the two are
-- identical, and 220 gave every KRA that existed exactly one — so no score on
-- record should move.
--
-- Check 30 computes both formulas for every appraisal and rater on record and
-- reports the largest disagreement. Check 31 NAMES the appraisals that moved,
-- with the old and new number, because "2 moved" is not something anybody can
-- act on. Anything other than 0.00 in check 30 means somebody built a KRA
-- with uneven KPI weightages before this ran, and their rating has changed.
--
-- That is reported rather than refused, deliberately: a settled rating that
-- moved is something to look at, not a reason to leave the schema half
-- migrated. The old numbers are still in pms_goal_kpi.weightage, which 222
-- retires but does not drop, so any of this is reversible.
--
-- READ THE RESULT: anything whose `result` is not PASS or INFO is a problem.

BEGIN;

CREATE FUNCTION pg_temp.verify_kpi_share()
RETURNS TABLE (seq int, check_name text, result text, detail text)
LANGUAGE plpgsql AS $fn$
DECLARE g record; kr record; k2 uuid; msg text;
        before_s numeric; after_s numeric; res text; stage_now text;
        before_n int; after_n int; ar record;
BEGIN
  SELECT gg.* INTO g
    FROM public.pms_employee_goals gg
    JOIN public.pms_periods pe ON pe.id = gg.period_id
   WHERE gg.status <> 'SENT_BACK' AND pe.policy_id IS NOT NULL
   ORDER BY gg.created_at DESC LIMIT 1;

  IF g IS NULL THEN
    RETURN QUERY SELECT 20, 'splitting a KRA does not move its weight'::text,
      'SKIP'::text, 'no KRA in a period with a policy to hang a fixture on'::text;
    RETURN;
  END IF;

  -- ── 20. adding a KPI redistributes, it does not inflate ─────────────────
  -- THE PROPERTY THE WHOLE CHANGE RESTS ON. A KRA's total contribution is its
  -- weightage however many KPIs it holds. If adding one made the KRA heavier,
  -- the appraisal would stop totalling 100 and every score would drift.
  SELECT SUM(w) INTO before_s FROM (
    SELECT g2.weightage::numeric / COUNT(*) OVER (PARTITION BY k.goal_id) AS w
      FROM public.pms_goal_kpi k
      JOIN public.pms_employee_goals g2 ON g2.id = k.goal_id
     WHERE k.goal_id = g.id) q;

  INSERT INTO public.pms_goal_kpi
    (company_id, period_id, employee_id, goal_id, seq_no, kpi_metric, weightage)
  VALUES (g.company_id, g.period_id, g.employee_id, g.id, 941, '__verify_share__', 0)
  RETURNING id INTO k2;

  SELECT SUM(w) INTO after_s FROM (
    SELECT g2.weightage::numeric / COUNT(*) OVER (PARTITION BY k.goal_id) AS w
      FROM public.pms_goal_kpi k
      JOIN public.pms_employee_goals g2 ON g2.id = k.goal_id
     WHERE k.goal_id = g.id) q;

  IF before_s IS NOT DISTINCT FROM after_s
     AND round(after_s, 6) = round(g.weightage::numeric, 6) THEN
    RETURN QUERY SELECT 20, 'splitting a KRA does not move its weight'::text,
      'PASS'::text, format('%s before, %s after, KRA is %s',
                           round(before_s, 4), round(after_s, 4), g.weightage);
  ELSE
    RETURN QUERY SELECT 20, 'splitting a KRA does not move its weight'::text,
      'FAIL'::text, format('%s before, %s after, KRA is %s',
                           round(COALESCE(before_s, -1), 4),
                           round(COALESCE(after_s, -1), 4), g.weightage);
  END IF;

  DELETE FROM public.pms_goal_kpi WHERE id = k2;

  -- ── 21 to 24. THE GATE, TESTED BY FORCING THE CONDITION ────────────────
  --
  -- The first version of these asked whether a real appraisal HAPPENED to
  -- have an unrated measure and a rung it HAPPENED to be sitting on. On a
  -- live database it did not: check 21 skipped and 22 reported "this
  -- appraisal is already complete". So the two claims that matter most in
  -- 222 — that the gates actually refuse — were the two nothing exercised.
  --
  -- A check that only fires on data you happen to have is not a check. The
  -- whole script is inside BEGIN … ROLLBACK, so it can MAKE the state it
  -- needs: unsubmit a rating, ask the question, and let the rollback put it
  -- back. Nothing here survives the transaction.

  SELECT k.* INTO kr
    FROM public.pms_goal_kpi k
    JOIN public.pms_reviews r
      ON r.kpi_id = k.id AND r.rater_role = 'SELF' AND r.submitted = true
         AND r.rating IS NOT NULL
   LIMIT 1;

  IF kr IS NULL THEN
    RETURN QUERY SELECT 21, 'the gate counts a draft as unrated'::text,
      'SKIP'::text, 'no submitted self rating anywhere to borrow'::text;
    RETURN;
  END IF;

  -- 21. A DRAFT IS NOT A RATING. submitted = false has to count as unrated,
  -- or a half-filled form walks through the gate.
  before_n := public.pms_unrated_kpis(kr.employee_id, kr.period_id, 'SELF');
  UPDATE public.pms_reviews SET submitted = false
   WHERE kpi_id = kr.id AND rater_role = 'SELF';
  after_n := public.pms_unrated_kpis(kr.employee_id, kr.period_id, 'SELF');
  IF after_n = before_n + 1 THEN
    RETURN QUERY SELECT 21, 'the gate counts a draft as unrated'::text,
      'PASS'::text, format('%s unrated before, %s after un-submitting one',
                           before_n, after_n);
  ELSE
    RETURN QUERY SELECT 21, 'the gate counts a draft as unrated'::text,
      'FAIL'::text, format('%s unrated before, %s after — a draft is being '
                           'counted as a rating', before_n, after_n);
  END IF;

  -- 22. AND SO IS A ROW WITH NO NUMBER IN IT. A comment typed against a
  -- measure creates the row; it does not rate it.
  UPDATE public.pms_reviews SET submitted = true, rating = NULL
   WHERE kpi_id = kr.id AND rater_role = 'SELF';
  after_n := public.pms_unrated_kpis(kr.employee_id, kr.period_id, 'SELF');
  IF after_n = before_n + 1 THEN
    RETURN QUERY SELECT 22, 'the gate counts a null rating as unrated'::text,
      'PASS'::text, format('%s unrated with the rating nulled', after_n);
  ELSE
    RETURN QUERY SELECT 22, 'the gate counts a null rating as unrated'::text,
      'FAIL'::text, format('%s unrated, expected %s', after_n, before_n + 1);
  END IF;

  -- 23. THE SUBMIT GATE ITSELF, with that measure still unrated.
  --
  -- pms_chain_submit has other guards ahead of this one — read-only, not
  -- enrolled, an unrunnable chain. Any of those is a legitimate BLOCKED that
  -- says nothing about 222, so the message is matched rather than the prefix,
  -- and a different refusal is reported with its reason instead of being
  -- counted either way.
  res := public.pms_chain_submit(kr.employee_id, kr.period_id);
  IF res LIKE '%still need your rating%' THEN
    RETURN QUERY SELECT 23, 'the submit gate refuses an unrated set'::text,
      'PASS'::text, left(res, 90);
  ELSIF res LIKE 'BLOCKED:%' THEN
    RETURN QUERY SELECT 23, 'the submit gate refuses an unrated set'::text,
      'INFO'::text, format('refused earlier, by another guard: %s', left(res, 60));
  ELSE
    RETURN QUERY SELECT 23, 'the submit gate refuses an unrated set'::text,
      'FAIL'::text, format('returned %s with a measure unrated', left(res, 60));
  END IF;

  -- 24. THE APPROVE GATE, on an appraisal MADE to be approvable.
  --
  -- The previous version read chain_stage off whatever appraisal the self
  -- rating happened to belong to, and skipped when it was NULL — which it
  -- was. Same mistake as checks 21 to 23 had, one level down: the rating
  -- state was forced and the STAGE was still left to chance.
  --
  -- So this finds an appraisal with a real rung holder, parks it on that
  -- rung, strips that rung's ratings, and approves as the holder. Every bit
  -- of that is undone by the ROLLBACK.
  --
  -- The rung is searched for rather than assumed to be RM_L1: 190 of 395
  -- enrolments have a collapsed reporting line with no RM L2, and some have
  -- no L1 either, so guessing means being refused for the wrong reason and
  -- learning nothing about the gate.
  SELECT k.employee_id, k.period_id, r.rung, r.holder
    INTO ar
    FROM public.pms_goal_kpi k
    CROSS JOIN LATERAL (
      SELECT g2.rung, public.pms_chain_holder(k.employee_id, k.period_id, g2.rung) AS holder
        FROM unnest(ARRAY['RM_L1','RM_L2','HOD']) AS g2(rung)
       WHERE public.pms_chain_holder(k.employee_id, k.period_id, g2.rung) IS NOT NULL
       LIMIT 1) r
    JOIN public.pms_employee_goals g3
      ON g3.id = k.goal_id AND g3.status <> 'SENT_BACK'
   ORDER BY k.employee_id, k.period_id
   LIMIT 1;

  IF ar IS NULL OR ar.holder IS NULL THEN
    RETURN QUERY SELECT 24, 'the approve gate refuses an unrated rater'::text,
      'SKIP'::text, 'no employee in this database has a resolvable chain '
                    'holder on any rung'::text;
    RETURN;
  END IF;

  -- WRAPPED, because this one WRITES before it asks. A trigger refusing the
  -- stage update — 201's acknowledged-stays-acknowledged, 202's post-final
  -- owner — would otherwise abort the whole function, and the reader would
  -- get an error message instead of the other eighteen checks. A verify
  -- script that can take itself down is worth less than one check.
  BEGIN
    UPDATE public.pms_overall_rating
       SET chain_stage = ar.rung, is_readonly = false
     WHERE employee_id = ar.employee_id AND period_id = ar.period_id;

    DELETE FROM public.pms_reviews
     WHERE employee_id = ar.employee_id AND period_id = ar.period_id
       AND rater_role = ar.rung;

    res := public.pms_chain_approve(ar.employee_id, ar.period_id,
                                    ar.holder, ar.rung, 3);
    IF res LIKE '%still need your rating%' THEN
      RETURN QUERY SELECT 24, 'the approve gate refuses an unrated rater'::text,
        'PASS'::text, format('at %s: %s', ar.rung, left(res, 70));
    ELSIF res LIKE 'BLOCKED:%' THEN
      -- An earlier guard. Named, so it is diagnosable rather than ambiguous.
      RETURN QUERY SELECT 24, 'the approve gate refuses an unrated rater'::text,
        'INFO'::text, format('at %s, refused earlier: %s', ar.rung, left(res, 60));
    ELSE
      RETURN QUERY SELECT 24, 'the approve gate refuses an unrated rater'::text,
        'FAIL'::text, format('at %s it returned %s with NOTHING rated by that '
                             'rung', ar.rung, left(res, 45));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    RETURN QUERY SELECT 24, 'the approve gate refuses an unrated rater'::text,
      'INFO'::text, format('could not stage a fixture at %s: %s',
                           ar.rung, left(msg, 60));
  END;

END $fn$;

SELECT v.seq, v.check_name, v.result, v.detail
FROM (

  -- ── the shape ──
  SELECT 1, 'the weightage column is still there'::text,
         CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                            WHERE table_name = 'pms_goal_kpi'
                              AND column_name = 'weightage')
              THEN 'PASS' ELSE 'FAIL' END::text,
         'retired, not dropped — the old splits are the only record of them'::text
  UNION ALL
  SELECT 2, 'it is marked retired, so nobody reads it by accident'::text,
         CASE WHEN COALESCE(col_description('public.pms_goal_kpi'::regclass,
                 (SELECT attnum FROM pg_attribute
                   WHERE attrelid = 'public.pms_goal_kpi'::regclass
                     AND attname = 'weightage')), '') LIKE '%RETIRED%'
              THEN 'PASS' ELSE 'FAIL' END::text,
         'COMMENT ON COLUMN carries the warning'::text
  UNION ALL
  SELECT 3, 'pms_score no longer reads it'::text,
         CASE WHEN (SELECT prosrc FROM pg_proc WHERE proname = 'pms_score' LIMIT 1)
                   NOT LIKE '%k.weightage%'
              THEN 'PASS' ELSE 'FAIL' END::text,
         'the stored split must not come back through the score'::text
  UNION ALL
  SELECT 4, 'pms_score divides by the KPI count'::text,
         CASE WHEN (SELECT prosrc FROM pg_proc WHERE proname = 'pms_score' LIMIT 1)
                   LIKE '%PARTITION BY k.goal_id%'
              THEN 'PASS' ELSE 'FAIL' END::text,
         'the equal share is what replaces the stored weightage'::text
  UNION ALL
  SELECT 5, 'the rating gate exists'::text,
         CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'pms_unrated_kpis')
              THEN 'PASS' ELSE 'FAIL' END::text,
         'pms_unrated_kpis'::text
  UNION ALL
  SELECT 6, 'both chain gates consult it'::text,
         CASE WHEN (SELECT prosrc FROM pg_proc WHERE proname = 'pms_chain_submit' LIMIT 1)
                   LIKE '%pms_unrated_kpis%'
               AND (SELECT prosrc FROM pg_proc WHERE proname = 'pms_chain_approve' LIMIT 1)
                   LIKE '%pms_unrated_kpis%'
              THEN 'PASS' ELSE 'FAIL' END::text,
         'every rung rates every KPI'::text
  UNION ALL
  -- The 221 near-miss, checked again because 222 restates both functions.
  SELECT 7, 'pms_chain_approve still advances the stage'::text,
         CASE WHEN (SELECT prosrc FROM pg_proc WHERE proname = 'pms_chain_approve' LIMIT 1)
                   LIKE '%chain_stage = COALESCE(v_next%'
              THEN 'PASS' ELSE 'FAIL' END::text,
         'restating a function must not drop what it did'::text
  UNION ALL
  SELECT 8, 'pms_chain_approve still locks the weightages'::text,
         CASE WHEN (SELECT prosrc FROM pg_proc WHERE proname = 'pms_chain_approve' LIMIT 1)
                   LIKE '%pms_lock_kras%'
              THEN 'PASS' ELSE 'FAIL' END::text,
         'the lock happens at the first reviewer''s approval'::text
  UNION ALL
  SELECT 9, 'the validator no longer checks a weightage balance'::text,
         CASE WHEN (SELECT prosrc FROM pg_proc WHERE proname = 'pms_validate_kpis' LIMIT 1)
                   NOT LIKE '%SUM(k.weightage)%'
              THEN 'PASS' ELSE 'FAIL' END::text,
         'equal shares cannot fail to add up'::text

  -- ── behaviour ──
  UNION ALL
  SELECT * FROM pg_temp.verify_kpi_share()

  -- ── THE NEUTRALITY CLAIM ──
  UNION ALL
  SELECT 30, 'no score on record moved'::text,
         CASE WHEN COALESCE((
           SELECT max(abs(q.old_s - q.new_s)) FROM (
             SELECT ROUND(SUM(r.rating * k.weightage)
                            / NULLIF(SUM(k.weightage), 0), 2) AS old_s,
                    ROUND(SUM(r.rating * (g.weightage::numeric
                            / cnt.n)) / NULLIF(SUM(g.weightage::numeric / cnt.n), 0), 2) AS new_s
               FROM pms_goal_kpi k
               JOIN pms_employee_goals g ON g.id = k.goal_id
               JOIN (SELECT goal_id, count(*)::numeric AS n
                       FROM pms_goal_kpi GROUP BY goal_id) cnt ON cnt.goal_id = k.goal_id
               JOIN pms_reviews r ON r.kpi_id = k.id AND r.submitted = true
              GROUP BY k.employee_id, k.period_id, r.rater_role) q
           WHERE q.old_s IS NOT NULL AND q.new_s IS NOT NULL), 0) = 0
         THEN 'PASS' ELSE 'FAIL' END::text,
         COALESCE((
           SELECT 'largest difference ' || max(abs(q.old_s - q.new_s))::text FROM (
             SELECT ROUND(SUM(r.rating * k.weightage)
                            / NULLIF(SUM(k.weightage), 0), 2) AS old_s,
                    ROUND(SUM(r.rating * (g.weightage::numeric
                            / cnt.n)) / NULLIF(SUM(g.weightage::numeric / cnt.n), 0), 2) AS new_s
               FROM pms_goal_kpi k
               JOIN pms_employee_goals g ON g.id = k.goal_id
               JOIN (SELECT goal_id, count(*)::numeric AS n
                       FROM pms_goal_kpi GROUP BY goal_id) cnt ON cnt.goal_id = k.goal_id
               JOIN pms_reviews r ON r.kpi_id = k.id AND r.submitted = true
              GROUP BY k.employee_id, k.period_id, r.rater_role) q
           WHERE q.old_s IS NOT NULL AND q.new_s IS NOT NULL), 'nothing rated yet')
  UNION ALL
  -- AND WHICH ONES. "2 moved" is not something anybody can act on.
  SELECT 31, 'the appraisals whose score moved'::text, 'INFO'::text,
         COALESCE((
           SELECT string_agg(format('%s %s: %s -> %s', q.code, q.rater_role,
                                    q.old_s, q.new_s), '; ' ORDER BY q.code)
             FROM (
             SELECT COALESCE(e.emp_code, k.employee_id::text) AS code, r.rater_role,
                    ROUND(SUM(r.rating * k.weightage)
                            / NULLIF(SUM(k.weightage), 0), 2) AS old_s,
                    ROUND(SUM(r.rating * (g.weightage::numeric
                            / cnt.n)) / NULLIF(SUM(g.weightage::numeric / cnt.n), 0), 2) AS new_s
               FROM pms_goal_kpi k
               JOIN pms_employee_goals g ON g.id = k.goal_id
               JOIN (SELECT goal_id, count(*)::numeric AS n
                       FROM pms_goal_kpi GROUP BY goal_id) cnt ON cnt.goal_id = k.goal_id
               JOIN pms_reviews r ON r.kpi_id = k.id AND r.submitted = true
               LEFT JOIN employees e ON e.id = k.employee_id
              GROUP BY e.emp_code, k.employee_id, k.period_id, r.rater_role) q
            WHERE q.old_s IS DISTINCT FROM q.new_s), 'none')

  -- ── INFO ──
  UNION ALL
  SELECT 40, 'KRAs carrying more than one KPI'::text, 'INFO'::text,
         (SELECT count(*)::text FROM (
            SELECT goal_id FROM pms_goal_kpi GROUP BY goal_id HAVING count(*) > 1) q40)
  UNION ALL
  SELECT 41, 'KRAs whose stored KPI weightages were uneven'::text, 'INFO'::text,
         -- The only population check 30 can fail on. Zero here means the
         -- neutrality claim holds by construction, not by luck.
         (SELECT count(*)::text FROM (
            SELECT goal_id FROM pms_goal_kpi
             GROUP BY goal_id
            HAVING count(*) > 1
               AND min(weightage) <> max(weightage)) q41)
  UNION ALL
  -- WHO IS NOW BLOCKED, not how many. Since 222 these cannot be submitted or
  -- approved until the missing measures are rated, so this is a worklist
  -- rather than a statistic — and if it is long, that is 222 reporting a
  -- backlog it did not create.
  SELECT 42, 'appraisals with a measure nobody has rated'::text, 'INFO'::text,
         COALESCE((
           SELECT string_agg(format('%s %s (%s of %s unrated)',
                                    q.code, q.period_code, q.unrated, q.total),
                             '; ' ORDER BY q.code)
             FROM (
             SELECT COALESCE(e.emp_code, k.employee_id::text) AS code,
                    COALESCE(pe.period_code, '?')             AS period_code,
                    count(*) FILTER (
                      WHERE NOT EXISTS (SELECT 1 FROM pms_reviews r
                                         WHERE r.kpi_id = k.id AND r.submitted = true
                                           AND r.rating IS NOT NULL)) AS unrated,
                    count(*)                                   AS total
               FROM pms_goal_kpi k
               JOIN pms_employee_goals g
                 ON g.id = k.goal_id AND g.status <> 'SENT_BACK'
               LEFT JOIN employees e   ON e.id = k.employee_id
               LEFT JOIN pms_periods pe ON pe.id = k.period_id
              GROUP BY e.emp_code, k.employee_id, pe.period_code, k.period_id) q
            WHERE q.unrated > 0), 'none')

) AS v (seq, check_name, result, detail)
ORDER BY v.seq;

ROLLBACK;
