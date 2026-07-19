-- 045_loan_config.sql — Loan module Part 1: config (loan_types + approval levels + seed).
-- (spec called it 046; renumbered — repo is at 044.) Idempotent. Seeds 3 loan types +
-- approval chains for EVERY company.
CREATE TABLE IF NOT EXISTS loan_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  code TEXT NOT NULL, name TEXT NOT NULL,
  eligibility_base TEXT NOT NULL DEFAULT 'CTC' CHECK (eligibility_base IN ('CTC','GROSS')),
  max_loan_percent NUMERIC NOT NULL,
  min_tenure_months INTEGER NOT NULL, max_tenure_months INTEGER NOT NULL,
  interest_rate NUMERIC NOT NULL DEFAULT 0,
  interest_type TEXT NOT NULL DEFAULT 'REDUCING' CHECK (interest_type IN ('REDUCING','FLAT','ZERO')),
  max_disbursement_days INTEGER NOT NULL DEFAULT 30,
  requires_agreement BOOLEAN DEFAULT true, notify_finance BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true, remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (company_id, code)
);
CREATE TABLE IF NOT EXISTS loan_approval_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  loan_type_id UUID REFERENCES loan_types(id),
  level_order INTEGER NOT NULL,
  approver_role TEXT NOT NULL CHECK (approver_role IN ('PAYROLL_MANAGER','HR_MANAGER','HR_HEAD','FINANCE','REPORTING_MANAGER')),
  is_mandatory BOOLEAN DEFAULT true, is_active BOOLEAN DEFAULT true,
  UNIQUE (company_id, loan_type_id, level_order)
);

ALTER TABLE loan_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_approval_levels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_loan_types" ON loan_types;
CREATE POLICY "allow_all_loan_types" ON loan_types FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "allow_all_loan_appr" ON loan_approval_levels;
CREATE POLICY "allow_all_loan_appr" ON loan_approval_levels FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION _loan_types_touch() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_loan_types_updated ON loan_types;
CREATE TRIGGER trg_loan_types_updated BEFORE UPDATE ON loan_types FOR EACH ROW EXECUTE FUNCTION _loan_types_touch();

-- ── Seed 3 loan types + approval chains for every company ──
DO $$ DECLARE co RECORD; t_id UUID;
BEGIN
  FOR co IN SELECT id FROM companies LOOP
    -- Salary Advance (interest-free, 1 approver)
    INSERT INTO loan_types (company_id, code, name, eligibility_base, max_loan_percent, min_tenure_months, max_tenure_months, interest_rate, interest_type, max_disbursement_days, requires_agreement, notify_finance)
    VALUES (co.id, 'SAL_ADV', 'Salary Advance', 'GROSS', 100, 1, 3, 0, 'ZERO', 30, false, true)
    ON CONFLICT (company_id, code) DO NOTHING RETURNING id INTO t_id;
    IF t_id IS NOT NULL THEN INSERT INTO loan_approval_levels (company_id, loan_type_id, level_order, approver_role) VALUES (co.id, t_id, 1, 'PAYROLL_MANAGER') ON CONFLICT DO NOTHING; END IF;
    t_id := NULL;
    -- Personal Loan (10% reducing, 2 approvers)
    INSERT INTO loan_types (company_id, code, name, eligibility_base, max_loan_percent, min_tenure_months, max_tenure_months, interest_rate, interest_type, max_disbursement_days, requires_agreement, notify_finance)
    VALUES (co.id, 'PERSONAL', 'Personal Loan', 'CTC', 50, 6, 24, 10, 'REDUCING', 90, true, true)
    ON CONFLICT (company_id, code) DO NOTHING RETURNING id INTO t_id;
    IF t_id IS NOT NULL THEN
      INSERT INTO loan_approval_levels (company_id, loan_type_id, level_order, approver_role) VALUES (co.id, t_id, 1, 'PAYROLL_MANAGER'), (co.id, t_id, 2, 'HR_MANAGER') ON CONFLICT DO NOTHING;
    END IF;
    t_id := NULL;
    -- Emergency Loan (6% reducing, 2 approvers)
    INSERT INTO loan_types (company_id, code, name, eligibility_base, max_loan_percent, min_tenure_months, max_tenure_months, interest_rate, interest_type, max_disbursement_days, requires_agreement, notify_finance)
    VALUES (co.id, 'EMERGENCY', 'Emergency Loan', 'CTC', 30, 3, 12, 6, 'REDUCING', 30, true, true)
    ON CONFLICT (company_id, code) DO NOTHING RETURNING id INTO t_id;
    IF t_id IS NOT NULL THEN
      INSERT INTO loan_approval_levels (company_id, loan_type_id, level_order, approver_role) VALUES (co.id, t_id, 1, 'PAYROLL_MANAGER'), (co.id, t_id, 2, 'HR_HEAD') ON CONFLICT DO NOTHING;
    END IF;
    t_id := NULL;
  END LOOP;
END $$;

notify pgrst, 'reload schema';
SELECT (SELECT COUNT(*) FROM loan_types) AS loan_types, (SELECT COUNT(*) FROM loan_approval_levels) AS approval_levels;
