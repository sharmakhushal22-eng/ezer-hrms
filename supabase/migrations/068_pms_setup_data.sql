-- =====================================================================
-- 068_pms_setup_data.sql — delivered as "057_pms_setup_data.sql"; renumbered
-- alongside 066/067 (formerly 055/056) — see 066's header for why.
--
-- This is NOT a schema migration. 066 and 067 create the module; this
-- fills in the data it cannot work without, and starts the first cycle.
--
-- Run it in blocks, reading the output as you go. Nothing here is
-- idempotent in the way a migration is — the UPDATEs are yours to review
-- before you commit them.
--
-- ORDER
--   A  see what is missing
--   B  map the HOD for every department        <- the real work
--   C  map the MD for every company
--   D  confirm nothing is unresolvable
--   E  create a policy
--   F  generate periods and open one
-- =====================================================================


-- =====================================================================
-- A. WHAT IS MISSING
-- Run these first. They tell you the size of the job before you start.
-- =====================================================================

-- A1. Every department, and whether it has an HOD.
--     NOTE dept_code is NOT unique — FIN, HR, IT, LOG and SALES each
--     exist three times, once per company. Always look at company too.
SELECT c.company_code,
       d.dept_code,
       d.dept_name,
       d.id                        AS department_id,
       e.emp_code                  AS hod_code,
       e.full_name                 AS hod_name,
       COUNT(emp.id)               AS headcount
FROM departments d
JOIN companies c            ON c.id  = d.company_id
LEFT JOIN employees e       ON e.id  = d.hod_employee_id
LEFT JOIN employees emp     ON emp.department_id = d.id
                           AND emp.date_of_leaving IS NULL
GROUP BY c.company_code, d.dept_code, d.dept_name, d.id, e.emp_code, e.full_name
ORDER BY c.company_code, d.dept_code;

-- A2. Who has no RM L1. Expect around 26 — mostly org-top, some gaps.
SELECT c.company_code, e.emp_code, e.full_name, e.designation, e.grade,
       d.dept_name
FROM employees e
LEFT JOIN companies c   ON c.id = e.company_id
LEFT JOIN departments d ON d.id = e.department_id
WHERE e.date_of_leaving IS NULL
  AND e.l1_manager_id IS NULL
ORDER BY c.company_code, e.grade DESC NULLS LAST;

-- A3. Anyone with no department at all — they cannot inherit a
--     department HOD, so they need employees.hod_id set individually.
SELECT c.company_code, e.emp_code, e.full_name, e.designation
FROM employees e
LEFT JOIN companies c ON c.id = e.company_id
WHERE e.date_of_leaving IS NULL AND e.department_id IS NULL
ORDER BY c.company_code, e.emp_code;


-- =====================================================================
-- B. MAP THE HOD FOR EVERY DEPARTMENT
--
-- 24 departments across 3 companies. This is the whole job — because the
-- resolver reads the department first, mapping 24 rows covers almost
-- everybody, and employees.hod_id is only for exceptions.
--
-- *** dept_code alone is NOT a key. ***
-- UPDATE ... WHERE dept_code = 'FIN' would set the HOD for Finance in
-- ALL THREE companies at once. Always pair it with company, or use the
-- department id from A1.
-- =====================================================================

-- B1. SAFEST — by department id, straight from A1. One row, no ambiguity.
--     UPDATE departments
--        SET hod_employee_id = (SELECT id FROM employees WHERE emp_code = 'STC9077')
--      WHERE id = '<department_id from A1>';

-- B2. By company + code, if you prefer reading it. Still one row.
--     UPDATE departments d
--        SET hod_employee_id = (SELECT id FROM employees WHERE emp_code = 'STC9077')
--       FROM companies c
--      WHERE c.id = d.company_id
--        AND c.company_code = 'STC'
--        AND d.dept_code    = 'SALES';

-- B3. Check as you go — this should shrink to zero.
SELECT c.company_code, d.dept_code, d.dept_name
FROM departments d JOIN companies c ON c.id = d.company_id
WHERE d.hod_employee_id IS NULL
ORDER BY c.company_code, d.dept_code;

-- B4. Sanity check on what you have set: is every HOD an active employee
--     of the same company as the department they head?
SELECT c.company_code, d.dept_name, e.emp_code, e.full_name,
       CASE WHEN e.id IS NULL                    THEN 'HOD id does not exist'
            WHEN e.date_of_leaving IS NOT NULL    THEN 'HOD has left'
            WHEN e.company_id <> d.company_id     THEN 'HOD is in another company'
            ELSE 'ok' END AS check_result
FROM departments d
JOIN companies c      ON c.id = d.company_id
LEFT JOIN employees e ON e.id = d.hod_employee_id
WHERE d.hod_employee_id IS NOT NULL
ORDER BY 5 DESC, c.company_code;


-- =====================================================================
-- C. MAP THE MD FOR EVERY COMPANY
-- Three rows. The MD sits at the top and is excluded from being
-- appraised by the chain.
-- =====================================================================

--     UPDATE companies SET md_employee_id =
--       (SELECT id FROM employees WHERE emp_code = '<MD emp_code>')
--      WHERE company_code = 'SRS';       -- and SSM, and STC

SELECT company_code, company_name, md_employee_id FROM companies ORDER BY company_code;


-- =====================================================================
-- D. CONFIRM NOTHING IS UNRESOLVABLE
-- This is the gate. A period will not open while anyone here is not
-- READY, so clear it before moving on.
-- =====================================================================

SELECT * FROM vw_pms_readiness_summary;

SELECT readiness_status, COUNT(*)
FROM vw_pms_org_readiness
GROUP BY readiness_status ORDER BY 2 DESC;

-- The individuals still blocking, with the reason:
-- vw_pms_org_readiness (067) exposes this column as department_name, not
-- dept_name — that is only the raw departments.dept_name, which the view
-- re-aliases on the way out.
SELECT employee_code, employee_name, department_name, readiness_status, block_reason
FROM vw_pms_org_readiness
WHERE readiness_status <> 'READY'
ORDER BY readiness_status, employee_code;


-- =====================================================================
-- E. CREATE A POLICY
-- One per company, or one shared — a policy carries the frequency, the
-- KRA rules and who may finalise.
--
-- payout_linkage_enabled is omitted deliberately. It defaults false and
-- carries CHECK (payout_linkage_enabled = false); PMS is developmental
-- only and setting it true will fail.
-- =====================================================================

--     INSERT INTO pms_policies (
--       company_id, policy_code, policy_name,
--       frequency, kra_min_count, kra_max_count,
--       total_weightage, min_weightage_per_kra,
--       one_to_one_mandatory, final_review_one_to_one,
--       who_can_finalise, approval_chain
--     ) VALUES (
--       (SELECT id FROM companies WHERE company_code = 'STC'),
--       'STD_QTR', 'Standard Quarterly',
--       'QUARTERLY', 4, 10,
--       100, 5,
--       true, true,
--       'HOD_ONLY',              -- HOD finalises; HR Admin supervises
--       'RM1_RM2_HOD'
--     );

SELECT id, policy_code, policy_name, frequency, who_can_finalise
FROM pms_policies ORDER BY created_at;


-- =====================================================================
-- F. GENERATE PERIODS AND OPEN ONE
-- =====================================================================

-- F1. Build the periods for a financial year from the policy's frequency.
--     SELECT pms_generate_periods('<policy_id>', '2026-27', '2026-04-01');

SELECT id, period_code, period_start, period_end, status
FROM pms_periods ORDER BY period_start;

-- F2. Open one. This RESOLVES AND FREEZES the chain for everybody, so a
--     reorg later cannot change who finalises a cycle already running.
--     It refuses if anyone is unresolvable — that is section D's job.
--     SELECT pms_open_period('<period_id>');

-- F3. What the freeze captured. rm_l1_id / rm_l2_id / hod_id here are the
--     chain for THIS period and will not move.
SELECT o.employee_id, e.emp_code, e.full_name, o.chain_shape,
       o.rm_l1_id, o.rm_l2_id, o.hod_id, o.workflow_status
FROM pms_overall_rating o
JOIN employees e ON e.id = o.employee_id
ORDER BY e.emp_code;


-- =====================================================================
-- AFTER THIS
-- Employees see Performance in ESS and can write their KRAs. Managers
-- see My Team. HODs see Department. Nothing in the app needs changing —
-- the screens are already built and are waiting on these rows.
-- =====================================================================
