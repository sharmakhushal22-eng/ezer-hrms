-- 219_pms_chain_rungs_verify.sql — run AFTER 218 and 219.
-- Builds fixtures and ROLLS THEM BACK, so it is safe on live data.
--
-- WHY THIS FILE EXISTS, AND WHY IT SHOULD HAVE EXISTED FOR 218
--
-- 218 shipped two defects that every unit test passed over, because the tests
-- asserted what the MIGRATION SAYS rather than what the database DOES:
--
--   1. CHECK (array_length(rungs, 1) >= 1) accepted an empty array, because
--      array_length('{}', 1) is NULL and a NULL CHECK is satisfied. The test
--      matched the constraint's text, which was present and inert.
--
--   2. The COMMENT named rm_l1_id and rm_l2_id as the columns that resolve
--      RM L1 and RM L2. Neither column exists. The test compared the
--      application's list against this COMMENT — one copied from the other,
--      so they agreed and were both wrong.
--
-- Test 1 below cannot pass unless Postgres actually refuses the row. Test 3
-- cannot pass unless the columns are really on the table. That is the whole
-- difference, and it is the project's own rule: ENGINE COMPUTES, SQL DECIDES.

BEGIN;

-- ── 0. both migrations are in ────────────────────────────────────────────
SELECT CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL — 218 not applied' END
         AS pms_chain_exists
  FROM information_schema.tables WHERE table_name = 'pms_chain';

SELECT CASE WHEN count(*) = 1 THEN 'PASS'
            ELSE 'FAIL — pms_policies.chain_id missing' END AS policy_points_at_a_chain
  FROM information_schema.columns
 WHERE table_name = 'pms_policies' AND column_name = 'chain_id';

SELECT CASE WHEN pg_get_constraintdef(oid) LIKE '%cardinality%' THEN 'PASS'
            ELSE 'FAIL — 219 not applied; the empty-chain CHECK is still inert' END
         AS has_rungs_uses_cardinality,
       pg_get_constraintdef(oid) AS definition
  FROM pg_constraint WHERE conname = 'pms_chain_has_rungs';

-- ── 1. AN EMPTY CHAIN IS ACTUALLY REFUSED ────────────────────────────────
--
-- The test 218 needed and did not have. Not "is the constraint written" —
-- does the INSERT fail.
DO $$
DECLARE co uuid;
BEGIN
  SELECT id INTO co FROM companies LIMIT 1;
  BEGIN
    INSERT INTO pms_chain (company_id, name, rungs)
    VALUES (co, '__verify_empty__', ARRAY[]::text[]);
    RAISE WARNING 'FAIL — an empty rungs[] was ACCEPTED';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS — an empty rungs[] is refused (%)', SQLERRM;
  END;
END $$;

-- ── 2. the rung whitelist refuses what it should, and only that ──────────
DO $$
DECLARE co uuid;
BEGIN
  SELECT id INTO co FROM companies LIMIT 1;
  -- A rung nothing can resolve to a person.
  BEGIN
    INSERT INTO pms_chain (company_id, name, rungs)
    VALUES (co, '__verify_unknown__', ARRAY['EMPLOYEE','FINANCE','HR']);
    RAISE WARNING 'FAIL — an unresolvable rung was ACCEPTED';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS — an unresolvable rung is refused';
  END;
  -- DONE is the terminal marker, not a rung an appraisal waits on.
  BEGIN
    INSERT INTO pms_chain (company_id, name, rungs)
    VALUES (co, '__verify_done__', ARRAY['EMPLOYEE','HOD','DONE']);
    RAISE WARNING 'FAIL — DONE was ACCEPTED as a rung';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS — DONE is refused as a rung';
  END;
  -- And every rung the builder offers is accepted, or an administrator can
  -- compose a chain the database then rejects.
  INSERT INTO pms_chain (company_id, name, rungs)
  VALUES (co, '__verify_all__',
          ARRAY['EMPLOYEE','RM_L1','RM_L2','HOD','SITE_HR','REGIONAL_HEAD','HR']);
  RAISE NOTICE 'PASS — every offerable rung is accepted';
END $$;

-- ── 3. THE DOCUMENTED COLUMNS EXIST ON employees ─────────────────────────
--
-- The check that would have caught 218's second defect. Asked of the table,
-- not of the COMMENT that describes it.
SELECT CASE WHEN count(*) = 5 THEN 'PASS'
            ELSE 'FAIL — a rung resolves through a column that does not exist' END
         AS every_rung_has_a_real_column,
       string_agg(column_name, ', ' ORDER BY column_name) AS found
  FROM information_schema.columns
 WHERE table_name = 'employees'
   AND column_name IN ('l1_manager_id','l2_manager_id','hod_id',
                       'site_hr_id','regional_head_id');

-- The old names must be gone, or the COMMENT could be "fixed" to either.
SELECT CASE WHEN count(*) = 0 THEN 'PASS'
            ELSE 'FAIL — rm_l1_id/rm_l2_id exist after all; check which is canonical' END
         AS the_old_names_are_not_real
  FROM information_schema.columns
 WHERE table_name = 'employees' AND column_name IN ('rm_l1_id','rm_l2_id');

-- And the COMMENT names the real ones, so chainBuilder.ts can keep reading it.
SELECT CASE WHEN d LIKE '%l1_manager_id%' AND d LIKE '%l2_manager_id%'
                 AND d NOT LIKE '%rm_l1_id%' AND d NOT LIKE '%rm_l2_id%'
            THEN 'PASS' ELSE 'FAIL — the COMMENT still names columns that do not exist' END
         AS comment_names_real_columns
  FROM (SELECT col_description('pms_chain'::regclass,
                 (SELECT ordinal_position FROM information_schema.columns
                   WHERE table_name = 'pms_chain' AND column_name = 'rungs')::int) AS d) x;

-- ── 4. the coverage the builder shows, measured here ─────────────────────
--
-- Printed rather than asserted: these are facts about the data, not about the
-- schema, and they move. REGIONAL_HEAD at 0 is the number that matters — a
-- chain naming it is skipped for everybody.
SELECT 'HOD' AS rung, count(hod_id) AS have, count(*) AS of FROM employees
 WHERE date_of_leaving IS NULL
UNION ALL SELECT 'RM_L1', count(l1_manager_id), count(*) FROM employees WHERE date_of_leaving IS NULL
UNION ALL SELECT 'RM_L2', count(l2_manager_id), count(*) FROM employees WHERE date_of_leaving IS NULL
UNION ALL SELECT 'SITE_HR', count(site_hr_id), count(*) FROM employees WHERE date_of_leaving IS NULL
UNION ALL SELECT 'REGIONAL_HEAD', count(regional_head_id), count(*) FROM employees WHERE date_of_leaving IS NULL;

-- ── 5. the two widened CHECKs accept the new rungs ───────────────────────
SELECT conname,
       CASE WHEN pg_get_constraintdef(oid) LIKE '%SITE_HR%'
             AND pg_get_constraintdef(oid) LIKE '%REGIONAL_HEAD%'
            THEN 'PASS' ELSE 'FAIL — not widened' END AS widened
  FROM pg_constraint
 WHERE conname IN ('pms_overall_rating_chain_stage_allowed',
                   'pms_reviews_rater_role_allowed');

-- Nothing that was allowed before may have been dropped: a CHECK is recreated
-- whole, so widening it is also the moment a value silently disappears.
SELECT CASE WHEN pg_get_constraintdef(oid) LIKE '%HR_HEAD%' THEN 'PASS'
            ELSE 'FAIL — HR_HEAD lost its place as a rater (214)' END
         AS hr_head_can_still_rate
  FROM pg_constraint WHERE conname = 'pms_reviews_rater_role_allowed';

SELECT CASE WHEN pg_get_constraintdef(oid) LIKE '%chain_stage IS NULL%' THEN 'PASS'
            ELSE 'FAIL — chain_stage is no longer nullable; "not submitted" '
                 'and "with the employee" collapse' END AS chain_stage_still_nullable
  FROM pg_constraint WHERE conname = 'pms_overall_rating_chain_stage_allowed';

-- ── 6. deleting a chain does not take its policies with it ───────────────
SELECT CASE WHEN confdeltype = 'n' THEN 'PASS'
            ELSE 'FAIL — chain_id is not ON DELETE SET NULL (' || confdeltype || ')' END
         AS deleting_a_chain_spares_the_policy
  FROM pg_constraint
 WHERE conrelid = 'pms_policies'::regclass AND contype = 'f'
   AND confrelid = 'pms_chain'::regclass;

ROLLBACK;
