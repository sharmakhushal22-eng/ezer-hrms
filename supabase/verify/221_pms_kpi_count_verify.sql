-- 221_pms_kpi_count_verify.sql — run AFTER 221.
-- Builds fixtures and ROLLS THEM BACK, so it is safe on live data.
-- CREATES NOTHING THAT OUTLIVES THE QUERY. One result set, no table.
--
-- ── WHAT THIS IS CHECKING ──────────────────────────────────────────────────
--
-- 221 makes the number of KPIs a KRA may hold a policy setting, default 1 to
-- 5. There are three claims to test and only one of them is about columns:
--
--   the columns exist, with the right defaults and a working pair CHECK
--   the CEILING actually refuses a write (trg_pms_kpi_count)
--   the FLOOR actually blocks a submission (pms_validate_kpis -> pms_lock_kras)
--
-- The second and third are the ones worth running. A column with a default is
-- easy to add and easy to leave inert — which is exactly what happened to the
-- old MIN_KPI_PER_KRA constant, and to pms_validate_kpis itself, which until
-- this migration was called by nothing at all.
--
-- ── WHAT IT DELIBERATELY DOES NOT CHECK ────────────────────────────────────
--
-- It does not assert that existing data obeys the new maximum. It must not:
-- the trigger fires on INSERT only, precisely so that lowering the setting
-- never bricks KRAs already written. Check 40 REPORTS any KRA already over
-- the limit instead, so it is visible and fixable without blocking anything.
--
-- READ THE RESULT: anything whose `result` is not PASS or INFO is a problem.

BEGIN;

CREATE FUNCTION pg_temp.verify_kpi_counts()
RETURNS TABLE (seq int, check_name text, result text, detail text)
LANGUAGE plpgsql AS $fn$
DECLARE
  g record; pol_id uuid; old_max int; old_min int;
  made int := 0; i int; k uuid; msg text; locked text;
BEGIN
  -- A real KRA, in a period that has a policy — the trigger reads the policy
  -- through the period, so a fixture on a period without one proves nothing.
  SELECT gg.* INTO g
    FROM public.pms_employee_goals gg
    JOIN public.pms_periods pe ON pe.id = gg.period_id
   WHERE gg.status <> 'SENT_BACK' AND pe.policy_id IS NOT NULL
   ORDER BY gg.created_at DESC LIMIT 1;

  IF g IS NULL THEN
    RETURN QUERY SELECT 20, 'the ceiling refuses a write'::text, 'SKIP'::text,
      'no KRA in a period with a policy to hang a fixture on'::text;
    RETURN;
  END IF;

  SELECT pe.policy_id INTO pol_id FROM public.pms_periods pe WHERE pe.id = g.period_id;
  SELECT max_kpi_per_kra, min_kpi_per_kra INTO old_max, old_min
    FROM public.pms_policies WHERE id = pol_id;

  -- ── 20. the ceiling refuses the write ───────────────────────────────────
  -- Set the maximum to exactly what this KRA already holds, then try to add
  -- one. Pinning it to the CURRENT count rather than to a literal means the
  -- check works whatever the fixture KRA happens to carry.
  SELECT count(*) INTO made FROM public.pms_goal_kpi WHERE goal_id = g.id;
  UPDATE public.pms_policies SET max_kpi_per_kra = GREATEST(made, 1) WHERE id = pol_id;

  BEGIN
    INSERT INTO public.pms_goal_kpi
      (company_id, period_id, employee_id, goal_id, seq_no, kpi_metric, weightage)
    VALUES (g.company_id, g.period_id, g.employee_id, g.id, 931, '__verify_over__', 1);
    RETURN QUERY SELECT 20, 'the ceiling refuses a write'::text, 'FAIL'::text,
      format('a KPI beyond max_kpi_per_kra=%s was accepted', GREATEST(made, 1));
  EXCEPTION WHEN check_violation OR raise_exception THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    RETURN QUERY SELECT 20, 'the ceiling refuses a write'::text, 'PASS'::text,
      left(msg, 90);
  END;

  -- ── 21. and the refusal names the limit and where to change it ──────────
  -- A refusal that says "constraint violated" sends the reader to a DBA. The
  -- sentence has to say what the limit is and which screen owns it.
  IF msg IS NOT NULL AND msg LIKE '%Setup and%Configuration%' THEN
    RETURN QUERY SELECT 21, 'the refusal says where to change the limit'::text,
      'PASS'::text, 'names Setup and Configuration'::text;
  ELSE
    RETURN QUERY SELECT 21, 'the refusal says where to change the limit'::text,
      'FAIL'::text, COALESCE(left(msg, 90), 'no message captured');
  END IF;

  -- ── 22. raising the maximum lets the same write through ─────────────────
  -- The mirror of 20. Without it, a trigger that refused EVERYTHING would
  -- pass check 20 and look correct.
  UPDATE public.pms_policies SET max_kpi_per_kra = GREATEST(made, 1) + 2 WHERE id = pol_id;
  BEGIN
    INSERT INTO public.pms_goal_kpi
      (company_id, period_id, employee_id, goal_id, seq_no, kpi_metric, weightage)
    VALUES (g.company_id, g.period_id, g.employee_id, g.id, 932, '__verify_ok__', 1)
    RETURNING id INTO k;
    RETURN QUERY SELECT 22, 'under the ceiling the write is allowed'::text,
      'PASS'::text, 'a KPI below the maximum was accepted'::text;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    RETURN QUERY SELECT 22, 'under the ceiling the write is allowed'::text,
      'FAIL'::text, left(msg, 90);
  END;

  -- ── 23. an UPDATE still works at the ceiling ────────────────────────────
  -- THE POINT OF INSERT-ONLY. Lower the maximum under the KRA's feet and
  -- edit a row it already has: that must still be possible, or tightening
  -- the setting would freeze every KRA written under the looser one.
  UPDATE public.pms_policies SET max_kpi_per_kra = 1 WHERE id = pol_id;
  BEGIN
    UPDATE public.pms_goal_kpi SET kpi_metric = '__verify_edited__' WHERE id = k;
    RETURN QUERY SELECT 23, 'lowering the maximum does not freeze existing KPIs'::text,
      'PASS'::text, 'an existing KPI was still editable over the limit'::text;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    RETURN QUERY SELECT 23, 'lowering the maximum does not freeze existing KPIs'::text,
      'FAIL'::text, left(msg, 90);
  END;

  -- ── 24. the floor blocks the submission ─────────────────────────────────
  -- Ask for more KPIs per KRA than anybody has, and pms_lock_kras must refuse
  -- rather than lock. This is the check that would have failed before 221,
  -- when pms_validate_kpis was called by nothing.
  UPDATE public.pms_policies
     SET min_kpi_per_kra = 9, max_kpi_per_kra = 20 WHERE id = pol_id;
  locked := public.pms_lock_kras(g.employee_id, g.period_id, NULL);
  IF locked LIKE 'BLOCKED:%' AND locked LIKE '%at least 9%' THEN
    RETURN QUERY SELECT 24, 'the floor blocks the submission'::text, 'PASS'::text,
      left(locked, 90);
  ELSIF locked LIKE 'BLOCKED:%' THEN
    -- Blocked, but by something else — the KRA set may be invalid for an
    -- unrelated reason, so this is not a failure of 221.
    RETURN QUERY SELECT 24, 'the floor blocks the submission'::text, 'INFO'::text,
      format('blocked, but not by the KPI floor: %s', left(locked, 70));
  ELSE
    RETURN QUERY SELECT 24, 'the floor blocks the submission'::text, 'FAIL'::text,
      format('pms_lock_kras returned %s with min_kpi_per_kra=9', left(locked, 60));
  END IF;

  -- ── 25. the pair CHECK refuses an inverted range ────────────────────────
  BEGIN
    UPDATE public.pms_policies SET min_kpi_per_kra = 5, max_kpi_per_kra = 3
     WHERE id = pol_id;
    RETURN QUERY SELECT 25, 'min above max is refused'::text, 'FAIL'::text,
      'a policy with min 5 and max 3 was saved'::text;
  EXCEPTION WHEN check_violation THEN
    RETURN QUERY SELECT 25, 'min above max is refused'::text, 'PASS'::text,
      'pms_policies_kpi_range held'::text;
  END;

  -- ── 26. a minimum below one is refused ──────────────────────────────────
  BEGIN
    UPDATE public.pms_policies SET min_kpi_per_kra = 0 WHERE id = pol_id;
    RETURN QUERY SELECT 26, 'a minimum of zero is refused'::text, 'FAIL'::text,
      'min_kpi_per_kra accepted 0 — a KRA with no measure cannot be rated'::text;
  EXCEPTION WHEN check_violation THEN
    RETURN QUERY SELECT 26, 'a minimum of zero is refused'::text, 'PASS'::text,
      'pms_policies_kpi_range held'::text;
  END;
END $fn$;

SELECT v.seq, v.check_name, v.result, v.detail
FROM (

  -- ── the columns ──
  SELECT 1, 'min_kpi_per_kra exists'::text,
         CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                            WHERE table_name = 'pms_policies'
                              AND column_name = 'min_kpi_per_kra')
              THEN 'PASS' ELSE 'FAIL' END::text,
         COALESCE((SELECT column_default FROM information_schema.columns
                    WHERE table_name = 'pms_policies'
                      AND column_name = 'min_kpi_per_kra'), 'absent')::text
  UNION ALL
  SELECT 2, 'max_kpi_per_kra exists'::text,
         CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                            WHERE table_name = 'pms_policies'
                              AND column_name = 'max_kpi_per_kra')
              THEN 'PASS' ELSE 'FAIL' END::text,
         COALESCE((SELECT column_default FROM information_schema.columns
                    WHERE table_name = 'pms_policies'
                      AND column_name = 'max_kpi_per_kra'), 'absent')::text
  UNION ALL
  -- The DEFAULTS are the requested 1 and 5. A column that exists with the
  -- wrong default is the kind of thing nobody notices until a policy created
  -- months later behaves unlike every other one.
  SELECT 3, 'the defaults are 1 and 5'::text,
         CASE WHEN (SELECT column_default FROM information_schema.columns
                     WHERE table_name = 'pms_policies'
                       AND column_name = 'min_kpi_per_kra') LIKE '1%'
               AND (SELECT column_default FROM information_schema.columns
                     WHERE table_name = 'pms_policies'
                       AND column_name = 'max_kpi_per_kra') LIKE '5%'
              THEN 'PASS' ELSE 'FAIL' END::text,
         format('min default %s, max default %s',
                COALESCE((SELECT column_default FROM information_schema.columns
                           WHERE table_name = 'pms_policies'
                             AND column_name = 'min_kpi_per_kra'), '?'),
                COALESCE((SELECT column_default FROM information_schema.columns
                           WHERE table_name = 'pms_policies'
                             AND column_name = 'max_kpi_per_kra'), '?'))::text
  UNION ALL
  SELECT 4, 'both columns are NOT NULL'::text,
         CASE WHEN (SELECT count(*) FROM information_schema.columns
                     WHERE table_name = 'pms_policies'
                       AND column_name IN ('min_kpi_per_kra', 'max_kpi_per_kra')
                       AND is_nullable = 'NO') = 2
              THEN 'PASS' ELSE 'FAIL' END::text,
         'a null limit would read as "no rule"'::text

  -- ── the constraint and the trigger exist ──
  UNION ALL
  SELECT 5, 'the pair CHECK exists'::text,
         CASE WHEN EXISTS (SELECT 1 FROM pg_constraint
                            WHERE conname = 'pms_policies_kpi_range')
              THEN 'PASS' ELSE 'FAIL' END::text,
         COALESCE((SELECT pg_get_constraintdef(oid) FROM pg_constraint
                    WHERE conname = 'pms_policies_kpi_range'), 'absent')::text
  UNION ALL
  SELECT 6, 'the ceiling trigger is attached'::text,
         CASE WHEN EXISTS (SELECT 1 FROM pg_trigger
                            WHERE tgname = 'trg_pms_kpi_count'
                              AND tgrelid = 'public.pms_goal_kpi'::regclass
                              AND NOT tgisinternal)
              THEN 'PASS' ELSE 'FAIL' END::text,
         'trg_pms_kpi_count on pms_goal_kpi'::text
  UNION ALL
  -- INSERT ONLY, and this is the check that says so. tgtype bit 2 (value 4)
  -- is INSERT and bit 4 (value 16) is UPDATE; an UPDATE trigger here would
  -- freeze existing KPIs the moment the maximum was lowered.
  SELECT 7, 'the trigger fires on INSERT and not UPDATE'::text,
         CASE WHEN (SELECT (tgtype & 4) <> 0 AND (tgtype & 16) = 0
                      FROM pg_trigger WHERE tgname = 'trg_pms_kpi_count'
                        AND tgrelid = 'public.pms_goal_kpi'::regclass
                        AND NOT tgisinternal)
              THEN 'PASS' ELSE 'FAIL' END::text,
         'an UPDATE trigger would freeze KPIs written under a looser limit'::text
  UNION ALL
  SELECT 8, 'pms_lock_kras consults pms_validate_kpis'::text,
         CASE WHEN (SELECT prosrc FROM pg_proc WHERE proname = 'pms_lock_kras'
                     LIMIT 1) LIKE '%pms_validate_kpis%'
              THEN 'PASS' ELSE 'FAIL' END::text,
         'without this the floor is enforced only by the browser'::text
  UNION ALL
  -- pms_lock_kras is reproduced from 074 in 221. If the reproduction dropped
  -- something, the cycle stalls after the manager locks and nothing says why.
  SELECT 9, 'pms_lock_kras still moves the appraisal to KRA_LOCKED'::text,
         CASE WHEN (SELECT prosrc FROM pg_proc WHERE proname = 'pms_lock_kras'
                     LIMIT 1) LIKE '%pms_overall_rating%KRA_LOCKED%'
              THEN 'PASS' ELSE 'FAIL' END::text,
         'the 074 body must survive 221 intact apart from the KPI check'::text

  -- ── the behavioural checks ──
  UNION ALL
  SELECT * FROM pg_temp.verify_kpi_counts()

  -- ── INFO ──
  UNION ALL
  SELECT 40, 'KRAs already over their policy maximum'::text, 'INFO'::text,
         (SELECT count(*)::text FROM (
            SELECT k.goal_id
              FROM pms_goal_kpi k
              JOIN pms_periods pe ON pe.id = k.period_id
              JOIN pms_policies p ON p.id = pe.policy_id
             GROUP BY k.goal_id, p.max_kpi_per_kra
            HAVING count(*) > p.max_kpi_per_kra) q40)
  UNION ALL
  SELECT 41, 'KRAs under their policy minimum'::text, 'INFO'::text,
         (SELECT count(*)::text FROM (
            SELECT g.id
              FROM pms_employee_goals g
              JOIN pms_periods pe ON pe.id = g.period_id
              JOIN pms_policies p ON p.id = pe.policy_id
              LEFT JOIN pms_goal_kpi k ON k.goal_id = g.id
             WHERE g.status <> 'SENT_BACK'
             GROUP BY g.id, p.min_kpi_per_kra
            HAVING count(k.id) < p.min_kpi_per_kra) q41)
  UNION ALL
  SELECT 42, 'the widest KRA on record'::text, 'INFO'::text,
         COALESCE((SELECT max(n)::text FROM (
            SELECT count(*) AS n FROM pms_goal_kpi GROUP BY goal_id) q42), '0')
  UNION ALL
  SELECT 43, 'policies, and their KPI ranges'::text, 'INFO'::text,
         COALESCE((SELECT string_agg(format('%s: %s-%s', policy_code,
                                            min_kpi_per_kra, max_kpi_per_kra), ', ')
                     FROM pms_policies WHERE COALESCE(is_active, true)), 'none')

) AS v (seq, check_name, result, detail)
ORDER BY v.seq;

ROLLBACK;
