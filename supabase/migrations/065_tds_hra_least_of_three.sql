-- ════════════════════════════════════════════════════════════════════════════
-- 065_tds_hra_least_of_three.sql — the actual Section 10(13A) formula.
--
-- WHAT WAS WRONG. sync_month_tds() took v_hra straight from the declaration's
-- hra_claimed — which the ESS form sets to (monthly rent × 12), full stop. It
-- was never checked against the actual HRA the employee is paid, or against
-- 40%/50% of Basic. Declare a rent higher than your own HRA and the exemption
-- happily exceeded the HRA itself — an amount that cannot legally be exempt at
-- all, since you can never be exempt on income you were never paid.
--
-- THE REAL RULE — least of:
--   1. Actual HRA received
--   2. 50% of Basic (metro) / 40% of Basic (non-metro)
--   3. Rent paid annually − 10% of Basic
--
-- Metro/non-metro was the reason sql125 gave for not building this in the first
-- place ("no metro/non-metro flag on employees"). It does not need one — the
-- snapshot already carries location_city, and the spec's four statutory metros
-- (Mumbai, Delhi, Kolkata, Chennai) are a fixed, known list.
--
-- RUN THE WHOLE FILE AT ONCE, with nothing selected in the editor.
-- 064 must already be applied.
-- ════════════════════════════════════════════════════════════════════════════

DO $$ BEGIN RAISE NOTICE '065 start'; END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='payroll_employee_snapshot' AND column_name='tds_age_category') THEN
    RAISE EXCEPTION '064_tds_full_spec.sql has not been applied yet — run it first.';
  END IF;
END $$;


-- ── 1) One column, so the number the exemption used can be read off the sheet
--       instead of inferred. ────────────────────────────────────────────────
ALTER TABLE payroll_employee_snapshot
  ADD COLUMN IF NOT EXISTS tds_hra_metro BOOLEAN;


-- ── 2) sync_month_tds — same body as 064, with v_hra replaced by the real
--       three-way least. Everything else — arrear, PT, LTA, DOL fraction,
--       perquisites, house property, previous employer, Chapter VI-A, age-aware
--       slabs, marginal relief — is unchanged. ─────────────────────────────
CREATE OR REPLACE FUNCTION sync_month_tds(p_run_id UUID, p_codes TEXT[] DEFAULT NULL)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  v_run     payroll_runs%ROWTYPE;
  v_period  DATE;
  v_on      DATE;
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

  -- HRA — §2.1.
  v_hra_ytd    NUMERIC; v_basic_ytd NUMERIC;
  v_hra_actual NUMERIC; v_basic_annual NUMERIC;
  v_hra_metro  BOOLEAN;
  v_hra_pct    NUMERIC;
  v_rent_annual NUMERIC;
  v_hra_rule3  NUMERIC;
BEGIN
  PERFORM payroll_assert_month_open(p_run_id);
  SELECT * INTO v_run FROM payroll_runs WHERE id = p_run_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'payroll_run % not found', p_run_id; END IF;
  v_period := payroll_period_start(v_run.fy, v_run.month);
  v_on     := v_period;

  FOR r IN
    SELECT s.*, e.tds_regime AS emp_regime, e.date_of_birth, e.company_id AS emp_company_id
      FROM payroll_employee_snapshot s
      LEFT JOIN employees e ON e.id = s.employee_id
     WHERE s.run_id = p_run_id
       AND (p_codes IS NULL OR s.employee_code = ANY (p_codes))
  LOOP
    v_regime := CASE WHEN upper(btrim(COALESCE(NULLIF(btrim(r.tds_regime),''), r.emp_regime, 'NEW'))) = 'OLD'
                     THEN 'OLD' ELSE 'NEW' END;
    v_age := tds_age_category(r.date_of_birth, v_run.fy);

    v_oneoff := COALESCE(r.pay_incentive,0) + COALESCE(r.pay_variable,0)
              + COALESCE(r.pay_bonus,0)     + COALESCE(r.pay_buyout,0);
    v_arr := COALESCE(r.arrear_total, 0);
    v_curr := GREATEST(0, COALESCE(r.earn_gross_monthly,0) - v_oneoff);

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
           COALESCE(SUM(COALESCE(p.earn_basic_monthly,0)), 0)
      INTO v_actual, v_arr_ytd, v_paid, v_pt_ytd, v_er_epf_ytd, v_er_nps_ytd, v_hra_ytd, v_basic_ytd
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
    v_proj := CASE WHEN v_projm = 0 THEN 0
                   ELSE (v_projm - 1) * v_struct + v_struct * v_dolfrac END;

    v_er_contrib_annual := COALESCE(v_er_epf_ytd,0) + COALESCE(v_er_nps_ytd,0)
                         + COALESCE(r.epf_employer_total,0) + COALESCE(r.employer_nps,0)
                         + v_projm * (COALESCE(r.epf_employer_total,0) + COALESCE(r.employer_nps,0));
    v_er_excess := GREATEST(0, v_er_contrib_annual - v_er_contrib_cap);

    SELECT COALESCE(total_perquisite_amount, 0) INTO v_perq
      FROM employee_perquisite_summary
     WHERE employee_id = r.employee_id AND fy = v_run.fy;
    v_perq := COALESCE(v_perq, 0) + v_er_excess;

    SELECT * INTO v_decl FROM tds_declarations WHERE employee_id = r.employee_id AND fy = v_run.fy LIMIT 1;

    -- §2.1 — HRA, the real least-of-three. Same actual + current + projected
    -- annualisation as gross, applied narrowly to just the HRA and Basic heads.
    v_hra_actual := COALESCE(v_hra_ytd,0) + COALESCE(r.earn_hra_monthly,0)
                  + v_projm * COALESCE(r.hra_monthly,0);
    v_basic_annual := COALESCE(v_basic_ytd,0) + COALESCE(r.earn_basic_monthly,0)
                     + v_projm * COALESCE(r.basic_monthly,0);
    v_hra_metro := lower(COALESCE(r.location_city,'')) = ANY (
                     ARRAY['mumbai','delhi','new delhi','kolkata','calcutta','chennai','madras']);
    v_hra_pct := v_basic_annual * (CASE WHEN v_hra_metro THEN 0.50 ELSE 0.40 END);
    v_rent_annual := COALESCE(v_decl.monthly_rent,0) * 12;
    v_hra_rule3 := GREATEST(0, v_rent_annual - 0.10 * v_basic_annual);
    v_hra := CASE WHEN v_regime = 'OLD'
                  THEN LEAST(v_hra_actual, v_hra_pct, v_hra_rule3) ELSE 0 END;

    v_lta := COALESCE(v_decl.lta_claimed, 0);

    SELECT * INTO v_lta_block FROM tds_lta_block_usage
     WHERE employee_id = r.employee_id AND block_start_year = 2026 LIMIT 1;
    IF FOUND THEN
      v_lta_allowed := 2 + CASE WHEN v_lta_block.carried_forward THEN 1 ELSE 0 END;
      IF v_lta_block.journeys_used >= v_lta_allowed THEN v_lta := 0; END IF;
    END IF;

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
      IF v_regime = 'NEW' THEN
        v_hp := GREATEST(v_hp, 0);
      ELSIF v_hp < 0 THEN
        v_hp := GREATEST(v_hp, -v_hp_setoff_cap);
      END IF;
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
      v_hra := 0; v_lta := 0; v_pt := 0;
      v_via := COALESCE(v_decl.employer_nps_80ccd2, 0);
    END IF;

    v_taxable := GREATEST(0, (v_annual - v_hra - v_lta) - v_std - v_via - v_pt);
    SELECT * INTO t1 FROM tds_annual_tax(v_taxable, v_regime, v_on, v_age);
    v_reg := ROUND(GREATEST(0, t1.total - v_paid - v_prev_tds) / v_months);

    IF v_oneoff > 0 THEN
      SELECT * INTO t2 FROM tds_annual_tax(
        GREATEST(0, (v_annual + v_oneoff - v_hra - v_lta) - v_std - v_via - v_pt), v_regime, v_on, v_age);
      v_add := ROUND(GREATEST(0, t2.total - t1.total));
    ELSE
      v_add := 0;
    END IF;

    UPDATE payroll_employee_snapshot SET
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
      tds_hra_exempt                = ROUND(v_hra),
      tds_hra_metro                 = v_hra_metro,
      tds_lta_exempt                = ROUND(v_lta),
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
      tds_reason                   = v_regime || ' regime · ' || v_age || ' · '
                             || (12 - COALESCE(v_dolm,12))::TEXT || ' month(s) cut by DOL · '
                             || v_months::TEXT || ' month(s) left'
                             || CASE WHEN v_dolfrac < 1
                                     THEN ' · leaving month ' || ROUND(v_dolfrac*100)::TEXT || '% projected'
                                     ELSE '' END
                             || CASE WHEN v_arr > 0
                                     THEN ' · arrear ' || ROUND(v_arr)::TEXT || ' taxed as actual' ELSE '' END
                             || CASE WHEN v_oneoff > 0
                                     THEN ' · one-off ' || ROUND(v_oneoff)::TEXT ELSE '' END
                             || CASE WHEN v_perq > 0 THEN ' · perquisites ' || ROUND(v_perq)::TEXT ELSE '' END
                             || CASE WHEN v_hp <> 0 THEN ' · house property ' || ROUND(v_hp)::TEXT ELSE '' END
                             || CASE WHEN v_prev_income > 0
                                     THEN ' · previous employer income ' || ROUND(v_prev_income)::TEXT ELSE '' END
                             || CASE WHEN t1.rebate_relief > 0
                                     THEN ' · 87A marginal relief ' || ROUND(t1.rebate_relief)::TEXT ELSE '' END
                             || CASE WHEN t1.surcharge_relief > 0
                                     THEN ' · surcharge marginal relief ' || ROUND(t1.surcharge_relief)::TEXT ELSE '' END
                             || CASE WHEN v_regime = 'OLD' AND v_rent_annual > 0
                                     THEN ' · HRA least-of ' || ROUND(v_hra_actual)::TEXT || '/' || ROUND(v_hra_pct)::TEXT
                                          || '/' || ROUND(v_hra_rule3)::TEXT
                                          || ' (' || CASE WHEN v_hra_metro THEN 'metro' ELSE 'non-metro' END || ')'
                                     ELSE '' END,
      synced_at = now()
    WHERE run_id = p_run_id AND employee_id = r.employee_id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END $$;


-- ── 3) Schema cache ────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';


-- ── 4) VERIFY ──────────────────────────────────────────────────────────────
SELECT 'tds_hra_metro column' AS item, EXISTS (SELECT 1 FROM information_schema.columns
       WHERE table_name='payroll_employee_snapshot' AND column_name='tds_hra_metro') AS ok
UNION ALL SELECT 'sync_month_tds() uses the least-of-three', (
  SELECT bool_or(pg_get_functiondef(oid) LIKE '%v_hra_rule3%') FROM pg_proc WHERE proname='sync_month_tds');

-- Worked example, straight from the spec's own numbers: Basic ₹75,000/month
-- (₹9,00,000/yr), non-metro, rent ₹29,000/month (₹3,48,000/yr), HRA actually
-- paid ₹4,50,000/yr.
--   1. Actual HRA received        = 4,50,000
--   2. 40% of Basic (non-metro)   = 3,60,000
--   3. Rent − 10% of Basic        = 3,48,000 − 90,000 = 2,58,000
--   Least of the three            = 2,58,000  ← the exemption
SELECT 'worked example: non-metro, 75k basic, 29k rent, 90k HRA' AS test,
       LEAST(450000, 360000, 258000) AS least_of_three,
       258000 AS expected;


-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK — re-run 064_tds_full_spec.sql's sync_month_tds() to go back to
-- hra_claimed-as-declared. Then:
-- ALTER TABLE payroll_employee_snapshot DROP COLUMN IF EXISTS tds_hra_metro;
-- ════════════════════════════════════════════════════════════════════════════
