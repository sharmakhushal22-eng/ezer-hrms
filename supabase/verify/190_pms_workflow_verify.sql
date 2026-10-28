-- 190_pms_workflow_verify.sql — run AFTER 190. Read-only; writes nothing.
-- Every row should report PASS.
--
-- The backfill is expected to change NOTHING on this database: only two rows
-- have any KRAs and both are terminal (ACKNOWLEDGED). So existence checks
-- alone would prove very little, and most of this file exercises the
-- DERIVATION directly instead, by calling it with made-up inputs. That is
-- the part that has to be right for the next real cycle.

-- 1. The pieces exist.
SELECT CASE WHEN count(*) = 3 THEN 'PASS' ELSE 'FAIL' END AS functions_present,
       count(*) AS found
  FROM pg_proc
 WHERE proname IN ('pms_workflow_derived','pms_refresh_workflow','pms_sync_goal_workflow');

SELECT CASE WHEN count(*) = 2 THEN 'PASS' ELSE 'FAIL' END AS triggers_present,
       string_agg(tgname, ', ' ORDER BY tgname) AS names
  FROM pg_trigger
 WHERE tgname IN ('trg_pms_sync_role_score','trg_pms_sync_goal_workflow')
   AND NOT tgisinternal;

-- 2. THE DERIVATION, exercised on every rung. args are
--    (status, self, l1, l2, hod, has_goals, locked).
WITH cases(label, got, want) AS (
  VALUES
    ('no goals, nothing rated',
     pms_workflow_derived('NOT_STARTED', NULL, NULL, NULL, NULL, false, false), 'NOT_STARTED'),
    ('KRAs written, not locked',
     pms_workflow_derived('NOT_STARTED', NULL, NULL, NULL, NULL, true,  false), 'KRA_DRAFT'),
    ('KRAs locked',
     pms_workflow_derived('KRA_LOCKED',  NULL, NULL, NULL, NULL, true,  true),  'KRA_LOCKED'),
    ('self rating in',
     pms_workflow_derived('KRA_LOCKED',  3.9,  NULL, NULL, NULL, true,  true),  'SELF_SUBMITTED'),
    ('RM L1 rated',
     pms_workflow_derived('KRA_LOCKED',  3.9,  3.7,  NULL, NULL, true,  true),  'RM_L1_DONE'),
    ('RM L2 rated',
     pms_workflow_derived('KRA_LOCKED',  3.9,  3.7,  3.45, NULL, true,  true),  'RM_L2_DONE'),
    ('HOD scored per goal, pre-finalise',
     pms_workflow_derived('KRA_LOCKED',  3.9,  3.7,  NULL, 3.5,  true,  true),  'RM_L2_DONE'),
    -- the terminal three: returned unchanged no matter what else is true
    ('finalised stays finalised',
     pms_workflow_derived('FINALISED',    3.9,  3.7,  3.45, NULL, true,  true),  'FINALISED'),
    ('published is NOT walked back',
     pms_workflow_derived('PUBLISHED',    3.9,  3.7,  3.45, NULL, true,  true),  'PUBLISHED'),
    ('acknowledged is NOT walked back',
     pms_workflow_derived('ACKNOWLEDGED', 3.9,  3.7,  3.45, NULL, true,  true),  'ACKNOWLEDGED'),
    -- a lock must never be walked back to a draft
    ('locked is never downgraded to draft',
     pms_workflow_derived('KRA_LOCKED',  NULL, NULL, NULL, NULL, true,  false), 'KRA_LOCKED'),
    -- retraction: scores gone, status comes back down with them (076's rule)
    ('retracted self rating falls back',
     pms_workflow_derived('SELF_SUBMITTED', NULL, NULL, NULL, NULL, true, true), 'KRA_LOCKED')
)
SELECT label, got, want,
       CASE WHEN got = want THEN 'PASS' ELSE 'FAIL' END AS result
  FROM cases
 ORDER BY (got = want), label;

-- 3. Every value it can emit must satisfy the column's CHECK constraint. A
--    status the constraint rejects would make the trigger throw on write.
WITH emitted(v) AS (
  SELECT DISTINCT pms_workflow_derived(s, sf, l1, l2, hod, g, lk)
    FROM (VALUES ('NOT_STARTED'),('KRA_DRAFT'),('KRA_LOCKED'),('SELF_SUBMITTED'),
                 ('RM_L1_DONE'),('RM_L2_DONE'),('FINALISED'),('PUBLISHED'),
                 ('ACKNOWLEDGED')) a(s),
         (VALUES (NULL::numeric),(3.9)) b(sf),
         (VALUES (NULL::numeric),(3.7)) c(l1),
         (VALUES (NULL::numeric),(3.4)) d(l2),
         (VALUES (NULL::numeric),(3.5)) e(hod),
         (VALUES (true),(false)) f(g),
         (VALUES (true),(false)) h(lk)
)
SELECT CASE WHEN count(*) = 0 THEN 'PASS'
            ELSE 'FAIL — emits a value the CHECK rejects' END AS all_values_legal,
       COALESCE(string_agg(v, ', '), '(none)') AS illegal
  FROM emitted
 WHERE v NOT IN ('NOT_STARTED','KRA_DRAFT','KRA_LOCKED','SELF_DRAFT','SELF_SUBMITTED',
                 'RM_L1_DONE','RM_L2_DONE','FINALISED','PUBLISHED','ACKNOWLEDGED');

-- 4. Nothing already settled was disturbed by the backfill. These two rows
--    were driven through the full cycle by hand and must still read
--    ACKNOWLEDGED with their ratings intact.
SELECT e.emp_code, o.workflow_status, o.final_rating, o.employee_ack,
       CASE WHEN o.workflow_status = 'ACKNOWLEDGED' THEN 'PASS'
            ELSE 'FAIL — a terminal row moved' END AS terminal_intact
  FROM pms_overall_rating o
  JOIN employees e ON e.id = o.employee_id
 WHERE e.emp_code IN ('SRS9006','SRS9030')
 ORDER BY e.emp_code;

-- 5. Consistency sweep: no NON-terminal row may disagree with the derivation.
--    Expect zero. This is the invariant the trigger is supposed to maintain,
--    asked of the whole table rather than of one row.
SELECT CASE WHEN count(*) = 0 THEN 'PASS'
            ELSE 'FAIL — rows disagree with their own data' END AS table_consistent,
       count(*) AS disagreeing
  FROM pms_overall_rating o
 WHERE NOT o.is_readonly
   AND o.workflow_status IS DISTINCT FROM pms_workflow_derived(
         o.workflow_status, o.self_score, o.rm_l1_score, o.rm_l2_score, o.hod_score,
         EXISTS (SELECT 1 FROM pms_employee_goals g
                  WHERE g.employee_id = o.employee_id AND g.period_id = o.period_id),
         EXISTS (SELECT 1 FROM pms_employee_goals g
                  WHERE g.employee_id = o.employee_id AND g.period_id = o.period_id
                    AND g.status = 'LOCKED'));

-- 6. What the roll-up can now report. Before 190 this could only ever return
--    NOT_STARTED and FINALISED. It will still look like that on THIS database
--    until a cycle has people partway through — see the migration's note on
--    blast radius. Informational, not a PASS/FAIL.
SELECT fill_status, count(*) AS rows
  FROM vw_pms_fill_status
 GROUP BY fill_status
 ORDER BY count(*) DESC;
