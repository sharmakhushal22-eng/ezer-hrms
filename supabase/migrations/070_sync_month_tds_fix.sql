-- ════════════════════════════════════════════════════════════════════════════
-- 070_sync_month_tds_fix.sql — corrective replacement of sync_month_tds from 069.
--
-- 069's function referenced per-head arrear columns (arrear_basic, arrear_hra,
-- arrear_conveyance, arrear_special_allowance, arrear_statutory_bonus) that do
-- not exist on payroll_employee_snapshot — only arrear_total does — so every
-- call failed with "column p.arrear_hra does not exist", the TDS step of Run
-- Payroll aborted, and no tds_worksheet / tds_config_version was ever stored.
--
-- This is the same function with those terms removed and arrears carried on the
-- worksheet as one fully-taxable 'Arrears' row (v_arr_ytd + v_arr), which keeps
-- the worksheet gross equal to the actual-plus-projected gross the tax is on.
-- Safe to re-run. Nothing else in 069 changes.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION sync_month_tds(p_run_id UUID, p_codes TEXT[] DEFAULT NULL)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  v_run     payroll_runs%ROWTYPE;
  v_period  DATE;
  v_on      DATE;
  v_fy_from DATE; v_fy_to DATE;
  v_cfg_ver TIMESTAMPTZ;
  v_count   INTEGER := 0;
  r         RECORD;
  v_regime  TEXT;
  v_age     TEXT;
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

  v_decl              tds_declarations%ROWTYPE;
  v_perq              NUMERIC;
  v_er_epf_ytd        NUMERIC; v_er_nps_ytd NUMERIC;
  v_er_contrib_annual NUMERIC;
  v_er_excess         NUMERIC;
  v_hp                NUMERIC;
  v_other_income      NUMERIC;
  v_80tta_ttb         NUMERIC;
  v_prev_income       NUMERIC; v_prev_tds NUMERIC;
  v_lta_block         RECORD;
  v_lta_allowed       INTEGER;
  v_er_contrib_cap    CONSTANT NUMERIC := 750000;
  v_hp_setoff_cap     CONSTANT NUMERIC := 200000;

  -- HRA — §2.1
  v_hra_ytd    NUMERIC; v_basic_ytd NUMERIC;
  v_hra_actual NUMERIC; v_basic_annual NUMERIC;
  v_hra_metro  BOOLEAN;
  v_hra_pct    NUMERIC;
  v_rent_annual NUMERIC;
  v_hra_rule3  NUMERIC;

  -- per-head worksheet
  ytd          RECORD;          -- SUM(earn_x + arrear_x) over prior runs, per head
  v_ws         JSONB := '[]'::JSONB;
  v_ws_gross   NUMERIC := 0; v_ws_exempt NUMERIC := 0;
  v_head       RECORD;
  v_h_gross    NUMERIC; v_h_ex NUMERIC; v_h_rule TEXT;
  v_flexi_ex   NUMERIC;
  v_lta_ws     NUMERIC;         -- LTA's exempt figure as it landed in the worksheet; NULL = no LTA head paid this year
  v_claims     NUMERIC;
  v_children   INTEGER;
  v_workdays   NUMERIC;
  v_paid_days_ytd NUMERIC;
  v_projdays   NUMERIC;

  -- monthly split
  v_m_cess NUMERIC; v_m_base NUMERIC; v_m_sur NUMERIC; v_sur_rate NUMERIC;
BEGIN
  PERFORM payroll_assert_month_open(p_run_id);
  SELECT * INTO v_run FROM payroll_runs WHERE id = p_run_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'payroll_run % not found', p_run_id; END IF;
  v_period  := payroll_period_start(v_run.fy, v_run.month);
  v_on      := v_period;
  v_fy_from := make_date(split_part(v_run.fy,'-',1)::INT, 4, 1);
  v_fy_to   := make_date(split_part(v_run.fy,'-',1)::INT + 1, 3, 31);
  SELECT config_version INTO v_cfg_ver FROM v_tax_config_version;

  FOR r IN
    SELECT s.*, e.tds_regime AS emp_regime, e.date_of_birth AS emp_dob, e.company_id AS emp_company_id
      FROM payroll_employee_snapshot s
      LEFT JOIN employees e ON e.id = s.employee_id
     WHERE s.run_id = p_run_id
       AND (p_codes IS NULL OR s.employee_code = ANY (p_codes))
  LOOP
    v_regime := CASE WHEN upper(btrim(COALESCE(NULLIF(btrim(r.tds_regime),''), r.emp_regime, 'NEW'))) = 'OLD'
                     THEN 'OLD' ELSE 'NEW' END;
    v_age := tds_age_category(r.emp_dob, v_run.fy);

    v_oneoff := COALESCE(r.pay_incentive,0) + COALESCE(r.pay_variable,0)
              + COALESCE(r.pay_bonus,0)     + COALESCE(r.pay_buyout,0);
    v_arr := COALESCE(r.arrear_total, 0);
    v_curr := GREATEST(0, COALESCE(r.earn_gross_monthly,0) - v_oneoff);

    -- ACTUAL side, totals (unchanged from 063) …
    SELECT COALESCE(SUM(GREATEST(0, COALESCE(p.earn_gross_monthly,0)
             - COALESCE(p.pay_incentive,0) - COALESCE(p.pay_variable,0)
             - COALESCE(p.pay_bonus,0)     - COALESCE(p.pay_buyout,0))), 0)
         + COALESCE(SUM(COALESCE(p.pay_incentive,0) + COALESCE(p.pay_variable,0)
             + COALESCE(p.pay_bonus,0) + COALESCE(p.pay_buyout,0)), 0),
           COALESCE(SUM(COALESCE(p.arrear_total,0)), 0),
           COALESCE(SUM(COALESCE(p.tds_monthly,0) + COALESCE(p.tds_additional,0)), 0),
           COALESCE(SUM(COALESCE(p.pt_amount, p.pt_monthly, 0)), 0),
           COALESCE(SUM(COALESCE(p.epf_employer_total,0)), 0),
           COALESCE(SUM(COALESCE(p.employer_nps,0)), 0),
           COALESCE(SUM(COALESCE(p.earn_hra_monthly,0)), 0),
           COALESCE(SUM(COALESCE(p.earn_basic_monthly,0)), 0),
           COALESCE(SUM(COALESCE(p.paid_days,0)), 0)
      INTO v_actual, v_arr_ytd, v_paid, v_pt_ytd, v_er_epf_ytd, v_er_nps_ytd, v_hra_ytd, v_basic_ytd, v_paid_days_ytd
      FROM payroll_employee_snapshot p
      JOIN payroll_runs pr ON pr.id = p.run_id
     WHERE p.employee_id = r.employee_id
       AND pr.fy = v_run.fy
       AND pr.month < v_run.month
       AND COALESCE(pr.status,'') <> 'CANCELLED';

    -- … and per head, the same window. Per-head arrears are not stored on the snapshot
    -- (only arrear_total is), so arrears go on the worksheet as one taxable row below.
    SELECT
      COALESCE(SUM(COALESCE(p.earn_basic_monthly,0)),0)             AS basic,
      COALESCE(SUM(COALESCE(p.earn_hra_monthly,0)),0)               AS hra,
      COALESCE(SUM(COALESCE(p.earn_conveyance,0)),0)        AS conveyance,
      COALESCE(SUM(COALESCE(p.earn_special_allowance,0)),0) AS special_allowance,
      COALESCE(SUM(COALESCE(p.earn_statutory_bonus,0)),0)   AS statutory_bonus,
      COALESCE(SUM(COALESCE(p.earn_flexi_car,0)),0)    AS flexi_car,
      COALESCE(SUM(COALESCE(p.earn_flexi_driver,0)),0) AS flexi_driver,
      COALESCE(SUM(COALESCE(p.earn_flexi_fuel,0)),0)   AS flexi_fuel,
      COALESCE(SUM(COALESCE(p.earn_flexi_tel,0)),0)    AS flexi_tel,
      COALESCE(SUM(COALESCE(p.earn_flexi_meal,0)),0)   AS flexi_meal,
      COALESCE(SUM(COALESCE(p.earn_flexi_device,0)),0) AS flexi_device,
      COALESCE(SUM(COALESCE(p.earn_flexi_attire,0)),0) AS flexi_attire,
      COALESCE(SUM(COALESCE(p.earn_flexi_pda,0)),0)    AS flexi_pda,
      COALESCE(SUM(COALESCE(p.earn_flexi_lta,0)),0)    AS flexi_lta,
      COALESCE(SUM(COALESCE(p.earn_flexi_chedu,0)),0)  AS flexi_chedu,
      COALESCE(SUM(COALESCE(p.earn_flexi_hostel,0)),0) AS flexi_hostel
      INTO ytd
      FROM payroll_employee_snapshot p
      JOIN payroll_runs pr ON pr.id = p.run_id
     WHERE p.employee_id = r.employee_id
       AND pr.fy = v_run.fy
       AND pr.month < v_run.month
       AND COALESCE(pr.status,'') <> 'CANCELLED';

    v_actual := COALESCE(v_actual,0) + COALESCE(v_arr_ytd,0);

    v_dolm := 12;
    IF r.date_of_leaving IS NOT NULL THEN
      v_dolm := ((EXTRACT(MONTH FROM r.date_of_leaving)::INT + 8) % 12) + 1;
      IF EXTRACT(YEAR FROM r.date_of_leaving)::INT
         > (split_part(v_run.fy,'-',1)::INT + CASE WHEN v_dolm <= 9 THEN 0 ELSE 1 END) THEN
        v_dolm := 12;
      END IF;
    END IF;

    v_struct := COALESCE(r.gross_monthly, r.earn_gross_monthly, 0);
    v_projm  := GREATEST(0, LEAST(v_dolm, 12) - v_run.month);

    v_dolfrac := 1;
    IF r.date_of_leaving IS NOT NULL AND v_dolm < 12 AND v_projm > 0 THEN
      v_dolfrac := EXTRACT(DAY FROM r.date_of_leaving)::NUMERIC
                 / EXTRACT(DAY FROM (date_trunc('month', r.date_of_leaving)
                                     + INTERVAL '1 month' - INTERVAL '1 day'))::NUMERIC;
    END IF;
    -- Effective projected months as one multiplier — every head scales by it.
    v_projdays := CASE WHEN v_projm = 0 THEN 0 ELSE (v_projm - 1) + v_dolfrac END;
    v_proj := v_struct * v_projdays;

    v_er_contrib_annual := COALESCE(v_er_epf_ytd,0) + COALESCE(v_er_nps_ytd,0)
                         + COALESCE(r.epf_employer_total,0) + COALESCE(r.employer_nps,0)
                         + v_projm * (COALESCE(r.epf_employer_total,0) + COALESCE(r.employer_nps,0));
    v_er_excess := GREATEST(0, v_er_contrib_annual - v_er_contrib_cap);

    SELECT COALESCE(total_perquisite_amount, 0) INTO v_perq
      FROM employee_perquisite_summary
     WHERE employee_id = r.employee_id AND fy = v_run.fy;
    v_perq := COALESCE(v_perq, 0) + v_er_excess;

    SELECT * INTO v_decl FROM tds_declarations WHERE employee_id = r.employee_id AND fy = v_run.fy LIMIT 1;

    -- §2.1 — HRA least-of-three, annual. Metro follows where the rent is PAID
    -- (the declaration), falling back to the office city only when the
    -- employee never answered.
    v_hra_actual   := COALESCE(v_hra_ytd,0) + COALESCE(r.earn_hra_monthly,0)
                    + COALESCE(r.hra_monthly,0) * v_projdays;
    v_basic_annual := COALESCE(v_basic_ytd,0) + COALESCE(r.earn_basic_monthly,0)
                    + COALESCE(r.basic_monthly,0) * v_projdays;
    v_hra_metro := COALESCE(v_decl.is_metro,
                     lower(COALESCE(r.location_city,'')) = ANY (ARRAY['mumbai','delhi','new delhi','kolkata','calcutta','chennai','madras']));
    v_hra_pct := v_basic_annual * (CASE WHEN v_hra_metro THEN 0.50 ELSE 0.40 END);
    v_rent_annual := COALESCE(v_decl.monthly_rent,0) * 12;
    v_hra_rule3 := GREATEST(0, v_rent_annual - 0.10 * v_basic_annual);
    v_hra := CASE WHEN v_regime = 'OLD' AND v_rent_annual > 0
                  THEN LEAST(v_hra_actual, v_hra_pct, v_hra_rule3) ELSE 0 END;

    -- LTA — declaration, or approved LTA claims once any exist (proof beats promise)
    v_lta := COALESCE(v_decl.lta_claimed, 0);
    SELECT * INTO v_lta_block FROM tds_lta_block_usage
     WHERE employee_id = r.employee_id AND block_start_year = 2026 LIMIT 1;
    IF FOUND THEN
      v_lta_allowed := 2 + CASE WHEN v_lta_block.carried_forward THEN 1 ELSE 0 END;
      IF v_lta_block.journeys_used >= v_lta_allowed THEN v_lta := 0; END IF;
    END IF;

    -- ── Per-head worksheet ────────────────────────────────────────────────
    -- Working days for the meal-card cap: actual paid days so far + this month,
    -- plus 22 per projected month (a projection assumes zero LOP, spec §7.2).
    v_workdays := COALESCE(v_paid_days_ytd,0) + COALESCE(r.paid_days,0) + 22 * v_projdays;
    SELECT COALESCE(NULLIF(f.form_data->'child'->>'count','')::INT, 0) INTO v_children
      FROM flexi_tds_forms f WHERE f.employee_id = r.employee_id AND f.fy = v_run.fy LIMIT 1;
    v_children := COALESCE(v_children, 0);

    v_ws := '[]'::JSONB; v_ws_gross := 0; v_ws_exempt := 0; v_flexi_ex := 0; v_lta_ws := NULL;

    -- the five fixed heads
    FOR v_head IN
      SELECT * FROM (VALUES
        ('basic',             'BASIC',             COALESCE(ytd.basic,0)             + COALESCE(r.earn_basic_monthly,0)             + COALESCE(r.basic_monthly,0)     * v_projdays),
        ('hra',               'HRA',               v_hra_actual),
        ('conveyance',        'Conveyance',        COALESCE(ytd.conveyance,0)        + COALESCE(r.earn_conveyance,0)        + COALESCE(r.conveyance,0)        * v_projdays),
        ('special_allowance', 'Special Allowance', COALESCE(ytd.special_allowance,0) + COALESCE(r.earn_special_allowance,0) + COALESCE(r.special_allowance,0) * v_projdays),
        ('statutory_bonus',   'Statutory Bonus',   COALESCE(ytd.statutory_bonus,0)   + COALESCE(r.earn_statutory_bonus,0)   + COALESCE(r.statutory_bonus,0)   * v_projdays),
        -- Arrears paid this FY (prior months + this month). The snapshot stores only
        -- arrear_total, not a per-head split, so they are one fully-taxable row.
        ('arrears',           'Arrears',           COALESCE(v_arr_ytd,0) + COALESCE(v_arr,0))
      ) AS t(code, label, gross)
    LOOP
      IF v_head.gross <= 0 THEN CONTINUE; END IF;
      v_h_gross := ROUND(v_head.gross);
      v_h_ex := CASE WHEN v_head.code = 'hra' THEN ROUND(v_hra) ELSE 0 END;
      v_h_rule := CASE WHEN v_head.code = 'hra'
                       THEN CASE WHEN v_regime='OLD' THEN 'Least of three' ELSE 'Not available in New Regime' END
                       ELSE 'Fully taxable' END;
      v_ws := v_ws || jsonb_build_object('head', v_head.code, 'label', v_head.label,
                                         'gross', v_h_gross, 'exempt', v_h_ex, 'taxable', v_h_gross - v_h_ex, 'rule', v_h_rule);
      v_ws_gross := v_ws_gross + v_h_gross; v_ws_exempt := v_ws_exempt + v_h_ex;
    END LOOP;

    -- the eleven flexi heads, exemption per flexi_head_tax_rules × approved claims
    FOR v_head IN
      SELECT fr.head_code, fr.label, fr.basis, fr.cap_per_unit, fr.units_per_day, fr.max_units,
             fr.allowed_old, fr.allowed_new,
             CASE fr.snapshot_col
               WHEN 'flexi_car'    THEN COALESCE(ytd.flexi_car,0)    + COALESCE(r.earn_flexi_car,0)    + COALESCE(r.flexi_car,0)    * v_projdays
               WHEN 'flexi_driver' THEN COALESCE(ytd.flexi_driver,0) + COALESCE(r.earn_flexi_driver,0) + COALESCE(r.flexi_driver,0) * v_projdays
               WHEN 'flexi_fuel'   THEN COALESCE(ytd.flexi_fuel,0)   + COALESCE(r.earn_flexi_fuel,0)   + COALESCE(r.flexi_fuel,0)   * v_projdays
               WHEN 'flexi_tel'    THEN COALESCE(ytd.flexi_tel,0)    + COALESCE(r.earn_flexi_tel,0)    + COALESCE(r.flexi_tel,0)    * v_projdays
               WHEN 'flexi_meal'   THEN COALESCE(ytd.flexi_meal,0)   + COALESCE(r.earn_flexi_meal,0)   + COALESCE(r.flexi_meal,0)   * v_projdays
               WHEN 'flexi_device' THEN COALESCE(ytd.flexi_device,0) + COALESCE(r.earn_flexi_device,0) + COALESCE(r.flexi_device,0) * v_projdays
               WHEN 'flexi_attire' THEN COALESCE(ytd.flexi_attire,0) + COALESCE(r.earn_flexi_attire,0) + COALESCE(r.flexi_attire,0) * v_projdays
               WHEN 'flexi_pda'    THEN COALESCE(ytd.flexi_pda,0)    + COALESCE(r.earn_flexi_pda,0)    + COALESCE(r.flexi_pda,0)    * v_projdays
               WHEN 'flexi_lta'    THEN COALESCE(ytd.flexi_lta,0)    + COALESCE(r.earn_flexi_lta,0)    + COALESCE(r.flexi_lta,0)    * v_projdays
               WHEN 'flexi_chedu'  THEN COALESCE(ytd.flexi_chedu,0)  + COALESCE(r.earn_flexi_chedu,0)  + COALESCE(r.flexi_chedu,0)  * v_projdays
               WHEN 'flexi_hostel' THEN COALESCE(ytd.flexi_hostel,0) + COALESCE(r.earn_flexi_hostel,0) + COALESCE(r.flexi_hostel,0) * v_projdays
               ELSE 0 END AS gross
        FROM flexi_head_tax_rules fr
       ORDER BY fr.head_code
    LOOP
      IF v_head.gross <= 0 THEN CONTINUE; END IF;
      v_h_gross := ROUND(v_head.gross);

      IF NOT (CASE WHEN v_regime='OLD' THEN v_head.allowed_old ELSE v_head.allowed_new END) THEN
        v_h_ex := 0; v_h_rule := 'Not available in ' || v_regime || ' Regime';
      ELSIF v_head.basis = 'TAXABLE' THEN
        v_h_ex := 0; v_h_rule := 'Fully taxable';
      ELSIF v_head.basis = 'INSTRUMENT_CAP' THEN
        v_h_ex := LEAST(v_h_gross, ROUND(COALESCE(v_head.cap_per_unit,0) * COALESCE(v_head.units_per_day,1) * v_workdays));
        v_h_rule := format('%s × %s per working day', v_head.cap_per_unit, v_head.units_per_day);
      ELSIF v_head.basis = 'PER_UNIT' THEN
        v_h_ex := LEAST(v_h_gross, ROUND(COALESCE(v_head.cap_per_unit,0) * LEAST(v_children, COALESCE(v_head.max_units,0)) * 12));
        v_h_rule := format('%s per child per month × %s child(ren)', v_head.cap_per_unit, LEAST(v_children, COALESCE(v_head.max_units,0)));
      ELSE  -- BILLS: what was actually approved this FY, per component
        SELECT COALESCE(SUM(COALESCE(c.approved_amount, c.claim_amount, 0)), 0) INTO v_claims
          FROM flexi_claims c
         WHERE c.employee_id = r.employee_id
           AND c.component_code = v_head.head_code
           AND c.status IN ('APPROVED','PAYROLL_PROCESSED')
           AND c.submitted_at >= v_fy_from AND c.submitted_at < v_fy_to + 1;
        -- LTA: the declaration still counts until a claim exists (promise → proof)
        IF v_head.head_code = 'LTA' AND v_claims = 0 THEN v_claims := v_lta; END IF;
        v_h_ex := LEAST(v_h_gross, ROUND(v_claims));
        v_h_rule := CASE WHEN v_h_ex > 0 THEN 'Against approved bills' ELSE 'No bills approved — taxable' END;
      END IF;
      IF v_head.head_code = 'LTA' THEN v_lta := v_h_ex; v_lta_ws := v_h_ex; END IF;   -- keep tds_lta_exempt consistent with the worksheet
      v_flexi_ex := v_flexi_ex + v_h_ex;

      v_ws := v_ws || jsonb_build_object('head', v_head.head_code, 'label', v_head.label,
                                         'gross', v_h_gross, 'exempt', v_h_ex, 'taxable', v_h_gross - v_h_ex, 'rule', v_h_rule);
      v_ws_gross := v_ws_gross + v_h_gross; v_ws_exempt := v_ws_exempt + v_h_ex;
    END LOOP;
    -- LTA sits inside v_flexi_ex now; keep the single-figure column but do not count it
    -- twice. An LTA exemption with no LTA head paid this year is exempting nothing —
    -- the spec caps every exemption at the head it belongs to.
    IF v_lta_ws IS NULL THEN v_lta := 0; ELSE v_flexi_ex := v_flexi_ex - v_lta_ws; END IF;

    -- one-offs: actual only, never projected — one row each so the payslip can label the cause
    FOR v_head IN
      SELECT * FROM (VALUES ('incentive','Incentive',COALESCE(r.pay_incentive,0)), ('variable','Variable Pay',COALESCE(r.pay_variable,0)),
                            ('bonus','Bonus',COALESCE(r.pay_bonus,0)), ('buyout','Notice Buyout',COALESCE(r.pay_buyout,0))) AS t(code,label,amt)
    LOOP
      IF v_head.amt <= 0 THEN CONTINUE; END IF;
      v_ws := v_ws || jsonb_build_object('head', v_head.code, 'label', v_head.label,
                                         'gross', ROUND(v_head.amt), 'exempt', 0, 'taxable', ROUND(v_head.amt), 'rule', 'One-off — actual only, never projected');
    END LOOP;

    -- ── House property, other income, previous employer (unchanged) ──────
    IF EXISTS (SELECT 1 FROM tds_house_property WHERE employee_id = r.employee_id AND fy = v_run.fy) THEN
      SELECT
        (LEAST(v_hp_setoff_cap, COALESCE(SUM(CASE WHEN occupancy_type = 'SELF'
              THEN interest_on_loan + pre_construction_interest ELSE 0 END), 0)) * -1)
        +
        COALESCE(SUM(CASE WHEN occupancy_type IN ('LET_OUT','DEEMED_LET_OUT') THEN
              (GREATEST(annual_rent_received - municipal_taxes_paid, 0) * 0.7)
              - interest_on_loan - pre_construction_interest
            ELSE 0 END), 0)
        INTO v_hp
      FROM tds_house_property WHERE employee_id = r.employee_id AND fy = v_run.fy;
      IF v_regime = 'NEW' THEN v_hp := GREATEST(v_hp, 0);
      ELSIF v_hp < 0 THEN v_hp := GREATEST(v_hp, -v_hp_setoff_cap); END IF;
    ELSE
      v_hp := CASE WHEN v_regime = 'OLD' THEN LEAST(COALESCE(v_decl.sec_24b,0), v_hp_setoff_cap) * -1 ELSE 0 END;
    END IF;

    v_other_income := COALESCE(v_decl.income_interest_savings,0) + COALESCE(v_decl.income_interest_fd,0)
                     + COALESCE(v_decl.income_dividend,0) + COALESCE(v_decl.income_other,0);
    v_80tta_ttb := LEAST(COALESCE(v_decl.income_interest_savings,0),
                         CASE WHEN v_age <> 'BELOW_60' THEN 50000 ELSE 10000 END);

    SELECT taxable_income, tds_deducted INTO v_prev_income, v_prev_tds
      FROM tds_previous_employer WHERE employee_id = r.employee_id AND fy = v_run.fy;
    v_prev_income := COALESCE(v_prev_income, 0);
    v_prev_tds    := COALESCE(v_prev_tds, 0);

    v_annual := v_actual + v_curr + v_arr + v_proj + v_perq + v_other_income + v_prev_income + v_hp;
    v_months := GREATEST(1, LEAST(v_dolm, 12) - v_run.month + 1);

    -- ── Chapter VI-A (unchanged from 064) ────────────────────────────────
    v_via := LEAST(COALESCE(v_decl.sec_80c,0), 150000)
           + CASE WHEN COALESCE(v_decl.sec_80d_self,0) + COALESCE(v_decl.sec_80d_parents,0) > 0 THEN
               LEAST(COALESCE(v_decl.sec_80d_self,0), CASE WHEN v_age <> 'BELOW_60' THEN 50000 ELSE 25000 END)
               + LEAST(COALESCE(v_decl.sec_80d_parents,0)
                       + LEAST(COALESCE(v_decl.sec_80d_preventive,0), 5000),
                       CASE WHEN COALESCE(v_decl.sec_80d_parents_senior,false) THEN 50000 ELSE 25000 END)
             ELSE COALESCE(v_decl.sec_80d,0) END
           + CASE WHEN COALESCE(v_decl.sec_80e_first_repayment_year,0) = 0
                    OR (split_part(v_run.fy,'-',1)::INT - v_decl.sec_80e_first_repayment_year) < 8
                  THEN COALESCE(v_decl.sec_80e,0) ELSE 0 END
           + LEAST(COALESCE(v_decl.nps_80ccd1b,0), 50000)
           + LEAST(COALESCE(v_decl.sec_80dd,0), CASE WHEN COALESCE(v_decl.sec_80dd_severe,false) THEN 125000 ELSE 75000 END)
           + LEAST(COALESCE(v_decl.sec_80ddb,0), CASE WHEN v_age <> 'BELOW_60' THEN 100000 ELSE 40000 END)
           + LEAST(COALESCE(v_decl.sec_80eeb,0), 150000)
           + LEAST(COALESCE(v_decl.sec_80u,0), CASE WHEN COALESCE(v_decl.sec_80u_severe,false) THEN 125000 ELSE 75000 END)
           + v_80tta_ttb;

    IF v_hra = 0 AND v_regime = 'OLD' AND COALESCE(v_decl.monthly_rent,0) > 0 THEN
      v_via := v_via + LEAST(60000, GREATEST(0, (COALESCE(v_decl.monthly_rent,0) * 12) - 0.10 * v_annual));
    END IF;
    IF v_regime = 'OLD' AND COALESCE((SELECT allow_80g_in_payroll FROM companies WHERE id = r.emp_company_id), false) THEN
      v_via := v_via + LEAST(COALESCE(v_decl.sec_80g,0), 0.10 * v_annual);
    END IF;

    v_pt_month := COALESCE(r.pt_amount, r.pt_monthly, 0);
    v_pt := COALESCE(v_pt_ytd,0) + v_pt_month + v_pt_month * v_projm;

    SELECT standard_deduction INTO v_std FROM tax_regime_config
     WHERE upper(regime) = v_regime AND effective_from <= v_on
       AND (effective_to IS NULL OR effective_to >= v_on)
     ORDER BY effective_from DESC LIMIT 1;
    v_std := COALESCE(v_std, CASE WHEN v_regime='OLD' THEN 50000 ELSE 75000 END);

    IF v_regime = 'NEW' THEN
      v_hra := 0; v_lta := 0; v_pt := 0; v_flexi_ex := 0;
      v_via := COALESCE(v_decl.employer_nps_80ccd2, 0);
    END IF;

    -- ── Taxable income — Section 288A: round to ₹10, ONCE, here ──────────
    v_taxable := GREATEST(0, (v_annual - v_hra - v_lta - v_flexi_ex) - v_std - v_via - v_pt);
    v_taxable := ROUND(v_taxable / 10) * 10;
    SELECT * INTO t1 FROM tds_annual_tax(v_taxable, v_regime, v_on, v_age);
    v_reg := ROUND(GREATEST(0, t1.total - v_paid - v_prev_tds) / v_months);

    IF v_oneoff > 0 THEN
      SELECT * INTO t2 FROM tds_annual_tax(
        ROUND(GREATEST(0, (v_annual + v_oneoff - v_hra - v_lta - v_flexi_ex) - v_std - v_via - v_pt) / 10) * 10,
        v_regime, v_on, v_age);
      v_add := ROUND(GREATEST(0, t2.total - t1.total));
    ELSE
      v_add := 0;
    END IF;

    -- ── This month's split — spec §13.1 ──────────────────────────────────
    v_sur_rate := CASE WHEN COALESCE(t1.slab,0) - COALESCE(t1.rebate,0) - COALESCE(t1.rebate_relief,0) > 0
                       THEN COALESCE(t1.surcharge,0) / (t1.slab - t1.rebate - t1.rebate_relief) ELSE 0 END;
    v_m_cess := ROUND(v_reg * 0.04 / 1.04);
    v_m_base := ROUND((v_reg - v_m_cess) / (1 + v_sur_rate));
    v_m_sur  := v_reg - v_m_cess - v_m_base;

    UPDATE payroll_employee_snapshot SET
      date_of_birth                = COALESCE(date_of_birth, r.emp_dob),
      tds_regime_used              = v_regime,
      tds_age_category             = v_age,
      tds_actual_ytd                = ROUND(v_actual),
      tds_current_gross            = ROUND(v_curr),
      tds_arrear                   = ROUND(v_arr),
      tds_projected                = ROUND(v_proj),
      tds_perquisites               = ROUND(v_perq),
      tds_employer_contrib_excess   = ROUND(v_er_excess),
      tds_house_property           = ROUND(v_hp),
      tds_other_income              = ROUND(v_other_income),
      tds_prev_employer_income     = ROUND(v_prev_income),
      tds_prev_employer_tds        = ROUND(v_prev_tds),
      tds_annual_gross             = ROUND(v_annual),
      tds_worksheet                = jsonb_build_object(
                                       'rows', v_ws,
                                       'gross', ROUND(v_ws_gross) + ROUND(v_oneoff),
                                       'exempt', ROUND(v_ws_exempt),
                                       'taxable', ROUND(v_ws_gross) + ROUND(v_oneoff) - ROUND(v_ws_exempt)),
      tds_hra_exempt                = ROUND(v_hra),
      tds_hra_metro                 = v_hra_metro,
      tds_hra_annual                = ROUND(v_hra_actual),
      tds_hra_basic_annual          = ROUND(v_basic_annual),
      tds_hra_rent_annual           = ROUND(v_rent_annual),
      tds_hra_leg_actual            = ROUND(v_hra_actual),
      tds_hra_leg_pct_basic         = ROUND(v_hra_pct),
      tds_hra_leg_rent_less_10      = ROUND(v_hra_rule3),
      tds_lta_exempt                = ROUND(v_lta),
      tds_flexi_exempt              = ROUND(v_flexi_ex),
      tds_pt_deduction              = ROUND(v_pt),
      tds_std_deduction             = ROUND(v_std),
      tds_chapter_via               = ROUND(v_via),
      tds_taxable_income            = ROUND(v_taxable),
      tds_slab_tax                  = t1.slab,
      tds_rebate_87a                = t1.rebate + t1.rebate_relief,
      tds_marginal_relief_87a       = t1.rebate_relief,
      tds_surcharge                 = t1.surcharge,
      tds_marginal_relief_surcharge = t1.surcharge_relief,
      tds_cess                     = t1.cess,
      tds_annual_liability         = t1.total,
      tds_paid_ytd                 = ROUND(v_paid),
      tds_months_remaining         = v_months,
      tds_monthly                  = v_reg,
      tds_additional                = v_add,
      tds_month_base_tax           = v_m_base,
      tds_month_surcharge          = v_m_sur,
      tds_month_cess               = v_m_cess,
      tds_surcharge_rate           = ROUND(v_sur_rate * 100, 2),
      tds_config_version           = v_cfg_ver,
      tds_reason                   = v_regime || ' regime · ' || v_age || ' · '
                             || (12 - COALESCE(v_dolm,12))::TEXT || ' month(s) cut by DOL · '
                             || v_months::TEXT || ' month(s) left'
                             || CASE WHEN v_dolfrac < 1
                                     THEN ' · leaving month ' || ROUND(v_dolfrac*100)::TEXT || '% projected' ELSE '' END
                             || CASE WHEN v_arr > 0 THEN ' · arrear ' || ROUND(v_arr)::TEXT || ' taxed as actual' ELSE '' END
                             || CASE WHEN v_oneoff > 0 THEN ' · one-off ' || ROUND(v_oneoff)::TEXT ELSE '' END
                             || CASE WHEN v_perq > 0 THEN ' · perquisites ' || ROUND(v_perq)::TEXT ELSE '' END
                             || CASE WHEN v_hp <> 0 THEN ' · house property ' || ROUND(v_hp)::TEXT ELSE '' END
                             || CASE WHEN v_prev_income > 0 THEN ' · previous employer income ' || ROUND(v_prev_income)::TEXT ELSE '' END
                             || CASE WHEN v_flexi_ex > 0 THEN ' · flexi exempt ' || ROUND(v_flexi_ex)::TEXT || ' against bills' ELSE '' END
                             || CASE WHEN t1.rebate_relief > 0 THEN ' · 87A marginal relief ' || ROUND(t1.rebate_relief)::TEXT ELSE '' END
                             || CASE WHEN t1.surcharge_relief > 0 THEN ' · surcharge marginal relief ' || ROUND(t1.surcharge_relief)::TEXT ELSE '' END
                             || CASE WHEN v_regime = 'OLD' AND v_rent_annual > 0
                                     THEN ' · HRA least-of ' || ROUND(v_hra_actual)::TEXT || '/' || ROUND(v_hra_pct)::TEXT || '/' || ROUND(v_hra_rule3)::TEXT
                                          || ' (' || CASE WHEN v_hra_metro THEN 'metro' ELSE 'non-metro' END || ')' ELSE '' END,
      synced_at = now()
    WHERE run_id = p_run_id AND employee_id = r.employee_id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END $$;

-- ── Verify ─────────────────────────────────────────────────────────────────
-- SELECT sync_month_tds(id) FROM payroll_runs WHERE status='CALCULATED' ORDER BY fy DESC, month DESC LIMIT 1;
-- SELECT employee_code, tds_monthly, tds_config_version, jsonb_array_length(tds_worksheet) AS ws_rows
--   FROM payroll_employee_snapshot WHERE tds_worksheet IS NOT NULL ORDER BY synced_at DESC LIMIT 5;
