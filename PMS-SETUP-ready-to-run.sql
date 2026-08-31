-- =====================================================================
-- EZER HRMS — PMS SETUP, ready to run
-- Generated 31-Aug-2026 from the LIVE org data (398 active employees,
-- 24 departments, 3 companies). Supersedes 02_SETUP_pms_data.sql, whose
-- INSERTs were all commented out and whose "27 rows" is not enough —
-- see the note in section 2.
--
-- RUN 074_pms_not_found_guards.sql FIRST. Without it pms_open_period
-- reports OPENED for a period id that does not exist.
--
-- Sections 1-4 are the data work. Run them in order and read section 5's
-- output before section 6.
-- =====================================================================

-- =====================================================================
-- 1. THE MANAGING DIRECTOR — 3 rows.  *** REVIEW THESE THREE LINES ***
--
-- The MD is the top of every chain: they are EXCLUDED from being appraised,
-- and they are who finalisation escalates to when the HOD is also somebody's
-- L1 manager. Nothing in the data names an MD (no Director / CEO / MD
-- designation exists), so these are picked as the person with the largest
-- reporting subtree in each company. If that is not who runs the company,
-- change the emp_code — it is the only judgement call in this file.
--
-- NOTE each of the three also comes out as the HOD of one department in
-- section 2 (SRS RETAIL, SSM LOG, STC FIN). That is allowed — it just means
-- those three departments are finalised by the MD directly.
-- =====================================================================
-- SRS: SRS9021 Arjun Malhotra — Senior Executive, reporting subtree of 43
-- SSM: SSM9008 Amit Malhotra — Senior Manager, reporting subtree of 21
-- STC: STC9007 Pooja Verma — Senior Executive, reporting subtree of 21

UPDATE companies SET md_employee_id = (SELECT id FROM employees WHERE emp_code = 'SRS9021')
 WHERE company_code = 'SRS';
UPDATE companies SET md_employee_id = (SELECT id FROM employees WHERE emp_code = 'SSM9008')
 WHERE company_code = 'SSM';
UPDATE companies SET md_employee_id = (SELECT id FROM employees WHERE emp_code = 'STC9007')
 WHERE company_code = 'STC';

-- =====================================================================
-- 2. DEPARTMENT HODs — 24 rows.
--
-- Each pick is the person at the TOP of their own department's reporting
-- chain (nobody in the department manages them), tie-broken by headcount.
-- dept_code is NOT unique — FIN, HR, IT, LOG and SALES each exist three
-- times — so every statement is paired with company_code.
-- =====================================================================
-- SRS CS      Customer Service            12 staff -> Meera Mehta (Senior Executive)
UPDATE departments d SET hod_employee_id = (SELECT id FROM employees WHERE emp_code = 'SRS9033')
  FROM companies c WHERE c.id = d.company_id AND c.company_code = 'SRS' AND d.dept_code = 'CS';
-- SRS FIN     Finance & Accounts          22 staff -> Sanjay Kapoor (Manager)
UPDATE departments d SET hod_employee_id = (SELECT id FROM employees WHERE emp_code = 'SRS9009')
  FROM companies c WHERE c.id = d.company_id AND c.company_code = 'SRS' AND d.dept_code = 'FIN';
-- SRS HR      HR & Admin                  17 staff -> Shreya Reddy (Senior Executive)
UPDATE departments d SET hod_employee_id = (SELECT id FROM employees WHERE emp_code = 'SRS9010')
  FROM companies c WHERE c.id = d.company_id AND c.company_code = 'SRS' AND d.dept_code = 'HR';
-- SRS IT      IT                          20 staff -> Kiran Kumar (Senior Executive)
UPDATE departments d SET hod_employee_id = (SELECT id FROM employees WHERE emp_code = 'SRS9022')
  FROM companies c WHERE c.id = d.company_id AND c.company_code = 'SRS' AND d.dept_code = 'IT';
-- SRS MERCH   Merchandising               15 staff -> Aarav Kumar (Senior Executive)
UPDATE departments d SET hod_employee_id = (SELECT id FROM employees WHERE emp_code = 'SRS9073')
  FROM companies c WHERE c.id = d.company_id AND c.company_code = 'SRS' AND d.dept_code = 'MERCH';
-- SRS RETAIL  Retail Operations           19 staff -> Arjun Malhotra (Senior Executive)
UPDATE departments d SET hod_employee_id = (SELECT id FROM employees WHERE emp_code = 'SRS9021')
  FROM companies c WHERE c.id = d.company_id AND c.company_code = 'SRS' AND d.dept_code = 'RETAIL';
-- SRS SALES   Sales & Marketing           25 staff -> Rahul Nair (Senior Manager)
UPDATE departments d SET hod_employee_id = (SELECT id FROM employees WHERE emp_code = 'SRS9007')
  FROM companies c WHERE c.id = d.company_id AND c.company_code = 'SRS' AND d.dept_code = 'SALES';
-- SSM FIN     Finance & Accounts          13 staff -> Sneha Verma (Senior Executive)
UPDATE departments d SET hod_employee_id = (SELECT id FROM employees WHERE emp_code = 'SSM9010')
  FROM companies c WHERE c.id = d.company_id AND c.company_code = 'SSM' AND d.dept_code = 'FIN';
-- SSM HR      HR & Admin                  12 staff -> Vikram Bose (Senior Executive)
UPDATE departments d SET hod_employee_id = (SELECT id FROM employees WHERE emp_code = 'SSM9031')
  FROM companies c WHERE c.id = d.company_id AND c.company_code = 'SSM' AND d.dept_code = 'HR';
-- SSM IT      IT                          11 staff -> Shreya Mehta (Senior Executive)
UPDATE departments d SET hod_employee_id = (SELECT id FROM employees WHERE emp_code = 'SSM9095')
  FROM companies c WHERE c.id = d.company_id AND c.company_code = 'SSM' AND d.dept_code = 'IT';
-- SSM LOG     Logistics                   22 staff -> Amit Malhotra (Senior Manager)
UPDATE departments d SET hod_employee_id = (SELECT id FROM employees WHERE emp_code = 'SSM9008')
  FROM companies c WHERE c.id = d.company_id AND c.company_code = 'SSM' AND d.dept_code = 'LOG';
-- SSM MAINT   Maintenance                 11 staff -> Sunita Jain (Senior Manager)
UPDATE departments d SET hod_employee_id = (SELECT id FROM employees WHERE emp_code = 'SSM9097')
  FROM companies c WHERE c.id = d.company_id AND c.company_code = 'SSM' AND d.dept_code = 'MAINT';
-- SSM MFG     Manufacturing                5 staff -> Meera Bose (Assistant Manager)
UPDATE departments d SET hod_employee_id = (SELECT id FROM employees WHERE emp_code = 'SSM9098')
  FROM companies c WHERE c.id = d.company_id AND c.company_code = 'SSM' AND d.dept_code = 'MFG';
-- SSM PROC    Procurement                 13 staff -> Vihaan Iyer (Manager)
UPDATE departments d SET hod_employee_id = (SELECT id FROM employees WHERE emp_code = 'SSM9020')
  FROM companies c WHERE c.id = d.company_id AND c.company_code = 'SSM' AND d.dept_code = 'PROC';
-- SSM PROD    Production                  17 staff -> Anjali Rao (Senior Executive)
UPDATE departments d SET hod_employee_id = (SELECT id FROM employees WHERE emp_code = 'SSM9019')
  FROM companies c WHERE c.id = d.company_id AND c.company_code = 'SSM' AND d.dept_code = 'PROD';
-- SSM QC      Quality Control             15 staff -> Rajesh Das (Manager)
UPDATE departments d SET hod_employee_id = (SELECT id FROM employees WHERE emp_code = 'SSM9045')
  FROM companies c WHERE c.id = d.company_id AND c.company_code = 'SSM' AND d.dept_code = 'QC';
-- SSM SALES   Sales & Marketing           12 staff -> Reyansh Jain (Senior Manager)
UPDATE departments d SET hod_employee_id = (SELECT id FROM employees WHERE emp_code = 'SSM9047')
  FROM companies c WHERE c.id = d.company_id AND c.company_code = 'SSM' AND d.dept_code = 'SALES';
-- STC FIN     Finance & Accounts          22 staff -> Pooja Verma (Senior Executive)
UPDATE departments d SET hod_employee_id = (SELECT id FROM employees WHERE emp_code = 'STC9007')
  FROM companies c WHERE c.id = d.company_id AND c.company_code = 'STC' AND d.dept_code = 'FIN';
-- STC HR      HR & Admin                  15 staff -> Riya Nair (Senior Executive)
UPDATE departments d SET hod_employee_id = (SELECT id FROM employees WHERE emp_code = 'STC9073')
  FROM companies c WHERE c.id = d.company_id AND c.company_code = 'STC' AND d.dept_code = 'HR';
-- STC IT      IT                          17 staff -> Kiran Patel (Senior Manager)
UPDATE departments d SET hod_employee_id = (SELECT id FROM employees WHERE emp_code = 'STC9022')
  FROM companies c WHERE c.id = d.company_id AND c.company_code = 'STC' AND d.dept_code = 'IT';
-- STC LEGAL   Legal & Compliance          16 staff -> Vihaan Kapoor (Senior Executive)
UPDATE departments d SET hod_employee_id = (SELECT id FROM employees WHERE emp_code = 'STC9035')
  FROM companies c WHERE c.id = d.company_id AND c.company_code = 'STC' AND d.dept_code = 'LEGAL';
-- STC LOG     Logistics                   22 staff -> Ishaan Bhat (Senior Manager)
UPDATE departments d SET hod_employee_id = (SELECT id FROM employees WHERE emp_code = 'STC9011')
  FROM companies c WHERE c.id = d.company_id AND c.company_code = 'STC' AND d.dept_code = 'LOG';
-- STC OPS     Operations                  17 staff -> Rekha Reddy (Senior Executive)
UPDATE departments d SET hod_employee_id = (SELECT id FROM employees WHERE emp_code = 'STC9026')
  FROM companies c WHERE c.id = d.company_id AND c.company_code = 'STC' AND d.dept_code = 'OPS';
-- STC SALES   Sales & Marketing           21 staff -> Kavya Das (Senior Executive)
UPDATE departments d SET hod_employee_id = (SELECT id FROM employees WHERE emp_code = 'STC9037')
  FROM companies c WHERE c.id = d.company_id AND c.company_code = 'STC' AND d.dept_code = 'SALES';

-- =====================================================================
-- 3. THE MISSING L1 MANAGERS — this is the step the handover file left out.
--
-- The resolver blocks anyone with no l1_manager_id, INCLUDING the people you
-- just made HODs: an HOD's own appraisal escalates to the MD, but they still
-- need an L1 reviewer. With only sections 1-2 applied, 29 employees stay
-- blocked (24 FIX_EMPLOYEE + 5 FIX_DEPARTMENT) and no period can open.
--
-- This points everyone who has no L1 at their company's MD. It deliberately
-- skips the MDs themselves — nobody manages the MD.
-- =====================================================================
UPDATE employees e
   SET l1_manager_id = c.md_employee_id
  FROM companies c
 WHERE c.id = e.company_id
   AND e.l1_manager_id IS NULL
   AND e.date_of_leaving IS NULL
   AND c.md_employee_id IS NOT NULL
   AND e.id <> c.md_employee_id;
-- expect: UPDATE 23   (26 with no L1, minus the 3 who became MDs)

-- =====================================================================
-- 4. EMPLOYEES WITH NO DEPARTMENT — 7 rows.
--
-- These cannot inherit a department HOD because they have no department.
-- employees.hod_id is the documented exception path, so point them at their
-- company's MD. The cleaner long-term fix is to give them a department.
-- =====================================================================
--   SRS SRS0001   aadhar
--   SRS SRS0002   SHyam
--   SRS SRS0003   Manoj Kumar Sharma
--   SRS SRS0004   umesh
--   SSM SSM-0001  Nayan Ahuja
--   SSM SSM0003   RAM Prasad
--   SSM SSM0004   khushal sharma
UPDATE employees e
   SET hod_id = c.md_employee_id
  FROM companies c
 WHERE c.id = e.company_id
   AND e.department_id IS NULL
   AND e.date_of_leaving IS NULL
   AND e.hod_id IS NULL
   AND c.md_employee_id IS NOT NULL
   AND e.id <> c.md_employee_id;
-- expect: UPDATE 7

-- =====================================================================
-- 5. THE GATE — everything must be READY or EXCLUDED before section 6.
-- =====================================================================
SELECT readiness_status, COUNT(*) FROM vw_pms_org_readiness
 GROUP BY readiness_status ORDER BY 2 DESC;
-- expected after 1-4:  READY 395  ·  EXCLUDED 3  (the MDs)  ·  nothing else
-- (simulated against the live org data before you run anything)

SELECT employee_code, employee_name, department_name, readiness_status, block_reason
  FROM vw_pms_org_readiness WHERE readiness_status NOT IN ('READY','EXCLUDED')
 ORDER BY readiness_status, employee_code;
-- must return 0 rows

-- =====================================================================
-- 6. POLICY + RATING SCALE — one policy per company.
--
-- Column names and every CHECK value verified against the live schema:
--   min_kra_count / max_kra_count   (NOT kra_min_count / kra_max_count)
--   frequency        MONTHLY | QUARTERLY | HALF_YEARLY | ANNUAL
--   approval_chain   SELF_RM1 | SELF_RM1_HOD | SELF_RM1_RM2_HOD | SELF_RM1_RM2_HOD_MD
--   who_can_finalise HOD_ONLY | RM2_HOD | RM1_RM2_HOD
-- payout_linkage_enabled is omitted: it carries CHECK (= false).
-- =====================================================================
INSERT INTO pms_policies (
  company_id, policy_code, policy_name, frequency,
  min_kra_count, max_kra_count, total_weightage, min_weightage_per_kra,
  one_to_one_mandatory, final_review_one_to_one, who_can_finalise, approval_chain)
SELECT c.id, 'STD_QTR', 'Standard Quarterly', 'QUARTERLY',
       4, 10, 100, 5, true, true, 'HOD_ONLY', 'SELF_RM1_RM2_HOD'
  FROM companies c
 WHERE c.company_code IN ('SRS','SSM','STC')
   AND NOT EXISTS (SELECT 1 FROM pms_policies p
                    WHERE p.company_id = c.id AND p.policy_code = 'STD_QTR');
-- expect: INSERT 0 3

-- The five rating bands, for every policy just created.
INSERT INTO pms_rating_scale
  (company_id, policy_id, rating_value, rating_code, rating_label,
   score_from, score_to, min_comment_chars,
   improvement_feedback_mandatory, allows_pip_request, colour_hex, sort_order)
SELECT p.company_id, p.id, v.val, v.code, v.label, v.f, v.t, v.chars, v.fb, v.pip, v.hex, v.ord
  FROM pms_policies p
  CROSS JOIN (VALUES
    (5,'O' ,'Outstanding'          ,4.51,5.00,200,false,false,'#16A34A',1),
    (4,'EE','Exceeds Expectations' ,3.51,4.50,100,false,false,'#7C3AED',2),
    (3,'ME','Meets Expectations'   ,2.51,3.50, 50,false,false,'#3C3489',3),
    (2,'NI','Needs Improvement'    ,1.51,2.50,200,true ,true ,'#F59E0B',4),
    (1,'U' ,'Unsatisfactory'       ,1.00,1.50,200,true ,true ,'#DC2626',5)
  ) AS v(val,code,label,f,t,chars,fb,pip,hex,ord)
 WHERE p.policy_code = 'STD_QTR'
   AND NOT EXISTS (SELECT 1 FROM pms_rating_scale r
                    WHERE r.policy_id = p.id AND r.rating_value = v.val);
-- expect: INSERT 0 15   (5 bands x 3 companies)

-- =====================================================================
-- 7. PERIODS — generate the FY, then open the current quarter.
-- =====================================================================
SELECT p.company_id, c.company_code, pms_generate_periods(p.id, '2026-27', '2026-04-01') AS periods_created
  FROM pms_policies p JOIN companies c ON c.id = p.company_id
 WHERE p.policy_code = 'STD_QTR';
-- expect: 4 per company

SELECT pe.id, c.company_code, pe.period_code, pe.period_start, pe.period_end, pe.status
  FROM pms_periods pe JOIN companies c ON c.id = pe.company_id
 ORDER BY c.company_code, pe.period_start;

-- Open ONE period per company. This RESOLVES AND FREEZES every chain, so a
-- reorg afterwards cannot change who finalises a cycle already running.
-- With 074 applied, a bad id now returns ERROR instead of OPENED.
--   SELECT pms_open_period('<period_id from the list above>');

-- What the freeze captured:
-- SELECT e.emp_code, e.full_name, o.chain_shape, o.workflow_status
--   FROM pms_overall_rating o JOIN employees e ON e.id = o.employee_id
--  ORDER BY e.emp_code;
