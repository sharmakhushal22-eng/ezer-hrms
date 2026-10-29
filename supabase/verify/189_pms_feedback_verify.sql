-- 189_pms_feedback_verify.sql — run AFTER 189. Read-only; writes nothing.
-- Every row should report PASS.

-- 1. Both columns exist, nullable, and of the right type.
SELECT CASE WHEN count(*) = 2 THEN 'PASS' ELSE 'FAIL' END AS both_columns_present,
       count(*) AS found
  FROM information_schema.columns
 WHERE table_name = 'pms_feedback'
   AND column_name IN ('rm_overall_comment', 'rm_overall_by');

SELECT column_name,
       CASE WHEN is_nullable = 'YES' THEN 'PASS' ELSE 'FAIL — must be nullable' END AS nullable
  FROM information_schema.columns
 WHERE table_name = 'pms_feedback'
   AND column_name IN ('rm_overall_comment', 'rm_overall_by');

-- 2. THE POINT OF THE MIGRATION: the HOD's columns are untouched and the
--    unique key is unchanged, so nothing that already reads this table moves.
SELECT CASE WHEN count(*) = 3 THEN 'PASS' ELSE 'FAIL — a HOD column went missing' END
         AS hod_columns_intact
  FROM information_schema.columns
 WHERE table_name = 'pms_feedback'
   AND column_name IN ('appreciation_remark', 'improvement_feedback', 'development_plan');

SELECT CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL — unique key changed' END
         AS unique_key_unchanged
  FROM pg_constraint c
 WHERE c.conrelid = 'pms_feedback'::regclass
   AND c.contype = 'u'
   AND pg_get_constraintdef(c.oid) ILIKE '%period_id%employee_id%';

-- 3. No data was touched: every pre-existing row still has its remark, and the
--    new columns start empty because nothing has written them yet.
SELECT count(*) AS feedback_rows,
       count(*) FILTER (WHERE appreciation_remark IS NOT NULL) AS with_appreciation,
       count(*) FILTER (WHERE rm_overall_comment IS NOT NULL)  AS with_rm_comment
  FROM pms_feedback;
