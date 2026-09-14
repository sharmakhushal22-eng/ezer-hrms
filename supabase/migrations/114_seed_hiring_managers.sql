-- 114_seed_hiring_managers.sql
--
-- Give the "Hiring Manager / Recruiter" (RECRUITER) role to 3 employees in each company,
-- so an HR Head approving an MRF has hiring managers to assign it to. Without this the
-- assign list is empty. Idempotent — safe to run more than once.
--
-- Picks the first three active <COMPANY_CODE>90xx employees per company (the main employee
-- series). Adjust the LIKE / limit if you want different people; or assign the role by hand
-- from ESS & Access → Assign Roles (needs an Implementation Manager).

WITH r AS (
  SELECT id FROM ess_roles WHERE role_code = 'RECRUITER'
),
picks AS (
  SELECT id FROM (
    SELECT e.id,
           row_number() OVER (PARTITION BY e.company_id ORDER BY e.emp_code) AS rn
    FROM employees e
    JOIN companies c ON c.id = e.company_id
    WHERE e.employment_status = 'Active'
      AND e.emp_code LIKE c.company_code || '90%'
  ) q
  WHERE rn <= 3
)
INSERT INTO ess_user_roles (ess_account_id, role_id, is_active)
SELECT a.id, (SELECT id FROM r), true
FROM picks p
JOIN ess_accounts a ON a.employee_id = p.id
WHERE (SELECT id FROM r) IS NOT NULL
ON CONFLICT (ess_account_id, role_id) DO UPDATE SET is_active = true;

-- Verify (optional): who now holds Hiring Manager / Recruiter.
--   SELECT e.emp_code, e.full_name, c.company_code
--   FROM ess_user_roles ur
--   JOIN ess_roles ro ON ro.id = ur.role_id AND ro.role_code = 'RECRUITER'
--   JOIN ess_accounts a ON a.id = ur.ess_account_id
--   JOIN employees e ON e.id = a.employee_id
--   JOIN companies c ON c.id = e.company_id
--   WHERE ur.is_active
--   ORDER BY c.company_code, e.emp_code;
