-- 169_notice_by_probation.sql — notice period by probation (20-Oct-2026).
-- On probation (the first 6 months — employees.probation_months when set — or
-- confirmation_status = 'Probation') the notice period is 30 days; confirmed, 60 days.
-- fn_resignation_submit computes it at submission (and writes it back to
-- employees.notice_period_days so the record agrees), instead of trusting whatever
-- number the record carried. Mirrors lib/exit/notice.ts.

CREATE OR REPLACE FUNCTION fn_effective_notice_days(p_employee_id UUID)
RETURNS INT LANGUAGE plpgsql STABLE AS $$
DECLARE e RECORD; on_prob BOOLEAN;
BEGIN
  SELECT confirmation_status, confirmation_date, company_doj, group_doj, probation_months INTO e FROM employees WHERE id = p_employee_id;
  IF NOT FOUND THEN RETURN 60; END IF;
  IF lower(COALESCE(e.confirmation_status, '')) = 'probation' THEN on_prob := TRUE;
  ELSIF lower(COALESCE(e.confirmation_status, '')) IN ('confirmed', 'permanent') THEN on_prob := FALSE;
  ELSIF e.confirmation_date IS NOT NULL AND e.confirmation_date <= CURRENT_DATE THEN on_prob := FALSE;
  ELSIF COALESCE(e.company_doj, e.group_doj) IS NULL THEN on_prob := FALSE;
  ELSE on_prob := CURRENT_DATE < (COALESCE(e.company_doj, e.group_doj) + make_interval(months => GREATEST(COALESCE(e.probation_months, 6), 1)))::date;
  END IF;
  RETURN CASE WHEN on_prob THEN 30 ELSE 60 END;
END $$;

CREATE OR REPLACE FUNCTION fn_resignation_submit(p_employee_id UUID, p_reason_code TEXT, p_date DATE DEFAULT CURRENT_DATE, p_remarks TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v_id UUID; v_notice INT; v_name TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM employee_resignation WHERE employee_id = p_employee_id AND status NOT IN ('SETTLED','WITHDRAWN')) THEN
    RAISE EXCEPTION 'An open resignation already exists for this employee';
  END IF;
  SELECT full_name INTO v_name FROM employees WHERE id = p_employee_id;
  v_notice := fn_effective_notice_days(p_employee_id);
  UPDATE employees SET notice_period_days = v_notice WHERE id = p_employee_id AND notice_period_days IS DISTINCT FROM v_notice;
  INSERT INTO employee_resignation (employee_id, date_of_resignation, notice_period_days, lwd_as_per_policy, status,
                                    remarks, initiated_by, initiated_by_name, reason_code, submitted_by_employee, submitted_at)
  VALUES (p_employee_id, p_date, v_notice, p_date + v_notice, 'INITIATED', p_remarks, p_employee_id, v_name, p_reason_code, true, now())
  RETURNING id INTO v_id;
  PERFORM fn_resignation_advance(v_id);
  RETURN v_id;
END $$;

NOTIFY pgrst, 'reload schema';
