-- supabase/verify/pms_admin_tenancy_probe.sql
--
-- READ-ONLY. Sizes one finding; changes nothing.
--
-- WHAT THIS ANSWERS
--
-- app/api/pms/admin/route.ts gates every write on canManage(grant,
-- 'Performance'), which is a MODULE ACCESS LEVEL and says nothing about
-- which company the caller belongs to. Company scoping in this product is a
-- separate choke-point — companyFilter() in lib/rms/resolve.ts, whose own
-- comment calls it "the single choke-point that stops '' / 'ALL' from
-- leaking other companies".
--
-- In that route companyFilter is called on the four INSERT paths and on none
-- of the seven UPDATE paths, each of which addresses its row as
--   .eq('id', <id from the request body>)
-- using rmsServiceClient — the SERVICE ROLE key, which bypasses RLS. So
-- there is no database backstop behind the missing check.
--
-- This script does not test the route. It answers the only question that
-- decides whether the gap is live or theoretical: IS THERE MORE THAN ONE
-- TENANT'S PMS CONFIGURATION IN THIS DATABASE? One company and the gap is
-- latent. Two or more and a Performance=FULL admin scoped to one of them can
-- rewrite the others' configuration, using ids the route's own GET hands
-- over unfiltered.
--
-- HOW TO READ IT
--
--   owners > 1   on any row  ->  that table is cross-tenant exposed
--   owners = 1   everywhere  ->  latent; fix it before onboarding tenant two
--
-- "group" counts rows with company_id IS NULL, which the route treats as
-- deliberately group-wide (the training catalogue and chain library only).

BEGIN;

SELECT 'companies on this database'          AS what,
       count(*)::text                        AS owners,
       ''                                    AS rows_,
       string_agg(company_name, ', ' ORDER BY company_name) AS detail
  FROM companies

UNION ALL
SELECT 'pms_policies',
       count(DISTINCT company_id)::text,
       count(*)::text,
       coalesce(string_agg(DISTINCT coalesce(company_id::text, 'group'), ', '), '—')
  FROM pms_policies

UNION ALL
SELECT 'pms_periods',
       count(DISTINCT company_id)::text,
       count(*)::text,
       coalesce(string_agg(DISTINCT coalesce(company_id::text, 'group'), ', '), '—')
  FROM pms_periods

UNION ALL
SELECT 'pms_rating_scale',
       count(DISTINCT company_id)::text,
       count(*)::text,
       coalesce(string_agg(DISTINCT coalesce(company_id::text, 'group'), ', '), '—')
  FROM pms_rating_scale

UNION ALL
SELECT 'pms_kra_master',
       count(DISTINCT company_id)::text,
       count(*)::text,
       coalesce(string_agg(DISTINCT coalesce(company_id::text, 'group'), ', '), '—')
  FROM pms_kra_master

UNION ALL
-- These two may not exist on a database where 215 / 218 never ran. If the
-- whole script errors on one of them, that is the answer for that row: the
-- table is absent, so nothing of it is exposed.
SELECT 'pms_chain',
       count(DISTINCT company_id)::text,
       count(*)::text,
       coalesce(string_agg(DISTINCT coalesce(company_id::text, 'group'), ', '), '—')
  FROM pms_chain

UNION ALL
SELECT 'pms_training_catalogue',
       count(DISTINCT company_id)::text,
       count(*)::text,
       coalesce(string_agg(DISTINCT coalesce(company_id::text, 'group'), ', '), '—')
  FROM pms_training_catalogue

UNION ALL
-- The route's GET also returns every active employee in the database
-- (id, emp_code, full_name, company_id — limit 5000) to anyone who passes
-- the same gate. This is how many that is.
SELECT 'employees the GET returns',
       count(DISTINCT company_id)::text,
       least(count(*), 5000)::text,
       'active employees, all companies, no filter'
  FROM employees
 WHERE date_of_leaving IS NULL;

ROLLBACK;
