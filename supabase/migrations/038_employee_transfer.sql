-- 038_employee_transfer.sql — Employee Transfer Module v2
-- Type 1: LOCATION_MOVEMENT (same company, branch change, bulk-capable)
-- Type 2: INTER_COMPANY (group move, new code, group_doj carries)
-- Idempotent. Run in Supabase SQL Editor.
CREATE TABLE IF NOT EXISTS employee_transfer (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  transfer_type   TEXT NOT NULL CHECK (transfer_type IN ('LOCATION_MOVEMENT','INTER_COMPANY')),
  batch_id        UUID,
  from_company_id UUID REFERENCES companies(id),
  from_branch_id  UUID REFERENCES locations(id),
  from_branch_state TEXT,
  from_emp_code   TEXT,
  to_company_id   UUID REFERENCES companies(id),
  to_branch_id    UUID REFERENCES locations(id),
  to_branch_state TEXT,
  to_emp_code     TEXT,
  new_employee_id UUID REFERENCES employees(id),
  effective_date         DATE NOT NULL,
  last_working_date_old  DATE,
  is_mid_month           BOOLEAN DEFAULT FALSE,
  new_doj                DATE,
  group_doj_preserved    DATE,
  new_reporting_manager_id UUID REFERENCES employees(id),
  new_designation  TEXT,
  new_department_id UUID REFERENCES departments(id),
  new_cost_centre  TEXT,
  new_shift_id     UUID,
  benefit_type     TEXT DEFAULT 'NONE'
                   CHECK (benefit_type IN ('NONE','RELOCATION','ONE_TIME_BONUS','AS_PER_NEW_POLICY')),
  benefit_amount   NUMERIC,
  letter_url       TEXT,
  letter_generated_at TIMESTAMPTZ,
  ack_status       TEXT DEFAULT 'PENDING'
                   CHECK (ack_status IN ('PENDING','ACKNOWLEDGED','DECLINED')),
  ack_at           TIMESTAMPTZ,
  ack_remark       TEXT,
  status           TEXT DEFAULT 'INITIATED'
                   CHECK (status IN ('INITIATED','LETTER_SENT','ACKNOWLEDGED','PENDING_ONBOARDING','PENDING_CODE','COMPLETED','CANCELLED')),
  onboarding_id    UUID,
  fnf_triggered    BOOLEAN DEFAULT FALSE,
  fnf_reference    TEXT,
  reason           TEXT,
  remarks          TEXT,
  initiated_by     UUID,
  initiated_by_name TEXT,
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transfer_emp ON employee_transfer(employee_id);
CREATE INDEX IF NOT EXISTS idx_transfer_batch ON employee_transfer(batch_id);
CREATE INDEX IF NOT EXISTS idx_transfer_status ON employee_transfer(status);
CREATE INDEX IF NOT EXISTS idx_transfer_ack ON employee_transfer(ack_status);

ALTER TABLE employees ADD COLUMN IF NOT EXISTS transferred_at TIMESTAMPTZ;

ALTER TABLE employee_transfer ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_employee_transfer" ON employee_transfer;
CREATE POLICY "allow_all_employee_transfer" ON employee_transfer
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

notify pgrst, 'reload schema';
