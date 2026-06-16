-- ============================================================
-- 022_hr_action_panel.sql — HR Employee Action Panel
-- PIP / Sabbatical / Resignation (with notice-shortfall recovery) / Abscond
-- + HR action audit + employee update-request approvals.
-- (employees already has employment_status, date_of_resignation,
--  last_working_date, notice_period_days.)
-- Idempotent. HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run.
-- ============================================================

CREATE TABLE IF NOT EXISTS employee_pip (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  start_date DATE NOT NULL, review_date DATE, reason TEXT, goals TEXT,
  status TEXT DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PASSED','FAILED','CLOSED')),
  outcome TEXT, closed_at TIMESTAMPTZ,
  initiated_by UUID, initiated_by_name TEXT, created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employee_sabbatical (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  from_date DATE NOT NULL, to_date DATE, actual_return DATE,
  reason TEXT,
  status TEXT DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RETURNED','EXTENDED','CLOSED')),
  notes TEXT, initiated_by UUID, initiated_by_name TEXT, created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employee_resignation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date_of_resignation DATE NOT NULL,
  notice_period_days INTEGER,
  lwd_as_per_policy DATE, lwd_confirmed_by_emp DATE,
  notice_shortfall_days INTEGER DEFAULT 0,
  recovery_required BOOLEAN DEFAULT FALSE,
  recovery_mail_to_payroll_at TIMESTAMPTZ,
  recovery_mail_to_emp_at TIMESTAMPTZ,
  recovery_amount NUMERIC,
  status TEXT DEFAULT 'INITIATED' CHECK (status IN ('INITIATED','RECOVERY_PENDING','SETTLED','WITHDRAWN')),
  remarks TEXT, initiated_by UUID, initiated_by_name TEXT, created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employee_abscond (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  abscond_from DATE NOT NULL, abscond_end DATE,
  status TEXT DEFAULT 'ABSCONDING' CHECK (status IN ('ABSCONDING','RETURNED','TERMINATED')),
  notes TEXT, marked_by UUID, marked_by_name TEXT, created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employee_hr_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id),
  action_type TEXT NOT NULL, action_detail JSONB DEFAULT '{}',
  performed_by UUID, performed_by_name TEXT, created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employee_update_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id),
  request_type TEXT NOT NULL, request_data JSONB DEFAULT '{}',
  status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  reviewed_by UUID, reviewed_by_name TEXT, review_note TEXT,
  reviewed_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now()
);

create index if not exists idx_pip_emp        on employee_pip(employee_id);
create index if not exists idx_sab_emp        on employee_sabbatical(employee_id);
create index if not exists idx_resig_emp      on employee_resignation(employee_id);
create index if not exists idx_abscond_emp    on employee_abscond(employee_id);
create index if not exists idx_hract_emp      on employee_hr_actions(employee_id);
create index if not exists idx_updreq_emp     on employee_update_requests(employee_id);

-- ── RLS (permissive while auth is not yet wired) ──
DO $$ DECLARE t TEXT;
BEGIN FOR t IN SELECT unnest(ARRAY[
  'employee_pip','employee_sabbatical','employee_resignation',
  'employee_abscond','employee_hr_actions','employee_update_requests'
]) LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS "allow_all_%s" ON %I', t, t);
  EXECUTE format('CREATE POLICY "allow_all_%s" ON %I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)', t, t);
END LOOP; END $$;

notify pgrst, 'reload schema';
