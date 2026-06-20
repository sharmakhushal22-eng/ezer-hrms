-- ============================================================
-- 030_leave_config.sql — EZER HRMS · Leave Configuration
-- Config-driven leave model: leave_types (CATALOG + 16 behaviour flags),
-- leave_policy (company+branch QUOTA, FY-versioned, UNIQUE-guarded),
-- leave_balances, comp_off_ledger, leave_applications, resolve_leave_quota().
-- Seeds the 10 core leave types.
--
-- NOTE: spec called this "028" but 028_role_permissions.sql exists → renumbered 030.
-- NOTE: spec assumed leave tables "already exist (024)" — they do NOT, so this
--       CREATEs them fresh (not ALTER). Depends on employees/companies/locations.
-- Idempotent — safe to re-run. HOW TO RUN: Supabase → SQL Editor → paste → Run.
-- ============================================================

-- ── CATALOG: leave_types — what the leave IS + how it behaves (global) ──
CREATE TABLE IF NOT EXISTS leave_types (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    TEXT NOT NULL,
  short_name              TEXT NOT NULL UNIQUE,                  -- EL/CL/SL... (code)
  -- behaviour flags (the "data not code" core)
  application_mode        TEXT NOT NULL DEFAULT 'EMPLOYEE' CHECK (application_mode IN ('EMPLOYEE','HR_MARK','EARN_AVAIL')),
  eligible_from           TEXT NOT NULL DEFAULT 'DOJ'      CHECK (eligible_from IN ('DOJ','ON_DOJ','AFTER_DAYS','AFTER_PROBATION')),
  min_tenure_days         INTEGER DEFAULT 0,
  probation_eligible      BOOLEAN DEFAULT FALSE,
  probation_limit         NUMERIC(5,1),
  laps                    BOOLEAN DEFAULT FALSE,                 -- lapses at year-end
  encashment_after        NUMERIC(5,1),                         -- balance above this is paid, not carried
  max_times_in_tenure     INTEGER,                              -- NULL = unlimited (ML/PL = 2)
  allow_without_balance   BOOLEAN DEFAULT FALSE,
  auto_mark_absent        BOOLEAN DEFAULT FALSE,
  deduct_salary           BOOLEAN DEFAULT FALSE,
  gender                  TEXT NOT NULL DEFAULT 'ANY' CHECK (gender IN ('ANY','M','F')),
  approval_by             TEXT NOT NULL DEFAULT 'HR_MANAGER' CHECK (approval_by IN ('L1','HR_MANAGER','ASSIGNED')),
  carry_forward_unlimited BOOLEAN DEFAULT FALSE,
  is_system               BOOLEAN DEFAULT FALSE,                 -- protects core types from deletion
  -- catalog defaults (kept from prior model)
  annual_quota            NUMERIC(5,1) DEFAULT 0,
  carry_forward_max       NUMERIC(5,1) DEFAULT 0,
  is_paid                 BOOLEAN DEFAULT TRUE,
  is_encashable           BOOLEAN DEFAULT FALSE,
  allow_half_day          BOOLEAN DEFAULT TRUE,
  accrual                 TEXT DEFAULT 'YEARLY',                 -- YEARLY | MONTHLY | NONE
  doc_required_after      INTEGER,                              -- days before a doc is needed (SL=2)
  color                   TEXT DEFAULT '#7C3AED',
  sort_order              INTEGER DEFAULT 0,
  is_active               BOOLEAN DEFAULT TRUE,
  created_at              TIMESTAMPTZ DEFAULT now()
);

-- ── QUOTA: leave_policy — company+branch days (branch NULL = company default) ──
CREATE TABLE IF NOT EXISTS leave_policy (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  leave_type_id     UUID NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id         UUID REFERENCES locations(id) ON DELETE CASCADE,  -- NULL = all branches of company
  fy                TEXT NOT NULL DEFAULT '2026-27',
  annual_quota      NUMERIC(5,1) DEFAULT 0,
  max_carry_forward NUMERIC(5,1) DEFAULT 0,
  laps              BOOLEAN DEFAULT FALSE,
  is_encashable     BOOLEAN DEFAULT FALSE,
  encashment_after  NUMERIC(5,1),
  accrual           TEXT DEFAULT 'YEARLY',
  is_active         BOOLEAN DEFAULT TRUE,
  created_at        TIMESTAMPTZ DEFAULT now()
);
-- UNIQUE guard — a branch can never sit in two conflicting quotas. Two partial
-- indexes because NULL branch_id needs its own uniqueness (Postgres NULLs are distinct).
CREATE UNIQUE INDEX IF NOT EXISTS uq_leave_policy_branch
  ON leave_policy(leave_type_id, company_id, branch_id, fy) WHERE branch_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_leave_policy_default
  ON leave_policy(leave_type_id, company_id, fy) WHERE branch_id IS NULL;

-- ── leave_balances — per employee, per type, per year ──
CREATE TABLE IF NOT EXISTS leave_balances (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id UUID NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  year          TEXT NOT NULL DEFAULT '2026',
  opening       NUMERIC(6,1) DEFAULT 0,
  accrued       NUMERIC(6,1) DEFAULT 0,
  used          NUMERIC(6,1) DEFAULT 0,
  encashed      NUMERIC(6,1) DEFAULT 0,
  updated_at    TIMESTAMPTZ DEFAULT now(),
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (employee_id, leave_type_id, year)
);

-- ── comp_off_ledger — earn (credit) + avail (debit) ──
CREATE TABLE IF NOT EXISTS comp_off_ledger (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  entry_type  TEXT NOT NULL CHECK (entry_type IN ('EARN','AVAIL')),
  days        NUMERIC(4,1) DEFAULT 1,
  reason      TEXT,
  ref_date    DATE,
  approved_by TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ── leave_applications — ESS apply target (workflow UI is future) ──
CREATE TABLE IF NOT EXISTS leave_applications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id UUID NOT NULL REFERENCES leave_types(id),
  from_date     DATE NOT NULL,
  to_date       DATE NOT NULL,
  days          NUMERIC(4,1),
  half_day      BOOLEAN DEFAULT FALSE,
  reason        TEXT,
  status        TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  approver      TEXT,
  remark        TEXT,
  applied_at    TIMESTAMPTZ DEFAULT now(),
  resolved_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_leave_bal_emp ON leave_balances(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_pol_co  ON leave_policy(company_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_leave_app_emp ON leave_applications(employee_id, status);

-- ── RLS (project standard permissive — anon + authenticated) ──
DO $$ DECLARE t TEXT;
BEGIN FOR t IN SELECT unnest(ARRAY[
  'leave_types','leave_policy','leave_balances','comp_off_ledger','leave_applications']) LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS "allow_all_%s" ON %I', t, t);
  EXECUTE format('CREATE POLICY "allow_all_%s" ON %I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)', t, t);
END LOOP; END $$;

-- ── resolve_leave_quota — eligible types + effective quota for a branch ──
-- branch-specific policy wins → company default (branch NULL) → catalog default.
CREATE OR REPLACE FUNCTION resolve_leave_quota(p_company_id UUID, p_branch_id UUID DEFAULT NULL, p_fy TEXT DEFAULT '2026-27')
RETURNS TABLE(leave_type_id UUID, short_name TEXT, name TEXT, application_mode TEXT, gender TEXT,
              annual_quota NUMERIC, max_carry_forward NUMERIC, source TEXT) AS $$
  SELECT lt.id, lt.short_name, lt.name, lt.application_mode, lt.gender,
    COALESCE(bp.annual_quota, cp.annual_quota, lt.annual_quota),
    COALESCE(bp.max_carry_forward, cp.max_carry_forward, lt.carry_forward_max),
    CASE WHEN bp.id IS NOT NULL THEN 'branch' WHEN cp.id IS NOT NULL THEN 'company' ELSE 'catalog' END
  FROM leave_types lt
  LEFT JOIN leave_policy bp ON bp.leave_type_id = lt.id AND bp.company_id = p_company_id
                           AND bp.branch_id = p_branch_id AND bp.fy = p_fy AND bp.is_active
  LEFT JOIN leave_policy cp ON cp.leave_type_id = lt.id AND cp.company_id = p_company_id
                           AND cp.branch_id IS NULL AND cp.fy = p_fy AND cp.is_active
  WHERE lt.is_active
  ORDER BY lt.sort_order;
$$ LANGUAGE sql STABLE;

-- ── Seed the 10 core leave types (idempotent on short_name) ──
INSERT INTO leave_types
  (name, short_name, application_mode, eligible_from, min_tenure_days, gender, max_times_in_tenure,
   allow_without_balance, auto_mark_absent, deduct_salary, laps, carry_forward_unlimited,
   is_paid, is_encashable, allow_half_day, doc_required_after, annual_quota, is_system, color, sort_order)
VALUES
  ('Earned Leave',        'EL',  'EMPLOYEE',   'DOJ',             0,   'ANY', NULL, false, false, false, false, false, true,  true,  true,  NULL, 0,   true, '#7C3AED', 1),
  ('Casual Leave',        'CL',  'EMPLOYEE',   'DOJ',             0,   'ANY', NULL, false, false, false, true,  false, true,  false, true,  NULL, 0,   true, '#2563EB', 2),
  ('Sick Leave',          'SL',  'EMPLOYEE',   'DOJ',             0,   'ANY', NULL, false, false, false, true,  false, true,  false, true,  2,    0,   true, '#059669', 3),
  ('Maternity Leave',     'ML',  'EMPLOYEE',   'AFTER_DAYS',      80,  'F',   2,    false, false, false, false, false, true,  false, false, NULL, 180, true, '#DB2777', 4),
  ('Paternity Leave',     'PL',  'EMPLOYEE',   'DOJ',             0,   'M',   2,    false, false, false, false, false, true,  false, false, NULL, 0,   true, '#0891B2', 5),
  ('Bereavement Leave',   'BL',  'EMPLOYEE',   'DOJ',             0,   'ANY', NULL, false, false, false, true,  false, true,  false, false, NULL, 0,   true, '#6B7280', 6),
  ('Congratulation Leave','COL', 'EMPLOYEE',   'ON_DOJ',         0,   'ANY', NULL, false, false, false, true,  false, true,  false, false, NULL, 0,   true, '#D97706', 7),
  ('Leave Without Pay',   'LWP', 'EMPLOYEE',   'DOJ',             0,   'ANY', NULL, true,  false, true,  false, true,  false, false, true,  NULL, 0,   true, '#B45309', 8),
  ('Abscond',             'AB',  'HR_MARK',    'DOJ',             0,   'ANY', NULL, false, true,  true,  false, false, false, false, false, NULL, 0,   true, '#DC2626', 9),
  ('Comp Off',            'CP',  'EARN_AVAIL', 'DOJ',             0,   'ANY', NULL, false, false, false, true,  false, true,  false, true,  NULL, 0,   true, '#16A34A', 10)
ON CONFLICT (short_name) DO NOTHING;

notify pgrst, 'reload schema';
