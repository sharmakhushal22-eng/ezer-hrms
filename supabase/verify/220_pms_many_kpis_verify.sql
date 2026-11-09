-- 220_pms_many_kpis_verify.sql — run AFTER 220.
-- Builds fixtures and ROLLS THEM BACK, so it is safe on live data.
-- CREATES NOTHING THAT OUTLIVES THE QUERY. One result set, no table.
--
-- ── THE CHECK THAT MATTERS IS 10 ───────────────────────────────────────────
--
-- 220 moves the weightage that scores an appraisal from the KRA to its KPIs.
-- Every KRA on record was given one KPI carrying its whole weightage, so the
-- two formulas should return the same number for every appraisal that exists:
--
--   old   SUM(rating x kra_weightage) / SUM(kra_weightage)
--   new   SUM(rating x kpi_weightage) / SUM(kpi_weightage)
--
-- Check 10 computes both, per employee per period per rater, and reports the
-- largest disagreement. Anything but 0.00 means the migration moved somebody's
-- score, and a rating that changes because of a schema change is the one
-- outcome this must not have.
--
-- Check 11 goes further and compares the recomputed score against the value
-- actually stored on pms_overall_rating, which is what the screens read.
--
-- READ THE RESULT: anything whose `result` is not PASS or INFO is a problem.

BEGIN;

CREATE FUNCTION pg_temp.verify_kpi_rules()
RETURNS TABLE (seq int, check_name text, result text, detail text)
LANGUAGE plpgsql AS $fn$
DECLARE g record; k1 uuid; k2 uuid; rater uuid;
BEGIN
  SELECT * INTO g FROM public.pms_employee_goals
   WHERE status <> 'SENT_BACK' ORDER BY created_at DESC LIMIT 1;
  IF g IS NULL THEN
    RETURN QUERY SELECT 20, 'the KPI rules actually bite'::text, 'SKIP'::text,
                        'no KRA to hang a fixture on'::text;
    RETURN;
  END IF;

  -- 20. A KRA may hold more than one KPI. This is the whole feature.
  BEGIN
    INSERT INTO public.pms_goal_kpi
      (company_id, period_id, employee_id, goal_id, seq_no, kpi_metric, weightage)
    VALUES (g.company_id, g.period_id, g.employee_id, g.id, 901, '__verify_a__', 1)
    RETURNING id INTO k1;
    INSERT INTO public.pms_goal_kpi
      (company_id, period_id, employee_id, goal_id, seq_no, kpi_metric, weightage)
    VALUES (g.company_id, g.period_id, g.employee_id, g.id, 902, '__verify_b__', 2)
    RETURNING id INTO k2;
    RETURN QUERY SELECT 20, 'a KRA can hold several KPIs'::text, 'PASS'::text, NULL::text;
  EXCEPTION WHEN others THEN
    RETURN QUERY SELECT 20, 'a KRA can hold several KPIs'::text, 'FAIL'::text, SQLERRM::text;
    RETURN;
  END;

  -- 21. The same seq_no twice under one KRA is a collision, not a second KPI.
  BEGIN
    INSERT INTO public.pms_goal_kpi
      (company_id, period_id, employee_id, goal_id, seq_no, kpi_metric, weightage)
    VALUES (g.company_id, g.period_id, g.employee_id, g.id, 901, '__verify_dup__', 1);
    RETURN QUERY SELECT 21, 'a duplicate KPI position is refused'::text, 'FAIL'::text,
                        'the insert was ACCEPTED'::text;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT 21, 'a duplicate KPI position is refused'::text, 'PASS'::text, NULL::text;
  END;

  -- 22 and 23. Each rung rates each KPI once: two KPIs, one rater, two
  --            ratings — but never two ratings of the same KPI.
  SELECT employee_id INTO rater FROM public.pms_overall_rating LIMIT 1;
  BEGIN
    INSERT INTO public.pms_reviews
      (company_id, period_id, employee_id, goal_id, kpi_id, rater_id, rater_role, rating, submitted)
    VALUES (g.company_id, g.period_id, g.employee_id, g.id, k1, rater, 'RM_L1', 4, false);
    INSERT INTO public.pms_reviews
      (company_id, period_id, employee_id, goal_id, kpi_id, rater_id, rater_role, rating, submitted)
    VALUES (g.company_id, g.period_id, g.employee_id, g.id, k2, rater, 'RM_L1', 5, false);
    RETURN QUERY SELECT 22, 'one rater can rate two KPIs of one KRA'::text, 'PASS'::text, NULL::text;
  EXCEPTION WHEN others THEN
    RETURN QUERY SELECT 22, 'one rater can rate two KPIs of one KRA'::text, 'FAIL'::text, SQLERRM::text;
  END;

  BEGIN
    INSERT INTO public.pms_reviews
      (company_id, period_id, employee_id, goal_id, kpi_id, rater_id, rater_role, rating, submitted)
    VALUES (g.company_id, g.period_id, g.employee_id, g.id, k1, rater, 'RM_L1', 2, false);
    RETURN QUERY SELECT 23, 'the same rater cannot rate one KPI twice'::text, 'FAIL'::text,
                        'the insert was ACCEPTED'::text;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT 23, 'the same rater cannot rate one KPI twice'::text, 'PASS'::text, NULL::text;
  END;

  -- 24. A review must name a KPI.
  BEGIN
    INSERT INTO public.pms_reviews
      (company_id, period_id, employee_id, goal_id, kpi_id, rater_id, rater_role, rating, submitted)
    VALUES (g.company_id, g.period_id, g.employee_id, g.id, NULL, rater, 'RM_L2', 3, false);
    RETURN QUERY SELECT 24, 'a review with no KPI is refused'::text, 'FAIL'::text,
                        'the insert was ACCEPTED'::text;
  EXCEPTION WHEN not_null_violation THEN
    RETURN QUERY SELECT 24, 'a review with no KPI is refused'::text, 'PASS'::text, NULL::text;
  END;

  -- 25. Unbalanced KPIs are reported — this KRA now has its own weightage
  --     plus the 3 added above, so it must come back as a fault.
  RETURN QUERY
    SELECT 25, 'unbalanced KPIs are reported'::text,
           CASE WHEN EXISTS (SELECT 1 FROM public.pms_validate_kpis(g.employee_id, g.period_id)
                              WHERE goal_id = g.id)
                THEN 'PASS' ELSE 'FAIL' END::text,
           (SELECT error_msg FROM public.pms_validate_kpis(g.employee_id, g.period_id)
             WHERE goal_id = g.id LIMIT 1);

  -- 26. Deleting a KRA takes its KPIs and their ratings with it.
  RETURN QUERY
    SELECT 26, 'KPIs cascade from their KRA'::text,
           CASE WHEN (SELECT confdeltype::text FROM pg_constraint
                       WHERE conrelid = 'public.pms_goal_kpi'::regclass AND contype = 'f'
                         AND confrelid = 'public.pms_employee_goals'::regclass) = 'c'
                THEN 'PASS' ELSE 'FAIL' END::text,
           (SELECT pg_get_constraintdef(oid) FROM pg_constraint
             WHERE conrelid = 'public.pms_goal_kpi'::regclass AND contype = 'f'
               AND confrelid = 'public.pms_employee_goals'::regclass);
  RETURN;
END
$fn$;

SELECT v.seq, v.check_name, v.result, v.detail
FROM (

  SELECT 1, 'pms_goal_kpi table exists'::text,
         (CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL — 220 not applied' END)::text, NULL::text
    FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name = 'pms_goal_kpi'

  UNION ALL
  SELECT 2, 'pms_reviews.kpi_id exists and is NOT NULL'::text,
         (CASE WHEN count(*) FILTER (WHERE is_nullable = 'NO') = 1 THEN 'PASS'
               WHEN count(*) = 1 THEN 'FAIL — still nullable; the backfill did not complete'
               ELSE 'FAIL — column missing' END)::text, NULL::text
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'pms_reviews' AND column_name = 'kpi_id'

  UNION ALL
  SELECT 3, 'the rating key now includes the KPI'::text,
         (CASE WHEN d LIKE '%kpi_id%' THEN 'PASS'
               WHEN d IS NULL THEN 'FAIL — pms_reviews_one_per_kpi_per_rater is missing'
               ELSE 'FAIL — key does not mention the KPI' END)::text, d
    FROM (SELECT (SELECT pg_get_constraintdef(oid) FROM pg_constraint
                   WHERE conrelid = 'public.pms_reviews'::regclass
                     AND conname = 'pms_reviews_one_per_kpi_per_rater') AS d) q3

  UNION ALL
  SELECT 4, 'the old per-KRA rating key is gone'::text,
         (CASE WHEN count(*) = 0 THEN 'PASS'
               ELSE 'FAIL — it would still cap a rater at one rating per KRA' END)::text, NULL::text
    FROM pg_constraint
   WHERE conrelid = 'public.pms_reviews'::regclass
     AND conname = 'pms_reviews_period_id_employee_id_goal_id_rater_role_key'

  -- ── the backfill ──
  UNION ALL
  SELECT 5, 'every KRA has at least one KPI'::text,
         (CASE WHEN count(*) = 0 THEN 'PASS'
               ELSE format('FAIL — %s KRA(s) have none', count(*)) END)::text, NULL::text
    FROM pms_employee_goals g
   WHERE NOT EXISTS (SELECT 1 FROM pms_goal_kpi k WHERE k.goal_id = g.id)

  UNION ALL
  SELECT 6, 'every review points at a KPI'::text,
         (CASE WHEN count(*) = 0 THEN 'PASS'
               ELSE format('FAIL — %s review(s) do not', count(*)) END)::text, NULL::text
    FROM pms_reviews WHERE kpi_id IS NULL

  UNION ALL
  SELECT 7, 'each review''s KPI belongs to its own KRA'::text,
         (CASE WHEN count(*) = 0 THEN 'PASS'
               ELSE format('FAIL — %s review(s) point across KRAs', count(*)) END)::text, NULL::text
    FROM pms_reviews r JOIN pms_goal_kpi k ON k.id = r.kpi_id
   WHERE k.goal_id <> r.goal_id

  UNION ALL
  SELECT 8, 'the backfilled KPI carries its KRA''s whole weightage'::text,
         (CASE WHEN count(*) = 0 THEN 'PASS'
               ELSE format('FAIL — %s KRA(s) disagree with their only KPI', count(*)) END)::text, NULL::text
    FROM (SELECT g.id FROM pms_employee_goals g
            JOIN pms_goal_kpi k ON k.goal_id = g.id
           GROUP BY g.id, g.weightage
          HAVING count(k.id) = 1 AND max(k.weightage) <> g.weightage) q8

  UNION ALL
  SELECT 9, 'no KRA on record is unbalanced'::text,
         (CASE WHEN count(*) = 0 THEN 'PASS'
               ELSE format('FAIL — %s KRA(s) whose KPIs do not total the KRA', count(*)) END)::text,
         (SELECT string_agg(error_msg, ' · ') FROM (
            SELECT error_msg FROM pms_employee_goals g2
              CROSS JOIN LATERAL pms_validate_kpis(g2.employee_id, g2.period_id) v2
             WHERE v2.goal_id = g2.id LIMIT 3) s)
    FROM (SELECT DISTINCT v.goal_id
            FROM pms_employee_goals g2
            CROSS JOIN LATERAL pms_validate_kpis(g2.employee_id, g2.period_id) v
           WHERE v.goal_id = g2.id) q9

  -- ── THE ONE THAT MATTERS: no score moved ──
  UNION ALL
  SELECT 10, 'every score is identical under the old and new formula'::text,
         (CASE WHEN COALESCE(max(diff), 0) = 0 THEN 'PASS'
               ELSE format('FAIL — largest disagreement %s', max(diff)) END)::text,
         format('%s appraisal/rater combinations compared, largest difference %s',
                count(*), COALESCE(max(diff), 0))
    FROM (
      SELECT ABS(
        ROUND(COALESCE(SUM(r.rating * g.weightage) / NULLIF(SUM(g.weightage), 0), 0), 2)
        - ROUND(COALESCE(SUM(r.rating * k.weightage) / NULLIF(SUM(k.weightage), 0), 0), 2)
      ) AS diff
        FROM pms_reviews r
        JOIN pms_employee_goals g ON g.id = r.goal_id
        JOIN pms_goal_kpi k       ON k.id = r.kpi_id
       WHERE r.submitted = true
       GROUP BY r.employee_id, r.period_id, r.rater_role) q10

  UNION ALL
  SELECT 11, 'the stored self_score still matches what pms_score returns'::text,
         (CASE WHEN count(*) = 0 THEN 'PASS'
               ELSE format('FAIL — %s row(s) drifted', count(*)) END)::text,
         (SELECT format('%s row(s) with a self_score checked',
                        count(*)) FROM pms_overall_rating WHERE self_score IS NOT NULL)
    FROM pms_overall_rating o
   WHERE o.self_score IS NOT NULL
     AND o.self_score <> pms_score(o.employee_id, o.period_id, 'SELF')

  -- 20 to 26: the behavioural checks.
  UNION ALL
  SELECT * FROM pg_temp.verify_kpi_rules()

  -- ── INFO ──
  UNION ALL
  SELECT 30, 'KRAs on record'::text, 'INFO'::text, count(*)::text FROM pms_employee_goals
  UNION ALL
  SELECT 31, 'KPIs on record'::text, 'INFO'::text, count(*)::text FROM pms_goal_kpi
  UNION ALL
  SELECT 32, 'ratings on record'::text, 'INFO'::text, count(*)::text FROM pms_reviews
  UNION ALL
  SELECT 33, 'KRAs carrying more than one KPI'::text, 'INFO'::text, count(*)::text
    FROM (SELECT goal_id FROM pms_goal_kpi GROUP BY goal_id HAVING count(*) > 1) q33

) AS v (seq, check_name, result, detail)
ORDER BY v.seq;

ROLLBACK;
