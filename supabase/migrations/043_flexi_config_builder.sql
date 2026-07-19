-- 043_flexi_config_builder.sql — converge flexi tables on the config-builder (037) schema:
-- company-scoped UUID slabs + component_id limits + perquisite/children columns.
-- Supersedes the 039 integer/component_code shape. Idempotent-ish (drops & recreates
-- slabs+limits; keeps flexi_components data and adds an id column).

-- 1) flexi_components: add a UUID id the builder joins on (keep code unique).
ALTER TABLE flexi_components ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();
UPDATE flexi_components SET id = gen_random_uuid() WHERE id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_flexi_comp_id ON flexi_components(id);

-- 2) Recreate slabs + limits in the builder schema.
DROP TABLE IF EXISTS flexi_slab_limits CASCADE;
DROP TABLE IF EXISTS flexi_policy_slabs CASCADE;

CREATE TABLE flexi_policy_slabs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID REFERENCES companies(id) ON DELETE CASCADE,
  slab_label    TEXT NOT NULL,
  fixed_from    NUMERIC NOT NULL,
  fixed_to      NUMERIC NOT NULL,
  is_active     BOOLEAN DEFAULT TRUE,
  sort_order    INTEGER,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (company_id, fixed_from, fixed_to)
);

CREATE TABLE flexi_slab_limits (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slab_id            UUID NOT NULL REFERENCES flexi_policy_slabs(id) ON DELETE CASCADE,
  component_id       UUID NOT NULL REFERENCES flexi_components(id) ON DELETE CASCADE,
  old_regime_max     NUMERIC,        -- amount / -1 formula / NULL not offered
  new_regime_max     NUMERIC,
  is_formula         BOOLEAN DEFAULT FALSE,
  formula_expr       TEXT,
  perquisite_value   NUMERIC,        -- ANNUAL (monthly x12)
  perquisite_monthly NUMERIC,        -- as entered
  children_count     INTEGER,        -- 1/2 for CHEDU/HOSTEL
  is_active          BOOLEAN DEFAULT TRUE,
  UNIQUE (slab_id, component_id)
);
CREATE INDEX IF NOT EXISTS idx_fsl_slab ON flexi_slab_limits(slab_id);

ALTER TABLE flexi_policy_slabs ENABLE ROW LEVEL SECURITY;
ALTER TABLE flexi_slab_limits  ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_flexi_policy_slabs" ON flexi_policy_slabs;
DROP POLICY IF EXISTS "allow_all_flexi_slab_limits"  ON flexi_slab_limits;
CREATE POLICY "allow_all_flexi_policy_slabs" ON flexi_policy_slabs FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_flexi_slab_limits"  ON flexi_slab_limits  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

notify pgrst, 'reload schema';
SELECT 'flexi config-builder schema ready ✓' AS status;
