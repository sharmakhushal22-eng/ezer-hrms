-- 039_flexi_policy_seed.sql  (spec called it 037; 037 was already used → 039)
-- EZER Flexi Benefit Policy FY 2026-27 — 9 slabs × 11 components × 2 regimes.
-- Tables: flexi_components (11), flexi_policy_slabs (9), flexi_slab_limits (99), flexi_policy_rules (7).
-- Value conventions in flexi_slab_limits: NULL = not eligible · -1 = formula (see formula_expr) · positive = annual ₹ limit.
-- Idempotent. Run in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS flexi_components (
  code           TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  old_available      BOOLEAN DEFAULT TRUE,
  new_available      BOOLEAN DEFAULT TRUE,
  is_perquisite      BOOLEAN DEFAULT FALSE,   -- Car/Driver: combined perquisite added to taxable income
  perquisite_annual  NUMERIC,                 -- ₹1,20,000 combined for Car+Driver (both regimes)
  is_children_linked BOOLEAN DEFAULT FALSE,   -- CHEDU/HOSTEL: auto rate × children × 12
  children_rate_mo   NUMERIC,                 -- ₹3,000 (edu) / ₹7,000 (hostel) per child per month
  max_children       INTEGER,                 -- 2
  is_lta             BOOLEAN DEFAULT FALSE,   -- LTA: 8.33% of Basic, proof-based
  notes              TEXT,
  sort_order         INTEGER DEFAULT 0
);
-- additive: bring an already-seeded flexi_components up to the enriched schema
ALTER TABLE flexi_components ADD COLUMN IF NOT EXISTS is_perquisite      BOOLEAN DEFAULT FALSE;
ALTER TABLE flexi_components ADD COLUMN IF NOT EXISTS perquisite_annual  NUMERIC;
ALTER TABLE flexi_components ADD COLUMN IF NOT EXISTS is_children_linked BOOLEAN DEFAULT FALSE;
ALTER TABLE flexi_components ADD COLUMN IF NOT EXISTS children_rate_mo   NUMERIC;
ALTER TABLE flexi_components ADD COLUMN IF NOT EXISTS max_children       INTEGER;
ALTER TABLE flexi_components ADD COLUMN IF NOT EXISTS is_lta             BOOLEAN DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS flexi_policy_slabs (
  id          INTEGER PRIMARY KEY,          -- 1..9
  label       TEXT NOT NULL,
  fixed_from  NUMERIC NOT NULL,
  fixed_to    NUMERIC                        -- NULL = open-ended (slab 9)
);
CREATE TABLE IF NOT EXISTS flexi_slab_limits (
  slab_id        INTEGER NOT NULL REFERENCES flexi_policy_slabs(id) ON DELETE CASCADE,
  component_code TEXT NOT NULL REFERENCES flexi_components(code) ON DELETE CASCADE,
  old_limit      NUMERIC,      -- NULL / -1 / value
  new_limit      NUMERIC,
  formula_expr   TEXT,
  PRIMARY KEY (slab_id, component_code)
);
CREATE TABLE IF NOT EXISTS flexi_policy_rules (
  code        TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  config      JSONB DEFAULT '{}'::jsonb,
  sort_order  INTEGER DEFAULT 0
);

-- ── Components (11) — with perquisite / children / LTA metadata ──
INSERT INTO flexi_components (code, name, old_available, new_available, is_perquisite, perquisite_annual, is_children_linked, children_rate_mo, max_children, is_lta, notes, sort_order) VALUES
  ('CHEDU','Children Education Allowance', TRUE, FALSE, FALSE, NULL,   TRUE,  3000, 2, FALSE, '₹3,000/child/mo, max 2 children. Declare first.', 1),
  ('HOSTEL','Hostel Allowance',            TRUE, FALSE, FALSE, NULL,   TRUE,  7000, 2, FALSE, '₹7,000/child/mo, max 2 children. Declare first.', 2),
  ('PDA','Professional Development Allowance', TRUE, FALSE, FALSE, NULL, FALSE, NULL, NULL, FALSE, 'Old regime only', 3),
  ('LTA','Leave Travel Allowance',         TRUE, FALSE, FALSE, NULL,   FALSE, NULL, NULL, TRUE,  'Formula 8.33% of Basic, slabs 5-9, Old only. Proof: EL + tickets + boarding passes.', 4),
  ('ATTIRE','Corporate Attire',            TRUE, FALSE, FALSE, NULL,   FALSE, NULL, NULL, FALSE, 'Old only, from slab 2', 5),
  ('DEVICE','Device Leasing',              TRUE, TRUE,  FALSE, NULL,   FALSE, NULL, NULL, FALSE, 'From slab 3', 6),
  ('TEL','Telephone / WiFi',               TRUE, TRUE,  FALSE, NULL,   FALSE, NULL, NULL, FALSE, 'From slab 4', 7),
  ('MEAL','Meal Coupon (Zaggle)',          TRUE, TRUE,  FALSE, NULL,   FALSE, NULL, NULL, FALSE, 'Old from slab 2, New from slab 3', 8),
  ('FUEL','Fuel Reimbursement',            TRUE, TRUE,  FALSE, NULL,   FALSE, NULL, NULL, FALSE, 'Old from slab 2, New from slab 3', 9),
  ('CAR','Car Lease',                      TRUE, TRUE,  TRUE,  120000, FALSE, NULL, NULL, FALSE, 'Linked with Driver; combined perquisite ₹1.2L/yr taxable both regimes', 10),
  ('DRIVER','Driver Allowance',            TRUE, TRUE,  TRUE,  120000, FALSE, NULL, NULL, FALSE, 'Linked with Car; part of the ₹1.2L combined perquisite', 11)
ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, old_available=EXCLUDED.old_available, new_available=EXCLUDED.new_available,
  is_perquisite=EXCLUDED.is_perquisite, perquisite_annual=EXCLUDED.perquisite_annual, is_children_linked=EXCLUDED.is_children_linked,
  children_rate_mo=EXCLUDED.children_rate_mo, max_children=EXCLUDED.max_children, is_lta=EXCLUDED.is_lta,
  notes=EXCLUDED.notes, sort_order=EXCLUDED.sort_order;

-- ── Slabs (9) — basis: Annual Fixed = CTC − Variable ──
INSERT INTO flexi_policy_slabs (id, label, fixed_from, fixed_to) VALUES
  (1,'≤5 LPA',            0,        500000),
  (2,'5.1–7.99 LPA',      510000,   799000),
  (3,'8–11.99 LPA',       800000,   1199000),
  (4,'12–17.99 LPA',      1200000,  1799000),
  (5,'18–24.99 LPA',      1800000,  2499000),
  (6,'25–29.99 LPA',      2500000,  2999000),
  (7,'30–39.99 LPA',      3000000,  3999000),
  (8,'40–49.99 LPA',      4000000,  4999000),
  (9,'50+ LPA',           5000000,  NULL)
ON CONFLICT (id) DO UPDATE SET label=EXCLUDED.label, fixed_from=EXCLUDED.fixed_from, fixed_to=EXCLUDED.fixed_to;

-- ── Slab limits (99 = 9 × 11). NULL = not eligible, -1 = formula. ──
INSERT INTO flexi_slab_limits (slab_id, component_code, old_limit, new_limit, formula_expr) VALUES
  -- PDA (Old only)
  (1,'PDA',NULL,NULL,NULL),(2,'PDA',18000,NULL,NULL),(3,'PDA',24000,NULL,NULL),(4,'PDA',30000,NULL,NULL),(5,'PDA',36000,NULL,NULL),(6,'PDA',48000,NULL,NULL),(7,'PDA',54000,NULL,NULL),(8,'PDA',60000,NULL,NULL),(9,'PDA',60000,NULL,NULL),
  -- TEL (both, from slab 4)
  (1,'TEL',NULL,NULL,NULL),(2,'TEL',NULL,NULL,NULL),(3,'TEL',NULL,NULL,NULL),(4,'TEL',18000,18000,NULL),(5,'TEL',18000,18000,NULL),(6,'TEL',18000,18000,NULL),(7,'TEL',18000,18000,NULL),(8,'TEL',18000,18000,NULL),(9,'TEL',18000,18000,NULL),
  -- DEVICE (both, from slab 3)
  (1,'DEVICE',NULL,NULL,NULL),(2,'DEVICE',NULL,NULL,NULL),(3,'DEVICE',50000,50000,NULL),(4,'DEVICE',50000,50000,NULL),(5,'DEVICE',90000,90000,NULL),(6,'DEVICE',130000,130000,NULL),(7,'DEVICE',150000,150000,NULL),(8,'DEVICE',200000,200000,NULL),(9,'DEVICE',200000,200000,NULL),
  -- LTA (Old only, formula 8.33% basic, slabs 5-9)
  (1,'LTA',NULL,NULL,NULL),(2,'LTA',NULL,NULL,NULL),(3,'LTA',NULL,NULL,NULL),(4,'LTA',NULL,NULL,NULL),(5,'LTA',-1,NULL,'0.0833 * basic_annual'),(6,'LTA',-1,NULL,'0.0833 * basic_annual'),(7,'LTA',-1,NULL,'0.0833 * basic_annual'),(8,'LTA',-1,NULL,'0.0833 * basic_annual'),(9,'LTA',-1,NULL,'0.0833 * basic_annual'),
  -- CAR (both, from slab 5; slab 8,9 old≠new)
  (1,'CAR',NULL,NULL,NULL),(2,'CAR',NULL,NULL,NULL),(3,'CAR',NULL,NULL,NULL),(4,'CAR',NULL,NULL,NULL),(5,'CAR',216000,216000,NULL),(6,'CAR',300000,300000,NULL),(7,'CAR',360000,360000,NULL),(8,'CAR',420000,360000,NULL),(9,'CAR',600000,360000,NULL),
  -- DRIVER (both, from slab 5)
  (1,'DRIVER',NULL,NULL,NULL),(2,'DRIVER',NULL,NULL,NULL),(3,'DRIVER',NULL,NULL,NULL),(4,'DRIVER',NULL,NULL,NULL),(5,'DRIVER',144000,144000,NULL),(6,'DRIVER',192000,192000,NULL),(7,'DRIVER',240000,240000,NULL),(8,'DRIVER',240000,240000,NULL),(9,'DRIVER',240000,240000,NULL),
  -- FUEL (Old from slab 2, New from slab 3; slab 8,9 old≠new)
  (1,'FUEL',NULL,NULL,NULL),(2,'FUEL',60000,NULL,NULL),(3,'FUEL',96000,96000,NULL),(4,'FUEL',144000,144000,NULL),(5,'FUEL',144000,144000,NULL),(6,'FUEL',160000,160000,NULL),(7,'FUEL',192000,192000,NULL),(8,'FUEL',240000,192000,NULL),(9,'FUEL',300000,192000,NULL),
  -- MEAL (Old from slab 2, New from slab 3)
  (1,'MEAL',NULL,NULL,NULL),(2,'MEAL',55000,NULL,NULL),(3,'MEAL',55000,55000,NULL),(4,'MEAL',55000,55000,NULL),(5,'MEAL',80000,80000,NULL),(6,'MEAL',96000,96000,NULL),(7,'MEAL',96000,96000,NULL),(8,'MEAL',96000,96000,NULL),(9,'MEAL',96000,96000,NULL),
  -- ATTIRE (Old only, from slab 2)
  (1,'ATTIRE',NULL,NULL,NULL),(2,'ATTIRE',40000,NULL,NULL),(3,'ATTIRE',48000,NULL,NULL),(4,'ATTIRE',60000,NULL,NULL),(5,'ATTIRE',60000,NULL,NULL),(6,'ATTIRE',78000,NULL,NULL),(7,'ATTIRE',96000,NULL,NULL),(8,'ATTIRE',96000,NULL,NULL),(9,'ATTIRE',96000,NULL,NULL),
  -- CHEDU (Old only, per-child ₹36,000/yr, from slab 2)
  (1,'CHEDU',NULL,NULL,NULL),(2,'CHEDU',36000,NULL,NULL),(3,'CHEDU',36000,NULL,NULL),(4,'CHEDU',36000,NULL,NULL),(5,'CHEDU',36000,NULL,NULL),(6,'CHEDU',36000,NULL,NULL),(7,'CHEDU',36000,NULL,NULL),(8,'CHEDU',36000,NULL,NULL),(9,'CHEDU',36000,NULL,NULL),
  -- HOSTEL (Old only, per-child ₹84,000/yr, from slab 2)
  (1,'HOSTEL',NULL,NULL,NULL),(2,'HOSTEL',84000,NULL,NULL),(3,'HOSTEL',84000,NULL,NULL),(4,'HOSTEL',84000,NULL,NULL),(5,'HOSTEL',84000,NULL,NULL),(6,'HOSTEL',84000,NULL,NULL),(7,'HOSTEL',84000,NULL,NULL),(8,'HOSTEL',84000,NULL,NULL),(9,'HOSTEL',84000,NULL,NULL)
ON CONFLICT (slab_id, component_code) DO UPDATE SET old_limit=EXCLUDED.old_limit, new_limit=EXCLUDED.new_limit, formula_expr=EXCLUDED.formula_expr;

-- ── Business rules (7) ──
INSERT INTO flexi_policy_rules (code, title, description, config, sort_order) VALUES
  ('CAR_DRIVER_LINK','Car & Driver declared together','If Car lease is declared, Driver allowance must also be declared (and vice-versa).', '{"linked_components":["CAR","DRIVER"]}', 1),
  ('CAR_PERQUISITE','Car + Driver perquisite','Combined perquisite ₹10,000/month = ₹1,20,000/year added to taxable income in BOTH regimes.', '{"monthly":10000,"annual":120000,"applies_to":["CAR","DRIVER"]}', 2),
  ('CHILDREN_FIRST','Children components declared first','Children Education and Hostel must be declared before other components.', '{"priority_components":["CHEDU","HOSTEL"]}', 3),
  ('CHEDU_TAX','Children Education tax treatment','Company ₹3,000/child/mo; IT-exempt only ₹100/child/mo; excess ₹2,900/child/mo taxable. Max 2 children.', '{"company_monthly":3000,"exempt_monthly":100,"taxable_monthly":2900,"max_children":2}', 4),
  ('HOSTEL_TAX','Hostel tax treatment','Company ₹7,000/child/mo; IT-exempt only ₹300/child/mo; excess ₹6,700/child/mo taxable. Max 2 children.', '{"company_monthly":7000,"exempt_monthly":300,"taxable_monthly":6700,"max_children":2}', 5),
  ('LTA_PROOF','LTA claim proof','Requires Earned Leave + flight tickets + boarding passes for all dependents. Old regime only, slabs 5-9.', '{"requires":["earned_leave","tickets","boarding_passes"],"regime":"OLD","slabs":[5,6,7,8,9]}', 6),
  ('UNCLAIMED_TAXABLE','Unclaimed wallet taxable','Any unclaimed flexi wallet balance is fully taxable (added to gross income) in BOTH regimes.', '{"taxable":true}', 7)
ON CONFLICT (code) DO UPDATE SET title=EXCLUDED.title, description=EXCLUDED.description, config=EXCLUDED.config, sort_order=EXCLUDED.sort_order;

-- RLS (read-mostly reference data; permissive per project convention)
ALTER TABLE flexi_components   ENABLE ROW LEVEL SECURITY;
ALTER TABLE flexi_policy_slabs ENABLE ROW LEVEL SECURITY;
ALTER TABLE flexi_slab_limits  ENABLE ROW LEVEL SECURITY;
ALTER TABLE flexi_policy_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_flexi_components" ON flexi_components;
DROP POLICY IF EXISTS "allow_all_flexi_policy_slabs" ON flexi_policy_slabs;
DROP POLICY IF EXISTS "allow_all_flexi_slab_limits" ON flexi_slab_limits;
DROP POLICY IF EXISTS "allow_all_flexi_policy_rules" ON flexi_policy_rules;
CREATE POLICY "allow_all_flexi_components"   ON flexi_components   FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_flexi_policy_slabs" ON flexi_policy_slabs FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_flexi_slab_limits"  ON flexi_slab_limits  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_flexi_policy_rules" ON flexi_policy_rules FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

notify pgrst, 'reload schema';
SELECT
  (SELECT COUNT(*) FROM flexi_components)   AS components,
  (SELECT COUNT(*) FROM flexi_policy_slabs) AS slabs,
  (SELECT COUNT(*) FROM flexi_slab_limits)  AS limits,
  (SELECT COUNT(*) FROM flexi_policy_rules) AS rules;
