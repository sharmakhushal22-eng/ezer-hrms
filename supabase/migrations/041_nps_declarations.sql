-- ============================================================
-- EZER HRMS — NPS (National Pension System) Module
-- Migration: 045_nps_declarations
-- Date: 03 July 2026
-- Corporate NPS: employer contributes % of Basic by tax regime
--   Old regime = 10% of Basic  (Section 80CCD(2))
--   New regime = 14% of Basic  (Section 80CCD(2))
-- Effective from 1st of the coming month
-- ============================================================

-- ============================================================
-- 1. NPS DECLARATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS nps_declarations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id           UUID NOT NULL REFERENCES employees(id),
  company_id            UUID NOT NULL REFERENCES companies(id),
  fy                    TEXT NOT NULL,

  -- PRAN
  has_existing_pran     BOOLEAN NOT NULL,
  pran_number           TEXT,                             -- 12-digit (null if pending)
  pran_holder_name      TEXT,
  tier_type             TEXT DEFAULT 'Tier I' CHECK (tier_type IN ('Tier I','Tier II')),

  -- Contribution (regime-driven)
  tax_regime            TEXT NOT NULL CHECK (tax_regime IN ('OLD','NEW')),
  contribution_percent  NUMERIC NOT NULL,                 -- 10 (old) | 14 (new)
  basic_at_declaration  NUMERIC NOT NULL,                 -- monthly basic snapshot
  monthly_nps_amount    NUMERIC NOT NULL,                 -- basic x percent
  annual_nps_amount     NUMERIC NOT NULL,

  -- Effective
  effective_date        DATE NOT NULL,                    -- 1st of coming month
  is_recurring          BOOLEAN DEFAULT true,

  -- Status
  status                TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN (
                          'PENDING_PRAN','ACTIVE','STOPPED','SUPERSEDED'
                        )),

  -- New PRAN flow
  pran_email_sent_at    TIMESTAMPTZ,
  pran_deadline         DATE,                             -- submit + 3 days
  pran_generated_at     TIMESTAMPTZ,

  -- Acknowledgement (mandatory)
  acknowledged          BOOLEAN NOT NULL DEFAULT false,
  acknowledged_at       TIMESTAMPTZ,

  -- Stop
  stopped_at            TIMESTAMPTZ,
  stopped_reason        TEXT,

  created_by            UUID,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nps_emp_active ON nps_declarations(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_nps_company_fy ON nps_declarations(company_id, fy);

-- Only ONE active/pending declaration per employee per FY
CREATE UNIQUE INDEX IF NOT EXISTS idx_nps_one_active
  ON nps_declarations(employee_id, fy)
  WHERE status IN ('ACTIVE','PENDING_PRAN');

-- ============================================================
-- 2. NPS AUDIT LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS nps_audit_log (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  declaration_id        UUID REFERENCES nps_declarations(id),
  employee_id           UUID NOT NULL,
  employee_code         TEXT,
  company_id            UUID,
  action                TEXT NOT NULL CHECK (action IN (
                          'DECLARED','PRAN_EMAIL_SENT','PRAN_SUBMITTED','MODIFIED',
                          'STOPPED','SYNCED_TO_PAYROLL','ACKNOWLEDGED'
                        )),
  old_value             JSONB,
  new_value             JSONB,
  monthly_nps_amount    NUMERIC,
  payroll_run_id        UUID,
  performed_by          UUID,
  source                TEXT DEFAULT 'ESS',
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nps_audit_emp ON nps_audit_log(employee_id, created_at DESC);

-- ============================================================
-- 3. RLS (EZER standard)
-- ============================================================
ALTER TABLE nps_declarations ENABLE ROW LEVEL SECURITY;
ALTER TABLE nps_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_nps_decl" ON nps_declarations;
CREATE POLICY "allow_all_nps_decl" ON nps_declarations
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_nps_audit" ON nps_audit_log;
CREATE POLICY "allow_all_nps_audit" ON nps_audit_log
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- 4. AUTO updated_at TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION _nps_touch_updated() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_nps_updated ON nps_declarations;
CREATE TRIGGER trg_nps_updated BEFORE UPDATE ON nps_declarations
  FOR EACH ROW EXECUTE FUNCTION _nps_touch_updated();

-- ============================================================
-- NOTE: payroll_lines.ded_nps column already exists (migration 038)
-- Payroll picks ACTIVE NPS where effective_date <= period start:
--   ded_nps = round(basic_monthly * contribution_percent / 100)
-- PENDING_PRAN declarations are NOT synced until PRAN submitted.
-- ============================================================
