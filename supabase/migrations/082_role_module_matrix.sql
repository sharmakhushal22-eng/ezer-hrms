-- ════════════════════════════════════════════════════════════════════════════
-- 082_role_module_matrix.sql — which modules each role opens.
--
-- The ESS sidebar now shows an employee the admin modules their roles grant, so
-- an HR or payroll person works entirely inside their own portal. That makes
-- role_permissions load-bearing in a way it was not before: whatever is in this
-- table IS the sidebar.
--
-- WHERE THE MATRIX COMES FROM
-- "Ezer Role Wise Access.xlsx" names the twelve roles but fills in only the MRF
-- column, so the module grid is a decision, not a transcription. What the sheet
-- does say is honoured:
--     CFO / MD ........ "Only Reports Access"  -> read-only, no operational module
--     CHRO / HR HEAD .. approves MRFs, assigns the hiring manager -> Recruitment FULL
--     HR MANAGER ...... creates MRFs, grants MRF rights           -> Recruitment FULL
--     RM1/RM2/HOD/Branch HR ... can create MRFs                   -> Recruitment EDIT
-- Everything else follows the job: a role gets FULL where it owns the process,
-- EDIT where it works inside somebody else's, VIEW where it only needs to look,
-- and no row at all where it has no business — a missing row reads as NONE.
--
-- ROLE CODE MAPPING (sheet name -> live ess_roles.role_code)
--     CFO / MD .............. CFO + MD          (two live roles, one sheet row)
--     CHRO / HR HEAD ........ CHRO + HR_HEAD    (same grants)
--     HR MANAGER ............ HR_MANAGER
--     Payroll Manager ....... PAYROLL           (PAYROLL_ADMIN stays the config
--                                                variant: setup, not operations)
--     IT Manager ............ IT
--     Admin Manager ......... ADMIN_COMPANY     (ADMIN_SUPER is the super-user,
--                                                not a business role — untouched)
--     Finance Executive ..... FINANCE_EXECUTIVE
--     Branch HR ............. BRANCH_HR
--     Hiring Manager ........ RECRUITER         (mapped, not created)
--     RM 1 / RM 2 / HOD ..... L1_MANAGER / L2_MANAGER / HOD — DELIBERATELY EMPTY.
--         These are derived live from employees.l1_manager_id / l2_manager_id and
--         departments.hod_employee_id (071, /api/ess/menu). Being somebody's manager
--         already opens Team and Approvals in ESS; it does not open admin modules,
--         and nobody should have to re-assign 372 rows when a manager changes.
--
-- ADMIN_SUPER is not listed: resolveGrant() gives it every module in code.
-- IMPL_MANAGER, BRANCH_EXEC, EMPLOYEE are not listed: no admin modules.
--
-- Re-runnable: it replaces the rows for the roles it names and touches no others.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TEMP TABLE _matrix (role_code text, module text, access_level text) ON COMMIT DROP;

INSERT INTO _matrix (role_code, module, access_level) VALUES
-- ── MD — oversight only. The sheet says "Only Reports Access". ────────────────
('MD','Reports','VIEW'), ('MD','Company Dashboard','VIEW'), ('MD','ESS Reports','VIEW'),
('MD','Employees','VIEW'),

-- ── CFO — the same oversight, plus the money it is accountable for. Already
--    holds LOAN and SALARY_REVISION approval rights in role_approval_rights. ──
('CFO','Finance','FULL'), ('CFO','Loans','EDIT'), ('CFO','Payroll','VIEW'),
('CFO','Travel Claims','VIEW'), ('CFO','Flexi Claims','VIEW'),
('CFO','Reports','VIEW'), ('CFO','Company Dashboard','VIEW'), ('CFO','ESS Reports','VIEW'),
('CFO','Employees','VIEW'),

-- ── CHRO / HR_HEAD — owns people, time and the paperwork. Sees payroll cost but
--    does not run payroll; that is the payroll manager's process. ─────────────
('HR_HEAD','Recruitment','FULL'), ('HR_HEAD','Onboarding','FULL'), ('HR_HEAD','Performance','FULL'),
('HR_HEAD','Employees','FULL'), ('HR_HEAD','Transfer','FULL'), ('HR_HEAD','Bulk Upload','EDIT'),
('HR_HEAD','Attendance','FULL'), ('HR_HEAD','Attendance Reports','FULL'),
('HR_HEAD','Leave Config','FULL'), ('HR_HEAD','Holidays','FULL'),
('HR_HEAD','Payroll','VIEW'), ('HR_HEAD','Finance','VIEW'), ('HR_HEAD','Flexi Claims','VIEW'),
('HR_HEAD','Travel Claims','VIEW'), ('HR_HEAD','Loans','VIEW'),
('HR_HEAD','Compliance','VIEW'), ('HR_HEAD','HR Letters','FULL'), ('HR_HEAD','Policies','FULL'),
('HR_HEAD','Reports','FULL'),
('HR_HEAD','ESS & Roles','FULL'), ('HR_HEAD','Admin Setup','EDIT'),
('HR_HEAD','Company Profile','VIEW'), ('HR_HEAD','Database Export','EDIT'),
('HR_HEAD','Company Dashboard','VIEW'), ('HR_HEAD','ESS Reports','VIEW'),
('HR_HEAD','Support','VIEW'), ('HR_HEAD','Ezer AI','VIEW'),

-- ── HR_MANAGER — the same work, one notch down: runs the processes, does not
--    reconfigure the company. No payroll, no finance. ──────────────────────────
('HR_MANAGER','Recruitment','FULL'), ('HR_MANAGER','Onboarding','FULL'), ('HR_MANAGER','Performance','FULL'),
('HR_MANAGER','Employees','EDIT'), ('HR_MANAGER','Transfer','EDIT'), ('HR_MANAGER','Bulk Upload','EDIT'),
('HR_MANAGER','Attendance','FULL'), ('HR_MANAGER','Attendance Reports','VIEW'),
('HR_MANAGER','Leave Config','EDIT'), ('HR_MANAGER','Holidays','EDIT'),
('HR_MANAGER','HR Letters','FULL'), ('HR_MANAGER','Policies','VIEW'), ('HR_MANAGER','Reports','EDIT'),
('HR_MANAGER','Flexi Claims','VIEW'), ('HR_MANAGER','Travel Claims','VIEW'), ('HR_MANAGER','Loans','VIEW'),
('HR_MANAGER','ESS & Roles','VIEW'), ('HR_MANAGER','ESS Reports','VIEW'),
('HR_MANAGER','Support','VIEW'), ('HR_MANAGER','Ezer AI','VIEW'),

-- ── PAYROLL (Payroll Manager) — owns the whole Money group. This is the
--    acceptance test: Money visible, People absent.
--    NOTE Flexi Claims also opens "Flexi Policy" under Setup — one module, two
--    nav entries. Intended: whoever runs flexi should set its policy. ─────────
('PAYROLL','Payroll','FULL'), ('PAYROLL','Finance','EDIT'), ('PAYROLL','Flexi Claims','FULL'),
('PAYROLL','Travel Claims','EDIT'), ('PAYROLL','Loans','FULL'),
('PAYROLL','Compliance','FULL'),
('PAYROLL','Employees','VIEW'), ('PAYROLL','Attendance','VIEW'),
('PAYROLL','Attendance Reports','VIEW'), ('PAYROLL','Leave Config','VIEW'),
('PAYROLL','Reports','EDIT'), ('PAYROLL','Database Export','EDIT'), ('PAYROLL','ESS Reports','VIEW'),
('PAYROLL','Support','VIEW'),

-- ── PAYROLL_ADMIN — configures payroll rather than running it. ───────────────
('PAYROLL_ADMIN','Payroll','FULL'), ('PAYROLL_ADMIN','Admin Setup','FULL'),
('PAYROLL_ADMIN','Compliance','FULL'), ('PAYROLL_ADMIN','Holidays','FULL'),
('PAYROLL_ADMIN','Leave Config','FULL'), ('PAYROLL_ADMIN','Flexi Claims','EDIT'),
('PAYROLL_ADMIN','Company Profile','EDIT'), ('PAYROLL_ADMIN','Employees','VIEW'),
('PAYROLL_ADMIN','Reports','VIEW'), ('PAYROLL_ADMIN','ESS Reports','VIEW'),

-- ── IT — accounts and access, not HR data. Holds IT exit clearance already. ──
('IT','ESS & Roles','EDIT'), ('IT','Employees','VIEW'), ('IT','Bulk Upload','EDIT'),
('IT','Database Export','VIEW'), ('IT','Admin Setup','VIEW'),
('IT','Support','FULL'), ('IT','Ezer AI','VIEW'),

-- ── ADMIN_COMPANY (Admin Manager) — the company's own setup and paperwork. ───
('ADMIN_COMPANY','Admin Setup','FULL'), ('ADMIN_COMPANY','Company Profile','FULL'),
('ADMIN_COMPANY','Policies','EDIT'), ('ADMIN_COMPANY','Holidays','FULL'),
('ADMIN_COMPANY','Employees','VIEW'), ('ADMIN_COMPANY','Bulk Upload','EDIT'),
('ADMIN_COMPANY','ESS & Roles','VIEW'), ('ADMIN_COMPANY','Support','FULL'),

-- ── FINANCE_EXECUTIVE — settles claims and disburses. Holds the finance stage
--    of travel claims (TRAVEL_CLAIM_FINANCE) already. ──────────────────────────
('FINANCE_EXECUTIVE','Finance','FULL'), ('FINANCE_EXECUTIVE','Travel Claims','FULL'),
('FINANCE_EXECUTIVE','Loans','EDIT'), ('FINANCE_EXECUTIVE','Flexi Claims','EDIT'),
('FINANCE_EXECUTIVE','Payroll','VIEW'), ('FINANCE_EXECUTIVE','Reports','VIEW'),
('FINANCE_EXECUTIVE','Employees','VIEW'),

-- ── BRANCH_HR — HR at one location; ess_roles.scope is already BRANCH. ───────
('BRANCH_HR','Recruitment','EDIT'), ('BRANCH_HR','Onboarding','EDIT'),
('BRANCH_HR','Employees','VIEW'), ('BRANCH_HR','Attendance','EDIT'),
('BRANCH_HR','Attendance Reports','VIEW'), ('BRANCH_HR','Leave Config','VIEW'),
('BRANCH_HR','HR Letters','EDIT'), ('BRANCH_HR','Transfer','VIEW'),
('BRANCH_HR','ESS Reports','VIEW'),

-- ── RECRUITER (Hiring Manager) — raises and runs requisitions, nothing else. ─
('RECRUITER','Recruitment','EDIT'), ('RECRUITER','Onboarding','VIEW'), ('RECRUITER','Employees','VIEW');

-- CHRO mirrors HR_HEAD exactly.
INSERT INTO _matrix (role_code, module, access_level)
SELECT 'CHRO', module, access_level FROM _matrix WHERE role_code = 'HR_HEAD';

-- ── Apply ───────────────────────────────────────────────────────────────────
-- Replace only the roles named above. ADMIN_SUPER, IMPL_MANAGER, BRANCH_EXEC and
-- EMPLOYEE are untouched; L1_MANAGER / L2_MANAGER / HOD are cleared on purpose so
-- being a manager grants no admin module.
DELETE FROM role_permissions rp
 USING ess_roles r
 WHERE r.id = rp.role_id
   AND r.role_code IN (SELECT DISTINCT role_code FROM _matrix);

DELETE FROM role_permissions rp
 USING ess_roles r
 WHERE r.id = rp.role_id AND r.role_code IN ('L1_MANAGER','L2_MANAGER','HOD');

INSERT INTO role_permissions (role_id, module, access_level)
SELECT r.id, m.module, m.access_level
  FROM _matrix m JOIN ess_roles r ON r.role_code = m.role_code;

COMMIT;

-- ── Verify ──────────────────────────────────────────────────────────────────
SELECT r.role_code, count(*) AS modules_granted,
       count(*) FILTER (WHERE rp.access_level = 'FULL') AS full_access
  FROM role_permissions rp JOIN ess_roles r ON r.id = rp.role_id
 GROUP BY r.role_code ORDER BY 2 DESC;

-- What a Payroll Manager will see in the ESS sidebar:
SELECT rp.module, rp.access_level
  FROM role_permissions rp JOIN ess_roles r ON r.id = rp.role_id
 WHERE r.role_code = 'PAYROLL' ORDER BY rp.module;

-- ════════════════════════════════════════════════════════════════════════════
-- The acceptance test — Nayan Ahuja (SSM-0001) as Payroll Manager.
--
-- The seven role holders the spreadsheet names are already in ess_user_roles
-- (Shreya Reddy HR_MANAGER, Kiran Reddy HR_HEAD, Shreya Gupta PAYROLL, Vikram
-- Bose ADMIN_COMPANY, Aarav Bhat IT, Anjali Reddy FINANCE_EXECUTIVE, Suresh
-- Bhat BRANCH_HR) plus Neha Nair CFO. Nayan is not among them, and the test
-- described in the brief needs him to be a Payroll Manager. This is the only
-- assignment the migration makes; drop this block if you would rather test with
-- Shreya Gupta, who already holds PAYROLL.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO ess_user_roles (ess_account_id, role_id, is_active)
SELECT a.id, r.id, true
  FROM ess_accounts a
  JOIN employees e ON e.id = a.employee_id AND e.emp_code = 'SSM-0001'
  JOIN ess_roles r ON r.role_code = 'PAYROLL'
 WHERE NOT EXISTS (SELECT 1 FROM ess_user_roles x
                    WHERE x.ess_account_id = a.id AND x.role_id = r.id);

-- Who holds what, after all of the above:
SELECT e.emp_code, e.full_name, r.role_code, r.scope
  FROM ess_user_roles ur
  JOIN ess_accounts a ON a.id = ur.ess_account_id
  JOIN employees e    ON e.id = a.employee_id
  JOIN ess_roles r    ON r.id = ur.role_id
 WHERE ur.is_active
 ORDER BY r.sort_order, e.emp_code;
