-- ════════════════════════════════════════════════════════════════════
-- 026_holiday_weekly_config.sql — EZER HRMS · Holiday & Weekly-off Config
-- Attendance & Leave → Config layer (Layer 1).
-- 6 tables + permissive RLS + 2 resolver functions + idempotent default seed.
--
-- NOTE: spec called this "025" but 025_offer_response_remark.sql already exists,
--       so this is renumbered to 026 (027 = company profile is already in).
-- Depends on existing tables: companies(id), locations(id), employees(id,
--   company_id, location_id, employment_type) — all confirmed live.
-- Supersedes the unused ess_holidays table (migration 021, referenced by no code).
-- Idempotent. HOW TO RUN: Supabase Dashboard → SQL Editor → paste → Run.
-- ════════════════════════════════════════════════════════════════════

-- ── 4.1 holiday_calendar — the cycle ─────────────────────────────────
CREATE TABLE IF NOT EXISTS holiday_calendar (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  calendar_type TEXT NOT NULL DEFAULT 'HOLIDAY' CHECK (calendar_type IN ('HOLIDAY','LEAVE')),
  from_date     DATE,
  to_date       DATE,
  status        TEXT NOT NULL DEFAULT 'DRAFT'   CHECK (status IN ('DRAFT','PUBLISHED')),
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ── 4.2 company_calendar_map — which calendar a company follows ──────
CREATE TABLE IF NOT EXISTS company_calendar_map (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
  holiday_calendar_id UUID REFERENCES holiday_calendar(id) ON DELETE SET NULL,
  leave_calendar_id   UUID REFERENCES holiday_calendar(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- ── 4.3 holiday_entries — each holiday line ──────────────────────────
CREATE TABLE IF NOT EXISTS holiday_entries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id   UUID NOT NULL REFERENCES holiday_calendar(id) ON DELETE CASCADE,
  holiday_date  DATE NOT NULL,
  description   TEXT NOT NULL,
  holiday_type  TEXT NOT NULL DEFAULT 'FESTIVAL'
                  CHECK (holiday_type IN ('NATIONAL','FESTIVAL','DISCRETIONARY','REGIONAL','OPTIONAL')),
  is_optional   BOOLEAN DEFAULT FALSE,
  on_weekly_off BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hol_entries_cal ON holiday_entries(calendar_id, holiday_date);

-- ── 4.4 holiday_applicability — holiday × company × branch ───────────
-- branch_id NULL = all branches of that company.
CREATE TABLE IF NOT EXISTS holiday_applicability (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_id UUID NOT NULL REFERENCES holiday_entries(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id  UUID REFERENCES locations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hol_appl_holiday ON holiday_applicability(holiday_id);
CREATE INDEX IF NOT EXISTS idx_hol_appl_company ON holiday_applicability(company_id, branch_id);

-- ── 4.5 holiday_override_log — weekend-override audit ────────────────
CREATE TABLE IF NOT EXISTS holiday_override_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_id   UUID REFERENCES holiday_entries(id) ON DELETE CASCADE,
  holiday_date DATE,
  weekday      TEXT,
  confirmed_by TEXT,
  note         TEXT,
  confirmed_at TIMESTAMPTZ DEFAULT now()
);

-- ── 4.6 weekly_off_config — weekly off rules ─────────────────────────
-- weekday: 0=Sun .. 6=Sat (Postgres DOW). NULL scope = all.
CREATE TABLE IF NOT EXISTS weekly_off_config (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id     UUID REFERENCES holiday_calendar(id) ON DELETE CASCADE,
  weekday         SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  mode            TEXT NOT NULL DEFAULT 'EVERY' CHECK (mode IN ('EVERY','NTH')),
  nth_occurrences INT[],
  is_primary      BOOLEAN DEFAULT FALSE,
  company_id      UUID REFERENCES companies(id) ON DELETE CASCADE,
  branch_id       UUID REFERENCES locations(id) ON DELETE CASCADE,
  employment_type TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_weekly_off_scope ON weekly_off_config(company_id, branch_id);

-- ── RLS (project standard permissive — anon + authenticated) ─────────
-- (Critical: without an anon policy the app's anon key reads zero rows.)
DO $$ DECLARE t TEXT;
BEGIN FOR t IN SELECT unnest(ARRAY[
  'holiday_calendar','company_calendar_map','holiday_entries',
  'holiday_applicability','holiday_override_log','weekly_off_config']) LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS "allow_all_%s" ON %I', t, t);
  EXECUTE format('CREATE POLICY "allow_all_%s" ON %I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)', t, t);
END LOOP; END $$;

-- ── Resolver: published holidays for an employee (company + branch) ──
-- Joins company_calendar_map so an employee only ever sees holidays from
-- THEIR mapped, PUBLISHED holiday calendar; applicability scopes company/branch.
-- DISTINCT prevents a company-wide + branch-specific match doubling up.
CREATE OR REPLACE FUNCTION resolve_holidays(p_employee_id UUID)
RETURNS TABLE(holiday_date DATE, description TEXT, holiday_type TEXT, is_optional BOOLEAN) AS $$
  SELECT DISTINCT he.holiday_date, he.description, he.holiday_type, he.is_optional
  FROM employees e
  JOIN company_calendar_map ccm ON ccm.company_id = e.company_id
  JOIN holiday_calendar hc      ON hc.id = ccm.holiday_calendar_id
                               AND hc.status = 'PUBLISHED'
                               AND hc.calendar_type = 'HOLIDAY'
  JOIN holiday_entries he       ON he.calendar_id = hc.id
                               AND he.holiday_date BETWEEN hc.from_date AND hc.to_date
  JOIN holiday_applicability ha ON ha.holiday_id = he.id
                               AND ha.company_id = e.company_id
                               AND (ha.branch_id IS NULL OR ha.branch_id = e.location_id)
  WHERE e.id = p_employee_id
  ORDER BY he.holiday_date;
$$ LANGUAGE sql STABLE;

-- ── Resolver: weekly-off dates for an employee over a date range ─────
-- Scoped by company / branch / employment_type (NULL = all). NTH = floor((day-1)/7)+1.
CREATE OR REPLACE FUNCTION resolve_weekly_offs(p_employee_id UUID, p_from DATE, p_to DATE)
RETURNS TABLE(off_date DATE) AS $$
  SELECT DISTINCT d::date AS off_date
  FROM employees e
  CROSS JOIN generate_series(p_from, p_to, interval '1 day') AS d
  JOIN weekly_off_config w
    ON w.weekday = EXTRACT(DOW FROM d)::smallint
   AND ( w.mode = 'EVERY'
         OR (w.mode = 'NTH'
             AND (FLOOR((EXTRACT(DAY FROM d)::int - 1) / 7) + 1) = ANY(w.nth_occurrences)) )
   AND (w.company_id IS NULL OR w.company_id = e.company_id)
   AND (w.branch_id  IS NULL OR w.branch_id  = e.location_id)
   AND (w.employment_type IS NULL OR w.employment_type = e.employment_type)
  WHERE e.id = p_employee_id
  ORDER BY off_date;
$$ LANGUAGE sql STABLE;

-- ── Default seed (idempotent): FY 2026-27 DRAFT calendar + Sunday off ─
INSERT INTO holiday_calendar (name, calendar_type, from_date, to_date, status)
SELECT 'FY 2026-27 Holiday Calendar', 'HOLIDAY', DATE '2026-04-01', DATE '2027-03-31', 'DRAFT'
WHERE NOT EXISTS (SELECT 1 FROM holiday_calendar WHERE name = 'FY 2026-27 Holiday Calendar');

INSERT INTO weekly_off_config (calendar_id, weekday, mode, is_primary)
SELECT NULL, 0, 'EVERY', TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM weekly_off_config WHERE weekday = 0 AND mode = 'EVERY' AND is_primary = TRUE
);

notify pgrst, 'reload schema';
