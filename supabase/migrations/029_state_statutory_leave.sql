-- ============================================================
-- 029_state_statutory_leave.sql — EZER HRMS · Statutory Leave Reference
-- State-wise, FY-versioned reference of minimum EL/CL/SL under the
-- Shops & Establishments Acts (state) + Factories Act 1948 (central, state='ALL').
-- Pure reference / advisory data (like PT & LWF) — NO foreign keys, permissive RLS.
-- Consumed (later) by the Leave Policy engine for auto-fill + below-minimum flags.
--
-- NOTE: spec called this "026" but 026_holiday_weekly_config.sql already exists,
--       so this is renumbered to 029.
-- Idempotent — safe to re-run. HOW TO RUN: Supabase → SQL Editor → paste → Run.
-- ============================================================

CREATE TABLE IF NOT EXISTS state_statutory_leave (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state                TEXT NOT NULL,                 -- 'Delhi' ... or 'ALL' for central (Factories Act)
  act_type             TEXT NOT NULL DEFAULT 'SE'
                         CHECK (act_type IN ('SE','FACTORY')),  -- SE = Shops&Estab | FACTORY = Factories Act
  fy                   TEXT NOT NULL DEFAULT '2026-27',
  el_days              NUMERIC(5,1),                  -- earned/privilege (NULL = formula-based)
  cl_days              NUMERIC(5,1),                  -- casual (NULL = no separate CL)
  sl_days              NUMERIC(5,1),                  -- sick (NULL = not specified)
  el_accrual_basis     TEXT,                          -- '1 day per 20 days worked', etc.
  el_carry_forward_max NUMERIC(5,1),                  -- EL accumulation cap
  cl_sl_lapse          BOOLEAN DEFAULT TRUE,          -- CL/SL usually lapse year-end
  notes                TEXT,
  verified_by          TEXT,                          -- admin who confirmed against the live Act
  verified_on          DATE,                          -- when verified (NULL = still 'VERIFY')
  is_active            BOOLEAN DEFAULT TRUE,
  created_at           TIMESTAMPTZ DEFAULT now(),
  UNIQUE (state, act_type, fy)                        -- one row per state+act+FY
);
CREATE INDEX IF NOT EXISTS idx_statutory_leave_state ON state_statutory_leave(state, act_type);

-- ── RLS (project standard permissive — anon + authenticated) ─────────
ALTER TABLE state_statutory_leave ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_state_statutory_leave" ON state_statutory_leave;
CREATE POLICY "allow_all_state_statutory_leave" ON state_statutory_leave
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- ── Seed reference rows (FY 2026-27) — every row marked VERIFY ────────
INSERT INTO state_statutory_leave
  (state, act_type, fy, el_days, cl_days, sl_days, el_accrual_basis, el_carry_forward_max, cl_sl_lapse, notes)
VALUES
  ('Delhi',         'SE',      '2026-27', 15,   12,   12,   'after 12 months service',        45,   true,  'Delhi S&E Act 1954 — VERIFY'),
  ('Maharashtra',   'SE',      '2026-27', 21,   8,    15,   'after 240 days worked',          42,   true,  'Maha S&E 2017; CL quarterly, lapses — VERIFY'),
  ('Karnataka',     'SE',      '2026-27', 18,   NULL, 12,   '1 per 20 days (privilege)',      30,   true,  'KA S&E 1961; no separate casual — VERIFY'),
  ('Tamil Nadu',    'SE',      '2026-27', 12,   NULL, 12,   'privilege leave',                NULL, true,  'TN S&E 1947 — VERIFY casual'),
  ('Uttar Pradesh', 'SE',      '2026-27', 15,   NULL, NULL, 'after 12 months continuous',     NULL, true,  'UP S&E/Dukan Act — VERIFY CL/SL'),
  ('Haryana',       'SE',      '2026-27', NULL, NULL, NULL, '1 per 20 days worked',           NULL, true,  'Punjab S&E Act applies — VERIFY'),
  ('West Bengal',   'SE',      '2026-27', NULL, NULL, 12,   NULL,                             NULL, true,  'WB S&E Act; SL ~12 — VERIFY EL/CL'),
  ('ALL',           'FACTORY', '2026-27', 15,   NULL, NULL, '1 per 20 days; 240-day rule',    30,   false, 'Factories Act 1948 §79; child 1/15, CF 40 — VERIFY')
ON CONFLICT (state, act_type, fy) DO NOTHING;

notify pgrst, 'reload schema';
