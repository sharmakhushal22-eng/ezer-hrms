-- ============================================================
-- 032_employee_master_gaps.sql — EZER HRMS · Employee-master gap fill (additive)
-- Adds the onboarding/payroll/compliance columns the master was missing (Gaps 1 & 3),
-- extends the existing 024 child tables, and creates employee_nominees (EPF Form 2 /
-- ESIC / gratuity nomination).
--
-- SAFE & ADDITIVE ONLY — every change is ADD COLUMN IF NOT EXISTS / CREATE IF NOT EXISTS.
-- Deliberately NOT included (separate, carefully-planned tasks): Aadhaar/bank full-number
-- encryption, and reporting_manager_id text→UUID migration.
-- Idempotent — safe to re-run. HOW TO RUN: Supabase → SQL Editor → paste → Run.
-- ============================================================

-- ── employees: onboarding-collected fields (Gap 1) ──────────────────
ALTER TABLE employees ADD COLUMN IF NOT EXISTS highest_qualification  TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS institution_name       TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS previous_uan           TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS spouse_name            TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS pf_existing_member     BOOLEAN;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS pf_scheme_certificate  TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS hobbies                TEXT[];

-- ── employees: payroll / compliance / posting fields (Gap 3) ────────
-- NOTE: plain UUID, NOT a FK. A 2nd foreign key from employees→locations makes
-- PostgREST's embedded `locations(...)` queries ambiguous ("more than one
-- relationship found"), which breaks the Employee Master + ESS. Keep it unconstrained.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS actual_posted_location_id UUID;
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_actual_posted_location_id_fkey;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS actual_posted_state       TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS actual_posted_district    TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS lwf_applicable            BOOLEAN;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS lwf_state                 TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS gratuity_eligible         BOOLEAN;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS gratuity_eligible_date    DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS pf_wage_type              TEXT;   -- BASIC_DA | GROSS_MINUS_HRA
ALTER TABLE employees ADD COLUMN IF NOT EXISTS tds_regime                TEXT;   -- OLD | NEW
ALTER TABLE employees ADD COLUMN IF NOT EXISTS investment_declared_amount NUMERIC(14,2);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS professional_tax_state    TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS cost_centre               TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS shift_type                TEXT;   -- GENERAL | SHIFT_A | SHIFT_B

-- ── Extend existing 024 child tables (don't recreate) ───────────────
-- employee_education: add academic level / board / score
ALTER TABLE employee_education ADD COLUMN IF NOT EXISTS level            TEXT;   -- 10th|12th|Graduation|PG
ALTER TABLE employee_education ADD COLUMN IF NOT EXISTS board_university TEXT;
ALTER TABLE employee_education ADD COLUMN IF NOT EXISTS percentage_grade TEXT;

-- employee_family (ESIC Form 1): add gender + esic eligibility
ALTER TABLE employee_family ADD COLUMN IF NOT EXISTS gender        TEXT;
ALTER TABLE employee_family ADD COLUMN IF NOT EXISTS esic_eligible BOOLEAN;

-- employee_experience (= previous employers, Form 11 / BGV): add prev PF details
ALTER TABLE employee_experience ADD COLUMN IF NOT EXISTS prev_uan      TEXT;
ALTER TABLE employee_experience ADD COLUMN IF NOT EXISTS prev_pf_office TEXT;

-- ── New table: employee_nominees (EPF Form 2 + ESIC + gratuity) ─────
CREATE TABLE IF NOT EXISTS employee_nominees (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  name         TEXT,
  relation     TEXT,
  dob          DATE,
  share_pct    NUMERIC(5,2),
  nominee_type TEXT,                 -- EPF | ESIC | GRATUITY
  aadhaar_no   TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_emp_nominee_emp ON employee_nominees(employee_id);

-- RLS (project standard permissive)
ALTER TABLE employee_nominees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_employee_nominees" ON employee_nominees;
CREATE POLICY "allow_all_employee_nominees" ON employee_nominees
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

notify pgrst, 'reload schema';
