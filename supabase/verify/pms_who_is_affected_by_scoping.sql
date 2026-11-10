-- supabase/verify/pms_who_is_affected_by_scoping.sql
--
-- READ-ONLY. Answers one question and changes nothing:
--
--   WHO, IF ANYBODY, BEHAVES DIFFERENTLY AFTER 5a0426c5?
--
-- The commit adds a company check to the PMS admin route's eleven by-id
-- write paths. It is a no-op for anyone the product already treats as
-- cross-company, and a real change for exactly one shape of account:
--
--   • holds a role granting Performance = FULL, and
--   • is NOT a super admin (role_code ADMIN_SUPER / SUPER_ADMIN), and
--   • holds NO role scoped 'ORG'
--
-- That person could previously write ANY company's PMS configuration by
-- posting its row id. Afterwards they are refused on rows outside the
-- companies their roles are valid in.
--
-- The three definitions below are lifted from lib/rms/resolve.ts:
--   isSuperAdmin  roles.some(role_code IN SUPER_ADMIN_CODES)
--   crossCompany  isSuperAdmin OR roles.some(upper(scope) = 'ORG')
--   canManage     atLeast(modules['Performance'], 'FULL')
--
-- HOW TO READ IT
--   affected = 0 rows  ->  nothing changes for anybody today; the fix is a
--                          guard for the first scoped Performance admin
--                          somebody creates.
--   affected > 0 rows  ->  those accounts lose cross-company writes. Check
--                          each is meant to be confined to its own company.
--                          If one genuinely needs every company, give its
--                          role scope 'ORG' rather than reverting this.

BEGIN;

WITH held AS (
  SELECT ur.ess_account_id,
         ur.role_id,
         ur.company_ids,
         upper(coalesce(r.role_code, '')) AS role_code,
         upper(coalesce(r.scope, ''))     AS scope
    FROM ess_user_roles ur
    JOIN ess_roles r ON r.id = ur.role_id
   WHERE ur.is_active = true
),
person AS (
  SELECT ess_account_id,
         bool_or(role_code IN ('ADMIN_SUPER', 'SUPER_ADMIN')) AS is_super,
         bool_or(scope = 'ORG')                               AS any_org,
         count(*)                                             AS roles_held
    FROM held
   GROUP BY ess_account_id
),
perf_full AS (
  SELECT DISTINCT h.ess_account_id
    FROM held h
    JOIN role_permissions p ON p.role_id = h.role_id
   WHERE p.module = 'Performance'
     AND upper(coalesce(p.access_level, '')) = 'FULL'
)
SELECT 'AFFECTED — loses cross-company PMS writes' AS verdict,
       e.emp_code,
       e.full_name,
       c.company_name                              AS own_company,
       p.roles_held::text                          AS roles_held
  FROM perf_full f
  JOIN person p            ON p.ess_account_id = f.ess_account_id
  JOIN ess_accounts a      ON a.id = f.ess_account_id
  LEFT JOIN employees e    ON e.id = a.employee_id
  LEFT JOIN companies c    ON c.id = e.company_id
 WHERE NOT p.is_super
   AND NOT p.any_org

UNION ALL

-- The control group: everyone who holds Performance = FULL and is NOT
-- affected, with the reason. If this is the only section with rows, the
-- change is inert on today's data.
SELECT CASE WHEN p.is_super THEN 'unchanged — super admin'
            ELSE 'unchanged — holds an ORG-scoped role' END,
       e.emp_code,
       e.full_name,
       c.company_name,
       p.roles_held::text
  FROM perf_full f
  JOIN person p            ON p.ess_account_id = f.ess_account_id
  JOIN ess_accounts a      ON a.id = f.ess_account_id
  LEFT JOIN employees e    ON e.id = a.employee_id
  LEFT JOIN companies c    ON c.id = e.company_id
 WHERE p.is_super OR p.any_org

ORDER BY 1, 2;

ROLLBACK;
