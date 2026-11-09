-- 192_pms_upload_commit_verify.sql — run AFTER 192.
--
-- SECTIONS 1-3 WRITE NOTHING. They exercise only the guards that return
-- before the function touches a table, which is why they are safe to run
-- against live data.
--
-- SECTION 4 IS COMMENTED OUT. It writes: a batch where every row fails
-- validation still inserts pms_rating_upload_log rows with committed = false,
-- by design, because §6.4 requires the attempt to be recorded. Uncomment it
-- only if you are willing to leave audit rows behind, and the cleanup is
-- given alongside it.
--
-- Every row of sections 1-3 should report PASS.

-- 1. The function exists, with the signature the route calls.
SELECT CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS function_present,
       count(*) AS found
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE p.proname = 'pms_commit_rating_upload' AND n.nspname = 'public';

SELECT CASE WHEN pg_get_function_arguments(p.oid)
                 = 'p_period_id uuid, p_actor_id uuid, p_actor_role text, p_rows jsonb'
            THEN 'PASS' ELSE 'FAIL — signature changed' END AS signature,
       pg_get_function_arguments(p.oid) AS actual
  FROM pg_proc p WHERE p.proname = 'pms_commit_rating_upload';

-- 2. THE GUARDS THAT MUST REFUSE, each returning ok:false and writing nothing.
WITH any_period AS (SELECT id FROM pms_periods ORDER BY period_start DESC LIMIT 1),
     cases AS (
  SELECT 'no actor — uploaded_by is NOT NULL and an override needs a name' AS label,
         pms_commit_rating_upload((SELECT id FROM any_period), NULL, 'ADMIN', '[]'::jsonb) AS res
  UNION ALL
  SELECT 'an RM may not bulk-override, even though pms_finalise accepts one',
         pms_commit_rating_upload((SELECT id FROM any_period),
           (SELECT id FROM employees LIMIT 1), 'RM_L1', '[]'::jsonb)
  UNION ALL
  SELECT 'HOD may not bulk-override either',
         pms_commit_rating_upload((SELECT id FROM any_period),
           (SELECT id FROM employees LIMIT 1), 'HOD', '[]'::jsonb)
  UNION ALL
  SELECT 'a period that does not exist',
         pms_commit_rating_upload('00000000-0000-0000-0000-000000000000',
           (SELECT id FROM employees LIMIT 1), 'ADMIN', '[]'::jsonb)
  UNION ALL
  SELECT 'rows that are not an array',
         pms_commit_rating_upload((SELECT id FROM any_period),
           (SELECT id FROM employees LIMIT 1), 'ADMIN', 'null'::jsonb)
)
SELECT label,
       CASE WHEN (res->>'ok')::boolean IS FALSE THEN 'PASS'
            ELSE 'FAIL — this was allowed through' END AS result,
       res->>'message' AS said
  FROM cases;

-- 3. An EMPTY but otherwise valid batch commits nothing and claims nothing.
--    This is the boundary the loops are written around: zero rows must not
--    read as "zero errors, therefore apply".
SELECT CASE WHEN (res->>'ok')::boolean IS TRUE
                 AND (res->>'applied')::int = 0
                 AND (res->>'rows')::int = 0
            THEN 'PASS' ELSE 'FAIL' END AS empty_batch_is_a_no_op,
       res AS returned
  FROM (SELECT pms_commit_rating_upload(
                 (SELECT id FROM pms_periods ORDER BY period_start DESC LIMIT 1),
                 (SELECT id FROM employees LIMIT 1), 'ADMIN', '[]'::jsonb) AS res) q;

-- 4. WRITES — commented out. A refused batch must log every row and apply
--    nothing. Uncomment, run, read, then run the cleanup.
--
-- SELECT pms_commit_rating_upload(
--   (SELECT id FROM pms_periods ORDER BY period_start DESC LIMIT 1),
--   (SELECT id FROM employees LIMIT 1), 'ADMIN',
--   '[{"employee_code":"NOSUCH99","final_rating":"3","override_reason":"verify"},
--     {"employee_code":"ALSONOT","final_rating":"99","override_reason":"verify"}]'::jsonb);
--
-- -- expect: ok=false, errors=2, applied=0, and two log rows committed=false
-- SELECT employee_code, validation_status, committed, error_message
--   FROM pms_rating_upload_log
--  WHERE override_reason = 'verify' ORDER BY employee_code;
--
-- -- and nothing was applied anywhere
-- SELECT CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL — a refused batch wrote a rating' END
--   FROM pms_overall_rating WHERE rating_source = 'HR_OVERRIDE';
--
-- -- cleanup
-- DELETE FROM pms_rating_upload_log WHERE override_reason = 'verify';
