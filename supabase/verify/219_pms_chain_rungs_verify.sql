-- 219_pms_chain_rungs_verify.sql — run AFTER 218 and 219.
-- Builds fixtures and ROLLS THEM BACK, so it is safe on live data.
--
-- ── ONE RESULT SET, ON PURPOSE ───────────────────────────────────────────
--
-- A first version was fifteen separate statements. The Supabase SQL editor
-- shows the LAST statement's result and swallows RAISE NOTICE entirely, so
-- running it showed exactly one PASS and hid the other fourteen checks —
-- including every behavioural one, which were the whole point. A verify
-- script you cannot read the output of is worse than none: it looks like it
-- passed.
--
-- So every check writes a row into a temp table and the final SELECT returns
-- all of them together. Sort by seq; anything not PASS or INFO is a problem.
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
-- Checks 4 to 7 below cannot pass unless Postgres actually refuses the row.
-- Check 8 cannot pass unless the columns are really on the table. That is
-- the difference, and it is the project's own rule: ENGINE COMPUTES, SQL
-- DECIDES.

BEGIN;

CREATE TEMP TABLE _verify (
  seq int, check_name text, result text, detail text
) ON COMMIT DROP;

-- ── 0. both migrations are in ────────────────────────────────────────────

INSERT INTO _verify
SELECT 1, 'pms_chain table exists',
       CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL — 218 not applied' END,
       NULL
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name = 'pms_chain';

INSERT INTO _verify
SELECT 2, 'pms_policies.chain_id exists',
       CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL — 218 not applied' END,
       NULL
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'pms_policies' AND column_name = 'chain_id';

-- A scalar subquery, so a MISSING constraint yields NULL and is reported.
-- `… FROM pg_constraint WHERE conname = …` returns no row at all when the
-- constraint is absent, and a check that prints nothing reads as a pass.
INSERT INTO _verify
SELECT 3, 'the empty-chain CHECK uses cardinality',
       CASE WHEN d LIKE '%cardinality%' THEN 'PASS'
            WHEN d IS NULL THEN 'FAIL — pms_chain_has_rungs does not exist'
            ELSE 'FAIL — 219 not applied; the CHECK is still inert' END,
       d
  FROM (SELECT (SELECT pg_get_constraintdef(oid) FROM pg_constraint
                 WHERE conrelid = 'pms_chain'::regclass
                   AND conname = 'pms_chain_has_rungs') AS d) q;

-- ── 1. the constraints are tested by trying to break them ────────────────
--
-- The test 218 needed and did not have. Not "is the constraint written" —
-- does the INSERT fail.

DO $$
DECLARE co uuid;
BEGIN
  SELECT id INTO co FROM companies LIMIT 1;
  IF co IS NULL THEN
    INSERT INTO _verify VALUES (4, 'an empty chain is refused', 'SKIP',
                                'no company row to hang a fixture on');
    RETURN;
  END IF;

  -- 4. THE DEFECT 219 FIXES.
  BEGIN
    INSERT INTO pms_chain (company_id, name, rungs)
    VALUES (co, '__verify_empty__', ARRAY[]::text[]);
    INSERT INTO _verify VALUES (4, 'an empty chain is refused', 'FAIL',
                                'the insert was ACCEPTED');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _verify VALUES (4, 'an empty chain is refused', 'PASS', SQLERRM);
  END;

  -- 5. a rung nothing can resolve to a person.
  BEGIN
    INSERT INTO pms_chain (company_id, name, rungs)
    VALUES (co, '__verify_unknown__', ARRAY['EMPLOYEE','FINANCE','HR']);
    INSERT INTO _verify VALUES (5, 'an unresolvable rung is refused', 'FAIL',
                                'the insert was ACCEPTED');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _verify VALUES (5, 'an unresolvable rung is refused', 'PASS', NULL);
  END;

  -- 6. DONE is the terminal marker, not a rung an appraisal waits on.
  BEGIN
    INSERT INTO pms_chain (company_id, name, rungs)
    VALUES (co, '__verify_done__', ARRAY['EMPLOYEE','HOD','DONE']);
    INSERT INTO _verify VALUES (6, 'DONE is refused as a rung', 'FAIL',
                                'the insert was ACCEPTED');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _verify VALUES (6, 'DONE is refused as a rung', 'PASS', NULL);
  END;

  -- 7. And every rung the builder OFFERS must be accepted, or an
  --    administrator can compose a chain the database then rejects.
  BEGIN
    INSERT INTO pms_chain (company_id, name, rungs)
    VALUES (co, '__verify_all__',
            ARRAY['EMPLOYEE','RM_L1','RM_L2','HOD','SITE_HR',
                  'REGIONAL_HEAD','HR']);
    INSERT INTO _verify VALUES (7, 'every offerable rung is accepted', 'PASS', NULL);
  EXCEPTION WHEN others THEN
    INSERT INTO _verify VALUES (7, 'every offerable rung is accepted', 'FAIL', SQLERRM);
  END;
END $$;

-- ── 2. the documented columns exist on employees ─────────────────────────
--
-- The check that would have caught 218's second defect. Asked of the table,
-- not of the COMMENT that describes it.

INSERT INTO _verify
SELECT 8, 'every rung resolves through a real column',
       CASE WHEN count(*) = 5 THEN 'PASS'
            ELSE 'FAIL — a rung resolves through a column that does not exist' END,
       coalesce(string_agg(column_name::text, ', ' ORDER BY column_name), '(none)')
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'employees'
   AND column_name IN ('l1_manager_id','l2_manager_id','hod_id',
                       'site_hr_id','regional_head_id');

INSERT INTO _verify
SELECT 9, 'the names 218 wrongly documented are not real',
       CASE WHEN count(*) = 0 THEN 'PASS'
            ELSE 'FAIL — rm_l1_id/rm_l2_id exist; check which is canonical' END,
       NULL
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'employees'
   AND column_name IN ('rm_l1_id','rm_l2_id');

INSERT INTO _verify
SELECT 10, 'the COMMENT names the real columns',
       CASE WHEN d LIKE '%l1_manager_id%' AND d LIKE '%l2_manager_id%'
                 AND d NOT LIKE '%rm_l1_id%' AND d NOT LIKE '%rm_l2_id%'
            THEN 'PASS'
            WHEN d IS NULL THEN 'FAIL — pms_chain.rungs has no COMMENT'
            ELSE 'FAIL — the COMMENT still names columns that do not exist' END,
       d
  FROM (SELECT col_description(a.attrelid, a.attnum) AS d
          FROM pg_attribute a
         WHERE a.attrelid = 'pms_chain'::regclass
           AND a.attname = 'rungs') q;

-- ── 3. the two widened CHECKs ────────────────────────────────────────────

INSERT INTO _verify
SELECT 11, 'chain_stage accepts SITE_HR and REGIONAL_HEAD',
       CASE WHEN d LIKE '%SITE_HR%' AND d LIKE '%REGIONAL_HEAD%' THEN 'PASS'
            WHEN d IS NULL THEN 'FAIL — the CHECK is gone entirely'
            ELSE 'FAIL — not widened' END,
       d
  FROM (SELECT (SELECT pg_get_constraintdef(oid) FROM pg_constraint
                 WHERE conrelid = 'pms_overall_rating'::regclass
                   AND conname = 'pms_overall_rating_chain_stage_allowed') AS d) q;

INSERT INTO _verify
SELECT 12, 'rater_role accepts SITE_HR and REGIONAL_HEAD',
       CASE WHEN d LIKE '%SITE_HR%' AND d LIKE '%REGIONAL_HEAD%' THEN 'PASS'
            WHEN d IS NULL THEN 'FAIL — the CHECK is gone entirely'
            ELSE 'FAIL — not widened' END,
       d
  FROM (SELECT (SELECT pg_get_constraintdef(oid) FROM pg_constraint
                 WHERE conrelid = 'pms_reviews'::regclass
                   AND conname = 'pms_reviews_rater_role_allowed') AS d) q;

-- A CHECK is recreated whole, so widening it is also the moment a value
-- silently disappears.
INSERT INTO _verify
SELECT 13, 'HR_HEAD can still rate (214)',
       CASE WHEN d LIKE '%HR_HEAD%' THEN 'PASS'
            WHEN d IS NULL THEN 'FAIL — the CHECK is gone entirely'
            ELSE 'FAIL — HR_HEAD lost its place as a rater' END,
       NULL
  FROM (SELECT (SELECT pg_get_constraintdef(oid) FROM pg_constraint
                 WHERE conrelid = 'pms_reviews'::regclass
                   AND conname = 'pms_reviews_rater_role_allowed') AS d) q;

-- NULL chain_stage means "not submitted", which 197 is explicit is distinct
-- from EMPLOYEE: "never started" and "sent back" look identical otherwise.
INSERT INTO _verify
SELECT 14, 'chain_stage is still nullable',
       CASE WHEN d LIKE '%chain_stage IS NULL%' THEN 'PASS'
            WHEN d IS NULL THEN 'FAIL — the CHECK is gone entirely'
            ELSE 'FAIL — "not submitted" and "with the employee" collapse' END,
       NULL
  FROM (SELECT (SELECT pg_get_constraintdef(oid) FROM pg_constraint
                 WHERE conrelid = 'pms_overall_rating'::regclass
                   AND conname = 'pms_overall_rating_chain_stage_allowed') AS d) q;

-- ── 4. deleting a chain does not take its policies with it ───────────────
--
-- confdeltype is "char" — Postgres's internal single-byte type, NOT text —
-- so an untyped literal cannot pick a || operator against it. Cast it.
INSERT INTO _verify
SELECT 15, 'deleting a chain spares the policy',
       CASE WHEN t = 'n' THEN 'PASS'
            WHEN t IS NULL THEN 'FAIL — there is no FK from pms_policies to pms_chain'
            ELSE 'FAIL — not ON DELETE SET NULL (' || t || ')' END,
       def
  FROM (SELECT (SELECT confdeltype::text FROM pg_constraint
                 WHERE conrelid = 'pms_policies'::regclass AND contype = 'f'
                   AND confrelid = 'pms_chain'::regclass) AS t,
               (SELECT pg_get_constraintdef(oid) FROM pg_constraint
                 WHERE conrelid = 'pms_policies'::regclass AND contype = 'f'
                   AND confrelid = 'pms_chain'::regclass) AS def) q;

-- ── 5. the coverage the builder shows ────────────────────────────────────
--
-- INFO, not PASS/FAIL: these are facts about the data, not the schema, and
-- they move. REGIONAL_HEAD at 0 is the one that matters — a chain naming it
-- is skipped for everybody, which is why the builder puts the number next to
-- the choice rather than in a footnote.
INSERT INTO _verify
SELECT 20 + row_number() OVER (ORDER BY rung), 'coverage · ' || rung, 'INFO',
       have::text || ' of ' || total::text || ' have one'
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
  ) c;

-- ── the whole answer, in one table ───────────────────────────────────────
SELECT seq, check_name, result, detail FROM _verify ORDER BY seq;

ROLLBACK;
