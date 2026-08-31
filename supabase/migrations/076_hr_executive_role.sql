-- ════════════════════════════════════════════════════════════════════════════
-- 076_hr_executive_role.sql — the HR bench gets its own role, and gets assigned.
--
-- THE PROBLEM
-- 075 wrote the module grid, but only NINE of 398 employees hold any role at all
-- (the seven the spreadsheet names, plus the CFO and Nayan). Everyone else has no
-- role, so their ESS sidebar shows no "What you manage" section — correct for a
-- Sales or Logistics employee, wrong for the HR bench. SRS0003 "Hr Executive" is
-- the case that surfaced it: he does HR for a living and saw nothing.
--
-- WHAT THIS DOES
--   1. Adds HR_EXECUTIVE — the People group, no money. An HR executive screens
--      candidates, runs onboarding and reads the employee master; they do not
--      run payroll, approve claims or reconfigure the company.
--   2. Assigns HR roles by department and seniority to everybody in HR who has
--      none yet, so the bench stops being invisible to itself.
--
-- WHO GETS WHAT
--   HR & Admin department, or any designation containing "HR":
--     Manager / Senior Manager / Assistant Manager / Team Lead / SR Manager
--                                       -> HR_MANAGER    (~14 people)
--     everyone else                     -> HR_EXECUTIVE  (~31 people)
--   Nobody who already holds an active role is touched, so Shreya Reddy stays
--   HR_MANAGER, Kiran Reddy stays HR_HEAD and Vikram Bose stays ADMIN_COMPANY.
--
-- DELIBERATELY NOT DONE HERE
--   Finance & Accounts (57), IT (48) and the other departments are left alone.
--   Their employees legitimately see no admin modules today, and deciding that a
--   Finance analyst should open the Finance module is a call for you, not a
--   pattern to infer from a department name. Section 4 has the statement ready.
--
--   Interns, contract and consultant staff in HR (11 of the 45) are included,
--   because the department is what decides here, not the contract. Section 3 has
--   the line to exclude them if you would rather they held nothing.
--
--   15 of the 45 have no ACTIVE ess_account, so they cannot hold a role at all —
--   ess_user_roles hangs off the account, not the employee. They are reported at
--   the end; create their ESS credentials and re-run this file to pick them up.
--
-- Re-runnable.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. The role ─────────────────────────────────────────────────────────────
-- Guarded rather than ON CONFLICT: role_code carries no unique constraint on this
-- database, so ON CONFLICT (role_code) would fail outright.
INSERT INTO ess_roles (role_code, role_name, salary_visibility, scope, sort_order)
SELECT 'HR_EXECUTIVE', 'HR Executive', 'NONE', 'DEPT', 12
 WHERE NOT EXISTS (SELECT 1 FROM ess_roles WHERE role_code = 'HR_EXECUTIVE');

UPDATE ess_roles SET role_name = 'HR Executive', salary_visibility = 'NONE', scope = 'DEPT'
 WHERE role_code = 'HR_EXECUTIVE';

-- ── 2. What it opens — the whole People group, and the HR side of time ──────
-- Employees VIEW also lights Org Chart; both nav entries share that module.
DELETE FROM role_permissions rp USING ess_roles r
 WHERE r.id = rp.role_id AND r.role_code = 'HR_EXECUTIVE';

INSERT INTO role_permissions (role_id, module, access_level)
SELECT r.id, v.module, v.lvl
  FROM ess_roles r
  CROSS JOIN (VALUES
    ('Recruitment','EDIT'),          -- screens and moves candidates
    ('Onboarding','EDIT'),           -- runs the joining formalities
    ('Performance','VIEW'),
    ('Employees','VIEW'),            -- + Org Chart
    ('Bulk Upload','VIEW'),
    ('Transfer','VIEW'),
    ('Attendance','EDIT'),           -- regularisations are HR desk work
    ('Attendance Reports','VIEW'),
    ('Leave Config','VIEW'),
    ('HR Letters','EDIT'),
    ('Policies','VIEW'),
    ('ESS Reports','VIEW'),
    ('Support','VIEW')
  ) AS v(module, lvl)
 WHERE r.role_code = 'HR_EXECUTIVE';

-- ── 3. Assign it ────────────────────────────────────────────────────────────
-- Only where an ACTIVE ess_account exists, and only for people who hold nothing.
WITH hr_people AS (
  SELECT a.id AS account_id,
         CASE WHEN e.designation IN ('Manager','Senior Manager','Assistant Manager','Team Lead','SR Manager')
              THEN 'HR_MANAGER' ELSE 'HR_EXECUTIVE' END AS role_code
    FROM employees e
    JOIN ess_accounts a ON a.employee_id = e.id AND a.status = 'ACTIVE'
    LEFT JOIN departments d ON d.id = e.department_id
   WHERE COALESCE(e.employment_status,'Active') = 'Active'
     AND e.date_of_leaving IS NULL
     -- HR by department, or by job title for the few with no department at all
     AND (d.dept_name = 'HR & Admin' OR e.designation ILIKE '%hr%')
     -- to exclude interns / contract / consultants, uncomment:
     -- AND COALESCE(e.employment_type,'Employee') = 'Employee'
     AND NOT EXISTS (SELECT 1 FROM ess_user_roles ur
                      WHERE ur.ess_account_id = a.id AND ur.is_active)
)
INSERT INTO ess_user_roles (ess_account_id, role_id, is_active)
SELECT h.account_id, r.id, true
  FROM hr_people h JOIN ess_roles r ON r.role_code = h.role_code;

-- ── 4. NOT RUN — the same pattern for the other functions, when you decide ──
-- Finance & Accounts -> FINANCE_EXECUTIVE (Finance FULL, Travel Claims FULL) is a
-- lot of access for 57 people; IT -> IT likewise for 48. Uncomment deliberately.
--
-- WITH fn AS (
--   SELECT a.id AS account_id, 'FINANCE_EXECUTIVE'::text AS role_code
--     FROM employees e
--     JOIN ess_accounts a ON a.employee_id = e.id AND a.status = 'ACTIVE'
--     JOIN departments d ON d.id = e.department_id AND d.dept_name = 'Finance & Accounts'
--    WHERE COALESCE(e.employment_status,'Active') = 'Active'
--      AND NOT EXISTS (SELECT 1 FROM ess_user_roles ur WHERE ur.ess_account_id = a.id AND ur.is_active)
-- )
-- INSERT INTO ess_user_roles (ess_account_id, role_id, is_active)
-- SELECT fn.account_id, r.id, true FROM fn JOIN ess_roles r ON r.role_code = fn.role_code;

-- ── Verify ──────────────────────────────────────────────────────────────────
SELECT r.role_code, count(*) AS people
  FROM ess_user_roles ur
  JOIN ess_roles r ON r.id = ur.role_id
 WHERE ur.is_active
 GROUP BY r.role_code ORDER BY 2 DESC;

-- SRS0003 specifically — the case that started this:
SELECT e.emp_code, e.full_name, e.designation, r.role_code
  FROM employees e
  JOIN ess_accounts a ON a.employee_id = e.id
  JOIN ess_user_roles ur ON ur.ess_account_id = a.id AND ur.is_active
  JOIN ess_roles r ON r.id = ur.role_id
 WHERE e.emp_code = 'SRS0003';

-- HR people who still hold nothing because they have no ESS account.
-- Create their credentials at /dashboard/ess-credentials, then re-run this file.
SELECT e.emp_code, e.full_name, e.designation,
       CASE WHEN a.id IS NULL THEN 'no ESS account' ELSE 'account ' || a.status END AS why
  FROM employees e
  LEFT JOIN ess_accounts a ON a.employee_id = e.id AND a.status = 'ACTIVE'
  LEFT JOIN departments d ON d.id = e.department_id
 WHERE COALESCE(e.employment_status,'Active') = 'Active'
   AND (d.dept_name = 'HR & Admin' OR e.designation ILIKE '%hr%')
   AND a.id IS NULL
 ORDER BY e.emp_code;
