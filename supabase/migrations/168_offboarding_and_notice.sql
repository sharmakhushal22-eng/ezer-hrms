-- 168_offboarding_and_notice.sql — notice period through the hiring flow, and access
-- revoked on the last working day (20-Oct-2026).
--
-- 1. onboarding_candidates.notice_period_days: the notice period of the offer (ctc_negotiations /
--    offer_letters.notice_period_days, else the company default) rides on the onboarding and
--    lands on employees.notice_period_days at code generation — the number the resignation
--    chain uses for the policy last working day.
-- 2. employees.access_revoked_at: stamped by /api/cron/offboarding-daily when the last working
--    day has passed and the ESS account, the roles and the reporting lines were closed.
-- 3. fn_resignation_stage_approver: the HR Manager fallback is scoped to the employee's company
--    (it picked the first RESIGNATION approver across all companies).

ALTER TABLE onboarding_candidates ADD COLUMN IF NOT EXISTS notice_period_days INTEGER;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS access_revoked_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION fn_resignation_stage_approver(p_employee_id UUID, p_stage TEXT)
RETURNS UUID LANGUAGE plpgsql STABLE AS $$
DECLARE e RECORD; v UUID;
BEGIN
  SELECT l1_manager_id, l2_manager_id, hod_id, hr_manager_id, department_id, company_id INTO e FROM employees WHERE id = p_employee_id;
  IF p_stage = 'RM_L1' THEN v := e.l1_manager_id;
  ELSIF p_stage = 'RM_L2' THEN v := e.l2_manager_id;
  ELSIF p_stage = 'HOD' THEN
    v := COALESCE(e.hod_id, (SELECT hod_employee_id FROM departments WHERE id = e.department_id));
  ELSIF p_stage = 'HR_MANAGER' THEN
    -- the employee's own HR manager if set, else an active RESIGNATION approver OF THE SAME
    -- COMPANY (HR Manager before HR Head before CHRO), else any
    v := e.hr_manager_id;
    IF v IS NULL THEN
      SELECT a.employee_id INTO v
        FROM ess_accounts a
        JOIN employees emp ON emp.id = a.employee_id AND emp.company_id = e.company_id AND COALESCE(emp.employment_status, 'Active') = 'Active'
        JOIN ess_user_roles ur ON ur.ess_account_id = a.id AND ur.is_active
        JOIN role_approval_rights ar ON ar.role_id = ur.role_id AND ar.approval_type = 'RESIGNATION' AND ar.can_approve
        JOIN ess_roles r ON r.id = ur.role_id
       WHERE a.status = 'ACTIVE' AND a.employee_id <> p_employee_id
       ORDER BY r.sort_order LIMIT 1;
    END IF;
    IF v IS NULL THEN
      SELECT a.employee_id INTO v
        FROM ess_accounts a
        JOIN ess_user_roles ur ON ur.ess_account_id = a.id AND ur.is_active
        JOIN role_approval_rights ar ON ar.role_id = ur.role_id AND ar.approval_type = 'RESIGNATION' AND ar.can_approve
        JOIN ess_roles r ON r.id = ur.role_id
       WHERE a.employee_id <> p_employee_id
       ORDER BY r.sort_order LIMIT 1;
    END IF;
  END IF;
  RETURN v;
END $$;

NOTIFY pgrst, 'reload schema';
