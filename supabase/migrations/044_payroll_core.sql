-- 044_payroll_core.sql — Payroll core schema (the guide's "migration 038", which was missing).
-- Month-run lifecycle with snapshot-freeze; pay heads config; lines with VPF/NPS/loan columns.
-- Idempotent. RLS permissive per EZER convention.

-- ── Pay heads (earnings / deductions / employer contrib / non-salary) ──
CREATE TABLE IF NOT EXISTS pay_heads (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID REFERENCES companies(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  head_type   TEXT NOT NULL CHECK (head_type IN ('EARNING','DEDUCTION','EMPLOYER','NON_SALARY')),
  taxable     BOOLEAN DEFAULT TRUE,
  calc_type   TEXT DEFAULT 'FIXED' CHECK (calc_type IN ('FIXED','PCT_BASIC','PCT_CTC','FORMULA')),
  calc_value  NUMERIC,
  sort_order  INTEGER DEFAULT 0,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (company_id, code)
);

-- ── Payroll run (one active month per company) ──
CREATE TABLE IF NOT EXISTS payroll_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fy            TEXT NOT NULL,
  month         INTEGER NOT NULL,          -- 1=Apr .. 12=Mar
  period_label  TEXT,                      -- 'Apr 2026'
  run_type      TEXT DEFAULT 'REGULAR' CHECK (run_type IN ('REGULAR','OFF_CYCLE')),
  status        TEXT NOT NULL DEFAULT 'OPEN'
                CHECK (status IN ('OPEN','SYNCED','ATTENDANCE_LOCKED','CALCULATED','AI_CHECKED','APPROVED','DISBURSED','LOCKED','CANCELLED')),
  total_gross   NUMERIC DEFAULT 0,
  total_net     NUMERIC DEFAULT 0,
  emp_count     INTEGER DEFAULT 0,
  created_by    TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  locked_at     TIMESTAMPTZ,
  UNIQUE (company_id, fy, month, run_type)
);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_co ON payroll_runs(company_id, status);

-- ── Employee snapshot (frozen at sync) ──
CREATE TABLE IF NOT EXISTS payroll_employee_snapshot (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id   UUID NOT NULL,
  employee_code TEXT,
  full_name     TEXT,
  department    TEXT,
  location      TEXT,
  annual_ctc    NUMERIC,
  basic_monthly NUMERIC,
  hra_monthly   NUMERIC,
  bank_account_last4 TEXT,
  ifsc_code     TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (run_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_pay_snap_run ON payroll_employee_snapshot(run_id);

-- ── Attendance snapshot ──
CREATE TABLE IF NOT EXISTS payroll_attendance_snapshot (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id   UUID NOT NULL,
  payable_days  NUMERIC,
  lop_days      NUMERIC DEFAULT 0,
  present_days  NUMERIC,
  arrear_days   NUMERIC DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (run_id, employee_id)
);

-- ── Payroll lines (per-employee computed pay; frozen on lock) ──
CREATE TABLE IF NOT EXISTS payroll_lines (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id    UUID NOT NULL,
  gross_earning  NUMERIC DEFAULT 0,
  ded_epf        NUMERIC DEFAULT 0,
  ded_vpf        NUMERIC DEFAULT 0,
  ded_nps        NUMERIC DEFAULT 0,
  ded_esic       NUMERIC DEFAULT 0,
  ded_pt         NUMERIC DEFAULT 0,
  ded_lwf        NUMERIC DEFAULT 0,
  ded_tds        NUMERIC DEFAULT 0,
  ded_loan_emi   NUMERIC DEFAULT 0,
  total_deductions NUMERIC DEFAULT 0,
  net_pay        NUMERIC DEFAULT 0,
  earnings_json  JSONB DEFAULT '[]'::jsonb,
  deductions_json JSONB DEFAULT '[]'::jsonb,
  created_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (run_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_pay_lines_run ON payroll_lines(run_id);

-- ── Disbursements (bank payout) ──
CREATE TABLE IF NOT EXISTS payroll_disbursements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id   UUID NOT NULL,
  amount        NUMERIC,
  bank_account_last4 TEXT,
  ifsc_code     TEXT,
  status        TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAID','FAILED')),
  utr           TEXT,
  paid_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ── Payslips ──
CREATE TABLE IF NOT EXISTS payroll_payslips (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id   UUID NOT NULL,
  payslip_url   TEXT,
  generated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (run_id, employee_id)
);

-- ── Audit log ──
CREATE TABLE IF NOT EXISTS payroll_audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        UUID REFERENCES payroll_runs(id) ON DELETE CASCADE,
  company_id    UUID,
  action        TEXT NOT NULL,
  detail        JSONB,
  performed_by  TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pay_audit_run ON payroll_audit_log(run_id, created_at DESC);

-- ── RLS ──
DO $$ DECLARE t TEXT;
BEGIN FOR t IN SELECT unnest(ARRAY[
  'pay_heads','payroll_runs','payroll_employee_snapshot','payroll_attendance_snapshot',
  'payroll_lines','payroll_disbursements','payroll_payslips','payroll_audit_log'
]) LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS "allow_all_%s" ON %I', t, t);
  EXECUTE format('CREATE POLICY "allow_all_%s" ON %I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)', t, t);
END LOOP; END $$;

notify pgrst, 'reload schema';
SELECT 'payroll core ready ✓' AS status;
