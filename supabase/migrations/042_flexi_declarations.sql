-- 042_flexi_declarations.sql — employee flexi declarations (ESS/TDS portal target).
-- Builds on the flexi policy tables (039). One row per (employee, fy, component).
-- Idempotent.
CREATE TABLE IF NOT EXISTS flexi_declarations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  fy              TEXT NOT NULL DEFAULT '2026-27',
  component_code  TEXT NOT NULL,            -- matches flexi_components.code
  old_regime_amt  NUMERIC DEFAULT 0,
  new_regime_amt  NUMERIC DEFAULT 0,
  children_count  INTEGER DEFAULT 0,        -- for children-linked components (CHEDU/HOSTEL)
  status          TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','LOCKED')),
  submitted_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (employee_id, fy, component_code)
);
CREATE INDEX IF NOT EXISTS idx_flexi_decl_emp ON flexi_declarations(employee_id, fy);

ALTER TABLE flexi_declarations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_flexi_declarations" ON flexi_declarations;
CREATE POLICY "allow_all_flexi_declarations" ON flexi_declarations
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

notify pgrst, 'reload schema';
SELECT 'flexi_declarations ready ✓' AS status;
