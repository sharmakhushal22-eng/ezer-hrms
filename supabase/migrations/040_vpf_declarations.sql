-- 040_vpf_declarations.sql — VPF (Voluntary Provident Fund) module
-- (spec called it 044; renumbered to 040 — repo is at 039).
-- Creates ctc_master (didn't exist), vpf_declarations, vpf_audit_log. Idempotent.
-- VPF = EPF wage base × percentage. base = min(monthly_gross − monthly_hra, epf_wage_limit).
--   epf_wage_limit 15000 → capped at PF ceiling · 999999999 → uncapped (actual).

-- ── ctc_master (employee CTC breakup — feeds VPF base + flexi) ──
CREATE TABLE IF NOT EXISTS ctc_master (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  company_id       UUID REFERENCES companies(id),
  fy               TEXT DEFAULT '2026-27',
  annual_ctc       NUMERIC,
  annual_variable  NUMERIC DEFAULT 0,
  basic_annual     NUMERIC,
  hra_annual       NUMERIC,
  epf_wage_limit   NUMERIC NOT NULL DEFAULT 15000,   -- 15000 (capped) | 999999999 (uncapped)
  effective_from   DATE,
  status           TEXT DEFAULT 'ACTIVE',
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (employee_id, fy)
);
-- in case an older/partial ctc_master already existed, self-heal all columns:
ALTER TABLE ctc_master ADD COLUMN IF NOT EXISTS company_id      UUID REFERENCES companies(id);
ALTER TABLE ctc_master ADD COLUMN IF NOT EXISTS fy              TEXT DEFAULT '2026-27';
ALTER TABLE ctc_master ADD COLUMN IF NOT EXISTS annual_ctc      NUMERIC;
ALTER TABLE ctc_master ADD COLUMN IF NOT EXISTS annual_variable NUMERIC DEFAULT 0;
ALTER TABLE ctc_master ADD COLUMN IF NOT EXISTS basic_annual    NUMERIC;
ALTER TABLE ctc_master ADD COLUMN IF NOT EXISTS hra_annual      NUMERIC;
ALTER TABLE ctc_master ADD COLUMN IF NOT EXISTS epf_wage_limit  NUMERIC NOT NULL DEFAULT 15000;
ALTER TABLE ctc_master ADD COLUMN IF NOT EXISTS status          TEXT DEFAULT 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_ctc_master_emp ON ctc_master(employee_id);

-- ── vpf_declarations (one ACTIVE per employee per FY) ──
CREATE TABLE IF NOT EXISTS vpf_declarations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id           UUID NOT NULL REFERENCES employees(id),
  company_id            UUID NOT NULL REFERENCES companies(id),
  fy                    TEXT NOT NULL,
  vpf_percent           NUMERIC NOT NULL,                 -- 1-88 (server capped)
  epf_wage_limit        NUMERIC NOT NULL,
  epf_wage_base         NUMERIC NOT NULL,
  monthly_vpf_amount    NUMERIC NOT NULL,
  annual_vpf_amount     NUMERIC NOT NULL,
  is_recurring          BOOLEAN DEFAULT true,
  effective_from_fy     TEXT NOT NULL,
  effective_from_month  INTEGER NOT NULL,                 -- 1=Apr .. 12=Mar
  status                TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','STOPPED','SUPERSEDED')),
  acknowledged          BOOLEAN NOT NULL DEFAULT false,
  acknowledged_at       TIMESTAMPTZ,
  stopped_at            TIMESTAMPTZ,
  stopped_reason        TEXT,
  stopped_from_month    INTEGER,
  created_by            UUID,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vpf_emp_active ON vpf_declarations(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_vpf_company_fy ON vpf_declarations(company_id, fy);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vpf_one_active ON vpf_declarations(employee_id, fy) WHERE status = 'ACTIVE';

-- ── vpf_audit_log ──
CREATE TABLE IF NOT EXISTS vpf_audit_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  declaration_id      UUID REFERENCES vpf_declarations(id),
  employee_id         UUID NOT NULL,
  employee_code       TEXT,
  company_id          UUID,
  action              TEXT NOT NULL CHECK (action IN ('DECLARED','MODIFIED','STOPPED','SYNCED_TO_PAYROLL','ACKNOWLEDGED')),
  old_value           JSONB,
  new_value           JSONB,
  monthly_vpf_amount  NUMERIC,
  payroll_run_id      UUID,
  performed_by        UUID,
  source              TEXT DEFAULT 'ESS',
  ip_address          TEXT,
  created_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vpf_audit_emp ON vpf_audit_log(employee_id, created_at DESC);

-- ── RLS (EZER standard permissive) ──
ALTER TABLE ctc_master        ENABLE ROW LEVEL SECURITY;
ALTER TABLE vpf_declarations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE vpf_audit_log     ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_ctc_master" ON ctc_master;
DROP POLICY IF EXISTS "allow_all_vpf_decl" ON vpf_declarations;
DROP POLICY IF EXISTS "allow_all_vpf_audit" ON vpf_audit_log;
CREATE POLICY "allow_all_ctc_master" ON ctc_master       FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_vpf_decl"   ON vpf_declarations FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_vpf_audit"  ON vpf_audit_log    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- ── auto updated_at ──
CREATE OR REPLACE FUNCTION _vpf_touch_updated() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_vpf_updated ON vpf_declarations;
CREATE TRIGGER trg_vpf_updated BEFORE UPDATE ON vpf_declarations FOR EACH ROW EXECUTE FUNCTION _vpf_touch_updated();

notify pgrst, 'reload schema';
SELECT 'VPF + ctc_master ready ✓' AS status;
