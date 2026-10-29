-- 167_international_onboarding.sql — international hiring tracks (19-Oct-2026).
--
-- An onboarding now runs on a hiring track chosen when the link is sent:
--   DOMESTIC          today's flow
--   FOREIGN_IN_INDIA  foreign national joining the Indian entity (visa, FRRO, PF as an
--                     International Worker unless an SSA certificate exempts them)
--   OVERSEAS          employee working outside India (foreign entity / EOR), outside the
--                     Indian payroll run, no Indian statutory
-- The track, the work country, the payroll currency and the employing entity ride on the
-- candidate and land on the employee record at code generation, together with the
-- immigration facts the candidate typed (passport / visa / work permit / FRRO / SSA) and
-- what the heads confirmed. The immigration tracker and its reminders read the employee
-- columns (lib/onboarding/hiring-track.ts, /api/cron/immigration-reminders).

ALTER TABLE onboarding_candidates
  ADD COLUMN IF NOT EXISTS hiring_track      TEXT NOT NULL DEFAULT 'DOMESTIC',
  ADD COLUMN IF NOT EXISTS work_country      TEXT,
  ADD COLUMN IF NOT EXISTS payroll_currency  TEXT DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS employing_entity  TEXT,
  -- what the heads confirm on their checklists (lib/onboarding/checklists.ts)
  ADD COLUMN IF NOT EXISTS pf_international_worker BOOLEAN,
  ADD COLUMN IF NOT EXISTS ssa_exempt        BOOLEAN,
  ADD COLUMN IF NOT EXISTS pan_pending       BOOLEAN,
  ADD COLUMN IF NOT EXISTS paid_outside_india BOOLEAN,
  ADD COLUMN IF NOT EXISTS frro_done         BOOLEAN,
  ADD COLUMN IF NOT EXISTS visa_checked      BOOLEAN,
  ADD COLUMN IF NOT EXISTS contract_signed   BOOLEAN;

DO $$ BEGIN
  ALTER TABLE onboarding_candidates ADD CONSTRAINT onboarding_candidates_hiring_track_chk
    CHECK (hiring_track IN ('DOMESTIC', 'FOREIGN_IN_INDIA', 'OVERSEAS'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS hiring_track          TEXT NOT NULL DEFAULT 'DOMESTIC',
  ADD COLUMN IF NOT EXISTS work_country          TEXT,
  ADD COLUMN IF NOT EXISTS payroll_currency      TEXT DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS employing_entity      TEXT,
  ADD COLUMN IF NOT EXISTS paid_outside_india    BOOLEAN NOT NULL DEFAULT false,
  -- immigration (foreign nationals in India; passport for overseas too)
  ADD COLUMN IF NOT EXISTS passport_country      TEXT,
  ADD COLUMN IF NOT EXISTS passport_expiry       DATE,
  ADD COLUMN IF NOT EXISTS visa_type             TEXT,
  ADD COLUMN IF NOT EXISTS visa_number           TEXT,
  ADD COLUMN IF NOT EXISTS visa_expiry           DATE,
  ADD COLUMN IF NOT EXISTS work_permit_number    TEXT,
  ADD COLUMN IF NOT EXISTS work_permit_expiry    DATE,
  ADD COLUMN IF NOT EXISTS india_entry_date      DATE,
  ADD COLUMN IF NOT EXISTS frro_number           TEXT,
  ADD COLUMN IF NOT EXISTS frro_date             DATE,
  ADD COLUMN IF NOT EXISTS frro_due_date         DATE,
  -- tax & social security
  ADD COLUMN IF NOT EXISTS tax_residency_status  TEXT,
  ADD COLUMN IF NOT EXISTS tax_residency_country TEXT,
  ADD COLUMN IF NOT EXISTS foreign_tin           TEXT,
  ADD COLUMN IF NOT EXISTS local_tax_id          TEXT,
  ADD COLUMN IF NOT EXISTS pan_pending           BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS international_employee BOOLEAN,
  ADD COLUMN IF NOT EXISTS certificate_of_coverage TEXT,
  ADD COLUMN IF NOT EXISTS ssa_country           TEXT,
  ADD COLUMN IF NOT EXISTS ssa_coc_expiry        DATE,
  -- overseas bank
  ADD COLUMN IF NOT EXISTS bank_iban             TEXT,
  ADD COLUMN IF NOT EXISTS bank_swift            TEXT,
  ADD COLUMN IF NOT EXISTS bank_country          TEXT;

CREATE INDEX IF NOT EXISTS idx_employees_hiring_track ON employees (hiring_track) WHERE hiring_track <> 'DOMESTIC';

-- Reminders already sent, so a 30-day warning is not repeated by the next run.
CREATE TABLE IF NOT EXISTS immigration_reminders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,          -- passport | visa | work_permit | frro | ssa_coc
  due_on      DATE NOT NULL,
  days_before INTEGER NOT NULL,       -- 60 | 30 | 7 | 0
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, kind, due_on, days_before)
);
ALTER TABLE immigration_reminders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_immigration_reminders" ON immigration_reminders;
CREATE POLICY "allow_all_immigration_reminders" ON immigration_reminders FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
