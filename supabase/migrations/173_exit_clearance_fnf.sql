-- =====================================================================
-- 173_exit_clearance_fnf.sql — the rest of the Exit Module (spec v2 §2–§11)
--
--  • hr_exit_requests: Transfer (destination company), supporting documents,
--    the Abscond reminder run (3 weekly reminders before the chain starts),
--    48-hour approval escalation.
--  • exit_clearance: the five department forms (IT / Admin / Finance / HR /
--    HOD) per exit, keyed on the employee_resignation row that both a
--    self-resignation and a company exit end in. Items, dues, sign-off,
--    escalation (5 business days → HR Manager, 7 → HR Head) and HR Head
--    override.
--  • fnf_settlements: the Full & Final statement — earnings / deductions
--    lines, totals, Payroll review → HR Manager approval → Finance payment.
--  • employees.rehire_flag: GREEN / BLOCKED / REVIEW (spec §11.3).
--  • exit-documents storage bucket (private).
-- Requires 172. Safe to run twice.
-- =====================================================================

ALTER TABLE hr_exit_requests
  ADD COLUMN IF NOT EXISTS destination_company_id UUID,
  ADD COLUMN IF NOT EXISTS destination_location_id UUID,
  ADD COLUMN IF NOT EXISTS onboarding_candidate_id UUID,
  ADD COLUMN IF NOT EXISTS documents             JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS abscond_stage         TEXT CHECK (abscond_stage IN ('REMINDING','READY')),
  ADD COLUMN IF NOT EXISTS reminders_sent        INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reminder_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS step_started_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS step_escalated_at     TIMESTAMPTZ;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS rehire_flag   TEXT CHECK (rehire_flag IN ('GREEN','BLOCKED','REVIEW')),
  ADD COLUMN IF NOT EXISTS rehire_reason TEXT,
  ADD COLUMN IF NOT EXISTS abscond_marked_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS exit_clearance (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resignation_id   UUID NOT NULL REFERENCES employee_resignation(id) ON DELETE CASCADE,
  employee_id      UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  company_id       UUID,
  dept             TEXT NOT NULL CHECK (dept IN ('IT','ADMIN','FINANCE','HR','HOD')),
  status           TEXT NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING','CLEARED','CLEARED_WITH_DUES','NOT_CLEARED','CLEARED_WITH_CONDITIONS','CLEARED_WITH_REMARKS')),
  items            JSONB NOT NULL DEFAULT '{}'::jsonb,
  extra            JSONB NOT NULL DEFAULT '{}'::jsonb,
  recovery         NUMERIC(12,2) NOT NULL DEFAULT 0,
  payable          NUMERIC(12,2) NOT NULL DEFAULT 0,
  remarks          TEXT,
  approver_ids     UUID[] NOT NULL DEFAULT '{}',
  cleared_by       UUID REFERENCES employees(id),
  cleared_by_name  TEXT,
  cleared_at       TIMESTAMPTZ,
  overridden       BOOLEAN NOT NULL DEFAULT false,
  escalated_to     TEXT CHECK (escalated_to IN ('HR_MANAGER','HR_HEAD')),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (resignation_id, dept)
);
CREATE INDEX IF NOT EXISTS exit_clearance_status ON exit_clearance (status, company_id);
ALTER TABLE exit_clearance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_exit_clearance" ON exit_clearance;
CREATE POLICY "allow_all_exit_clearance" ON exit_clearance FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS fnf_settlements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resignation_id    UUID NOT NULL UNIQUE REFERENCES employee_resignation(id) ON DELETE CASCADE,
  employee_id       UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  company_id        UUID,
  reason_code       TEXT,
  last_working_day  DATE,
  earnings          JSONB NOT NULL DEFAULT '[]'::jsonb,
  deductions        JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_earnings    NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_deductions  NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_payable       NUMERIC(14,2) NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'CALCULATED'
                    CHECK (status IN ('CALCULATED','REVIEWED','APPROVED','PAID')),
  letters           JSONB NOT NULL DEFAULT '[]'::jsonb,
  letters_case_by_case BOOLEAN NOT NULL DEFAULT false,
  notes             TEXT,
  calculated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by UUID, reviewed_by_name TEXT, reviewed_at TIMESTAMPTZ,
  approved_by UUID, approved_by_name TEXT, approved_at TIMESTAMPTZ,
  paid_by     UUID, paid_by_name     TEXT, paid_at     TIMESTAMPTZ, paid_ref TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE fnf_settlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_fnf_settlements" ON fnf_settlements;
CREATE POLICY "allow_all_fnf_settlements" ON fnf_settlements FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Supporting documents for a company exit (warning letters, inquiry reports). Private; read
-- through signed URLs from app/api/exit/documents.
INSERT INTO storage.buckets (id, name, public) VALUES ('exit-documents', 'exit-documents', false)
ON CONFLICT (id) DO NOTHING;
