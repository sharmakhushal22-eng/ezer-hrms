-- =====================================================================
-- EZER HRMS — 077: the rest of the company profile
--
-- Adds the fields the company master was asked to hold and did not. Roughly
-- two thirds of the requested profile already existed and only needed
-- displaying — name, code, type, industry, CIN, PAN, TAN, GST, logo,
-- addresses, branches, coordinates, departments, cost centres, bank
-- accounts, and the whole statutory register. This file is the remainder.
--
-- ALL ADD COLUMN IF NOT EXISTS, all nullable, no defaults that rewrite an
-- existing row, no data deleted. One new table.
--
-- ── WHY COLUMNS AND NOT A KEY/VALUE TABLE ──────────────────────────────
-- A settings table keyed on (company, key, value-as-text) would have taken
-- one migration and then cost every reader a cast and a missing-row check.
-- These are a fixed, known set of company attributes with real types —
-- a date is a date, a count is an int — so they are columns.
--
-- The exception is contacts, which is genuinely one-to-many (HR, payroll,
-- admin, and whatever the next one is) and gets its own table rather than
-- seven more columns that cannot grow.
-- =====================================================================


-- ── 1. BASIC ───────────────────────────────────────────────────────────
ALTER TABLE companies ADD COLUMN IF NOT EXISTS duns_number      text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS website_url      text;

-- ── 3. LOCATION ────────────────────────────────────────────────────────
-- Payroll cut-offs and shift boundaries are wall-clock decisions, so the
-- zone belongs to the company rather than being assumed from the server.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS timezone         text DEFAULT 'Asia/Kolkata';

-- ── 5. FINANCIAL ───────────────────────────────────────────────────────
ALTER TABLE companies ADD COLUMN IF NOT EXISTS currency         text DEFAULT 'INR';
-- Stored as a month number, not a date: a financial year starts on the 1st
-- of a month and repeats every year, so a full date would carry a year that
-- is wrong for every year but one. 4 = April, the Indian default.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS fy_start_month   int;

-- ── 6. HIERARCHY ───────────────────────────────────────────────────────
ALTER TABLE companies ADD COLUMN IF NOT EXISTS structure_type   text;
-- Sanctioned positions for the whole company. locations.max_employees
-- already holds the per-site cap; this is the company-level number, and the
-- two are deliberately separate — a company can be sanctioned for more than
-- its sites can seat.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS approved_strength int;

-- ── 7. PAYROLL CONFIGURATION ───────────────────────────────────────────
ALTER TABLE companies ADD COLUMN IF NOT EXISTS payroll_frequency     text;
-- Day-of-month rather than a date, for the same reason as fy_start_month.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS payroll_cycle_start_day int;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS salary_disbursement_day int;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS wc_policy_number      text;

-- ── 8. STATUTORY STATUS ────────────────────────────────────────────────
-- Registered / Not registered / Exempt is a THIRD state, and it is not the
-- same as "we have not entered the number yet" — which is why these are
-- their own columns rather than being inferred from whether epf_code is
-- blank. An exempt establishment is compliant; a blank one is unknown.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS pf_status        text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS esic_status      text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS maternity_compliant boolean;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS dpdp_compliant      boolean;

-- ── 9. HR CONFIGURATION ────────────────────────────────────────────────
ALTER TABLE companies ADD COLUMN IF NOT EXISTS default_employment_type text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS probation_days          int;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS notice_period_days      int;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS max_leave_carryforward  numeric(5,1);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS leave_year_start_month  int;

-- ── 10. BRANDING & CULTURE ─────────────────────────────────────────────
ALTER TABLE companies ADD COLUMN IF NOT EXISTS vision_statement  text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS mission_statement text;
-- An array, not comma-separated text: values are a list and the UI renders
-- them as chips. Splitting a string on commas breaks the first time somebody
-- writes "Integrity, always".
ALTER TABLE companies ADD COLUMN IF NOT EXISTS core_values       text[];
ALTER TABLE companies ADD COLUMN IF NOT EXISTS tagline           text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS brand_primary     text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS brand_secondary   text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS brand_font        text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS linkedin_url      text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS twitter_url       text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS facebook_url      text;


-- ── Sanity constraints ─────────────────────────────────────────────────
-- Added guarded so a re-run does not fail, and written as ranges rather than
-- enumerations where the value is a number — a month is 1..12 in every
-- calendar this will ever see.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_fy_start_month_chk') THEN
    ALTER TABLE companies ADD CONSTRAINT companies_fy_start_month_chk
      CHECK (fy_start_month IS NULL OR fy_start_month BETWEEN 1 AND 12);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_leave_year_month_chk') THEN
    ALTER TABLE companies ADD CONSTRAINT companies_leave_year_month_chk
      CHECK (leave_year_start_month IS NULL OR leave_year_start_month BETWEEN 1 AND 12);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_cycle_day_chk') THEN
    ALTER TABLE companies ADD CONSTRAINT companies_cycle_day_chk
      CHECK (payroll_cycle_start_day IS NULL OR payroll_cycle_start_day BETWEEN 1 AND 31);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_disburse_day_chk') THEN
    ALTER TABLE companies ADD CONSTRAINT companies_disburse_day_chk
      CHECK (salary_disbursement_day IS NULL OR salary_disbursement_day BETWEEN 1 AND 31);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_pf_status_chk') THEN
    ALTER TABLE companies ADD CONSTRAINT companies_pf_status_chk
      CHECK (pf_status IS NULL OR pf_status IN ('REGISTERED','NOT_REGISTERED','EXEMPT'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_esic_status_chk') THEN
    ALTER TABLE companies ADD CONSTRAINT companies_esic_status_chk
      CHECK (esic_status IS NULL OR esic_status IN ('REGISTERED','NOT_REGISTERED','EXEMPT'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_payroll_freq_chk') THEN
    ALTER TABLE companies ADD CONSTRAINT companies_payroll_freq_chk
      CHECK (payroll_frequency IS NULL OR payroll_frequency IN ('MONTHLY','BI_WEEKLY','WEEKLY','FORTNIGHTLY'));
  END IF;
END $$;


-- ── 4. CONTACTS — the one new table ────────────────────────────────────
-- One-to-many on purpose. The brief lists seven contacts (primary, main
-- email, phone, alternate, HR, payroll, admin) and there will be an eighth;
-- seven columns would need a migration every time that happens, and could
-- not hold two payroll contacts for a company that has two.
CREATE TABLE IF NOT EXISTS company_contacts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contact_type text NOT NULL
               CHECK (contact_type IN ('PRIMARY','HR','PAYROLL','ADMIN','FINANCE','IT','OTHER')),
  person_name  text,
  designation  text,
  email        text,
  phone        text,
  alt_phone    text,
  -- The one to ring first when there are several of a type.
  is_primary   boolean NOT NULL DEFAULT false,
  status       text NOT NULL DEFAULT 'Active',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_contacts_company
  ON company_contacts (company_id, contact_type);

-- Follows the house pattern, and carries the same open question as every
-- other table here: this holds names, emails and phone numbers of named
-- people, and is readable by anon like the rest. Flagged for the same RLS
-- decision, not silently made more permissive or more strict than its
-- neighbours.
ALTER TABLE company_contacts ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'company_contacts' AND policyname = 'company_contacts_all'
  ) THEN
    CREATE POLICY company_contacts_all ON company_contacts
      FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;


-- ── 2 & 8. The extra registration types ────────────────────────────────
-- No schema change needed. registrations.reg_type is free text, so FSSAI,
-- ISO, UDYAM, DPIIT, LABOUR, BUSINESS_LICENCE and WC are simply new values.
-- Listed here so the set is written down somewhere:
--
--   GST · EPF · ESIC · PT · LWF        statutory, company-level
--   SE · FACTORY                       establishment, per location
--   FSSAI · ISO · UDYAM · DPIIT        certification / recognition
--   LABOUR · BUSINESS_LICENCE · WC     licences
--
-- The app's REG_TYPES list in lib/supabase-company-profile.ts is the source
-- of what gets a row on screen; adding one there is enough.
-- =====================================================================
