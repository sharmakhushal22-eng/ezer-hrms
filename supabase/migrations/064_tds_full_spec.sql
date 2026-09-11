-- ════════════════════════════════════════════════════════════════════════════
-- 064_tds_full_spec.sql — every remaining gap from EZER-INCOME-TAX-SPEC-FINAL.md
-- closed: senior/super-senior slabs, perquisites, the §17(2)(vii) employer-
-- contribution cap, house property (both kinds, with the ₹2L salary set-off cap),
-- previous employer income/TDS (Form 12B), the rest of Chapter VI-A (80DD, 80DDB,
-- 80EEB, 80G, 80GG, 80TTA/80TTB, granular 80D, the 80E eight-year window), income
-- from other sources, an LTA two-journeys-per-block cap, and marginal relief on
-- both the surcharge thresholds and the New Regime's ₹12L rebate cliff.
--
-- RUN THE WHOLE FILE AT ONCE, with nothing selected in the editor.
-- 062 and 063 must already be applied.
--
-- WHAT IS DELIBERATELY STILL NOT HERE, STATED RATHER THAN HIDDEN
--   · Rule 3B accretion — interest earned on the §17(2)(vii) excess. The excess
--     itself IS taxed; the running year-on-year interest on it is not, because
--     that needs an opening-balance ledger per employee per FY that nothing yet
--     tracks. Affects only employees already over the ₹7.5L employer-contribution
--     cap — a handful of the most senior people in the company.
--   · 80G's real 50%/100% and 10%-of-GTI-per-donee rules. What is here is the
--     conservative "10% of gross total income" reading applied uniformly — the
--     spec itself recommends leaving 80G out of payroll entirely for exactly this
--     reason (`companies.allow_80g_in_payroll` defaults to false).
--   · LTA's own fare/route validation — only the journey COUNT per block is
--     capped; the rupee amount is still whatever the employee declares.
-- ════════════════════════════════════════════════════════════════════════════

DO $$ BEGIN RAISE NOTICE '064 start'; END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='sync_month_tds') THEN
    RAISE EXCEPTION 'sync_month_tds() is missing — run 062 and 063 first.';
  END IF;
END $$;


-- ════════════════════════════════════════════════════════════════════════════
-- 1) tds_declarations — the rest of Chapter VI-A, §7 other income, and the 80E
--    eight-year window. Granular 80D supersedes the old flat sec_80d only when
--    it is actually used (see the engine below) — nobody's existing submitted
--    declaration changes shape.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE tds_declarations
  ADD COLUMN IF NOT EXISTS sec_80d_self             NUMERIC,
  ADD COLUMN IF NOT EXISTS sec_80d_parents           NUMERIC,
  ADD COLUMN IF NOT EXISTS sec_80d_parents_senior     BOOLEAN,
  ADD COLUMN IF NOT EXISTS sec_80d_preventive         NUMERIC,
  ADD COLUMN IF NOT EXISTS sec_80dd                  NUMERIC,
  ADD COLUMN IF NOT EXISTS sec_80dd_severe            BOOLEAN,
  ADD COLUMN IF NOT EXISTS sec_80ddb                 NUMERIC,
  ADD COLUMN IF NOT EXISTS sec_80eeb                 NUMERIC,
  ADD COLUMN IF NOT EXISTS sec_80g                   NUMERIC,
  ADD COLUMN IF NOT EXISTS sec_80u                   NUMERIC,
  ADD COLUMN IF NOT EXISTS sec_80u_severe             BOOLEAN,
  ADD COLUMN IF NOT EXISTS sec_80e_first_repayment_year INTEGER,
  ADD COLUMN IF NOT EXISTS income_interest_savings   NUMERIC,
  ADD COLUMN IF NOT EXISTS income_interest_fd        NUMERIC,
  ADD COLUMN IF NOT EXISTS income_dividend           NUMERIC,
  ADD COLUMN IF NOT EXISTS income_other              NUMERIC;

-- 80G is a company policy switch, not an employee fact — the spec's own advice is
-- to default it off. Lives on companies because it applies to everyone the
-- company pays, not per declaration.
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS allow_80g_in_payroll BOOLEAN NOT NULL DEFAULT false;


-- ════════════════════════════════════════════════════════════════════════════
-- 2) House property — §6. One row per property; a person can have more than one.
--    Self-occupied interest (capped ₹2L combined) and let-out (NAV − municipal
--    tax − 30% standard deduction − full interest, no cap) are genuinely
--    different computations, so occupancy_type drives which applies per row.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS tds_house_property (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id             UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  fy                      TEXT NOT NULL,
  occupancy_type          TEXT NOT NULL CHECK (occupancy_type IN ('SELF','LET_OUT','DEEMED_LET_OUT')),
  address                 TEXT,
  annual_rent_received    NUMERIC NOT NULL DEFAULT 0,   -- LET_OUT / DEEMED_LET_OUT only
  municipal_taxes_paid    NUMERIC NOT NULL DEFAULT 0,   -- actual, only if paid by the owner
  interest_on_loan        NUMERIC NOT NULL DEFAULT 0,
  pre_construction_interest NUMERIC NOT NULL DEFAULT 0, -- the year's 1/5th share, already divided
  lender_name             TEXT,
  lender_pan              TEXT,
  lender_address          TEXT,
  co_owner_share_pct      NUMERIC,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE tds_house_property ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_tds_house_property" ON tds_house_property;
CREATE POLICY "allow_all_tds_house_property" ON tds_house_property
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS ix_tds_hp_emp_fy ON tds_house_property (employee_id, fy);


-- ════════════════════════════════════════════════════════════════════════════
-- 3) Previous employer — §15.2, Form 12B. One row per employee per FY; only
--    populated for a mid-year joiner who had an earlier employer that same year.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS tds_previous_employer (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  fy                TEXT NOT NULL,
  taxable_income    NUMERIC NOT NULL DEFAULT 0,
  tds_deducted      NUMERIC NOT NULL DEFAULT 0,
  pf_deducted       NUMERIC NOT NULL DEFAULT 0,   -- record only — transferred via the employee's own PF account
  professional_tax  NUMERIC NOT NULL DEFAULT 0,   -- record only — a different employer's state liability
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, fy)
);
ALTER TABLE tds_previous_employer ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_tds_previous_employer" ON tds_previous_employer;
CREATE POLICY "allow_all_tds_previous_employer" ON tds_previous_employer
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);


-- ════════════════════════════════════════════════════════════════════════════
-- 4) LTA block usage — §2.2. Two journeys per four-year block (current block
--    2026–2029), one carried forward into the first year of the next block. A
--    row only exists once somebody has actually used a journey — nobody without
--    a row is restricted, so this cannot retroactively take away an exemption
--    from a declaration nobody has reconciled against it yet.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS tds_lta_block_usage (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  block_start_year  INTEGER NOT NULL,
  journeys_used     INTEGER NOT NULL DEFAULT 0,
  carried_forward   BOOLEAN NOT NULL DEFAULT false,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, block_start_year)
);
ALTER TABLE tds_lta_block_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_tds_lta_block_usage" ON tds_lta_block_usage;
CREATE POLICY "allow_all_tds_lta_block_usage" ON tds_lta_block_usage
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);


-- ════════════════════════════════════════════════════════════════════════════
-- 5) payroll_employee_snapshot — one column per new figure, same rule sql125
--    started with: a single frozen number cannot be checked by anyone, a column
--    per step can.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE payroll_employee_snapshot
  ADD COLUMN IF NOT EXISTS tds_age_category            TEXT,
  ADD COLUMN IF NOT EXISTS tds_perquisites              NUMERIC,
  ADD COLUMN IF NOT EXISTS tds_employer_contrib_excess  NUMERIC,
  ADD COLUMN IF NOT EXISTS tds_house_property           NUMERIC,
  ADD COLUMN IF NOT EXISTS tds_other_income             NUMERIC,
  ADD COLUMN IF NOT EXISTS tds_prev_employer_income     NUMERIC,
  ADD COLUMN IF NOT EXISTS tds_prev_employer_tds        NUMERIC,
  ADD COLUMN IF NOT EXISTS tds_marginal_relief_87a       NUMERIC,
  ADD COLUMN IF NOT EXISTS tds_marginal_relief_surcharge NUMERIC;


-- ════════════════════════════════════════════════════════════════════════════
-- 6) Age, as on 31 March of the FY — the day the Act tests it on, not today's
--    date. AGE() handles month/day comparison correctly on its own; a plain
--    year subtraction gets it wrong for anyone whose birthday falls after
--    31 March.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION tds_age_category(p_dob DATE, p_fy TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_dob IS NULL THEN 'BELOW_60'
    WHEN DATE_PART('year', AGE(
           make_date(split_part(p_fy,'-',1)::INT + 1, 3, 31), p_dob)) >= 80 THEN 'SUPER_SENIOR_80_PLUS'
    WHEN DATE_PART('year', AGE(
           make_date(split_part(p_fy,'-',1)::INT + 1, 3, 31), p_dob)) >= 60 THEN 'SENIOR_60_80'
    ELSE 'BELOW_60'
  END
$$;


-- ════════════════════════════════════════════════════════════════════════════
-- 7) tds_slab_tax — now age-aware. Default stays BELOW_60 so nothing that calls
--    the old three-argument form breaks.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION tds_slab_tax(p_income NUMERIC, p_regime TEXT, p_on DATE, p_age_category TEXT DEFAULT 'BELOW_60')
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(
    GREATEST(0, LEAST(COALESCE(s.slab_max, p_income), p_income) - s.slab_min) * s.tax_rate / 100
  ), 0)
  FROM tax_slabs s
  WHERE upper(s.regime) = upper(COALESCE(p_regime,'NEW'))
    -- New Regime carries no senior slabs at all — it is age-blind by design, and
    -- only a BELOW_60 row exists for it. Old Regime gets the real category.
    AND s.age_category = CASE WHEN upper(COALESCE(p_regime,'NEW')) = 'NEW' THEN 'BELOW_60'
                               ELSE COALESCE(p_age_category, 'BELOW_60') END
    AND s.effective_from <= p_on
    AND (s.effective_to IS NULL OR s.effective_to >= p_on)
    AND p_income > s.slab_min
$$;
COMMENT ON FUNCTION tds_slab_tax(NUMERIC, TEXT, DATE, TEXT) IS
  'Slab tax for a taxable income, from tax_slabs, now reading the real senior / '
  'super-senior row when the employee''s age (from employees.date_of_birth) calls for it.';


-- ════════════════════════════════════════════════════════════════════════════
-- 8) tds_annual_tax — rebuilt with marginal relief on both the 87A cliff and
--    every surcharge threshold. This changes the OUT-parameter shape (two new
--    outputs), which Postgres will not let CREATE OR REPLACE do — the old
--    version has to be dropped first.
--
--    Marginal relief, in one sentence: crossing a threshold can never cost more
--    in extra tax than the extra income that crossed it. At each cliff, tax is
--    capped at (tax at the threshold) + (income above the threshold).
-- ════════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS tds_annual_tax(NUMERIC, TEXT, DATE);

CREATE OR REPLACE FUNCTION tds_annual_tax(
  p_taxable NUMERIC, p_regime TEXT, p_on DATE, p_age_category TEXT DEFAULT 'BELOW_60',
  OUT slab NUMERIC, OUT rebate NUMERIC, OUT rebate_relief NUMERIC,
  OUT surcharge NUMERIC, OUT surcharge_relief NUMERIC, OUT cess NUMERIC, OUT total NUMERIC
) LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_cfg        RECORD;
  v_income     NUMERIC := GREATEST(p_taxable, 0);
  v_after_rebate NUMERIC;
  v_band       RECORD;
  v_prev_rate  NUMERIC;
  v_uncapped   NUMERIC;
  v_capped     NUMERIC;
BEGIN
  slab := ROUND(tds_slab_tax(v_income, p_regime, p_on, p_age_category));

  SELECT standard_deduction, rebate_87a_threshold, rebate_87a_amount
    INTO v_cfg
    FROM tax_regime_config
   WHERE upper(regime) = upper(COALESCE(p_regime,'NEW'))
     AND effective_from <= p_on AND (effective_to IS NULL OR effective_to >= p_on)
   ORDER BY effective_from DESC LIMIT 1;

  -- §11 — 87A wipes the liability out below the threshold …
  rebate := CASE
              WHEN v_cfg.rebate_87a_threshold IS NOT NULL
               AND v_income <= v_cfg.rebate_87a_threshold
              THEN LEAST(slab, COALESCE(v_cfg.rebate_87a_amount, slab))
              ELSE 0 END;

  -- … and marginal relief protects the income just ABOVE it: tax there cannot
  -- exceed the income above the threshold. Only meaningful when the rebate did
  -- NOT apply (income over the threshold) and slab tax exists.
  rebate_relief := 0;
  IF rebate = 0 AND v_cfg.rebate_87a_threshold IS NOT NULL AND slab > 0 THEN
    rebate_relief := GREATEST(0, LEAST(slab, slab - (v_income - v_cfg.rebate_87a_threshold)));
  END IF;

  v_after_rebate := GREATEST(0, slab - rebate - rebate_relief);

  -- §11 surcharge, then its own marginal relief at whichever threshold this
  -- income just crossed.
  SELECT sc.income_min, sc.surcharge_rate INTO v_band
    FROM surcharge_slabs sc
   WHERE upper(sc.regime) = upper(COALESCE(p_regime,'NEW'))
     AND v_income > sc.income_min
     AND (sc.income_max IS NULL OR v_income <= sc.income_max)
     AND sc.effective_from <= p_on
     AND (sc.effective_to IS NULL OR sc.effective_to >= p_on)
   ORDER BY sc.income_min DESC LIMIT 1;

  surcharge := ROUND(COALESCE(v_after_rebate * v_band.surcharge_rate / 100, 0));
  surcharge_relief := 0;

  IF v_band.surcharge_rate > 0 THEN
    SELECT sc.surcharge_rate INTO v_prev_rate
      FROM surcharge_slabs sc
     WHERE upper(sc.regime) = upper(COALESCE(p_regime,'NEW'))
       AND sc.income_max = v_band.income_min
       AND sc.effective_from <= p_on
       AND (sc.effective_to IS NULL OR sc.effective_to >= p_on)
     LIMIT 1;
    v_prev_rate := COALESCE(v_prev_rate, 0);

    IF v_band.surcharge_rate > v_prev_rate THEN
      -- Tax-plus-surcharge at the exact threshold, using the RATE THAT APPLIED
      -- there (the band below), plus every rupee of income past it — that is
      -- the most this income may be made to pay.
      v_uncapped := v_after_rebate + surcharge;
      v_capped   := ROUND(tds_slab_tax(v_band.income_min, p_regime, p_on, p_age_category))
                    * (1 + v_prev_rate / 100)
                  + (v_income - v_band.income_min);
      IF v_uncapped > v_capped THEN
        surcharge_relief := ROUND(v_uncapped - v_capped);
        surcharge := GREATEST(0, surcharge - surcharge_relief);
      END IF;
    END IF;
  END IF;

  cess  := ROUND((v_after_rebate + surcharge) * 0.04);
  total := v_after_rebate + surcharge + cess;
END $$;
COMMENT ON FUNCTION tds_annual_tax(NUMERIC, TEXT, DATE, TEXT) IS
  'Annual tax with both marginal reliefs applied — the New Regime 87A cliff near '
  '12L, and every surcharge threshold (50L / 1Cr / 2Cr / 5Cr). rebate_relief and '
  'surcharge_relief are broken out so a payslip can show WHY the number is what '
  'it is, not just what it is.';


-- ════════════════════════════════════════════════════════════════════════════
-- 9) sync_month_tds — every section of the spec in one place. Everything from
--    062/063 is unchanged (arrear as actual income, PT, LTA, the DOL-month
--    fraction); this adds age-aware slabs, perquisites, the §17(2)(vii) cap,
--    house property, previous employer, the rest of Chapter VI-A, §7 other
--    income, the LTA block cap, and marginal relief.
-- ════════════════════════════════════════════════════════════════════════════
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

  -- %ROWTYPE, not RECORD — its field list is fixed at compile time, so an
  -- employee with no tds_declarations row yet still leaves every v_decl.x
  -- access returning NULL (which COALESCE handles below) instead of raising
  -- "record v_decl is not assigned yet". A bare RECORD only gets that safety
  -- once it has matched a row at least once, which most employees never will.
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
  v_er_contrib_cap    CONSTANT NUMERIC := 750000;   -- §17(2)(vii), combined EPF + NPS + superannuation
  v_hp_setoff_cap     CONSTANT NUMERIC := 200000;   -- §6.3, salary set-off cap on a house-property loss
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
           COALESCE(SUM(COALESCE(p.employer_nps,0)), 0)
      INTO v_actual, v_arr_ytd, v_paid, v_pt_ytd, v_er_epf_ytd, v_er_nps_ytd
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

    -- §17(2)(vii) — employer EPF + NPS, annualised the same actual + current +
    -- projected way as income, against the combined cap. Superannuation is not
    -- on this schema, so it is not part of the sum — flagged, not guessed.
    v_er_contrib_annual := COALESCE(v_er_epf_ytd,0) + COALESCE(v_er_nps_ytd,0)
                         + COALESCE(r.epf_employer_total,0) + COALESCE(r.employer_nps,0)
                         + v_projm * (COALESCE(r.epf_employer_total,0) + COALESCE(r.employer_nps,0));
    v_er_excess := GREATEST(0, v_er_contrib_annual - v_er_contrib_cap);

    -- Perquisites — §4. Applies in BOTH regimes. Reads the summary view the
    -- perquisite tables already had; nothing computes an amount that was never
    -- entered against an employee in employee_perquisites.
    SELECT COALESCE(total_perquisite_amount, 0) INTO v_perq
      FROM employee_perquisite_summary
     WHERE employee_id = r.employee_id AND fy = v_run.fy;
    v_perq := COALESCE(v_perq, 0) + v_er_excess;

    SELECT * INTO v_decl FROM tds_declarations WHERE employee_id = r.employee_id AND fy = v_run.fy LIMIT 1;

    v_hra := COALESCE(v_decl.hra_claimed, 0);
    v_lta := COALESCE(v_decl.lta_claimed, 0);

    -- §2.2 — two journeys per four-year block (current block starts 2026). A
    -- row only exists once someone has actually used a journey; nobody without
    -- one is capped.
    SELECT * INTO v_lta_block FROM tds_lta_block_usage
     WHERE employee_id = r.employee_id AND block_start_year = 2026 LIMIT 1;
    IF FOUND THEN
      v_lta_allowed := 2 + CASE WHEN v_lta_block.carried_forward THEN 1 ELSE 0 END;
      IF v_lta_block.journeys_used >= v_lta_allowed THEN v_lta := 0; END IF;
    END IF;

    -- House property — §6. tds_house_property, once anyone has a row, supersedes
    -- the flat sec_24b entirely: it is the real computation, not an
    -- approximation of it.
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
      -- Old Regime: a combined loss sets off against salary up to the cap; a net
      -- gain flows through in full. New Regime: only a net GAIN counts — a loss
      -- cannot be set off against salary at all (§6.5), so it carries forward on
      -- the employee's own return instead of touching this employer's TDS.
      IF v_regime = 'NEW' THEN
        v_hp := GREATEST(v_hp, 0);
      ELSIF v_hp < 0 THEN
        v_hp := GREATEST(v_hp, -v_hp_setoff_cap);
      END IF;
    ELSE
      v_hp := CASE WHEN v_regime = 'OLD' THEN LEAST(COALESCE(v_decl.sec_24b,0), v_hp_setoff_cap) * -1 ELSE 0 END;
    END IF;

    -- §7 — income from other sources. 80TTA/80TTB is taken against the
    -- savings-interest slice of it, mutually exclusive by age rather than by a
    -- flag: a senior gets 80TTB, everyone else gets 80TTA, never both.
    v_other_income := COALESCE(v_decl.income_interest_savings,0) + COALESCE(v_decl.income_interest_fd,0)
                     + COALESCE(v_decl.income_dividend,0) + COALESCE(v_decl.income_other,0);
    v_80tta_ttb := LEAST(COALESCE(v_decl.income_interest_savings,0),
                         CASE WHEN v_age <> 'BELOW_60' THEN 50000 ELSE 10000 END);

    -- Previous employer — §15.2 / Form 12B. Income joins the annual figure; TDS
    -- already deducted there is credited the same way this FY's own
    -- already-deducted TDS is.
    SELECT taxable_income, tds_deducted INTO v_prev_income, v_prev_tds
      FROM tds_previous_employer WHERE employee_id = r.employee_id AND fy = v_run.fy;
    v_prev_income := COALESCE(v_prev_income, 0);
    v_prev_tds    := COALESCE(v_prev_tds, 0);

    v_annual := v_actual + v_curr + v_arr + v_proj + v_perq + v_other_income + v_prev_income + v_hp;

    v_months := GREATEST(1, LEAST(v_dolm, 12) - v_run.month + 1);

    -- §8 Chapter VI-A — every section, Old Regime only. Granular 80D only takes
    -- over from the flat sec_80d once the employee actually uses it, so an
    -- existing declaration with just sec_80d keeps behaving exactly as it did.
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

    -- 80GG — only where HRA is not received at all (§8.5, mutually exclusive
    -- with §2.1 on purpose). Rent comes off the same monthly_rent the HRA side
    -- of the declaration already collects.
    IF v_hra = 0 AND v_regime = 'OLD' AND COALESCE(v_decl.monthly_rent,0) > 0 THEN
      v_via := v_via + LEAST(60000, GREATEST(0, (COALESCE(v_decl.monthly_rent,0) * 12) - 0.10 * v_annual));
    END IF;

    -- 80G — off by default (companies.allow_80g_in_payroll), and even switched
    -- on this is the conservative 10%-of-gross reading, not the real
    -- donee-specific 50%/100% test — see the top of this file.
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

    -- Under the new regime only 80CCD(2) survives — HRA, LTA, PT and every
    -- other Chapter VI-A section above do not apply.
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
                                     THEN ' · surcharge marginal relief ' || ROUND(t1.surcharge_relief)::TEXT ELSE '' END,
      synced_at = now()
    WHERE run_id = p_run_id AND employee_id = r.employee_id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END $$;


-- ════════════════════════════════════════════════════════════════════════════
-- 10) save_investment_declaration — extended with every new field above,
--     appended after the existing parameters so any positional caller still
--     works unchanged. The employee-facing form (InvestmentDeclaration.tsx)
--     calls this by name, not position, so order here is for readability only.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION save_investment_declaration(
  p_employee_id UUID, p_fy TEXT, p_regime TEXT,
  p_sec_80c NUMERIC DEFAULT 0, p_sec_80d NUMERIC DEFAULT 0, p_sec_80e NUMERIC DEFAULT 0,
  p_sec_24b NUMERIC DEFAULT 0, p_hra_claimed NUMERIC DEFAULT 0, p_lta_claimed NUMERIC DEFAULT 0,
  p_nps NUMERIC DEFAULT 0, p_monthly_rent NUMERIC DEFAULT 0, p_landlord_pan TEXT DEFAULT NULL,
  p_submit BOOLEAN DEFAULT false,
  p_sec_80d_self NUMERIC DEFAULT NULL, p_sec_80d_parents NUMERIC DEFAULT NULL,
  p_sec_80d_parents_senior BOOLEAN DEFAULT NULL, p_sec_80d_preventive NUMERIC DEFAULT NULL,
  p_sec_80dd NUMERIC DEFAULT NULL, p_sec_80dd_severe BOOLEAN DEFAULT NULL,
  p_sec_80ddb NUMERIC DEFAULT NULL, p_sec_80eeb NUMERIC DEFAULT NULL, p_sec_80g NUMERIC DEFAULT NULL,
  p_sec_80u NUMERIC DEFAULT NULL, p_sec_80u_severe BOOLEAN DEFAULT NULL,
  p_sec_80e_first_repayment_year INTEGER DEFAULT NULL,
  p_income_interest_savings NUMERIC DEFAULT NULL, p_income_interest_fd NUMERIC DEFAULT NULL,
  p_income_dividend NUMERIC DEFAULT NULL, p_income_other NUMERIC DEFAULT NULL
) RETURNS TABLE (declaration_id UUID, action TEXT, regime_locked BOOLEAN) LANGUAGE plpgsql AS $$
DECLARE
  v_existing tds_declarations%ROWTYPE;
  v_company  UUID;
  v_switches INTEGER := 0;
  v_locked   TIMESTAMPTZ;
  v_id       UUID;
  v_action   TEXT;
BEGIN
  SELECT company_id INTO v_company FROM employees WHERE id = p_employee_id;
  SELECT * INTO v_existing FROM tds_declarations WHERE employee_id = p_employee_id AND fy = p_fy;

  IF p_landlord_pan IS NULL AND landlord_pan_required(p_monthly_rent) THEN
    RAISE EXCEPTION 'Landlord PAN zaroori hai — saal ka rent ₹1,00,000 se zyada hai.';
  END IF;

  IF FOUND AND v_existing.regime IS DISTINCT FROM p_regime THEN
    IF NOT can_switch_regime(p_fy, v_existing.regime_switches, v_existing.regime_locked_at) THEN
      RAISE EXCEPTION 'Regime ab nahi badal sakta — ek baar badla ja chuka hai ya January nikal gayi.';
    END IF;
    v_switches := COALESCE(v_existing.regime_switches, 0) + 1;
    v_locked   := now();
  ELSIF FOUND THEN
    v_switches := COALESCE(v_existing.regime_switches, 0);
    v_locked   := v_existing.regime_locked_at;
  END IF;

  INSERT INTO tds_declarations (
    employee_id, company_id, fy, regime, sec_80c, sec_80d, sec_80e, sec_24b,
    hra_claimed, lta_claimed, nps_80ccd1b, monthly_rent, landlord_pan,
    total_declared, declaration_status, regime_switches, regime_locked_at, submitted_at,
    sec_80d_self, sec_80d_parents, sec_80d_parents_senior, sec_80d_preventive,
    sec_80dd, sec_80dd_severe, sec_80ddb, sec_80eeb, sec_80g, sec_80u, sec_80u_severe,
    sec_80e_first_repayment_year,
    income_interest_savings, income_interest_fd, income_dividend, income_other
  ) VALUES (
    p_employee_id, v_company, p_fy, p_regime,
    LEAST(COALESCE(p_sec_80c, 0), 150000),
    COALESCE(p_sec_80d, 0), COALESCE(p_sec_80e, 0), COALESCE(p_sec_24b, 0),
    COALESCE(p_hra_claimed, 0), COALESCE(p_lta_claimed, 0), COALESCE(p_nps, 0),
    COALESCE(p_monthly_rent, 0), p_landlord_pan,
    LEAST(COALESCE(p_sec_80c, 0), 150000) + COALESCE(p_sec_80d, 0),
    CASE WHEN p_submit THEN 'SUBMITTED' ELSE 'DRAFT' END,
    v_switches, v_locked,
    CASE WHEN p_submit THEN now() ELSE NULL END,
    p_sec_80d_self, p_sec_80d_parents, p_sec_80d_parents_senior, p_sec_80d_preventive,
    p_sec_80dd, p_sec_80dd_severe, p_sec_80ddb, p_sec_80eeb, p_sec_80g, p_sec_80u, p_sec_80u_severe,
    p_sec_80e_first_repayment_year,
    p_income_interest_savings, p_income_interest_fd, p_income_dividend, p_income_other
  )
  ON CONFLICT (employee_id, fy) DO UPDATE SET
    regime = EXCLUDED.regime, sec_80c = EXCLUDED.sec_80c, sec_80d = EXCLUDED.sec_80d,
    sec_80e = EXCLUDED.sec_80e, sec_24b = EXCLUDED.sec_24b,
    hra_claimed = EXCLUDED.hra_claimed, lta_claimed = EXCLUDED.lta_claimed,
    nps_80ccd1b = EXCLUDED.nps_80ccd1b, monthly_rent = EXCLUDED.monthly_rent,
    landlord_pan = EXCLUDED.landlord_pan, total_declared = EXCLUDED.total_declared,
    declaration_status = EXCLUDED.declaration_status,
    regime_switches = EXCLUDED.regime_switches, regime_locked_at = EXCLUDED.regime_locked_at,
    submitted_at = COALESCE(EXCLUDED.submitted_at, tds_declarations.submitted_at),
    sec_80d_self = EXCLUDED.sec_80d_self, sec_80d_parents = EXCLUDED.sec_80d_parents,
    sec_80d_parents_senior = EXCLUDED.sec_80d_parents_senior, sec_80d_preventive = EXCLUDED.sec_80d_preventive,
    sec_80dd = EXCLUDED.sec_80dd, sec_80dd_severe = EXCLUDED.sec_80dd_severe,
    sec_80ddb = EXCLUDED.sec_80ddb, sec_80eeb = EXCLUDED.sec_80eeb, sec_80g = EXCLUDED.sec_80g,
    sec_80u = EXCLUDED.sec_80u, sec_80u_severe = EXCLUDED.sec_80u_severe,
    sec_80e_first_repayment_year = EXCLUDED.sec_80e_first_repayment_year,
    income_interest_savings = EXCLUDED.income_interest_savings, income_interest_fd = EXCLUDED.income_interest_fd,
    income_dividend = EXCLUDED.income_dividend, income_other = EXCLUDED.income_other,
    updated_at = now()
  RETURNING id INTO v_id;

  v_action := CASE WHEN v_existing.id IS NULL THEN 'CREATED' ELSE 'UPDATED' END;
  RETURN QUERY SELECT v_id, v_action, v_locked IS NOT NULL;
END $$;


-- ════════════════════════════════════════════════════════════════════════════
-- 10a) House property, previous employer and LTA-block — small upsert/delete
--      RPCs so the ESS screen has something to call. Kept separate from the
--      declaration RPC above: these are naturally multi-row (a person can have
--      two properties) or one-time (a mid-year joiner's Form 12B), not a
--      single per-FY form field.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION save_tds_house_property(
  p_id UUID DEFAULT NULL, p_employee_id UUID DEFAULT NULL, p_fy TEXT DEFAULT NULL,
  p_occupancy_type TEXT DEFAULT 'SELF', p_address TEXT DEFAULT NULL,
  p_annual_rent_received NUMERIC DEFAULT 0, p_municipal_taxes_paid NUMERIC DEFAULT 0,
  p_interest_on_loan NUMERIC DEFAULT 0, p_pre_construction_interest NUMERIC DEFAULT 0,
  p_lender_name TEXT DEFAULT NULL, p_lender_pan TEXT DEFAULT NULL, p_lender_address TEXT DEFAULT NULL,
  p_co_owner_share_pct NUMERIC DEFAULT NULL, p_delete BOOLEAN DEFAULT false
) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v_id UUID;
BEGIN
  IF p_delete THEN
    DELETE FROM tds_house_property WHERE id = p_id AND employee_id = p_employee_id;
    RETURN p_id;
  END IF;

  IF (p_occupancy_type IN ('LET_OUT','DEEMED_LET_OUT')) AND (p_lender_pan IS NULL OR p_lender_pan = '')
     AND p_interest_on_loan > 0 THEN
    RAISE EXCEPTION 'Lender PAN zaroori hai — koi bhi housing loan ke liye.';
  END IF;

  IF p_id IS NOT NULL THEN
    UPDATE tds_house_property SET
      occupancy_type = p_occupancy_type, address = p_address,
      annual_rent_received = COALESCE(p_annual_rent_received,0), municipal_taxes_paid = COALESCE(p_municipal_taxes_paid,0),
      interest_on_loan = COALESCE(p_interest_on_loan,0), pre_construction_interest = COALESCE(p_pre_construction_interest,0),
      lender_name = p_lender_name, lender_pan = p_lender_pan, lender_address = p_lender_address,
      co_owner_share_pct = p_co_owner_share_pct, updated_at = now()
    WHERE id = p_id AND employee_id = p_employee_id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO tds_house_property (
      employee_id, fy, occupancy_type, address, annual_rent_received, municipal_taxes_paid,
      interest_on_loan, pre_construction_interest, lender_name, lender_pan, lender_address, co_owner_share_pct
    ) VALUES (
      p_employee_id, p_fy, p_occupancy_type, p_address, COALESCE(p_annual_rent_received,0), COALESCE(p_municipal_taxes_paid,0),
      COALESCE(p_interest_on_loan,0), COALESCE(p_pre_construction_interest,0), p_lender_name, p_lender_pan, p_lender_address,
      p_co_owner_share_pct
    ) RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION save_tds_previous_employer(
  p_employee_id UUID, p_fy TEXT, p_taxable_income NUMERIC DEFAULT 0, p_tds_deducted NUMERIC DEFAULT 0,
  p_pf_deducted NUMERIC DEFAULT 0, p_professional_tax NUMERIC DEFAULT 0
) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO tds_previous_employer (employee_id, fy, taxable_income, tds_deducted, pf_deducted, professional_tax)
  VALUES (p_employee_id, p_fy, COALESCE(p_taxable_income,0), COALESCE(p_tds_deducted,0),
          COALESCE(p_pf_deducted,0), COALESCE(p_professional_tax,0))
  ON CONFLICT (employee_id, fy) DO UPDATE SET
    taxable_income = EXCLUDED.taxable_income, tds_deducted = EXCLUDED.tds_deducted,
    pf_deducted = EXCLUDED.pf_deducted, professional_tax = EXCLUDED.professional_tax, updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION save_tds_lta_block_usage(
  p_employee_id UUID, p_block_start_year INTEGER DEFAULT 2026,
  p_journeys_used INTEGER DEFAULT 0, p_carried_forward BOOLEAN DEFAULT false
) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO tds_lta_block_usage (employee_id, block_start_year, journeys_used, carried_forward)
  VALUES (p_employee_id, p_block_start_year, COALESCE(p_journeys_used,0), COALESCE(p_carried_forward,false))
  ON CONFLICT (employee_id, block_start_year) DO UPDATE SET
    journeys_used = EXCLUDED.journeys_used, carried_forward = EXCLUDED.carried_forward, updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;


-- ════════════════════════════════════════════════════════════════════════════
-- 11) Schema cache
-- ════════════════════════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════════════
-- 12) VERIFY — every row must read true
-- ════════════════════════════════════════════════════════════════════════════
SELECT 'tds_house_property table' AS item, EXISTS (
  SELECT 1 FROM information_schema.tables WHERE table_name='tds_house_property') AS ok
UNION ALL SELECT 'tds_previous_employer table', EXISTS (
  SELECT 1 FROM information_schema.tables WHERE table_name='tds_previous_employer')
UNION ALL SELECT 'tds_lta_block_usage table', EXISTS (
  SELECT 1 FROM information_schema.tables WHERE table_name='tds_lta_block_usage')
UNION ALL SELECT 'companies.allow_80g_in_payroll column', EXISTS (
  SELECT 1 FROM information_schema.columns WHERE table_name='companies' AND column_name='allow_80g_in_payroll')
UNION ALL SELECT 'tds_age_category()', EXISTS (SELECT 1 FROM pg_proc WHERE proname='tds_age_category')
UNION ALL SELECT 'tds_slab_tax() is age-aware', EXISTS (
  SELECT 1 FROM pg_proc WHERE proname='tds_slab_tax' AND pronargs = 4)
UNION ALL SELECT 'tds_annual_tax() has marginal relief', EXISTS (
  SELECT 1 FROM pg_proc WHERE proname='tds_annual_tax'
    AND pg_get_functiondef(oid) LIKE '%rebate_relief%' AND pg_get_functiondef(oid) LIKE '%surcharge_relief%')
UNION ALL SELECT 'sync_month_tds() reads perquisites', (
  SELECT bool_or(pg_get_functiondef(oid) LIKE '%employee_perquisite_summary%') FROM pg_proc WHERE proname='sync_month_tds')
UNION ALL SELECT 'sync_month_tds() reads house property', (
  SELECT bool_or(pg_get_functiondef(oid) LIKE '%tds_house_property%') FROM pg_proc WHERE proname='sync_month_tds')
UNION ALL SELECT 'sync_month_tds() reads previous employer', (
  SELECT bool_or(pg_get_functiondef(oid) LIKE '%tds_previous_employer%') FROM pg_proc WHERE proname='sync_month_tds')
UNION ALL SELECT 'sync_month_tds() reads §17(2)(vii) cap', (
  SELECT bool_or(pg_get_functiondef(oid) LIKE '%v_er_contrib_cap%') FROM pg_proc WHERE proname='sync_month_tds')
UNION ALL SELECT 'save_investment_declaration() accepts the new fields', EXISTS (
  SELECT 1 FROM pg_proc WHERE proname='save_investment_declaration' AND pronargs = 29)
UNION ALL SELECT 'save_tds_house_property()', EXISTS (SELECT 1 FROM pg_proc WHERE proname='save_tds_house_property')
UNION ALL SELECT 'save_tds_previous_employer()', EXISTS (SELECT 1 FROM pg_proc WHERE proname='save_tds_previous_employer')
UNION ALL SELECT 'save_tds_lta_block_usage()', EXISTS (SELECT 1 FROM pg_proc WHERE proname='save_tds_lta_block_usage');

-- Age-aware slab sanity: a super-senior (80+), Old Regime, no other exemptions —
-- ₹5,00,000 of the first slab is nil for them where it would not be for anyone
-- younger, so this must NOT equal the BELOW_60 figure for the same income.
SELECT 'spec check: super-senior 6L old regime taxed differently from BELOW_60' AS test,
       (SELECT total FROM tds_annual_tax(600000 - 50000, 'OLD', DATE '2026-04-01', 'SUPER_SENIOR_80_PLUS')) AS super_senior_got,
       (SELECT total FROM tds_annual_tax(600000 - 50000, 'OLD', DATE '2026-04-01', 'BELOW_60')) AS below_60_got;

-- The 062/063 spec example must still tie out — none of this should have moved
-- a figure that has no perquisites, no house property, nobody senior, and no
-- previous employer behind it.
SELECT 'spec check: 24L new regime unchanged' AS test,
       (SELECT total FROM tds_annual_tax(2400000 - 75000, 'NEW', DATE '2026-04-01')) AS got,
       292500 AS expected;


-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ════════════════════════════════════════════════════════════════════════════
-- To go back to 063's version of the engine, re-run 063_tds_engine_gaps.sql —
-- its CREATE OR REPLACE FUNCTION sync_month_tds(...) will overwrite this one.
-- Its tds_annual_tax(NUMERIC, TEXT, DATE) call sites expect the OLD five-field
-- shape, so also run:
--   DROP FUNCTION IF EXISTS tds_annual_tax(NUMERIC, TEXT, DATE, TEXT);
--   CREATE OR REPLACE FUNCTION tds_annual_tax(
--     p_taxable NUMERIC, p_regime TEXT, p_on DATE,
--     OUT slab NUMERIC, OUT rebate NUMERIC, OUT surcharge NUMERIC, OUT cess NUMERIC, OUT total NUMERIC
--   ) LANGUAGE plpgsql STABLE AS $$
--   -- (the 062 body — see supabase/migrations/062_tds_engine.sql section 4)
--   $$;
-- DROP FUNCTION IF EXISTS tds_age_category(DATE, TEXT);
-- DROP FUNCTION IF EXISTS save_tds_house_property(UUID,UUID,TEXT,TEXT,TEXT,NUMERIC,NUMERIC,NUMERIC,NUMERIC,TEXT,TEXT,TEXT,NUMERIC,BOOLEAN);
-- DROP FUNCTION IF EXISTS save_tds_previous_employer(UUID,TEXT,NUMERIC,NUMERIC,NUMERIC,NUMERIC);
-- DROP FUNCTION IF EXISTS save_tds_lta_block_usage(UUID,INTEGER,INTEGER,BOOLEAN);
-- -- save_investment_declaration: re-run sql99_four_modules.txt's original 13-arg version.
-- DROP TABLE IF EXISTS tds_lta_block_usage;
-- DROP TABLE IF EXISTS tds_previous_employer;
-- DROP TABLE IF EXISTS tds_house_property;
-- ALTER TABLE companies DROP COLUMN IF EXISTS allow_80g_in_payroll;
-- ALTER TABLE payroll_employee_snapshot
--   DROP COLUMN IF EXISTS tds_age_category,   DROP COLUMN IF EXISTS tds_perquisites,
--   DROP COLUMN IF EXISTS tds_employer_contrib_excess, DROP COLUMN IF EXISTS tds_house_property,
--   DROP COLUMN IF EXISTS tds_other_income,   DROP COLUMN IF EXISTS tds_prev_employer_income,
--   DROP COLUMN IF EXISTS tds_prev_employer_tds, DROP COLUMN IF EXISTS tds_marginal_relief_87a,
--   DROP COLUMN IF EXISTS tds_marginal_relief_surcharge;
-- ALTER TABLE tds_declarations
--   DROP COLUMN IF EXISTS sec_80d_self, DROP COLUMN IF EXISTS sec_80d_parents,
--   DROP COLUMN IF EXISTS sec_80d_parents_senior, DROP COLUMN IF EXISTS sec_80d_preventive,
--   DROP COLUMN IF EXISTS sec_80dd, DROP COLUMN IF EXISTS sec_80dd_severe,
--   DROP COLUMN IF EXISTS sec_80ddb, DROP COLUMN IF EXISTS sec_80eeb, DROP COLUMN IF EXISTS sec_80g,
--   DROP COLUMN IF EXISTS sec_80u, DROP COLUMN IF EXISTS sec_80u_severe,
--   DROP COLUMN IF EXISTS sec_80e_first_repayment_year,
--   DROP COLUMN IF EXISTS income_interest_savings, DROP COLUMN IF EXISTS income_interest_fd,
--   DROP COLUMN IF EXISTS income_dividend, DROP COLUMN IF EXISTS income_other;
-- ════════════════════════════════════════════════════════════════════════════
