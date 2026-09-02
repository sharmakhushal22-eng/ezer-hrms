-- =====================================================================
-- EZER HRMS — 085: sync_month_salary must respect the payroll month
--
-- ── THE DEFECT ─────────────────────────────────────────────────────────
-- sync_month_salary reads two sources, and only one of them is asked which
-- month it is being synced for:
--
--   ctc_master        WHERE c.effective_from IS NULL OR c.effective_from <= v_period
--                     ORDER BY c.effective_from DESC LIMIT 1        ← correct
--
--   salary_structures WHERE s.employee_id = e.id AND s.fy = v_run.fy
--                     ORDER BY s.effective_date DESC LIMIT 1        ← no date test
--
-- v_period is already computed at the top of the function and already used by
-- the ctc_master lookup, so the month is known — the structure lookup simply
-- does not consult it. It takes the LATEST structure in the financial year,
-- and DESC puts a future one first.
--
-- Consequence: an appraisal effective 01-Jul creates a second salary_structures
-- row. Re-syncing Salary for APRIL then pulls the JULY structure into April —
-- a higher basic, a higher HRA, and every downstream figure computed off them:
-- earned salary, EPF wages, ESIC, gratuity, net pay. April would silently pay
-- at the July rate, and the appraisal arrear engine would then difference that
-- month against a figure that was never right.
--
-- ── NOT YET BITING ─────────────────────────────────────────────────────
-- Checked against the live database on 02-Sep-2026: 337 salary_structures rows,
-- and ZERO employees with more than one row in the same financial year. So no
-- month is wrong today. But creating that second row is exactly what the
-- Appraisal module does, so this is a defect waiting on the first appraisal.
--
-- ── THE FIX ────────────────────────────────────────────────────────────
-- One WHERE clause. The structure lookup gets the same test ctc_master already
-- has: take the latest one that had taken effect BY this payroll month.
--
-- NULL effective_date is admitted deliberately. Rows loaded before the column
-- was populated carry NULL, and NULL sorts last under NULLS LAST — so a dated
-- row still wins where one exists, and an undated row is used only when it is
-- all there is. Excluding NULL instead would leave those employees with no
-- structure at all, which pays them zero.
--
-- Everything else in the function is unchanged, including p_codes.
-- =====================================================================

CREATE OR REPLACE FUNCTION sync_month_salary(p_run_id UUID, p_codes TEXT[] DEFAULT NULL)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  v_run    payroll_runs%ROWTYPE;
  v_period DATE;
  v_new    INTEGER := 0;
  v_count  INTEGER := 0;
BEGIN
  PERFORM payroll_assert_month_open(p_run_id);
  SELECT * INTO v_run FROM payroll_runs WHERE id = p_run_id;
  v_period := payroll_period_start(v_run.fy, v_run.month);
  v_new    := payroll_add_new_employees(p_run_id, p_codes);

  UPDATE payroll_employee_snapshot pes SET
    annual_ctc              = src.annual_ctc,
    total_ctc               = src.total_ctc,
    variable_annual         = src.annual_variable,
    basic_monthly           = src.basic_monthly,
    hra_monthly             = src.hra_monthly,
    conveyance              = src.conveyance,
    special_allowance       = src.special_allowance,
    special_allowance_gross = src.special_allowance_gross,
    statutory_bonus         = src.statutory_bonus,
    gross_monthly           = src.gross_monthly,
    employer_pf             = src.employer_pf,
    employer_esic           = src.employer_esic,
    employee_pf             = src.employee_pf,
    employee_esic           = src.employee_esic,
    gratuity_monthly        = src.gratuity_monthly,
    pt_monthly              = src.pt_monthly,
    lwf_monthly             = src.lwf_monthly,
    net_take_home           = src.net_take_home,
    epf_wage                = src.epf_wage,
    synced_at               = now()
  FROM (
    SELECT e.id AS employee_id,
           ctc.annual_ctc, ctc.annual_variable,
           ss.total_ctc, ss.basic_monthly, ss.hra_monthly, ss.conveyance,
           ss.special_allowance, ss.special_allowance_gross, ss.statutory_bonus,
           ss.gross_monthly, ss.employer_pf, ss.employer_esic, ss.employee_pf, ss.employee_esic,
           ss.gratuity_monthly, ss.pt_monthly, ss.lwf_monthly, ss.net_take_home, ss.epf_wage
    FROM payroll_eligible_employees(p_run_id, p_codes) e
    JOIN LATERAL (
      SELECT * FROM salary_structures s
      WHERE s.employee_id = e.id AND s.fy = v_run.fy
        -- THE FIX: a structure that starts after this payroll month has not
        -- taken effect yet and must not be frozen into it.
        AND (s.effective_date IS NULL OR s.effective_date <= v_period)
      ORDER BY s.effective_date DESC NULLS LAST LIMIT 1
    ) ss ON true
    LEFT JOIN LATERAL (
      SELECT * FROM ctc_master c
      WHERE c.employee_id = e.id AND (c.effective_from IS NULL OR c.effective_from <= v_period)
      ORDER BY c.effective_from DESC NULLS LAST LIMIT 1
    ) ctc ON true
  ) src
  WHERE pes.run_id = p_run_id AND pes.employee_id = src.employee_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM refresh_eps_monthly(p_run_id);
  PERFORM payroll_log_sync(p_run_id, 'salary', v_count, v_new, p_codes);
  RETURN v_count;
END;
$$;


-- ── verify ───────────────────────────────────────────────────────────────
-- Expect 'OK'. Reads the stored body back, because the only proof that this
-- ran is the clause being in it.
SELECT CASE
         WHEN prosrc ILIKE '%s.effective_date <= v_period%' THEN 'OK — the month is now respected'
         ELSE 'NOT APPLIED — the structure lookup still ignores the payroll month'
       END AS result
FROM pg_proc WHERE proname = 'sync_month_salary';
