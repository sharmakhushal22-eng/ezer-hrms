-- =====================================================================
-- EZER HRMS — 086: who actually changed, per sync category
--
-- The Data Sync picker used to list every employee in the month, which answers
-- "who CAN I sync" when the question being asked is "who NEEDS it". This
-- function compares the live HRMS value against what the Month Master froze,
-- per category, and returns only the rows that differ — with the differing
-- fields named, so HR can see WHY somebody is on the list.
--
-- Every comparison mirrors its sync function's own source query — the same
-- joins, the same casts, the same effective-date rules (incl. 085's fix on
-- salary_structures). If a sync function's mapping changes, change the same
-- category here, or the picker will disagree with the button under it.
--
-- Only the copy categories are supported: employee, statutory, bank, salary,
-- flexi and inv_decl COPY a source into the snapshot, so "changed" is well
-- defined. The computed categories (earnings, EPF, ESIC, PT, LWF, NPS,
-- arrear, loan, reimbursement, proofs) derive their values during the run;
-- for those the function returns nothing and the picker falls back to the
-- full list.
--
-- IS DISTINCT FROM everywhere: NULL = NULL must read as "no change", and
-- NULL vs value as a change — plain <> gets both wrong.
-- =====================================================================

CREATE OR REPLACE FUNCTION payroll_sync_pending(p_run_id UUID, p_category TEXT)
RETURNS TABLE (employee_code TEXT, full_name TEXT, changes TEXT)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_run    payroll_runs%ROWTYPE;
  v_period DATE;
BEGIN
  SELECT * INTO v_run FROM payroll_runs WHERE id = p_run_id;
  IF NOT FOUND THEN RETURN; END IF;
  v_period := payroll_period_start(v_run.fy, v_run.month);

  IF p_category = 'employee' THEN
    RETURN QUERY
    -- Not in the month yet: sync_month_employee_info is the door new joiners
    -- come in through, so they belong on its list.
    SELECT e.emp_code::TEXT, e.full_name::TEXT, 'new joiner — not in this month yet'::TEXT
    FROM payroll_eligible_employees(p_run_id, NULL) e
    WHERE NOT EXISTS (SELECT 1 FROM payroll_employee_snapshot p WHERE p.run_id = p_run_id AND p.employee_id = e.id)
    UNION ALL
    SELECT p.employee_code::TEXT, p.full_name::TEXT, x.diff
    FROM payroll_employee_snapshot p
    JOIN payroll_eligible_employees(p_run_id, NULL) e ON e.id = p.employee_id
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN locations   l ON l.id = e.location_id
    CROSS JOIN LATERAL (
      SELECT array_to_string(array_remove(ARRAY[
        CASE WHEN p.full_name          IS DISTINCT FROM e.full_name          THEN 'name' END,
        CASE WHEN p.father_name        IS DISTINCT FROM e.father_name        THEN 'father name' END,
        CASE WHEN p.mother_name        IS DISTINCT FROM e.mother_name        THEN 'mother name' END,
        CASE WHEN p.designation        IS DISTINCT FROM e.designation        THEN 'designation' END,
        CASE WHEN p.department         IS DISTINCT FROM d.dept_name          THEN 'department' END,
        CASE WHEN p.sub_department     IS DISTINCT FROM e.sub_department     THEN 'sub department' END,
        CASE WHEN p.cost_centre        IS DISTINCT FROM e.cost_centre        THEN 'cost centre' END,
        CASE WHEN p.grade              IS DISTINCT FROM e.grade              THEN 'grade' END,
        CASE WHEN p.location           IS DISTINCT FROM l.location_name      THEN 'location' END,
        CASE WHEN p.employment_type    IS DISTINCT FROM e.employment_type    THEN 'employment type' END,
        CASE WHEN p.employment_status  IS DISTINCT FROM e.employment_status  THEN 'employment status' END,
        CASE WHEN p.office_email       IS DISTINCT FROM e.office_email       THEN 'office email' END,
        CASE WHEN p.personal_email     IS DISTINCT FROM e.personal_email     THEN 'personal email' END,
        CASE WHEN p.group_doj          IS DISTINCT FROM e.group_doj::DATE    THEN 'group DOJ' END,
        CASE WHEN p.company_doj        IS DISTINCT FROM e.company_doj::DATE  THEN 'company DOJ' END,
        CASE WHEN p.date_of_leaving    IS DISTINCT FROM COALESCE(e.date_of_leaving, e.last_working_date, e.relieving_date) THEN 'date of leaving' END,
        CASE WHEN p.location_state     IS DISTINCT FROM l.state              THEN 'location state' END,
        CASE WHEN p.location_district  IS DISTINCT FROM l.district           THEN 'location district' END,
        CASE WHEN p.location_city      IS DISTINCT FROM l.city               THEN 'location city' END,
        CASE WHEN p.location_pin_code  IS DISTINCT FROM l.pin_code::TEXT     THEN 'pin code' END,
        CASE WHEN p.actual_posted_state IS DISTINCT FROM e.actual_posted_state THEN 'posted state' END,
        CASE WHEN p.self_declared_state IS DISTINCT FROM e.self_declared_state THEN 'self-declared state' END,
        CASE WHEN p.res_state          IS DISTINCT FROM e.res_state          THEN 'residential state' END,
        CASE WHEN p.perm_state         IS DISTINCT FROM e.perm_state         THEN 'permanent state' END
      ], NULL), ', ') AS diff
    ) x
    WHERE p.run_id = p_run_id AND x.diff <> '';

  ELSIF p_category = 'statutory' THEN
    RETURN QUERY
    SELECT p.employee_code::TEXT, p.full_name::TEXT, x.diff
    FROM payroll_employee_snapshot p
    JOIN payroll_eligible_employees(p_run_id, NULL) e ON e.id = p.employee_id
    CROSS JOIN LATERAL (
      SELECT array_to_string(array_remove(ARRAY[
        CASE WHEN p.pan_number              IS DISTINCT FROM e.pan_number              THEN 'PAN' END,
        CASE WHEN p.uan_number              IS DISTINCT FROM e.uan_number              THEN 'UAN' END,
        CASE WHEN p.previous_uan            IS DISTINCT FROM e.previous_uan            THEN 'previous UAN' END,
        CASE WHEN p.esic_number             IS DISTINCT FROM e.esic_number             THEN 'ESIC number' END,
        CASE WHEN p.pf_account_number       IS DISTINCT FROM e.pf_account_number       THEN 'PF account' END,
        CASE WHEN p.pf_applicable           IS DISTINCT FROM e.pf_applicable           THEN 'PF applicable' END,
        CASE WHEN p.pf_gross_limit          IS DISTINCT FROM e.pf_gross_limit          THEN 'PF gross limit' END,
        CASE WHEN p.pf_wage_type            IS DISTINCT FROM e.pf_wage_type::TEXT      THEN 'PF wage type' END,
        CASE WHEN p.pf_existing_member      IS DISTINCT FROM e.pf_existing_member      THEN 'PF existing member' END,
        CASE WHEN p.epf_method              IS DISTINCT FROM e.epf_method::TEXT        THEN 'EPF method' END,
        CASE WHEN p.epf_wage_limit          IS DISTINCT FROM e.epf_wage_limit          THEN 'EPF wage limit' END,
        CASE WHEN p.voluntary_pf_applicable IS DISTINCT FROM e.voluntary_pf_applicable THEN 'VPF applicable' END,
        CASE WHEN p.vpf_percent             IS DISTINCT FROM e.vpf_percent             THEN 'VPF %' END,
        CASE WHEN p.epf_pension_applicable  IS DISTINCT FROM e.epf_pension_applicable  THEN 'EPS applicable' END,
        CASE WHEN p.pension_applicable      IS DISTINCT FROM e.pension_applicable      THEN 'pension applicable' END,
        CASE WHEN p.pension_number          IS DISTINCT FROM e.pension_number          THEN 'pension number' END,
        CASE WHEN p.esic_applicable         IS DISTINCT FROM e.esic_applicable         THEN 'ESIC applicable' END,
        CASE WHEN p.esic_wage_limit         IS DISTINCT FROM e.esic_wage_limit         THEN 'ESIC wage limit' END,
        CASE WHEN p.pt_applicable           IS DISTINCT FROM e.pt_applicable           THEN 'PT applicable' END,
        CASE WHEN p.professional_tax_state  IS DISTINCT FROM e.professional_tax_state  THEN 'PT state' END,
        CASE WHEN p.lwf_applicable          IS DISTINCT FROM e.lwf_applicable          THEN 'LWF applicable' END,
        CASE WHEN p.lwf_state               IS DISTINCT FROM e.lwf_state               THEN 'LWF state' END,
        CASE WHEN p.tds_regime              IS DISTINCT FROM e.tds_regime              THEN 'tax regime' END,
        CASE WHEN p.wage_category           IS DISTINCT FROM e.wage_category           THEN 'wage category' END,
        CASE WHEN p.gratuity_eligible       IS DISTINCT FROM e.gratuity_eligible       THEN 'gratuity eligible' END
      ], NULL), ', ') AS diff
    ) x
    WHERE p.run_id = p_run_id AND x.diff <> '';

  ELSIF p_category = 'bank' THEN
    RETURN QUERY
    SELECT p.employee_code::TEXT, p.full_name::TEXT, x.diff
    FROM payroll_employee_snapshot p
    JOIN payroll_eligible_employees(p_run_id, NULL) e ON e.id = p.employee_id
    CROSS JOIN LATERAL (
      SELECT array_to_string(array_remove(ARRAY[
        CASE WHEN p.bank_name           IS DISTINCT FROM e.bank_name           THEN 'bank name' END,
        CASE WHEN p.bank_account_number IS DISTINCT FROM e.bank_account_number THEN 'account number' END,
        CASE WHEN p.ifsc_code           IS DISTINCT FROM e.ifsc_code           THEN 'IFSC' END,
        CASE WHEN p.account_type        IS DISTINCT FROM e.account_type        THEN 'account type' END
      ], NULL), ', ') AS diff
    ) x
    WHERE p.run_id = p_run_id AND x.diff <> '';

  ELSIF p_category = 'salary' THEN
    RETURN QUERY
    SELECT p.employee_code::TEXT, p.full_name::TEXT, x.diff
    FROM payroll_employee_snapshot p
    JOIN payroll_eligible_employees(p_run_id, NULL) e ON e.id = p.employee_id
    -- The same two lookups sync_month_salary makes, incl. 085's month test.
    LEFT JOIN LATERAL (
      SELECT * FROM salary_structures s
      WHERE s.employee_id = e.id AND s.fy = v_run.fy
        AND (s.effective_date IS NULL OR s.effective_date <= v_period)
      ORDER BY s.effective_date DESC NULLS LAST LIMIT 1
    ) ss ON true
    LEFT JOIN LATERAL (
      SELECT * FROM ctc_master c
      WHERE c.employee_id = e.id AND (c.effective_from IS NULL OR c.effective_from <= v_period)
      ORDER BY c.effective_from DESC NULLS LAST LIMIT 1
    ) ctc ON true
    CROSS JOIN LATERAL (
      SELECT array_to_string(array_remove(ARRAY[
        CASE WHEN p.annual_ctc        IS DISTINCT FROM ctc.annual_ctc         THEN 'annual CTC' END,
        CASE WHEN p.variable_annual   IS DISTINCT FROM ctc.annual_variable    THEN 'annual variable' END,
        CASE WHEN p.total_ctc         IS DISTINCT FROM ss.total_ctc           THEN 'total CTC' END,
        CASE WHEN p.basic_monthly     IS DISTINCT FROM ss.basic_monthly       THEN 'basic' END,
        CASE WHEN p.hra_monthly       IS DISTINCT FROM ss.hra_monthly         THEN 'HRA' END,
        CASE WHEN p.conveyance        IS DISTINCT FROM ss.conveyance          THEN 'conveyance' END,
        CASE WHEN p.special_allowance IS DISTINCT FROM ss.special_allowance   THEN 'special allowance' END,
        CASE WHEN p.statutory_bonus   IS DISTINCT FROM ss.statutory_bonus     THEN 'statutory bonus' END,
        CASE WHEN p.gross_monthly     IS DISTINCT FROM ss.gross_monthly       THEN 'gross' END,
        CASE WHEN p.employer_pf       IS DISTINCT FROM ss.employer_pf         THEN 'employer PF' END,
        CASE WHEN p.employer_esic     IS DISTINCT FROM ss.employer_esic       THEN 'employer ESIC' END,
        CASE WHEN p.employee_pf       IS DISTINCT FROM ss.employee_pf         THEN 'employee PF' END,
        CASE WHEN p.employee_esic     IS DISTINCT FROM ss.employee_esic       THEN 'employee ESIC' END,
        CASE WHEN p.gratuity_monthly  IS DISTINCT FROM ss.gratuity_monthly    THEN 'gratuity' END,
        CASE WHEN p.net_take_home     IS DISTINCT FROM ss.net_take_home       THEN 'net take home' END,
        CASE WHEN p.epf_wage          IS DISTINCT FROM ss.epf_wage            THEN 'EPF wage' END
      ], NULL), ', ') AS diff
    ) x
    WHERE p.run_id = p_run_id AND ss.employee_id IS NOT NULL AND x.diff <> '';

  ELSIF p_category = 'flexi' THEN
    RETURN QUERY
    SELECT p.employee_code::TEXT, p.full_name::TEXT, x.diff
    FROM payroll_employee_snapshot p
    JOIN payroll_eligible_employees(p_run_id, NULL) e ON e.id = p.employee_id
    LEFT JOIN LATERAL (
      SELECT f.regime,
             CASE WHEN f.regime = 'NEW' THEN f.form_data->'nFlexi' ELSE f.form_data->'oFlexi' END AS fx
      FROM flexi_tds_forms f
      WHERE f.employee_id = e.id AND f.fy = v_run.fy
      ORDER BY f.updated_at DESC NULLS LAST LIMIT 1
    ) fl ON true
    CROSS JOIN LATERAL (
      SELECT array_to_string(array_remove(ARRAY[
        CASE WHEN p.flexi_regime IS DISTINCT FROM fl.regime THEN 'regime' END,
        CASE WHEN p.flexi_car    IS DISTINCT FROM ROUND(COALESCE((fl.fx->>'car')::NUMERIC, 0) / 12)    THEN 'car lease' END,
        CASE WHEN p.flexi_driver IS DISTINCT FROM ROUND(COALESCE((fl.fx->>'driver')::NUMERIC, 0) / 12) THEN 'driver' END,
        CASE WHEN p.flexi_fuel   IS DISTINCT FROM ROUND(COALESCE((fl.fx->>'fuel')::NUMERIC, 0) / 12)   THEN 'fuel' END,
        CASE WHEN p.flexi_tel    IS DISTINCT FROM ROUND(COALESCE((fl.fx->>'tel')::NUMERIC, 0) / 12)    THEN 'telephone' END,
        CASE WHEN p.flexi_meal   IS DISTINCT FROM ROUND(COALESCE((fl.fx->>'meal')::NUMERIC, 0) / 12)   THEN 'meal' END,
        CASE WHEN p.flexi_device IS DISTINCT FROM ROUND(COALESCE((fl.fx->>'device')::NUMERIC, 0) / 12) THEN 'device' END,
        CASE WHEN p.flexi_attire IS DISTINCT FROM ROUND(COALESCE((fl.fx->>'attire')::NUMERIC, 0) / 12) THEN 'attire' END,
        CASE WHEN p.flexi_pda    IS DISTINCT FROM ROUND(COALESCE((fl.fx->>'pda')::NUMERIC, 0) / 12)    THEN 'books & periodicals' END,
        CASE WHEN p.flexi_lta    IS DISTINCT FROM ROUND(COALESCE((fl.fx->>'lta')::NUMERIC, 0) / 12)    THEN 'LTA' END,
        CASE WHEN p.flexi_chedu  IS DISTINCT FROM ROUND(COALESCE((fl.fx->>'chedu')::NUMERIC, 0) / 12)  THEN 'children education' END,
        CASE WHEN p.flexi_hostel IS DISTINCT FROM ROUND(COALESCE((fl.fx->>'hostel')::NUMERIC, 0) / 12) THEN 'hostel' END
      ], NULL), ', ') AS diff
    ) x
    WHERE p.run_id = p_run_id AND fl.regime IS NOT NULL AND x.diff <> '';

  ELSIF p_category = 'inv_decl' THEN
    RETURN QUERY
    SELECT p.employee_code::TEXT, p.full_name::TEXT, ('tax regime: ' || COALESCE(p.tds_regime, '—') || ' → ' || d.regime)::TEXT
    FROM payroll_employee_snapshot p
    JOIN payroll_eligible_employees(p_run_id, NULL) e ON e.id = p.employee_id
    JOIN tds_declarations d ON d.employee_id = e.id AND d.fy = v_run.fy
    WHERE p.run_id = p_run_id
      AND COALESCE(d.regime, '') <> ''
      AND p.tds_regime IS DISTINCT FROM d.regime;

  END IF;
  -- Any other category: computed during the run, no source-vs-snapshot diff
  -- exists — return nothing and let the caller fall back to the full list.
END $$;


-- ── verify ───────────────────────────────────────────────────────────────
SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'payroll_sync_pending')
       THEN 'OK — payroll_sync_pending exists' ELSE 'MISSING' END AS result;
