-- ════════════════════════════════════════════════════════════════════════════
-- 063_tds_engine_gaps.sql — originally distributed ad hoc as "sql126".
-- STATUS AS OF THIS COMMIT: NOT YET LIVE. 062's ALTER TABLE ran (the three
-- columns exist) but this file's CREATE OR REPLACE FUNCTION never took effect —
-- calling sync_month_tds() still shows 062's behaviour (tds_arrear / tds_pt_
-- deduction / tds_lta_exempt stay NULL, no DOL-month proration in tds_reason).
-- RUN THIS FILE NOW in the Supabase SQL Editor before relying on the Run
-- Payroll → TDS wiring for real payslips — safe to run any number of times.
-- ════════════════════════════════════════════════════════════════════════════
-- sql126 — the four TDS formulas sql125 left out
-- ════════════════════════════════════════════════════════════════════════════
-- RUN THE WHOLE FILE AT ONCE, with nothing selected in the editor.
-- sql125 must be applied first.
--
-- WHAT WAS MISSING, AND WHY EACH ONE MATTERS
--
-- 1. ARREAR WAS NOT BEING TAXED AT ALL.
--    earn_gross_monthly does not contain the arrear — arrear_total is its own
--    column beside it. So an employee paid six months of appraisal arrear had
--    that money reach their bank untaxed, and the shortfall only surfaced in
--    March. The spec is explicit: an arrear is an actual of the month it is
--    PAID, not the month it relates to. It goes into the regular annual income
--    and spreads over the months left — not into Additional TDS, because it is
--    money the employee should already have had.
--
-- 2. PROFESSIONAL TAX WAS NOT DEDUCTED under the old regime. PT is deductible
--    from salary income; leaving it out over-deducts every old-regime employee
--    by the tax on roughly ₹2,500 a year.
--
-- 3. LTA EXEMPTION was ignored. tds_declarations.lta_claimed has been collected
--    all along and nothing read it.
--
-- 4. THE MONTH OF LEAVING WAS COUNTED AS A FULL MONTH. Somebody leaving on
--    15 November was projected a whole November salary, so their last months
--    over-deducted.
--
-- ROLLBACK is at the bottom.
-- ════════════════════════════════════════════════════════════════════════════

DO $$ BEGIN RAISE NOTICE 'sql126 start'; END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='sync_month_tds') THEN
    RAISE EXCEPTION 'sync_month_tds() is missing — run sql125 first.';
  END IF;
END $$;


-- ── 1) Three more columns, same one-step-one-column rule ───────────────────
ALTER TABLE payroll_employee_snapshot
  -- Arrear paid this month. Shown apart from tds_current_gross so the reader can
  -- see why the annual income jumped in a month the salary did not change.
  ADD COLUMN IF NOT EXISTS tds_arrear        NUMERIC,
  -- Professional tax for the whole year — paid so far, this month, and projected.
  -- Old regime only; under the new regime it is not deductible.
  ADD COLUMN IF NOT EXISTS tds_pt_deduction  NUMERIC,
  -- LTA exemption from the declaration. Old regime only.
  ADD COLUMN IF NOT EXISTS tds_lta_exempt    NUMERIC;


-- ── 2) sync_month_tds, with the four fixes ─────────────────────────────────
CREATE OR REPLACE FUNCTION sync_month_tds(p_run_id UUID, p_codes TEXT[] DEFAULT NULL)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  v_run     payroll_runs%ROWTYPE;
  v_period  DATE;
  v_on      DATE;
  v_count   INTEGER := 0;
  r         RECORD;
  v_regime  TEXT;
  v_actual  NUMERIC; v_curr NUMERIC; v_proj NUMERIC; v_annual NUMERIC;
  v_arr     NUMERIC; v_arr_ytd NUMERIC;
  v_months  INTEGER; v_dolm INTEGER; v_projm INTEGER;
  v_dolfrac NUMERIC;
  v_struct  NUMERIC;
  v_hra     NUMERIC; v_lta NUMERIC; v_std NUMERIC; v_via NUMERIC;
  v_pt      NUMERIC; v_pt_month NUMERIC; v_pt_ytd NUMERIC;
  v_taxable NUMERIC;
  v_paid    NUMERIC; v_oneoff NUMERIC;
  t1        RECORD; t2 RECORD;
  v_reg     NUMERIC; v_add NUMERIC;
BEGIN
  PERFORM payroll_assert_month_open(p_run_id);
  SELECT * INTO v_run FROM payroll_runs WHERE id = p_run_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'payroll_run % not found', p_run_id; END IF;
  v_period := payroll_period_start(v_run.fy, v_run.month);
  v_on     := v_period;

  FOR r IN
    SELECT s.*, e.tds_regime AS emp_regime
      FROM payroll_employee_snapshot s
      LEFT JOIN employees e ON e.id = s.employee_id
     WHERE s.run_id = p_run_id
       AND (p_codes IS NULL OR s.employee_code = ANY (p_codes))
  LOOP
    v_regime := CASE WHEN upper(btrim(COALESCE(NULLIF(btrim(r.tds_regime),''), r.emp_regime, 'NEW'))) = 'OLD'
                     THEN 'OLD' ELSE 'NEW' END;

    -- One-offs are never projected and drive the Additional TDS column.
    v_oneoff := COALESCE(r.pay_incentive,0) + COALESCE(r.pay_variable,0)
              + COALESCE(r.pay_bonus,0)     + COALESCE(r.pay_buyout,0);

    -- FIX 1 — arrear paid this month. Regular income, spread, not immediate.
    v_arr := COALESCE(r.arrear_total, 0);

    -- CURRENT: this month's regular gross, one-offs taken out.
    v_curr := GREATEST(0, COALESCE(r.earn_gross_monthly,0) - v_oneoff);

    -- ACTUAL: every earlier month of this FY that has been run, arrear included.
    SELECT COALESCE(SUM(GREATEST(0, COALESCE(p.earn_gross_monthly,0)
             - COALESCE(p.pay_incentive,0) - COALESCE(p.pay_variable,0)
             - COALESCE(p.pay_bonus,0)     - COALESCE(p.pay_buyout,0))), 0)
         + COALESCE(SUM(COALESCE(p.pay_incentive,0) + COALESCE(p.pay_variable,0)
             + COALESCE(p.pay_bonus,0) + COALESCE(p.pay_buyout,0)), 0),
           COALESCE(SUM(COALESCE(p.arrear_total,0)), 0),
           COALESCE(SUM(COALESCE(p.tds_monthly,0) + COALESCE(p.tds_additional,0)), 0),
           COALESCE(SUM(COALESCE(p.pt_amount, p.pt_monthly, 0)), 0)
      INTO v_actual, v_arr_ytd, v_paid, v_pt_ytd
      FROM payroll_employee_snapshot p
      JOIN payroll_runs pr ON pr.id = p.run_id
     WHERE p.employee_id = r.employee_id
       AND pr.fy = v_run.fy
       AND pr.month < v_run.month
       AND COALESCE(pr.status,'') <> 'CANCELLED';

    v_actual := COALESCE(v_actual,0) + COALESCE(v_arr_ytd,0);

    -- PROJECTION window. Date of leaving shortens the year.
    v_dolm := 12;
    IF r.date_of_leaving IS NOT NULL THEN
      v_dolm := ((EXTRACT(MONTH FROM r.date_of_leaving)::INT + 8) % 12) + 1;
      IF EXTRACT(YEAR FROM r.date_of_leaving)::INT
         > (split_part(v_run.fy,'-',1)::INT + CASE WHEN v_dolm <= 9 THEN 0 ELSE 1 END) THEN
        v_dolm := 12;
      END IF;
    END IF;

    v_struct := COALESCE(r.gross_monthly, r.earn_gross_monthly, 0);
    v_projm  := GREATEST(0, LEAST(v_dolm, 12) - v_run.month);   -- months after this one

    -- FIX 4 — the month of leaving is a part month, not a whole one. Somebody
    -- leaving on the 15th is projected half a salary for that month.
    v_dolfrac := 1;
    IF r.date_of_leaving IS NOT NULL AND v_dolm < 12 AND v_projm > 0 THEN
      v_dolfrac := EXTRACT(DAY FROM r.date_of_leaving)::NUMERIC
                 / EXTRACT(DAY FROM (date_trunc('month', r.date_of_leaving)
                                     + INTERVAL '1 month' - INTERVAL '1 day'))::NUMERIC;
    END IF;
    v_proj := CASE WHEN v_projm = 0 THEN 0
                   ELSE (v_projm - 1) * v_struct + v_struct * v_dolfrac END;

    v_annual := v_actual + v_curr + v_arr + v_proj;

    -- Months remaining, this one included. The divisor.
    v_months := GREATEST(1, LEAST(v_dolm, 12) - v_run.month + 1);

    -- Exemptions from the declaration.
    SELECT COALESCE(d.hra_claimed,0), COALESCE(d.lta_claimed,0),
           COALESCE(d.sec_80c,0) + COALESCE(d.sec_80d,0) + COALESCE(d.sec_80e,0)
             + COALESCE(d.sec_24b,0) + COALESCE(d.nps_80ccd1b,0)
      INTO v_hra, v_lta, v_via
      FROM tds_declarations d
     WHERE d.employee_id = r.employee_id AND d.fy = v_run.fy
     LIMIT 1;
    v_hra := COALESCE(v_hra, 0);
    v_lta := COALESCE(v_lta, 0);
    v_via := COALESCE(v_via, 0);

    -- FIX 2 — professional tax for the year: paid so far + this month + projected.
    v_pt_month := COALESCE(r.pt_amount, r.pt_monthly, 0);
    v_pt := COALESCE(v_pt_ytd,0) + v_pt_month + v_pt_month * v_projm;

    SELECT standard_deduction INTO v_std FROM tax_regime_config
     WHERE upper(regime) = v_regime AND effective_from <= v_on
       AND (effective_to IS NULL OR effective_to >= v_on)
     ORDER BY effective_from DESC LIMIT 1;
    v_std := COALESCE(v_std, CASE WHEN v_regime='OLD' THEN 50000 ELSE 75000 END);

    -- Under the new regime only 80CCD(2) survives. HRA, LTA and PT do not apply.
    IF v_regime = 'NEW' THEN
      v_hra := 0;
      v_lta := 0;
      v_pt  := 0;
      v_via := COALESCE((SELECT employer_nps_80ccd2 FROM tds_declarations
                          WHERE employee_id = r.employee_id AND fy = v_run.fy LIMIT 1), 0);
    END IF;

    -- RUN 1 — without this month's one-offs. Drives the TDS column.
    v_taxable := GREATEST(0, (v_annual - v_hra - v_lta) - v_std - v_via - v_pt);
    SELECT * INTO t1 FROM tds_annual_tax(v_taxable, v_regime, v_on);
    v_reg := ROUND(GREATEST(0, t1.total - v_paid) / v_months);

    -- RUN 2 — with them. The difference is taken in full, this month.
    IF v_oneoff > 0 THEN
      SELECT * INTO t2 FROM tds_annual_tax(
        GREATEST(0, (v_annual + v_oneoff - v_hra - v_lta) - v_std - v_via - v_pt),
        v_regime, v_on);
      v_add := ROUND(GREATEST(0, t2.total - t1.total));
    ELSE
      v_add := 0;
    END IF;

    UPDATE payroll_employee_snapshot SET
      tds_regime_used      = v_regime,
      tds_actual_ytd       = ROUND(v_actual),
      tds_current_gross    = ROUND(v_curr),
      tds_arrear           = ROUND(v_arr),
      tds_projected        = ROUND(v_proj),
      tds_annual_gross     = ROUND(v_annual),
      tds_hra_exempt       = ROUND(v_hra),
      tds_lta_exempt       = ROUND(v_lta),
      tds_pt_deduction     = ROUND(v_pt),
      tds_std_deduction    = ROUND(v_std),
      tds_chapter_via      = ROUND(v_via),
      tds_taxable_income   = ROUND(v_taxable),
      tds_slab_tax         = t1.slab,
      tds_rebate_87a       = t1.rebate,
      tds_surcharge        = t1.surcharge,
      tds_cess             = t1.cess,
      tds_annual_liability = t1.total,
      tds_paid_ytd         = ROUND(v_paid),
      tds_months_remaining = v_months,
      tds_monthly          = v_reg,
      tds_additional       = v_add,
      tds_reason           = v_regime || ' regime · '
                             || (12 - COALESCE(v_dolm,12))::TEXT || ' month(s) cut by DOL · '
                             || v_months::TEXT || ' month(s) left'
                             || CASE WHEN v_dolfrac < 1
                                     THEN ' · leaving month ' || ROUND(v_dolfrac*100)::TEXT || '% projected'
                                     ELSE '' END
                             || CASE WHEN v_arr > 0
                                     THEN ' · arrear ' || ROUND(v_arr)::TEXT || ' taxed as actual' ELSE '' END
                             || CASE WHEN v_oneoff > 0
                                     THEN ' · one-off ' || ROUND(v_oneoff)::TEXT ELSE '' END,
      synced_at = now()
    WHERE run_id = p_run_id AND employee_id = r.employee_id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END $$;


-- ── 3) Schema cache ────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';


-- ── 4) VERIFY ──────────────────────────────────────────────────────────────
SELECT 'tds_arrear column' AS item, EXISTS (SELECT 1 FROM information_schema.columns
       WHERE table_name='payroll_employee_snapshot' AND column_name='tds_arrear') AS ok
UNION ALL SELECT 'tds_pt_deduction column', EXISTS (SELECT 1 FROM information_schema.columns
       WHERE table_name='payroll_employee_snapshot' AND column_name='tds_pt_deduction')
UNION ALL SELECT 'tds_lta_exempt column', EXISTS (SELECT 1 FROM information_schema.columns
       WHERE table_name='payroll_employee_snapshot' AND column_name='tds_lta_exempt')
UNION ALL SELECT 'arrear now in income', (SELECT bool_or(pg_get_functiondef(oid) LIKE '%arrear_total%')
       FROM pg_proc WHERE proname='sync_month_tds')
UNION ALL SELECT 'PT now deducted', (SELECT bool_or(pg_get_functiondef(oid) LIKE '%v_pt%')
       FROM pg_proc WHERE proname='sync_month_tds')
UNION ALL SELECT 'DOL month prorated', (SELECT bool_or(pg_get_functiondef(oid) LIKE '%v_dolfrac%')
       FROM pg_proc WHERE proname='sync_month_tds');

-- The spec example must still tie out after the changes: ₹24,00,000 annual,
-- new regime, no declarations → ₹2,92,500.
SELECT 'spec check: 24L new regime' AS test,
       (SELECT total FROM tds_annual_tax(2400000 - 75000, 'NEW', DATE '2026-04-01')) AS got,
       292500 AS expected;


-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK — sql125's version of the function has to be re-run to go back.
-- ALTER TABLE payroll_employee_snapshot
--   DROP COLUMN IF EXISTS tds_arrear,
--   DROP COLUMN IF EXISTS tds_pt_deduction,
--   DROP COLUMN IF EXISTS tds_lta_exempt;
-- ════════════════════════════════════════════════════════════════════════════
