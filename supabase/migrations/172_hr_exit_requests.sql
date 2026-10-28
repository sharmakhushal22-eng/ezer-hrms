-- =====================================================================
-- 172_hr_exit_requests.sql — an exit the company starts, with its approval chain
--
-- People → Employees → an employee → the red Exit button (Exit Module spec v2
-- §4). HR / a Hiring Manager starts it with a reason, sub-reason, last working
-- day and additional information; it then walks a chain per reason
-- (lib/exit/hr-exit.ts):
--   Abscond                         HR Manager → HR Head
--   Layoff / Termination / Discontinue  HR Manager → HR Head → MD
--   Fraud / Misconduct              HR Manager → Legal → HR Head → MD
-- and only on the last approval does it take effect (an employee_resignation
-- row with the final last working day, employees.last_working_date, the
-- employee told). Cancel closes it; a rejected one is Reset before another
-- can start.
--
-- `chain` holds every step with its approvers (id, emp code, name) and who
-- acted, so the status popup shows the whole flow without another query.
-- Safe to run twice.
-- =====================================================================

CREATE TABLE IF NOT EXISTS hr_exit_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  company_id        UUID,
  reason_code       TEXT NOT NULL,
  reason_label      TEXT NOT NULL,
  sub_reason        TEXT,
  last_working_day  DATE NOT NULL,
  remarks           TEXT,
  status            TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED','RESET')),
  chain             JSONB NOT NULL DEFAULT '[]'::jsonb,
  current_step      INT,
  rehire_flag       TEXT CHECK (rehire_flag IN ('GREEN','BLOCKED','REVIEW')),
  resignation_id    UUID REFERENCES employee_resignation(id) ON DELETE SET NULL,
  initiated_by      UUID REFERENCES employees(id),
  initiated_by_name TEXT,
  closed_by         UUID REFERENCES employees(id),
  closed_by_name    TEXT,
  close_note        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at        TIMESTAMPTZ,
  closed_at         TIMESTAMPTZ
);

-- One live request per employee (running, approved, or rejected and not yet reset).
CREATE UNIQUE INDEX IF NOT EXISTS hr_exit_requests_one_open
  ON hr_exit_requests (employee_id) WHERE status IN ('PENDING','APPROVED','REJECTED');
CREATE INDEX IF NOT EXISTS hr_exit_requests_status ON hr_exit_requests (status, company_id);

ALTER TABLE hr_exit_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_hr_exit_requests" ON hr_exit_requests;
CREATE POLICY "allow_all_hr_exit_requests" ON hr_exit_requests
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
