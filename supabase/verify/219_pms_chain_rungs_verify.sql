-- 219_pms_chain_rungs_verify.sql — run AFTER 218 and 219.
-- Builds fixtures and ROLLS THEM BACK, so it is safe on live data.
-- CREATES NOTHING THAT OUTLIVES THE QUERY. No table, no persistent function.
--
-- ── ONE RESULT SET, AND NO CREATE TABLE ──────────────────────────────────
--
-- Two things had to be true at once, and the obvious way to get them
-- conflicted:
--
--   The whole answer must arrive in ONE result set. A first version was
--   fifteen separate statements; the Supabase SQL editor returns the LAST
--   one's result and swallows RAISE NOTICE, so running it showed a single
--   PASS and hid the other fourteen checks — including every behavioural
--   one, which are the only reason this file exists. A verify script whose
--   output you cannot read is worse than none: it looks like it passed.
--
--   It must not trip the editor's "table without RLS" warning. The second
--   version collected rows in a TEMP table. That warning was a false
--   positive — a temp table lives in a session-private schema no other
--   connection can see, and this one never commits — but a script that
--   asks you to dismiss a security prompt every time is training you to
--   dismiss security prompts.
--
-- So the four behavioural checks live in a function in pg_temp, which exists
-- only for this session and is gone at ROLLBACK, and everything else is a
-- plain SELECT. They are UNION ALLed into one table at the bottom.
--
-- ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────
--
-- 218 shipped two defects that every unit test passed over, because the
-- tests asserted what the MIGRATION SAYS rather than what the database DOES:
--
--   1. CHECK (array_length(rungs, 1) >= 1) accepted an empty array, because
--      array_length('{}', 1) is NULL and a NULL CHECK is satisfied. The test
--      matched the constraint's text, which was present and inert.
--
--   2. The COMMENT named rm_l1_id and rm_l2_id as the columns resolving
--      RM L1 and RM L2. Neither exists. The test compared the application's
--      list against that COMMENT — one copied from the other, so they agreed
--      and were both wrong.
--
-- Checks 4 to 7 cannot pass unless Postgres actually refuses the row. Check
-- 8 cannot pass unless the columns are really on the table. That is the
-- difference, and it is the project's own rule: ENGINE COMPUTES, SQL DECIDES.
--
-- READ THE RESULT: anything whose `result` is not PASS or INFO is a problem.
--
-- ── LAST RUN: 2026-11-06, 15 PASS · 5 INFO · 0 FAIL ────────────────────────
--
-- Check 4 is the one that mattered: Postgres actually refused the empty
-- array — "new row for relation pms_chain violates check constraint
-- pms_chain_has_rungs". 218's version of that constraint accepted it, and
-- every unit test passed over the defect because they read the migration's
-- text rather than asking the database.
--
-- Check 8 closed the other gap. site_hr_id and regional_head_id appear in no
-- migration and nowhere else in the product, so nothing in the repository
-- could prove they exist; information_schema returned all five rung columns,
-- and check 9 confirmed the rm_l1_id / rm_l2_id that 218 wrongly documented
-- are not there.
--
-- Coverage that run: HOD 398/398 · RM_L1 395/398 · SITE_HR 395/398 ·
-- RM_L2 261/398 · REGIONAL_HEAD 0/398. The same numbers the chain builder
-- shows, arrived at independently.

BEGIN;

-- ── the four checks that have to actually break something ────────────────
--
-- In pg_temp: created for this session only, never visible to another
-- connection, and dropped by the ROLLBACK at the end. Tables are what the
-- RLS warning is about; this is not one.
CREATE FUNCTION pg_temp.verify_chain_rules()
RETURNS TABLE (seq int, check_name text, result text, detail text)
LANGUAGE plpgsql AS $fn$
DECLARE co uuid;
BEGIN
  SELECT id INTO co FROM public.companies LIMIT 1;
  IF co IS NULL THEN
    RETURN QUERY SELECT 4, 'the constraints actually refuse'::text,
                        'SKIP'::text, 'no company row to hang a fixture on'::text;
    RETURN;
  END IF;

  -- 4. THE DEFECT 219 FIXES. Not "is the constraint written" — does the
  --    INSERT fail.
  BEGIN
    INSERT INTO public.pms_chain (company_id, name, rungs)
    VALUES (co, '__verify_empty__', ARRAY[]::text[]);
    RETURN QUERY SELECT 4, 'an empty chain is refused'::text,
                        'FAIL'::text, 'the insert was ACCEPTED'::text;
  EXCEPTION WHEN check_violation THEN
    RETURN QUERY SELECT 4, 'an empty chain is refused'::text,
                        'PASS'::text, SQLERRM::text;
  END;

  -- 5. a rung nothing can resolve to a person.
  BEGIN
    INSERT INTO public.pms_chain (company_id, name, rungs)
    VALUES (co, '__verify_unknown__', ARRAY['EMPLOYEE','FINANCE','HR']);
    RETURN QUERY SELECT 5, 'an unresolvable rung is refused'::text,
                        'FAIL'::text, 'the insert was ACCEPTED'::text;
  EXCEPTION WHEN check_violation THEN
    RETURN QUERY SELECT 5, 'an unresolvable rung is refused'::text,
                        'PASS'::text, NULL::text;
  END;

  -- 6. DONE is the terminal marker, not a rung an appraisal waits on.
  BEGIN
    INSERT INTO public.pms_chain (company_id, name, rungs)
    VALUES (co, '__verify_done__', ARRAY['EMPLOYEE','HOD','DONE']);
    RETURN QUERY SELECT 6, 'DONE is refused as a rung'::text,
                        'FAIL'::text, 'the insert was ACCEPTED'::text;
  EXCEPTION WHEN check_violation THEN
    RETURN QUERY SELECT 6, 'DONE is refused as a rung'::text,
                        'PASS'::text, NULL::text;
  END;

  -- 7. And every rung the builder OFFERS must be accepted, or an
  --    administrator can compose a chain the database then rejects.
  --    Catches `others`: this one should fail loudly on ANY error.
  BEGIN
    INSERT INTO public.pms_chain (company_id, name, rungs)
    VALUES (co, '__verify_all__',
            ARRAY['EMPLOYEE','RM_L1','RM_L2','HOD','SITE_HR',
                  'REGIONAL_HEAD','HR']);
    RETURN QUERY SELECT 7, 'every offerable rung is accepted'::text,
                        'PASS'::text, NULL::text;
  EXCEPTION WHEN others THEN
    RETURN QUERY SELECT 7, 'every offerable rung is accepted'::text,
                        'FAIL'::text, SQLERRM::text;
  END;

  RETURN;
END
$fn$;

-- ── everything, in one table ─────────────────────────────────────────────
SELECT v.seq, v.check_name, v.result, v.detail
FROM (

  -- 0. both migrations are in.
  SELECT 1, 'pms_chain table exists'::text,
         (CASE WHEN count(*) = 1 THEN 'PASS'
               ELSE 'FAIL — 218 not applied' END)::text, NULL::text
    FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name = 'pms_chain'

  UNION ALL
  SELECT 2, 'pms_policies.chain_id exists'::text,
         (CASE WHEN count(*) = 1 THEN 'PASS'
               ELSE 'FAIL — 218 not applied' END)::text, NULL::text
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'pms_policies' AND column_name = 'chain_id'

  -- A scalar subquery, so a MISSING constraint yields NULL and is reported.
  -- `… FROM pg_constraint WHERE conname = …` returns no row at all when the
  -- constraint is absent, and a check that prints nothing reads as a pass.
  UNION ALL
  SELECT 3, 'the empty-chain CHECK uses cardinality'::text,
         (CASE WHEN d LIKE '%cardinality%' THEN 'PASS'
               WHEN d IS NULL THEN 'FAIL — pms_chain_has_rungs does not exist'
               ELSE 'FAIL — 219 not applied; the CHECK is still inert' END)::text,
         d
    FROM (SELECT (SELECT pg_get_constraintdef(oid) FROM pg_constraint
                   WHERE conrelid = 'public.pms_chain'::regclass
                     AND conname = 'pms_chain_has_rungs') AS d) q3

  -- 4 to 7: the behavioural checks.
  UNION ALL
  SELECT * FROM pg_temp.verify_chain_rules()

  -- 8 to 10: the documented columns exist on employees. The check that would
  -- have caught 218's second defect — asked of the table, not of the COMMENT
  -- that describes it.
  UNION ALL
  SELECT 8, 'every rung resolves through a real column'::text,
         (CASE WHEN count(*) = 5 THEN 'PASS'
               ELSE 'FAIL — a rung resolves through a column that does not exist'
          END)::text,
         coalesce(string_agg(column_name::text, ', ' ORDER BY column_name), '(none)')
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'employees'
     AND column_name IN ('l1_manager_id','l2_manager_id','hod_id',
                         'site_hr_id','regional_head_id')

  UNION ALL
  SELECT 9, 'the names 218 wrongly documented are not real'::text,
         (CASE WHEN count(*) = 0 THEN 'PASS'
               ELSE 'FAIL — rm_l1_id/rm_l2_id exist; check which is canonical'
          END)::text, NULL::text
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'employees'
     AND column_name IN ('rm_l1_id','rm_l2_id')

  UNION ALL
  SELECT 10, 'the COMMENT names the real columns'::text,
         (CASE WHEN d LIKE '%l1_manager_id%' AND d LIKE '%l2_manager_id%'
                    AND d NOT LIKE '%rm_l1_id%' AND d NOT LIKE '%rm_l2_id%'
               THEN 'PASS'
               WHEN d IS NULL THEN 'FAIL — pms_chain.rungs has no COMMENT'
               ELSE 'FAIL — the COMMENT still names columns that do not exist'
          END)::text, d
    FROM (SELECT col_description(a.attrelid, a.attnum) AS d
            FROM pg_attribute a
           WHERE a.attrelid = 'public.pms_chain'::regclass
             AND a.attname = 'rungs') q10

  -- 11 to 14: the two widened CHECKs, and what they must not have dropped.
  UNION ALL
  SELECT 11, 'chain_stage accepts SITE_HR and REGIONAL_HEAD'::text,
         (CASE WHEN d LIKE '%SITE_HR%' AND d LIKE '%REGIONAL_HEAD%' THEN 'PASS'
               WHEN d IS NULL THEN 'FAIL — the CHECK is gone entirely'
               ELSE 'FAIL — not widened' END)::text, d
    FROM (SELECT (SELECT pg_get_constraintdef(oid) FROM pg_constraint
                   WHERE conrelid = 'public.pms_overall_rating'::regclass
                     AND conname = 'pms_overall_rating_chain_stage_allowed') AS d) q11

  UNION ALL
  SELECT 12, 'rater_role accepts SITE_HR and REGIONAL_HEAD'::text,
         (CASE WHEN d LIKE '%SITE_HR%' AND d LIKE '%REGIONAL_HEAD%' THEN 'PASS'
               WHEN d IS NULL THEN 'FAIL — the CHECK is gone entirely'
               ELSE 'FAIL — not widened' END)::text, d
    FROM (SELECT (SELECT pg_get_constraintdef(oid) FROM pg_constraint
                   WHERE conrelid = 'public.pms_reviews'::regclass
                     AND conname = 'pms_reviews_rater_role_allowed') AS d) q12

  -- A CHECK is recreated whole, so widening it is also the moment a value
  -- silently disappears.
  UNION ALL
  SELECT 13, 'HR_HEAD can still rate (214)'::text,
         (CASE WHEN d LIKE '%HR_HEAD%' THEN 'PASS'
               WHEN d IS NULL THEN 'FAIL — the CHECK is gone entirely'
               ELSE 'FAIL — HR_HEAD lost its place as a rater' END)::text, NULL::text
    FROM (SELECT (SELECT pg_get_constraintdef(oid) FROM pg_constraint
                   WHERE conrelid = 'public.pms_reviews'::regclass
                     AND conname = 'pms_reviews_rater_role_allowed') AS d) q13

  -- NULL chain_stage means "not submitted", which 197 is explicit is
  -- distinct from EMPLOYEE: "never started" and "sent back" look identical
  -- otherwise.
  UNION ALL
  SELECT 14, 'chain_stage is still nullable'::text,
         (CASE WHEN d LIKE '%chain_stage IS NULL%' THEN 'PASS'
               WHEN d IS NULL THEN 'FAIL — the CHECK is gone entirely'
               ELSE 'FAIL — "not submitted" and "with the employee" collapse'
          END)::text, NULL::text
    FROM (SELECT (SELECT pg_get_constraintdef(oid) FROM pg_constraint
                   WHERE conrelid = 'public.pms_overall_rating'::regclass
                     AND conname = 'pms_overall_rating_chain_stage_allowed') AS d) q14

  -- 15. deleting a chain does not take its policies with it.
  --
  -- confdeltype is "char" — Postgres's internal single-byte type, NOT text —
  -- so an untyped literal cannot pick a || operator against it. Cast it.
  UNION ALL
  SELECT 15, 'deleting a chain spares the policy'::text,
         (CASE WHEN t = 'n' THEN 'PASS'
               WHEN t IS NULL THEN 'FAIL — no FK from pms_policies to pms_chain'
               ELSE 'FAIL — not ON DELETE SET NULL (' || t || ')' END)::text, def
    FROM (SELECT (SELECT confdeltype::text FROM pg_constraint
                   WHERE conrelid = 'public.pms_policies'::regclass AND contype = 'f'
                     AND confrelid = 'public.pms_chain'::regclass) AS t,
                 (SELECT pg_get_constraintdef(oid) FROM pg_constraint
                   WHERE conrelid = 'public.pms_policies'::regclass AND contype = 'f'
                     AND confrelid = 'public.pms_chain'::regclass) AS def) q15

  -- 21 to 25: the coverage the builder shows.
  --
  -- INFO, not PASS/FAIL: these are facts about the data, not the schema, and
  -- they move. REGIONAL_HEAD at 0 is the one that matters — a chain naming
  -- it is skipped for everybody, which is why the builder puts the number
  -- next to the choice rather than in a footnote.
  UNION ALL
  SELECT (20 + row_number() OVER (ORDER BY rung))::int,
         ('coverage · ' || rung)::text, 'INFO'::text,
         (have::text || ' of ' || total::text || ' have one')::text
    FROM (
      SELECT 'HOD' AS rung, count(hod_id) AS have, count(*) AS total
        FROM employees WHERE date_of_leaving IS NULL
      UNION ALL SELECT 'RM_L1', count(l1_manager_id), count(*)
        FROM employees WHERE date_of_leaving IS NULL
      UNION ALL SELECT 'RM_L2', count(l2_manager_id), count(*)
        FROM employees WHERE date_of_leaving IS NULL
      UNION ALL SELECT 'SITE_HR', count(site_hr_id), count(*)
        FROM employees WHERE date_of_leaving IS NULL
      UNION ALL SELECT 'REGIONAL_HEAD', count(regional_head_id), count(*)
        FROM employees WHERE date_of_leaving IS NULL
    ) c

) AS v (seq, check_name, result, detail)
ORDER BY v.seq;

ROLLBACK;
