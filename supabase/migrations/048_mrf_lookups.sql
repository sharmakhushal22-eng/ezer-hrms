-- ═══════════════════════════════════════════════════════════════════
-- 048_mrf_lookups.sql — Business Unit / Cost Center / Currency lookups
--
-- Optional. Run AFTER 047_mrf_columns.sql. Without it the MRF form
-- works fully; those three dropdowns just say "No options configured".
--
-- Plain INSERTs — no plpgsql — so a failure here names the exact statement.
-- Safe to re-run: every insert is guarded by a NOT EXISTS on the code.
-- ═══════════════════════════════════════════════════════════════════

-- The three master types, filed under the same category as the existing MRF ones.
INSERT INTO master_types (category_id, code, name, description, is_system, is_active, sort_order)
SELECT (SELECT category_id FROM master_types WHERE code = 'mrf_reason' LIMIT 1),
       v.code, v.name, v.description, false, true, 900
FROM (VALUES
  ('business_unit', 'Business Unit', 'Business unit / vertical a requisition belongs to'),
  ('cost_center',   'Cost Center',   'Cost center the headcount is charged to'),
  ('currency',      'Currency',      'Currency for salary ranges in multi-country orgs')
) AS v(code, name, description)
WHERE NOT EXISTS (SELECT 1 FROM master_types mt WHERE mt.code = v.code);

-- Business units
INSERT INTO master_values (type_id, code, label, sort_order, is_active)
SELECT (SELECT id FROM master_types WHERE code = 'business_unit'), v.code, v.label, v.ord, true
FROM (VALUES
  ('CORP','Corporate',1), ('RETAIL','Retail',2), ('MFG','Manufacturing',3),
  ('TRADING','Trading',4), ('TECH','Technology',5), ('SERVICES','Services',6)
) AS v(code, label, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM master_values mv
  WHERE mv.type_id = (SELECT id FROM master_types WHERE code = 'business_unit')
    AND mv.code = v.code);

-- Cost centers
INSERT INTO master_values (type_id, code, label, sort_order, is_active)
SELECT (SELECT id FROM master_types WHERE code = 'cost_center'), v.code, v.label, v.ord, true
FROM (VALUES
  ('CC-HO','CC-HO - Head Office',1), ('CC-SALES','CC-SALES - Sales',2),
  ('CC-OPS','CC-OPS - Operations',3), ('CC-TECH','CC-TECH - Technology',4),
  ('CC-FIN','CC-FIN - Finance',5),    ('CC-HR','CC-HR - Human Resources',6),
  ('CC-PLANT','CC-PLANT - Plant',7)
) AS v(code, label, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM master_values mv
  WHERE mv.type_id = (SELECT id FROM master_types WHERE code = 'cost_center')
    AND mv.code = v.code);

-- Currencies. The form takes the leading token as the stored code, so the
-- label must start with the ISO code.
INSERT INTO master_values (type_id, code, label, sort_order, is_active)
SELECT (SELECT id FROM master_types WHERE code = 'currency'), v.code, v.label, v.ord, true
FROM (VALUES
  ('INR','INR - Indian Rupee',1), ('USD','USD - US Dollar',2),
  ('AED','AED - UAE Dirham',3),   ('GBP','GBP - Pound Sterling',4),
  ('EUR','EUR - Euro',5),         ('SGD','SGD - Singapore Dollar',6)
) AS v(code, label, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM master_values mv
  WHERE mv.type_id = (SELECT id FROM master_types WHERE code = 'currency')
    AND mv.code = v.code);

NOTIFY pgrst, 'reload schema';

-- VERIFY — expect business_unit 6, cost_center 7, currency 6.
SELECT mt.code AS master_type, count(mv.id) AS value_count
FROM master_types mt
LEFT JOIN master_values mv ON mv.type_id = mt.id
WHERE mt.code IN ('business_unit','cost_center','currency')
GROUP BY mt.code
ORDER BY mt.code;
