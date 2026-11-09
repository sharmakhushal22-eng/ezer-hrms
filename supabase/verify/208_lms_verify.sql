-- 208_lms_verify.sql — run AFTER 206, 207 and 208. Read-only, safe on live data.
-- Every row should say PASS. It checks what would otherwise fail silently: a table left
-- readable by the anon key, or a function the browser could call through PostgREST.

SELECT CASE WHEN count(*) = 27 THEN 'PASS' ELSE 'FAIL — expected 27 lms_ tables, found ' || count(*) END AS lms_tables_exist
  FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'lms\_%';

SELECT CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL — RLS off on: ' || string_agg(tablename, ', ') END AS rls_on_every_table
  FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'lms\_%' AND NOT rowsecurity;

SELECT CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL — policies found: ' || string_agg(tablename || '.' || policyname, ', ') END AS no_policy_exists
  FROM pg_policies WHERE schemaname = 'public' AND tablename LIKE 'lms\_%';

SELECT CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL — browser roles hold grants on: ' || string_agg(DISTINCT table_name, ', ') END AS no_table_grant_to_browser_roles
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND table_name LIKE 'lms\_%' AND grantee IN ('anon', 'authenticated', 'PUBLIC');

SELECT CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL — callable by anon: ' || string_agg(p.proname, ', ') END AS no_function_callable_by_anon
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname LIKE 'lms\_%' AND p.prokind = 'f'
   AND p.prorettype <> 'trigger'::regtype AND has_function_privilege('anon', p.oid, 'EXECUTE');

SELECT CASE WHEN public = false AND file_size_limit >= 2147483648 THEN 'PASS' ELSE 'FAIL — bucket is public or its limit is low' END AS bucket_private
  FROM storage.buckets WHERE id = 'lms-content';

SELECT CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL — storage policies mention the bucket' END AS bucket_has_no_policy
  FROM pg_policies WHERE schemaname = 'storage' AND (qual ILIKE '%lms-content%' OR with_check ILIKE '%lms-content%');

SELECT CASE WHEN count(DISTINCT r.role_code) = 3 THEN 'PASS' ELSE 'FAIL — new roles missing' END AS three_new_roles
  FROM ess_roles r WHERE r.role_code IN ('LND_MANAGER', 'LMS_AUTHOR', 'LMS_COORDINATOR');

SELECT CASE WHEN count(*) >= 30 THEN 'PASS' ELSE 'FAIL — role matrix short: ' || count(*) END AS role_matrix_seeded
  FROM role_permissions WHERE module IN ('Learning Content', 'Learning Assignment', 'Learning Reports');

SELECT CASE WHEN count(*) = 5 THEN 'PASS' ELSE 'FAIL — frozen-version triggers missing' END AS published_versions_frozen
  FROM pg_trigger WHERE tgname LIKE 'trg_lms_%_frozen';

SELECT CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL — audit log not append-only' END AS audit_append_only
  FROM pg_trigger WHERE tgname = 'trg_lms_audit_append_only';

-- The columns the engine reads from existing tables, because a missing one fails only at run time.
SELECT CASE WHEN count(*) = 9 THEN 'PASS' ELSE 'FAIL — employees is missing a column the engine reads' END AS employee_columns_present
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'employees'
   AND column_name IN ('company_doj', 'group_doj', 'is_test', 'l1_manager_id', 'team_name', 'employee_category', 'confirmation_status', 'employment_type', 'grade');
