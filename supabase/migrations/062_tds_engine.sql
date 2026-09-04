-- ════════════════════════════════════════════════════════════════════════════
-- 062_tds_engine.sql — originally distributed ad hoc as "sql125"; already applied
-- to production once (this file only tracks it in the repo — running it again is
-- a harmless no-op, ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE throughout).
-- Superseded by 063_tds_engine_gaps.sql, which fixes four things this version
-- got wrong — arrear untaxed, professional tax not deducted, LTA ignored, and
-- the month of leaving counted as a whole month.
-- ════════════════════════════════════════════════════════════════════════════
-- sql125 — Monthly TDS engine in the payroll sheet
-- ════════════════════════════════════════════════════════════════════════════
-- RUN THE WHOLE FILE AT ONCE, with nothing selected in the editor.
--
-- WHAT CHANGES
-- Today the engine reads tds_declarations.monthly_tds — one number typed once by
-- the flexi calculator and then frozen. It does not move when somebody gets an
-- appraisal, takes unpaid leave, resigns, or is paid an incentive. This computes
-- TDS every month, from that month's own figures.
--
--              annual tax liability − TDS already deducted this FY
-- monthly TDS = ──────────────────────────────────────────────────
--                   months remaining, including this one
--
-- Annual income = ACTUAL (Apr → last month) + CURRENT (this month)
--               + PROJECTED (next month → March, or → the month of leaving)
--
-- April projects eleven months, May ten, and so on. March projects nothing —
-- that is the true-up month, where the year's over- and under-deduction lands.
--
-- EVERY STEP IS A COLUMN, on purpose. A single tds_monthly figure cannot be
-- checked by anyone; eighteen columns can be read across and tied out by hand.
--
-- ROLLBACK is at the bottom.
-- ════════════════════════════════════════════════════════════════════════════

DO $$ BEGIN RAISE NOTICE 'sql125 start'; END $$;


-- ── 0) Guards ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='payroll_employee_snapshot' AND column_name='earn_gross_monthly') THEN
    RAISE EXCEPTION 'earn_gross_monthly is missing — run the earned-salary migration first.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tax_slabs LIMIT 1) THEN
    RAISE EXCEPTION 'tax_slabs is empty — the engine reads every rate from it.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tax_regime_config LIMIT 1) THEN
    RAISE EXCEPTION 'tax_regime_config is empty — standard deduction and 87A come from it.';
  END IF;
END $$;


-- ── 1) Columns — one per step of the calculation ───────────────────────────
ALTER TABLE payroll_employee_snapshot
  -- the income build
  -- Which regime the calculation actually used. Kept apart from tds_regime: that column
  -- is what was declared, this is what was applied after the blank-to-NEW fallback, and
  -- when they differ the row has to say so.
  ADD COLUMN IF NOT EXISTS tds_regime_used      TEXT,
  ADD COLUMN IF NOT EXISTS tds_actual_ytd       NUMERIC,  -- Apr → last month, actual gross
  ADD COLUMN IF NOT EXISTS tds_current_gross    NUMERIC,  -- this month, regular only
  ADD COLUMN IF NOT EXISTS tds_projected        NUMERIC,  -- next month → Mar or DOL
  ADD COLUMN IF NOT EXISTS tds_annual_gross     NUMERIC,  -- the three added up
  -- exemptions and deductions
  ADD COLUMN IF NOT EXISTS tds_hra_exempt       NUMERIC,
  ADD COLUMN IF NOT EXISTS tds_std_deduction    NUMERIC,
  ADD COLUMN IF NOT EXISTS tds_chapter_via      NUMERIC,
  ADD COLUMN IF NOT EXISTS tds_taxable_income   NUMERIC,
  -- the tax
  ADD COLUMN IF NOT EXISTS tds_slab_tax         NUMERIC,
  ADD COLUMN IF NOT EXISTS tds_rebate_87a       NUMERIC,
  ADD COLUMN IF NOT EXISTS tds_surcharge        NUMERIC,
  ADD COLUMN IF NOT EXISTS tds_cess             NUMERIC,
  ADD COLUMN IF NOT EXISTS tds_annual_liability NUMERIC,
  -- the split
  ADD COLUMN IF NOT EXISTS tds_paid_ytd         NUMERIC,
  ADD COLUMN IF NOT EXISTS tds_months_remaining INTEGER,
  ADD COLUMN IF NOT EXISTS tds_monthly          NUMERIC,  -- the regular deduction
  ADD COLUMN IF NOT EXISTS tds_additional       NUMERIC,  -- one-off tax, full this month
  ADD COLUMN IF NOT EXISTS tds_reason           TEXT;


-- ── 2) Slab tax on a taxable income ────────────────────────────────────────
-- Reads tax_slabs. Nothing is hardcoded, so a Budget change is a data change.
CREATE OR REPLACE FUNCTION tds_slab_tax(p_income NUMERIC, p_regime TEXT, p_on DATE)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(
    GREATEST(0, LEAST(COALESCE(s.slab_max, p_income), p_income) - s.slab_min) * s.tax_rate / 100
  ), 0)
  FROM tax_slabs s
  WHERE upper(s.regime) = upper(COALESCE(p_regime,'NEW'))
    AND COALESCE(s.age_category,'BELOW_60') = 'BELOW_60'
    AND s.effective_from <= p_on
    AND (s.effective_to IS NULL OR s.effective_to >= p_on)
    AND p_income > s.slab_min
$$;
COMMENT ON FUNCTION tds_slab_tax IS
  'Slab tax for a taxable income, from tax_slabs. Age category is BELOW_60 — the '
  'employees table carries no age band today, so senior slabs are not applied.';


-- ── 3) Surcharge ───────────────────────────────────────────────────────────
-- Marginal relief is NOT applied. It matters just above 50L / 1Cr / 2Cr, and
-- without it those employees are over-deducted. Flagged rather than hidden.
CREATE OR REPLACE FUNCTION tds_surcharge(p_income NUMERIC, p_tax NUMERIC, p_regime TEXT, p_on DATE)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT COALESCE((
    SELECT ROUND(p_tax * sc.surcharge_rate / 100)
      FROM surcharge_slabs sc
     WHERE upper(sc.regime) = upper(COALESCE(p_regime,'NEW'))
       AND p_income > sc.income_min
       AND (sc.income_max IS NULL OR p_income <= sc.income_max)
       AND sc.effective_from <= p_on
       AND (sc.effective_to IS NULL OR sc.effective_to >= p_on)
     ORDER BY sc.income_min DESC LIMIT 1
  ), 0)
$$;


-- ── 4) Annual tax from a taxable income ────────────────────────────────────
CREATE OR REPLACE FUNCTION tds_annual_tax(
  p_taxable NUMERIC, p_regime TEXT, p_on DATE,
  OUT slab NUMERIC, OUT rebate NUMERIC, OUT surcharge NUMERIC, OUT cess NUMERIC, OUT total NUMERIC
) LANGUAGE plpgsql STABLE AS $$
DECLARE v_cfg RECORD; v_after NUMERIC;
BEGIN
  slab := ROUND(tds_slab_tax(GREATEST(p_taxable,0), p_regime, p_on));

  SELECT standard_deduction, rebate_87a_threshold, rebate_87a_amount
    INTO v_cfg
    FROM tax_regime_config
   WHERE upper(regime) = upper(COALESCE(p_regime,'NEW'))
     AND effective_from <= p_on AND (effective_to IS NULL OR effective_to >= p_on)
   ORDER BY effective_from DESC LIMIT 1;

  -- 87A wipes the liability out below the threshold, capped at the rebate amount.
  rebate := CASE
              WHEN v_cfg.rebate_87a_threshold IS NOT NULL
               AND p_taxable <= v_cfg.rebate_87a_threshold
              THEN LEAST(slab, COALESCE(v_cfg.rebate_87a_amount, slab))
              ELSE 0 END;

  v_after   := GREATEST(0, slab - rebate);
  surcharge := tds_surcharge(GREATEST(p_taxable,0), v_after, p_regime, p_on);
  cess      := ROUND((v_after + surcharge) * 0.04);
  total     := v_after + surcharge + cess;
END $$;


-- ── 5) sync_month_tds ──────────────────────────────────────────────────────
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
  v_months  INTEGER; v_dolm INTEGER;
  v_struct  NUMERIC;
  v_hra     NUMERIC; v_std NUMERIC; v_via NUMERIC; v_taxable NUMERIC;
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
    -- Regime: the month's own frozen value, else the employee's current one.
    v_regime := CASE WHEN upper(btrim(COALESCE(NULLIF(btrim(r.tds_regime),''), r.emp_regime, 'NEW'))) = 'OLD'
                     THEN 'OLD' ELSE 'NEW' END;

    -- One-offs are never projected and drive the Additional TDS column.
    v_oneoff := COALESCE(r.pay_incentive,0) + COALESCE(r.pay_variable,0)
              + COALESCE(r.pay_bonus,0)     + COALESCE(r.pay_buyout,0);

    -- CURRENT: this month's regular gross, one-offs taken out.
    v_curr := GREATEST(0, COALESCE(r.earn_gross_monthly,0) - v_oneoff);

    -- ACTUAL: every earlier month of this FY that has been run.
    SELECT COALESCE(SUM(GREATEST(0, COALESCE(p.earn_gross_monthly,0)
             - COALESCE(p.pay_incentive,0) - COALESCE(p.pay_variable,0)
             - COALESCE(p.pay_bonus,0)     - COALESCE(p.pay_buyout,0))), 0)
         + COALESCE(SUM(COALESCE(p.pay_incentive,0) + COALESCE(p.pay_variable,0)
             + COALESCE(p.pay_bonus,0) + COALESCE(p.pay_buyout,0)), 0)
      INTO v_actual
      FROM payroll_employee_snapshot p
      JOIN payroll_runs pr ON pr.id = p.run_id
     WHERE p.employee_id = r.employee_id
       AND pr.fy = v_run.fy
       AND pr.month < v_run.month
       AND COALESCE(pr.status,'') <> 'CANCELLED';

    -- TDS already deducted this FY, from those same months.
    SELECT COALESCE(SUM(COALESCE(p.tds_monthly,0) + COALESCE(p.tds_additional,0)), 0)
      INTO v_paid
      FROM payroll_employee_snapshot p
      JOIN payroll_runs pr ON pr.id = p.run_id
     WHERE p.employee_id = r.employee_id
       AND pr.fy = v_run.fy
       AND pr.month < v_run.month
       AND COALESCE(pr.status,'') <> 'CANCELLED';

    -- PROJECTION window. Date of leaving shortens the year, which is the single
    -- biggest driver of TDS variance — an engine that only handles DOL at F&F
    -- keeps over-deducting until the employee has already gone.
    v_dolm := 12;
    IF r.date_of_leaving IS NOT NULL THEN
      -- FY month number of the DOL: April = 1.
      v_dolm := ((EXTRACT(MONTH FROM r.date_of_leaving)::INT + 8) % 12) + 1;
      IF EXTRACT(YEAR FROM r.date_of_leaving)::INT
         > (split_part(v_run.fy,'-',1)::INT + CASE WHEN v_dolm <= 9 THEN 0 ELSE 1 END) THEN
        v_dolm := 12;   -- leaving after this FY: full year
      END IF;
    END IF;

    -- Projection is the CURRENT structure repeated, so a mid-year appraisal
    -- raises the projection from the month it takes effect, with no manual step.
    -- It assumes zero LOP — future unpaid leave cannot be known, and the next
    -- month's actual corrects it.
    v_struct := COALESCE(r.gross_monthly, r.earn_gross_monthly, 0);
    v_proj   := GREATEST(0, LEAST(v_dolm, 12) - v_run.month) * v_struct;

    v_annual := v_actual + v_curr + v_proj;

    -- Months remaining, this one included. The divisor.
    v_months := GREATEST(1, LEAST(v_dolm, 12) - v_run.month + 1);

    -- Exemptions. HRA comes from the declaration as already computed — the
    -- employees table has no metro flag, so recomputing it here would be a guess.
    SELECT COALESCE(d.hra_claimed,0),
           COALESCE(d.sec_80c,0) + COALESCE(d.sec_80d,0) + COALESCE(d.sec_80e,0)
             + COALESCE(d.sec_24b,0) + COALESCE(d.nps_80ccd1b,0)
      INTO v_hra, v_via
      FROM tds_declarations d
     WHERE d.employee_id = r.employee_id AND d.fy = v_run.fy
     LIMIT 1;
    v_hra := COALESCE(v_hra, 0);
    v_via := COALESCE(v_via, 0);

    SELECT standard_deduction INTO v_std FROM tax_regime_config
     WHERE upper(regime) = v_regime AND effective_from <= v_on
       AND (effective_to IS NULL OR effective_to >= v_on)
     ORDER BY effective_from DESC LIMIT 1;
    v_std := COALESCE(v_std, CASE WHEN v_regime='OLD' THEN 50000 ELSE 75000 END);

    -- Under the new regime only 80CCD(2) survives, and HRA does not apply.
    IF v_regime = 'NEW' THEN
      v_hra := 0;
      v_via := COALESCE((SELECT employer_nps_80ccd2 FROM tds_declarations
                          WHERE employee_id = r.employee_id AND fy = v_run.fy LIMIT 1), 0);
    END IF;

    -- RUN 1 — without this month's one-offs. Drives the TDS column.
    v_taxable := GREATEST(0, (v_annual - v_hra) - v_std - v_via);
    SELECT * INTO t1 FROM tds_annual_tax(v_taxable, v_regime, v_on);
    v_reg := ROUND(GREATEST(0, t1.total - v_paid) / v_months);

    -- RUN 2 — with them. The difference is taken in full, this month, so the
    -- company is not left carrying the tax on money already paid out.
    IF v_oneoff > 0 THEN
      SELECT * INTO t2 FROM tds_annual_tax(
        GREATEST(0, (v_annual + v_oneoff - v_hra) - v_std - v_via), v_regime, v_on);
      v_add := ROUND(GREATEST(0, t2.total - t1.total));
    ELSE
      v_add := 0;
    END IF;

    UPDATE payroll_employee_snapshot SET
      tds_regime_used      = v_regime,
      tds_actual_ytd       = ROUND(v_actual),
      tds_current_gross    = ROUND(v_curr),
      tds_projected        = ROUND(v_proj),
      tds_annual_gross     = ROUND(v_annual),
      tds_hra_exempt       = ROUND(v_hra),
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
                             || CASE WHEN v_oneoff > 0
                                     THEN ' · one-off ' || ROUND(v_oneoff)::TEXT ELSE '' END,
      synced_at = now()
    WHERE run_id = p_run_id AND employee_id = r.employee_id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END $$;


-- ── 6) Schema cache ────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';


-- ── 7) VERIFY — every row must read true ───────────────────────────────────
SELECT 'tds_monthly column'    AS item, EXISTS (SELECT 1 FROM information_schema.columns
       WHERE table_name='payroll_employee_snapshot' AND column_name='tds_monthly') AS ok
UNION ALL SELECT 'tds_additional column', EXISTS (SELECT 1 FROM information_schema.columns
       WHERE table_name='payroll_employee_snapshot' AND column_name='tds_additional')
UNION ALL SELECT 'tds_annual_gross column', EXISTS (SELECT 1 FROM information_schema.columns
       WHERE table_name='payroll_employee_snapshot' AND column_name='tds_annual_gross')
UNION ALL SELECT 'tds_slab_tax()',   EXISTS (SELECT 1 FROM pg_proc WHERE proname='tds_slab_tax')
UNION ALL SELECT 'tds_annual_tax()', EXISTS (SELECT 1 FROM pg_proc WHERE proname='tds_annual_tax')
UNION ALL SELECT 'sync_month_tds()', EXISTS (SELECT 1 FROM pg_proc WHERE proname='sync_month_tds');

-- Sanity check against the worked example in the spec: ₹24,00,000 annual,
-- new regime, no declarations → ₹2,92,500 net annual tax.
SELECT 'spec check: 24L new regime' AS test,
       (SELECT total FROM tds_annual_tax(2400000 - 75000, 'NEW', DATE '2026-04-01')) AS got,
       292500 AS expected;


-- ════════════════════════════════════════════════════════════════════════════
-- AFTER RUNNING
--   Data Sync → Earned salary, then TDS. TDS reads earn_gross_monthly, so
--   running it first leaves every figure blank.
--
-- NOT DONE, STATED RATHER THAN HIDDEN
--   · Marginal relief just above 50L / 1Cr / 2Cr is not applied — those
--     employees are over-deducted until it is.
--   · Senior-citizen slabs exist in tax_slabs but employees carries no age
--     band, so BELOW_60 is used for everyone.
--   · HRA exemption is taken from the declaration rather than recomputed;
--     there is no metro/non-metro flag on employees to recompute it from.
--   · Section 17(2)(vii) ₹7.5L cap on employer EPF+NPS+superannuation.
--
-- ROLLBACK
-- ════════════════════════════════════════════════════════════════════════════
-- DROP FUNCTION IF EXISTS sync_month_tds(UUID, TEXT[]);
-- DROP FUNCTION IF EXISTS tds_annual_tax(NUMERIC, TEXT, DATE);
-- DROP FUNCTION IF EXISTS tds_surcharge(NUMERIC, NUMERIC, TEXT, DATE);
-- DROP FUNCTION IF EXISTS tds_slab_tax(NUMERIC, TEXT, DATE);
-- ALTER TABLE payroll_employee_snapshot
--   DROP COLUMN IF EXISTS tds_actual_ytd,  DROP COLUMN IF EXISTS tds_current_gross,
--   DROP COLUMN IF EXISTS tds_projected,   DROP COLUMN IF EXISTS tds_annual_gross,
--   DROP COLUMN IF EXISTS tds_hra_exempt,  DROP COLUMN IF EXISTS tds_std_deduction,
--   DROP COLUMN IF EXISTS tds_chapter_via, DROP COLUMN IF EXISTS tds_taxable_income,
--   DROP COLUMN IF EXISTS tds_slab_tax,    DROP COLUMN IF EXISTS tds_rebate_87a,
--   DROP COLUMN IF EXISTS tds_surcharge,   DROP COLUMN IF EXISTS tds_cess,
--   DROP COLUMN IF EXISTS tds_annual_liability, DROP COLUMN IF EXISTS tds_paid_ytd,
--   DROP COLUMN IF EXISTS tds_months_remaining, DROP COLUMN IF EXISTS tds_monthly,
--   DROP COLUMN IF EXISTS tds_additional,  DROP COLUMN IF EXISTS tds_reason;
-- NOTIFY pgrst, 'reload schema';
